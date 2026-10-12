"""Intertidal heights from Sentinel-2 waterlines at known tides.

For every usable scene: a water mask (NDWI = (green - NIR)/(green + NIR) > 0, the
rule DEA Intertidal uses on Sentinel-2), cloud, shadow and haze masked out
(SCL plus our own checks). Scenes are then checked against the pixels that
are wet or dry in nearly all scenes; one that disagrees with them more than
--max-scene-error (haze, glint, a missed cloud, surf) is dropped.

Each pixel's height is the tide level at which it flips: with the scenes
sorted by tide, the threshold that best separates "dry when the tide was
below it" from "wet when above" (fewest contradictions). Its misfit (the
share of scenes that contradict the threshold) is its confidence. A pixel wet
in every scene is "below the lowest tide seen"; dry in every scene, above
the highest. Heights are in the tide's datum (LAT at Howth for Dublin, Killard
chart datum for Co. Down) and in the tide station's terms: a pixel inside an
estuary that floods late gets the Howth level at which it floods, which is
what the app needs (it draws depth from Howth's curve).

    python -I build_heights.py --area dublin --s2 <dl>/s2 --tide <dl>/tide --model-tide <out>/tide --out <out>/dublin
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402


def water_masks(s2, area, stamps):
    """int8 stack: 1 wet, 0 dry, -1 masked; and per pixel the share of dry looks that were
    lush land vegetation (NDVI > 0.7: grass and crops, not seaweed or saltmarsh)."""
    first = common.load_scene(s2, area, stamps[0])
    stack = np.empty((len(stamps),) + first["B03"].shape, dtype=np.int8)
    lush = np.zeros(first["B03"].shape, np.int32)
    drys = np.zeros(first["B03"].shape, np.int32)
    for i, stamp in enumerate(stamps):
        scene = common.load_scene(s2, area, stamp)
        refl = common.reflectance(scene)
        wet = (common.ndwi(refl) > 0).astype(np.int8)
        wet[common.bad_mask(scene)] = -1
        stack[i] = wet
        lush += (wet == 0) & (common.ndvi(refl) > 0.7)
        drys += wet == 0
    return stack, lush / np.maximum(drys, 1)


def flip_heights(stack, tides):
    """Per pixel: the threshold between sorted tides with the fewest contradictions."""
    order = np.argsort(tides)
    t = tides[order]
    n, h, w = stack.shape
    z = np.full((h, w), np.nan, np.float32)
    misfit = np.full((h, w), np.nan, np.float32)
    nvalid = np.zeros((h, w), np.int16)
    state = np.zeros((h, w), np.int8)  # 0 no data, 1 flips, 2 always wet, 3 always dry
    spread = np.full((h, w), np.nan, np.float32)
    # Candidate thresholds: below every scene (k=0), between k-1 and k, above all (k=n).
    mids = np.concatenate([[t[0] - 0.05], (t[:-1] + t[1:]) / 2, [t[-1] + 0.05]])
    for r0 in range(0, h, 64):
        block = stack[order, r0:r0 + 64]  # (n, rows, w)
        wet = (block == 1).astype(np.int16)
        dry = (block == 0).astype(np.int16)
        cw = np.concatenate([np.zeros((1,) + wet.shape[1:], np.int16), np.cumsum(wet, 0)])  # wet below k
        cd = np.concatenate([np.zeros((1,) + dry.shape[1:], np.int16), np.cumsum(dry, 0)])
        errors = cw + (cd[-1:] - cd)  # wet below the threshold + dry above it
        best = errors.min(0)
        ties = errors == best[None]
        # Middle of the tied thresholds; their spread says how well the tides pin it.
        kk = np.arange(n + 1)[:, None, None]
        tie_count = ties.sum(0)
        kmid = np.round((ties * kk).sum(0) / np.maximum(tie_count, 1)).astype(int)
        lo = np.where(ties, kk, n + 1).min(0)
        hi = np.where(ties, kk, -1).max(0)
        valid = cw[-1] + cd[-1]
        rows = slice(r0, r0 + block.shape[1])
        nvalid[rows] = valid
        misfit[rows] = np.where(valid > 0, best / np.maximum(valid, 1), np.nan)
        zz = mids[kmid]
        st = np.where(valid == 0, 0, np.where(kmid == 0, 2, np.where(kmid == n, 3, 1)))
        z[rows] = np.where(st == 1, zz, np.nan)
        spread[rows] = np.where(st == 1, mids[np.clip(hi, 0, n)] - mids[np.clip(lo, 0, n)], np.nan)
        state[rows] = st
    return z, misfit, nvalid, state, spread


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--tide", required=True, type=Path)
    p.add_argument("--model-tide", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--max-scene-error", type=float, default=0.06)
    p.add_argument("--min-valid", type=int, default=30)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    meta = common.grid(args.s2, args.area)
    levels = common.tide_levels(args.area, args.tide, args.model_tide)
    stamps = sorted(k for k, v in levels.items() if v[0] is not None)
    tides = np.array([levels[k][0] for k in stamps], dtype=np.float32)
    print(f"{args.area}: {len(stamps)} scenes with a tide, {tides.min():.2f}..{tides.max():.2f} m", flush=True)
    stack, lush = water_masks(args.s2, args.area, stamps)

    # Scene QC against pixels that are nearly always wet or always dry.
    valid = stack >= 0
    freq = (stack == 1).sum(0) / np.maximum(valid.sum(0), 1)
    always_wet, always_dry = freq > 0.97, freq < 0.03
    # Only near the coast: within 600 m of the always-wet sea.
    near = ndimage.binary_dilation(always_wet, iterations=60)
    ref_wet, ref_dry = always_wet & near, always_dry & near
    errors = []
    for i in range(len(stamps)):
        s = stack[i]
        e_w = ((s == 0) & ref_wet).sum() / max(((s >= 0) & ref_wet).sum(), 1)
        e_d = ((s == 1) & ref_dry).sum() / max(((s >= 0) & ref_dry).sum(), 1)
        cover = ((s >= 0) & near).sum() / max(near.sum(), 1)
        errors.append((e_w, e_d, cover))
    keep = np.array([max(ew, ed) <= args.max_scene_error and cov >= 0.5 for ew, ed, cov in errors])
    print(f"  scene QC: kept {keep.sum()} of {len(stamps)}", flush=True)
    stack, tides_k = stack[keep], tides[keep]
    kept_stamps = [s for s, k in zip(stamps, keep) if k]

    z, misfit, nvalid, state, spread = flip_heights(stack, tides_k)
    # The lowest and highest 15% of scenes (for the months they fall in).
    low = tides_k <= np.percentile(tides_k, 15)
    high = tides_k >= np.percentile(tides_k, 85)
    v = stack >= 0
    freq = (stack == 1).sum(0) / np.maximum(v.sum(0), 1)

    # Keep what is connected to the sea through ever-wet water, and not inland ponds or wet fields.
    sea = (freq > 0.97) & (nvalid >= args.min_valid)
    lab, _ = ndimage.label(sea)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    sea = lab == sizes.argmax()
    ever = (freq > 0.03) & (nvalid >= args.min_valid)
    lab, _ = ndimage.label(ever | sea)
    connected = np.isin(lab, np.unique(lab[sea]))
    # Seen dry below its flip at least 3 times and wet above it at least 3 times. (Requiring it to
    # be dry in most of the lowest 15% of scenes cut everything under about 1.3 m.)
    dry_below = np.zeros(z.shape, np.int16)
    wet_above = np.zeros(z.shape, np.int16)
    for i, t in enumerate(tides_k):
        dry_below += (stack[i] == 0) & (t < z)
        wet_above += (stack[i] == 1) & (t > z)
    intertidal = (connected & (lush < 0.5) & (state == 1) & (dry_below >= 3) & (wet_above >= 3)
                  & (misfit < 0.2) & (nvalid >= args.min_valid))
    zi = np.where(intertidal, z, np.nan)

    common.write_tif(args.out / f"{args.area}-heights.tif",
                     [zi, z, misfit, nvalid.astype(np.float32), spread, freq, lush],
                     meta, ["intertidal_height_m", "flip_height_all_m", "misfit", "n_valid_scenes",
                            "tied_threshold_spread_m", "wet_frequency", "lush_vegetation_share"])
    np.save(args.out / f"{args.area}-state.npy", state)
    np.save(args.out / f"{args.area}-intertidal.npy", intertidal)
    np.save(args.out / f"{args.area}-sea.npy", sea)
    summary = {
        "area": args.area, "scenes_with_tide": len(stamps), "scenes_kept": int(keep.sum()),
        "tide_range_kept": [round(float(tides_k.min()), 2), round(float(tides_k.max()), 2)],
        "tide_source": sorted({levels[k][1] for k in kept_stamps}),
        "tide_source_counts": {s: sum(levels[k][1] == s for k in kept_stamps) for s in {levels[k][1] for k in kept_stamps}},
        # S2 passes at about 11:40 UTC: which months the lowest and highest scenes fall in.
        "months_of_lowest_15pct": np.bincount([int(s[4:6]) for s, l in zip(kept_stamps, low) if l], minlength=13)[1:].tolist(),
        "months_of_highest_15pct": np.bincount([int(s[4:6]) for s, h in zip(kept_stamps, high) if h], minlength=13)[1:].tolist(),
        "months_all": np.bincount([int(s[4:6]) for s in kept_stamps], minlength=13)[1:].tolist(),
        "intertidal_pixels": int(intertidal.sum()), "intertidal_km2": round(float(intertidal.sum()) * 1e-4, 2),
        "intertidal_height_percentiles_5_50_95": [round(float(x), 2) for x in np.nanpercentile(zi, [5, 50, 95])],
        "intertidal_misfit_median": round(float(np.nanmedian(np.where(intertidal, misfit, np.nan))), 3),
        "kept_scenes": [{"stamp": s, "tide": round(float(levels[s][0]), 3), "source": levels[s][1]} for s in kept_stamps],
        "dropped_scenes": [{"stamp": s, "tide": round(float(levels[s][0]), 3), "wet_err": round(float(e[0]), 3),
                            "dry_err": round(float(e[1]), 3), "cover": round(float(e[2]), 2)}
                           for s, e, k in zip(stamps, errors, keep) if not k],
    }
    (args.out / f"{args.area}-heights.json").write_text(json.dumps(summary, indent=1))
    print("  intertidal %.2f km2, heights p5/50/95 %s, misfit median %.3f" % (
        summary["intertidal_km2"], summary["intertidal_height_percentiles_5_50_95"], summary["intertidal_misfit_median"]))


if __name__ == "__main__":
    main()
