"""Development aid: rock-feature percentiles inside OSM rock and OSM sand/flats (within the satellite intertidal)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.features import rasterize  # noqa: E402
from rasterio.warp import transform_geom  # noqa: E402

import common  # noqa: E402


def osm_mask(geojson, cls, meta, points_buffer=False):
    shapes = []
    for f in json.load(open(geojson))["features"]:
        if f["properties"]["class"] != cls or f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
            continue
        shapes.append(transform_geom("EPSG:4326", f"EPSG:{meta['epsg']}", f["geometry"]))
    if not shapes:
        return np.zeros(tuple(meta["shape"]), bool)
    return rasterize(shapes, out_shape=tuple(meta["shape"]), transform=common.transform(meta), all_touched=False).astype(bool)


def main(s2, out, area):
    out = Path(out)
    meta = common.grid(s2, area)
    with rasterio.open(out / f"{area}-rock-features.tif") as src:
        feats = src.read()
        names = list(src.descriptions)
    with rasterio.open(out / f"{area}-heights.tif") as src:
        z = src.read(1)
    inter = np.load(out / f"{area}-intertidal.npy")
    rock = osm_mask(out / f"{area}-osm.geojson", "rock", meta)
    soft = osm_mask(out / f"{area}-osm.geojson", "soft", meta)
    groups = {"osm rock & intertidal": rock & inter, "osm soft & intertidal": soft & inter & ~rock,
              "intertidal, not in osm": inter & ~rock & ~soft}
    for g, m in groups.items():
        print(f"{area} {g}: {m.sum()} px; z p50 {np.nanmedian(z[m]) if m.any() else float('nan'):.2f}")
        for name, band in zip(names, feats):
            v = band[m]
            v = v[np.isfinite(v)]
            if len(v):
                print(f"    {name:10s} p10 {np.percentile(v, 10):7.3f}  p50 {np.percentile(v, 50):7.3f}  p90 {np.percentile(v, 90):7.3f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
