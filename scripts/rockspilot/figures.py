"""Comparison images per area: low- and high-tide RGB, detected rocks, OSM rocks, heights.

    python -I figures.py --area down --s2 .. --out <out>/down
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from pyproj import Transformer  # noqa: E402
from scipy import ndimage  # noqa: E402

import common  # noqa: E402

CONF_COLOURS = {"high": "#e4002b", "medium": "#ff8c00", "low": "#ffd400"}


def rgb(scene, gain=3.5):
    r = common.reflectance(scene)
    return np.clip(np.dstack([r["B04"], r["B03"], r["B02"]]) * gain, 0, 1) ** (1 / 1.6)


def pick(summary, s2, area, zone, low=True):
    scenes = sorted(summary["kept_scenes"], key=lambda s: s["tide"], reverse=not low)[:25]
    best = None
    for s in scenes:
        bad = common.bad_mask(common.load_scene(s2, area, s["stamp"]))[zone].mean()
        if bad < 0.02:
            return s
        if best is None or bad < best[0]:
            best = (bad, s)
    return best[1]


def draw_geom(ax, geom, to_utm, **kw):
    def ring(coords):
        xs, ys = to_utm.transform(*zip(*coords))
        return xs, ys
    t = geom["type"]
    if t == "Point":
        x, y = to_utm.transform(*geom["coordinates"])
        ax.plot(x, y, marker="o", ms=4, mfc="none", mec=kw.get("edgecolor", "c"), mew=1.2)
    elif t == "LineString":
        ax.plot(*ring(geom["coordinates"]), color=kw.get("edgecolor", "c"), lw=kw.get("lw", 1))
    else:
        polys = [geom["coordinates"]] if t == "Polygon" else geom["coordinates"]
        for poly in polys:
            xs, ys = ring(poly[0])
            ax.fill(xs, ys, facecolor=kw.get("facecolor", "none"), edgecolor=kw.get("edgecolor", "c"),
                    lw=kw.get("lw", 1), alpha=kw.get("alpha", 1))


def base(meta, img, title, spots, to_utm):
    left, bottom, right, top = meta["bounds"]
    fig, ax = plt.subplots(figsize=(10, 10 * (top - bottom) / (right - left)), dpi=110)
    ax.imshow(img, extent=(left, right, bottom, top), interpolation="nearest")
    for s in spots:
        x, y = to_utm.transform(s["lon"], s["lat"])
        ax.plot(x, y, marker="*", ms=13, color="#00e5ff", mec="black", mew=0.8)
        ax.annotate(s["name"], (x, y), xytext=(6, 6), textcoords="offset points", color="white", fontsize=9,
                    bbox=dict(boxstyle="round,pad=0.2", fc="black", alpha=0.55, lw=0))
    ax.set_xlim(left, right)
    ax.set_ylim(bottom, top)
    ax.set_title(title, fontsize=11)
    ax.set_axis_off()
    return fig, ax


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--area", required=True)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    area, out = args.area, args.out
    meta = common.grid(args.s2, area)
    spots = common.areas()[area]["spots"]
    to_utm = Transformer.from_crs(4326, meta["epsg"], always_xy=True)
    summary = json.loads((out / f"{area}-heights.json").read_text())
    inter = np.load(out / f"{area}-intertidal.npy")
    zone = ndimage.binary_dilation(inter, iterations=5)
    lo = pick(summary, args.s2, area, zone, low=True)
    hi = pick(summary, args.s2, area, zone, low=False)
    datum = "m LAT, Howth" if area != "down" else "m CD, Killard (EOT20)"
    figs = {}
    for tag, s in (("lowtide", lo), ("hightide", hi)):
        img = rgb(common.load_scene(args.s2, area, s["stamp"]))
        d = s["stamp"]
        fig, ax = base(meta, img, f"Sentinel-2 {d[:4]}-{d[4:6]}-{d[6:8]} {d[9:11]}:{d[11:13]} UTC, tide {s['tide']:.2f} {datum}", spots, to_utm)
        fig.savefig(out / f"{area}-{tag}-rgb.png", bbox_inches="tight")
        plt.close(fig)
        figs[tag] = s

    low_img = rgb(common.load_scene(args.s2, area, lo["stamp"]))
    rocks = json.loads((out / f"{area}-rocks.geojson").read_text())
    fig, ax = base(meta, low_img, f"Detected rock and reef (Sentinel-2 2017-2026), on the {lo['tide']:.2f} m scene", spots, to_utm)
    for f in rocks["features"]:
        c = CONF_COLOURS[f["properties"]["confidenceClass"]]
        draw_geom(ax, f["geometry"], to_utm, facecolor=c, edgecolor=c, lw=0.6, alpha=0.55)
    ax.legend(handles=[Patch(color=CONF_COLOURS["high"], label="high confidence"),
                       Patch(color=CONF_COLOURS["medium"], label="medium"),
                       Patch(color=CONF_COLOURS["low"], label="shoreline fringe (low)")], loc="lower left", fontsize=9)
    fig.savefig(out / f"{area}-rocks-overlay.png", bbox_inches="tight")
    plt.close(fig)

    osm = json.loads((out / f"{area}-osm.geojson").read_text())
    fig, ax = base(meta, low_img, "OpenStreetMap rocks/reefs (cyan) and sand/flats (white), over detected rock (red)", spots, to_utm)
    for f in rocks["features"]:
        draw_geom(ax, f["geometry"], to_utm, facecolor="#e4002b", edgecolor="#e4002b", lw=0.3, alpha=0.35)
    for f in osm["features"]:
        cls = f["properties"]["class"]
        if cls == "rock":
            draw_geom(ax, f["geometry"], to_utm, edgecolor="#00e5ff", lw=1.3)
        elif cls == "soft":
            draw_geom(ax, f["geometry"], to_utm, edgecolor="white", lw=0.6)
    ax.legend(handles=[Line2D([], [], color="#00e5ff", label="OSM rock / reef / stone"),
                       Line2D([], [], color="white", label="OSM beach / sand / tidal flat"),
                       Patch(color="#e4002b", alpha=0.5, label="detected rock")], loc="lower left", fontsize=9)
    fig.savefig(out / f"{area}-osm-overlay.png", bbox_inches="tight")
    plt.close(fig)

    with rasterio.open(out / f"{area}-heights.tif") as src:
        z = src.read(1)
    grey = np.repeat(low_img.mean(2, keepdims=True), 3, 2) * 0.8
    fig, ax = base(meta, grey, f"Intertidal height from {summary['scenes_kept']} scenes ({datum}; tides seen "
                   f"{summary['tide_range_kept'][0]:.2f}-{summary['tide_range_kept'][1]:.2f})", spots, to_utm)
    left, bottom, right, top = meta["bounds"]
    im = ax.imshow(np.ma.masked_invalid(z), extent=(left, right, bottom, top), cmap="viridis",
                   vmin=summary["tide_range_kept"][0], vmax=summary["tide_range_kept"][1], interpolation="nearest")
    fig.colorbar(im, ax=ax, shrink=0.5, label=datum)
    fig.savefig(out / f"{area}-heights.png", bbox_inches="tight")
    plt.close(fig)
    (out / f"{area}-figures.json").write_text(json.dumps(figs, indent=1))
    print(area, "low", lo, "high", hi)


if __name__ == "__main__":
    main()
