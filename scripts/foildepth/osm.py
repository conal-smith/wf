"""OpenStreetMap's land and water, as a hard mask for the foilable depth.

The depth layer's own idea of where the water is came from EMODnet's coarse
DTM and the satellite waterlines, and it was wrong at the shore: fields north
of the Malahide lagoon drawn as tidal flats (EMODnet's 115 m land cells at
0.4-1.1 m LAT), the lagoon's western half drawn as land (no source at all).
OSM's coastline is mapped from imagery at about mean high water and is what
the basemap draws, so the layer now takes it as the shore:

- **sea**: outside OSM's land polygons (built from the coastline by
  osmdata.openstreetmap.de), plus tidal water mapped inland of the coastline
  (`natural=water` with `tidal=yes` or `water=lagoon`, tidal rivers and
  `wetland=tidalflat`), where it joins the sea. It is water at every pixel:
  never drawn as land.
- **shore**: beaches, sand, shingle, shoals, mud and salt marsh joined to the
  sea (`natural=beach|sand|shingle|shoal|mud`, `wetland=saltmarsh`). Above
  the coastline, so they may be foreshore: drawn where a survey's height says
  the tide reaches them (under the dry ceiling), land where it does not.
- everything else is **land**, never drawn, whatever a source's height.

Two steps:

    python -I osm.py extract --land <land_polygons.shp> --pbf <ireland.osm.pbf> --out <data>/osm [--bbox w,s,e,n]

writes the land polygons clipped to 0.5-degree tiles (`land/<w>_<s>_<e>_<n>.json`)
and the tidal features (`tidal.json`), both GeoJSON in lon/lat; then the
builds call `water_mask` on each grid. Only `extract` needs pyshp and
osmium (pyosmium); `water_mask` needs rasterio and scipy, as the build does.

Data: https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip
and https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf;
© OpenStreetMap contributors, ODbL.
"""
import argparse
import glob
import json
import math
import os
import sys

import numpy as np

TILE_DEGREES = 0.5
BBOX = (-11.0, 51.2, -5.2, 55.6)

# What OSM says of a feature mapped inland of the coastline. "sea": water at
# every tide or most (tidal water, lagoons, tidal flats); "shore": ground the
# tide may reach (beaches, sand, marsh), drawn only where a height says so.
SEA_WATER = {"lagoon", "tidal"}
SHORE_NATURAL = {"beach", "sand", "shingle", "shoal", "mud"}
SHORE_WETLAND = {"saltmarsh"}
SEA_WETLAND = {"tidalflat"}


def classify(tags):
    """'sea', 'shore' or None for a feature's tags (a dict)."""
    natural = tags.get("natural")
    tidal = tags.get("tidal") == "yes"
    if natural == "water" and (tidal or tags.get("water") in SEA_WATER):
        return "sea"
    if tags.get("waterway") == "riverbank" and tidal:
        return "sea"
    if natural == "wetland":
        w = tags.get("wetland")
        if w in SEA_WETLAND:
            return "sea"
        if w in SHORE_WETLAND or tidal:
            return "shore"
        return None
    if natural in SHORE_NATURAL:
        return "shore"
    return None


def tile_name(w, s):
    return f"{w:.1f}_{s:.1f}_{w + TILE_DEGREES:.1f}_{s + TILE_DEGREES:.1f}"


def extract_land(shp, bbox, out_dir):
    import shapefile  # pyshp
    from shapely.geometry import box, mapping, shape
    from shapely.ops import unary_union

    w0, s0, e0, n0 = bbox
    reader = shapefile.Reader(shp)
    tiles = {}
    for shp_ in reader.iterShapes(bbox=[w0, s0, e0, n0]):
        if shp_ is None or not shp_.points:
            continue
        geom = shape(shp_.__geo_interface__)
        if not geom.is_valid:
            geom = geom.buffer(0)
        x0, y0, x1, y1 = geom.bounds
        for tw in np.arange(math.floor(x0 / TILE_DEGREES) * TILE_DEGREES, x1, TILE_DEGREES):
            for ts in np.arange(math.floor(y0 / TILE_DEGREES) * TILE_DEGREES, y1, TILE_DEGREES):
                tw, ts = round(float(tw), 1), round(float(ts), 1)
                if tw + TILE_DEGREES < w0 or tw > e0 or ts + TILE_DEGREES < s0 or ts > n0:
                    continue
                part = geom.intersection(box(tw, ts, tw + TILE_DEGREES, ts + TILE_DEGREES))
                if not part.is_empty:
                    tiles.setdefault((tw, ts), []).append(part)
    os.makedirs(os.path.join(out_dir, "land"), exist_ok=True)
    total = 0
    for (tw, ts), parts in sorted(tiles.items()):
        merged = unary_union(parts)
        polys = [merged] if merged.geom_type == "Polygon" else [g for g in getattr(merged, "geoms", []) if g.geom_type == "Polygon"]
        feats = [{"type": "Feature", "properties": {}, "geometry": mapping(p)} for p in polys]
        total += len(feats)
        with open(os.path.join(out_dir, "land", tile_name(tw, ts) + ".json"), "w") as fh:
            json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
    print(f"land: {total} polygons in {len(tiles)} tiles → {out_dir}/land")


def extract_tidal(pbf, bbox, out_dir):
    import osmium

    w0, s0, e0, n0 = bbox
    factory = osmium.geom.GeoJSONFactory()
    feats = []
    counts = {}
    fp = (osmium.FileProcessor(pbf)
          .with_areas(osmium.filter.KeyFilter("natural", "waterway"))
          .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA)))
    for area in fp:
        tags = {t.k: t.v for t in area.tags}
        kind = classify(tags)
        if kind is None:
            continue
        try:
            geom = json.loads(factory.create_multipolygon(area))
        except Exception:  # a broken multipolygon: skipped, as the basemap would
            continue
        xs = [p[0] for poly in geom["coordinates"] for ring in poly for p in ring]
        ys = [p[1] for poly in geom["coordinates"] for ring in poly for p in ring]
        if max(xs) < w0 or min(xs) > e0 or max(ys) < s0 or min(ys) > n0:
            continue
        key = f"{kind}:{tags.get('natural')}/{tags.get('water') or tags.get('wetland') or ''}"
        counts[key] = counts.get(key, 0) + 1
        feats.append({"type": "Feature",
                      "properties": {"kind": kind, "bbox": [min(xs), min(ys), max(xs), max(ys)],
                                     "osm": f"{'w' if area.from_way() else 'r'}{area.orig_id()}",
                                     **{k: tags[k] for k in ("natural", "water", "wetland", "tidal", "name") if k in tags}},
                      "geometry": geom})
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "tidal.json"), "w") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
    print(f"tidal: {len(feats)} features → {out_dir}/tidal.json")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")


# ---- the mask on a grid -------------------------------------------------------


def _merc_geom(geom):
    """A GeoJSON (Multi)Polygon in lon/lat to Web Mercator metres."""
    def ring(r):
        a = np.asarray(r, dtype=np.float64)[:, :2]
        x = np.radians(a[:, 0]) * 6378137.0
        y = np.log(np.tan(np.pi / 4 + np.radians(np.clip(a[:, 1], -85, 85)) / 2)) * 6378137.0
        return np.column_stack([x, y]).tolist()
    if geom["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in geom["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in geom["coordinates"]]}


def _rasterize(geoms, transform, shape):
    """Burn (Web Mercator) polygons into a grid at pixel centres."""
    from rasterio import features
    shapes = [(g, 1) for g in geoms]
    if not shapes:
        return np.zeros(shape, dtype=bool)
    return features.rasterize(shapes, out_shape=shape, transform=transform, dtype="uint8").astype(bool)


def _lonlat_bounds(transform, shape):
    h, w = shape
    x0, y1 = transform.c, transform.f
    x1, y0 = x0 + w * transform.a, y1 - h * transform.a
    lon = np.degrees(np.array([x0, x1]) / 6378137.0)
    lat = np.degrees(2 * np.arctan(np.exp(np.array([y0, y1]) / 6378137.0)) - np.pi / 2)
    return float(lon[0]), float(lat[0]), float(lon[1]), float(lat[1])


_tidal_cache = {}
_land_cache = {}


def _tidal(osm_dir):
    if osm_dir not in _tidal_cache:
        path = os.path.join(osm_dir, "tidal.json")
        feats = []
        if os.path.exists(path):
            with open(path) as fh:
                feats = json.load(fh)["features"]
        for f in feats:
            f["merc"] = _merc_geom(f["geometry"])
        _tidal_cache[osm_dir] = feats
    return _tidal_cache[osm_dir]


def water_mask(osm_dir, transform, shape, join_pixels=3):
    """(sea, shore) on a Web Mercator grid, from `extract`'s files.

    `sea` is water at every pixel: outside OSM's land polygons, or tidal
    water inland of the coastline that joins it. `shore` is ground the tide
    may reach (a beach, marsh) joined to the sea. A feature joins the sea if
    it is within `join_pixels` of it, directly or through other such
    features: a lagoon behind a shingle bar (Lady's Island Lake) does not."""
    from scipy import ndimage

    w, s, e, n = _lonlat_bounds(transform, shape)
    land_geoms = []
    for path in glob.glob(os.path.join(osm_dir, "land", "*.json")):
        try:
            bw, bs, be, bn = (float(v) for v in os.path.basename(path)[:-5].split("_"))
        except ValueError:
            continue
        if bw > e or be < w or bs > n or bn < s:
            continue
        if path not in _land_cache:
            with open(path) as fh:
                _land_cache[path] = [_merc_geom(f["geometry"]) for f in json.load(fh)["features"]]
        land_geoms += _land_cache[path]
    if not glob.glob(os.path.join(osm_dir, "land", "*.json")):
        raise SystemExit(f"no OSM land polygons under {osm_dir}/land (osm.py extract)")
    land = _rasterize(land_geoms, transform, shape)
    sea = ~land
    near = [f for f in _tidal(osm_dir)
            if not (f["properties"]["bbox"][0] > e or f["properties"]["bbox"][2] < w
                    or f["properties"]["bbox"][1] > n or f["properties"]["bbox"][3] < s)]
    tidal_sea = _rasterize([f["merc"] for f in near if f["properties"]["kind"] == "sea"], transform, shape) & land
    shore = _rasterize([f["merc"] for f in near if f["properties"]["kind"] == "shore"], transform, shape) & land
    # Tidal water joins the sea through water only (a lagoon behind a
    # shingle bar is not joined by the beach on the bar); a beach or marsh
    # through the sea or tidal water.
    def joined_to(feats, water):
        grown = ndimage.binary_dilation(feats, iterations=join_pixels)
        labels, _ = ndimage.label(grown, structure=np.ones((3, 3)))
        touching = np.unique(labels[water & grown])
        return np.isin(labels, touching[touching > 0]) & feats

    sea = sea | joined_to(tidal_sea, sea)
    shore = joined_to(shore, sea) & ~sea
    return sea, shore


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="step", required=True)
    x = sub.add_parser("extract")
    x.add_argument("--land", required=True, help="land_polygons.shp (land-polygons-split-4326)")
    x.add_argument("--pbf", required=True, help="an OSM extract covering the bbox (.osm.pbf)")
    x.add_argument("--out", required=True)
    x.add_argument("--bbox", default=",".join(str(v) for v in BBOX))
    a = p.parse_args()
    bbox = tuple(float(v) for v in a.bbox.split(","))
    extract_land(a.land, bbox, a.out)
    extract_tidal(a.pbf, bbox, a.out)


if __name__ == "__main__":
    sys.exit(main())
