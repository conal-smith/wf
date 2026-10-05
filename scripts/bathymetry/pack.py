import gzip, json, os, sys
from pmtiles.tile import zxy_to_tileid, TileType, Compression
from pmtiles.writer import Writer
src, out = sys.argv[1], sys.argv[2]
tiles = []
for z in os.listdir(src):
    for x in os.listdir(f"{src}/{z}"):
        for f in os.listdir(f"{src}/{z}/{x}"):
            tiles.append((zxy_to_tileid(int(z), int(x), int(f[:-4])), f"{src}/{z}/{x}/{f}"))
tiles.sort()
with open(out, "wb") as fh:
    w = Writer(fh)
    for tid, path in tiles:
        w.write_tile(tid, gzip.compress(open(path, "rb").read(), 9))
    w.finalize(
        {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP, "min_zoom": 5, "max_zoom": 12,
         "min_lon_e7": int(-11.3e7), "min_lat_e7": int(51.2e7), "max_lon_e7": int(-5.1e7), "max_lat_e7": int(55.6e7),
         "center_zoom": 7, "center_lon_e7": int(-8.2e7), "center_lat_e7": int(53.4e7)},
        {"name": "wingfoil bathymetry", "attribution": "EMODnet Bathymetry",
         "description": "EMODnet DTM (incl. INFOMAR), depths in m below chart datum (~LAT). z5-9 from 0.0025°, z10-12 from 1/16′ (~115 m).",
         "vector_layers": [{"id": l, "fields": {}} for l in ["bands", "contours", "soundings", "relief"]]},
    )
print(len(tiles), "tiles", os.path.getsize(out) / 1e6, "MB")
