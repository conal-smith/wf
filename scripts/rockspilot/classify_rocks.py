"""Rock and weed-covered rock on the foreshore, as polygons with a confidence; and a check against OSM.

A score from four memberships (0..1 each, averaged), from rock_features.py:

- dark:       vis 0.09 -> 0.05 (sand is 0.08-0.14 at low water, wrack-covered rock 0.02-0.07)
- weed:       NDVI 0.15 -> 0.40 (exposed wrack and kelp; bare sand ~0.05-0.1)
- persistent: weed in 30% -> 80% of years (wrack is on the rock every year; Ulva blooms and
              seagrass on mud come and go, and mud's diatom film is weak)
- textured:   3x3 brightness spread 0.03 -> 0.10 (a rocky shore is patchy at 10 m; flats are smooth)

Texture is measured among foreshore neighbours only (an edge against the sea or the land is a
contrast, not a rough surface). A pixel of the satellite intertidal (or within 20 m of it, rock
tops that never cover in the scenes) scoring 0.6 or more, with some texture, is rock; 0.8 or more
is high confidence. A polygon lying mostly along the landward edge is flagged a shoreline fringe
(low confidence: sea wall, rock armour, or a marsh or dune edge seen as mixed pixels). Groups of fewer than
3 pixels (300 m2) are dropped: 10 m pixels see reefs and platforms, not single boulders.
Bare rock with no weed (upper-shore, scoured) scores only on dark/texture and is mostly missed.

Each polygon carries its pixels' flip heights (the tide level, at the tide station, at which
they cover and uncover): z_min (the lowest part seen to dry), z_median, and the share of its
pixels that never dried in the scenes (below the lowest tide seen: the reef goes on deeper).

    python -I classify_rocks.py --area down --s2 .. --out <out>/down
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.features import shapes  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402
import feature_stats  # noqa: E402


def ramp(x, lo, hi):
    """0 at lo, 1 at hi (either direction); NaN stays NaN."""
    return np.clip((x - lo) / (hi - lo), 0, 1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--threshold", type=float, default=0.6)
    p.add_argument("--high", type=float, default=0.8)
    p.add_argument("--min-pixels", type=int, default=3)
    args = p.parse_args()
    meta = common.grid(args.s2, args.area)
    out = args.out
    with rasterio.open(out / f"{args.area}-rock-features.tif") as src:
        f = {name: band for name, band in zip(src.descriptions, src.read())}
    with rasterio.open(out / f"{args.area}-heights.tif") as src:
        z = src.read(1)
        zall = src.read(2)
        lush = src.read(7)
    inter = np.load(out / f"{args.area}-intertidal.npy")
    state = np.load(out / f"{args.area}-state.npy")
    sea = np.load(out / f"{args.area}-sea.npy")

    enough = f["n_looks"] >= 8
    # The foreshore: the satellite intertidal, plus up to 20 m beside it that is not lush land
    # (reef tops above the highest tide seen, or pixels the intertidal mask's misfit cut dropped).
    zone = inter | (ndimage.binary_dilation(inter, iterations=2) & (lush < 0.5) & ~sea)
    # Texture among foreshore neighbours only, so that the edge against the sea or the land
    # (a contrast, not a rough surface) does not count.
    vis = np.where(zone & np.isfinite(f["vis"]), f["vis"], 0.0)
    w = (zone & np.isfinite(f["vis"])).astype(np.float32)
    k = np.ones((3, 3), np.float32)
    sw = ndimage.convolve(w, k, mode="constant")
    mean = ndimage.convolve(vis, k, mode="constant") / np.maximum(sw, 1)
    var = ndimage.convolve(vis ** 2, k, mode="constant") / np.maximum(sw, 1) - mean ** 2
    texture = np.where(sw >= 5, np.sqrt(np.maximum(var, 0)) / np.maximum(mean, 1e-3), np.nan)

    m_dark = ramp(f["vis"], 0.09, 0.05)
    m_weed = ramp(f["ndvi"], 0.15, 0.40)
    m_pers = ramp(f["veg_years"], 0.3, 0.8)
    m_tex = np.nan_to_num(ramp(texture, 0.03, 0.10))
    score = (m_dark + m_weed + m_pers + m_tex) / 4
    # A smooth surface is a flat (with weed, seagrass or marsh on it), not a reef.
    rock = zone & enough & (score >= args.threshold) & (m_tex >= 0.25)
    rock = ndimage.binary_opening(rock, structure=np.ones((2, 2))) | (rock & (score >= args.high))
    lab, n = ndimage.label(rock)
    sizes = np.bincount(lab.ravel())
    small = sizes < args.min_pixels
    small[0] = True
    rock = ~small[lab]
    lab, n = ndimage.label(rock)

    common.write_tif(out / f"{args.area}-rock-score.tif", [np.where(zone & enough, score, np.nan), rock.astype(np.float32)],
                     meta, ["rock_score", "rock_mask"])
    # Land beside the foreshore: a strip of "rock" along it, a pixel or two wide, is as likely a
    # sea wall, rock armour, or a marsh or dune edge seen as mixed pixels as a reef.
    land = ~zone & ~sea & (state != 2)
    by_land = ndimage.binary_dilation(land, iterations=3)

    # Polygons with their properties.
    features = []
    T = common.transform(meta)
    objects = ndimage.find_objects(lab)
    for i, sl in enumerate(objects, 1):
        if sl is None:
            continue
        m = lab[sl] == i
        sc = score[sl][m]
        zz = z[sl][m]
        za = zall[sl][m]
        st = state[sl][m]
        zf = zz[np.isfinite(zz)]
        za_f = za[np.isfinite(za)]
        conf = float(np.nanmean(sc))
        # Thin (mostly gone after a one-pixel erosion) and along the land.
        core = ndimage.binary_erosion(np.pad(m, 1), structure=np.ones((3, 3)))[1:-1, 1:-1]
        fringe = bool(by_land[sl][m].mean() >= 0.6 and core.sum() < 0.3 * m.sum())
        props = {
            "id": f"{args.area}-rock-{i}",
            "confidence": round(conf, 2),
            "confidenceClass": "low" if fringe else ("high" if conf >= args.high else "medium"),
            "shorelineFringe": fringe,
            "kind": "weed-covered rock" if np.nanmedian(f["ndvi"][sl][m]) >= 0.3 else "rock (little weed)",
            "areaM2": int(m.sum() * 100),
            "pixels": int(m.sum()),
            # Flip heights (tide-station datum): where it covers/uncovers.
            "zMin": round(float(zf.min()), 2) if len(zf) else None,
            "zMedian": round(float(np.median(zf)), 2) if len(zf) else (round(float(np.median(za_f)), 2) if len(za_f) else None),
            "zMax": round(float(zf.max()), 2) if len(zf) else None,
            "shareNeverDried": round(float((st == 2).mean()), 2),
            "shareNeverCovered": round(float((st == 3).mean()), 2),
        }
        geoms = [g for g, v in shapes(m.astype(np.uint8), mask=m,
                                      transform=T * T.translation(sl[1].start, sl[0].start)) if v == 1]
        polys = [transform_geom(f"EPSG:{meta['epsg']}", "EPSG:4326", g, precision=6) for g in geoms]
        geom = polys[0] if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": [pg["coordinates"] for pg in polys]}
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    features.sort(key=lambda ft: -ft["properties"]["areaM2"])
    heights_meta = json.loads((out / f"{args.area}-heights.json").read_text())
    fc = {"type": "FeatureCollection",
          "name": f"{args.area} rocks and reefs from Sentinel-2 (pilot)",
          "datum": "flip heights in metres above the tide station's datum (LAT at Howth for Dublin; Killard Point chart datum for Co. Down)",
          "tideRangeSeen": heights_meta["tide_range_kept"],
          "attribution": "Contains modified Copernicus Sentinel data 2017-2026",
          "features": features}
    (out / f"{args.area}-rocks.geojson").write_text(json.dumps(fc))

    # Against OSM.
    osm_rock = feature_stats.osm_mask(out / f"{args.area}-osm.geojson", "rock", meta)
    osm_soft = feature_stats.osm_mask(out / f"{args.area}-osm.geojson", "soft", meta)
    near_rock = ndimage.binary_dilation(osm_rock, iterations=2)
    zone_osm = osm_rock & zone & enough
    osm_feats = [ft for ft in json.load(open(out / f"{args.area}-osm.geojson"))["features"]
                 if ft["properties"]["class"] == "rock"]
    found = 0
    considered = 0
    rock_near = ndimage.binary_dilation(rock, iterations=2)
    for ft in osm_feats:
        g = transform_geom("EPSG:4326", f"EPSG:{meta['epsg']}", ft["geometry"])
        from rasterio.features import rasterize
        if g["type"] == "Point":
            col, row = ~T * tuple(g["coordinates"])
            r, c = int(row), int(col)
            if not (0 <= r < rock.shape[0] and 0 <= c < rock.shape[1]) or not zone[max(r - 2, 0):r + 3, max(c - 2, 0):c + 3].any():
                continue
            considered += 1
            found += bool(rock_near[r, c])
            continue
        mm = rasterize([g], out_shape=rock.shape, transform=T, all_touched=True).astype(bool)
        if not (mm & zone).any():
            continue
        considered += 1
        found += bool((mm & rock_near).any())
    check = {
        "rock_pixels": int(rock.sum()), "rock_km2": round(float(rock.sum()) * 1e-4, 3), "polygons": len(features),
        "high_confidence_polygons": sum(ft["properties"]["confidenceClass"] == "high" for ft in features),
        "medium_confidence_polygons": sum(ft["properties"]["confidenceClass"] == "medium" for ft in features),
        "fringe_polygons": sum(ft["properties"]["shorelineFringe"] for ft in features),
        "rock_km2_not_fringe": round(sum(ft["properties"]["areaM2"] for ft in features if not ft["properties"]["shorelineFringe"]) * 1e-6, 3),
        "osm_rock_pixels_on_foreshore": int(zone_osm.sum()),
        "osm_rock_pixels_detected_share": round(float((rock & zone_osm).sum() / max(zone_osm.sum(), 1)), 3),
        "detected_pixels_within_20m_of_osm_rock_share": round(float((rock & near_rock).sum() / max(rock.sum(), 1)), 3),
        "detected_pixels_inside_osm_sand_or_flats": int((rock & osm_soft & ~near_rock).sum()),
        "osm_soft_pixels_on_foreshore": int((osm_soft & zone & enough & ~near_rock).sum()),
        "osm_soft_false_positive_share": round(float((rock & osm_soft & ~near_rock).sum() / max((osm_soft & zone & enough & ~near_rock).sum(), 1)), 3),
        "osm_rock_features_on_foreshore": considered, "osm_rock_features_detected": found,
    }
    (out / f"{args.area}-rocks-vs-osm.json").write_text(json.dumps(check, indent=1))
    print(args.area, json.dumps(check))


if __name__ == "__main__":
    main()
