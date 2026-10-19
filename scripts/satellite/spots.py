"""One satellite picture of each riding place, for its page (/spot/<id>), cut
from the published imagery: the same composites the map draws (high.pmtiles,
low.pmtiles), so nothing is read from Sentinel-2 again.

Per place and tide, a WebP of `--width` x `--height` pixels, north up, centred
exactly on the place, at `--zoom` (a 256-pixel tile's zoom: 14 is the
archives' own 5.8 m a pixel at 53°N, 14.5 a little closer, resampled). Where
the archive has no image (beyond the sea's 5 km), the picture is the chart's
paper. With a `spots.json` beside them that lists every place pictured, the
point each picture is centred on and its files:

    {"schemaVersion": 1, "kind": "satellite-spots", "zoom": 14.5, "width": 1200,
     "height": 600, "attribution": "...", "imagery": {"ireland": "satellite/v…/"},
     "spots": [{"id": "portrane", "lonLat": [-6.1095, 53.4952],
                "high": "portrane-high.webp", "low": "portrane-low.webp"}, ...]}

publish.py --spots versions the folder and puts it in the bucket beside the
imagery, and writes the site's copy of the list (public/satellite/spots.json)
that the spot page reads.

The archives are read by HTTP range from the data host (by default the areas
public/satellite/index.json names, each place from the area whose cover holds
it), or from a local set (`--imagery <root>/out/satellite`). A place is
pictured from one area: the first whose cover holds it.

    python -I spots.py --out <root>/out/spots [--only portrane,brandon] [--imagery DIR]
"""
import argparse
import functools
import io
import json
import math
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA_HOST = "https://data.wingfoil.ie/"
TIDES = ("high", "low")
# The chart's paper (ui/theme.css --color-ground), where the archive has no image.
PAPER = (0xF3, 0xEE, 0xE3)
# A picture with less imagery than this is not worth showing.
MIN_COVER = 0.5


def world_px(lon, lat, zoom):
    """A point's pixel in Web Mercator at a 256-pixel tile's zoom (fractional zooms too)."""
    size = 256 * 2 ** zoom
    lat = max(-85.05112878, min(85.05112878, lat))
    s = math.sin(math.radians(lat))
    return ((lon + 180) / 360 * size,
            (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * size)


def native_zoom(area):
    """The 256-pixel zoom of an archive's deepest tiles: z13 at 512 px is 14."""
    return area["maxzoom"] + math.log2(area["tileSize"] / 256)


def window(lon, lat, zoom, width, height, native):
    """The box (x0, y0, x1, y1), in the archive's deepest tiles' pixels, that
    a picture of width x height at `zoom` centred on the point covers."""
    k = 2 ** (native - zoom)
    cx, cy = world_px(lon, lat, native)
    return (cx - width * k / 2, cy - height * k / 2, cx + width * k / 2, cy + height * k / 2)


def tiles_for(box, tile_size):
    """The tiles (x, y) under a box of pixels, row by row."""
    x0, y0, x1, y1 = box
    return [(x, y)
            for y in range(math.floor(y0 / tile_size), math.ceil(y1 / tile_size))
            for x in range(math.floor(x0 / tile_size), math.ceil(x1 / tile_size))]


def area_for(areas, lon, lat):
    """The first area whose cover (else its bounds) holds the point, or None."""
    def holds(b):
        return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]
    for area in areas:
        if any(holds(b) for b in area.get("cover") or [area["bounds"]]):
            return area
    return None


def picture(get_tile, area, lon, lat, zoom, width, height):
    """The picture of one place at one tide, as an RGB image, and the share
    of it that is imagery (not the paper)."""
    from PIL import Image
    size = area["tileSize"]
    z = area["maxzoom"]
    box = window(lon, lat, zoom, width, height, native_zoom(area))
    tiles = tiles_for(box, size)
    tx0, ty0 = tiles[0]
    tx1, ty1 = tiles[-1]
    canvas = Image.new("RGBA", ((tx1 - tx0 + 1) * size, (ty1 - ty0 + 1) * size), (0, 0, 0, 0))
    for x, y in tiles:
        data = get_tile(z, x, y)
        if data:
            canvas.paste(Image.open(io.BytesIO(data)).convert("RGBA"), ((x - tx0) * size, (y - ty0) * size))
    crop = (box[0] - tx0 * size, box[1] - ty0 * size, box[2] - tx0 * size, box[3] - ty0 * size)
    # Premultiplied, so the fading sea edge never blends with "no value".
    rgba = canvas.convert("RGBa").resize((width, height), Image.Resampling.LANCZOS, box=crop).convert("RGBA")
    alpha = rgba.getchannel("A")
    cover = sum(i * n for i, n in enumerate(alpha.histogram())) / (255 * width * height)
    paper = Image.new("RGBA", (width, height), PAPER + (255,))
    return Image.alpha_composite(paper, rgba).convert("RGB"), cover


def encode(image, quality):
    buf = io.BytesIO()
    image.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()


def http_source(url):
    """An archive's bytes by HTTP range, each range read once."""
    import requests
    session = requests.Session()

    @functools.lru_cache(maxsize=2048)
    def get_bytes(offset, length):
        r = session.get(url, headers={"Range": f"bytes={offset}-{offset + length - 1}"}, timeout=60)
        if r.status_code != 206:
            raise SystemExit(f"{url} answered {r.status_code} to a range: not read")
        return r.content
    return get_bytes


def file_source(path):
    from pmtiles.reader import MmapSource
    return MmapSource(open(path, "rb"))


def tile_getter(get_bytes):
    from pmtiles.reader import Reader
    reader = Reader(get_bytes)
    return reader.get


def areas_of(imagery, data_host, index_path):
    """The areas to cut from, each with a `source(name)` for its archives."""
    if imagery:
        index = json.load(open(os.path.join(imagery, "index.json")))
        area = dict(index, id=index.get("id", "ireland"), base=None)
        area["source"] = lambda name: file_source(os.path.join(imagery, name))
        return [area], index["attribution"]
    index = json.load(open(index_path))
    areas = []
    for area in index["areas"]:
        area = dict(area)
        area["source"] = (lambda base: lambda name: http_source(data_host + base + name))(area["base"])
        areas.append(area)
    return areas, index["attribution"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, help="the folder for the pictures and spots.json")
    p.add_argument("--spots", default=os.path.join(REPO, "public", "riding-locations.json"))
    p.add_argument("--only", help="comma-separated place ids (default: every place)")
    p.add_argument("--imagery", help="a local imagery set (tiles.py imagery's --out) in place of the data host's")
    p.add_argument("--index", default=os.path.join(REPO, "public", "satellite", "index.json"),
                   help="the site's satellite index, naming the published areas")
    p.add_argument("--data-host", default=DATA_HOST)
    p.add_argument("--zoom", type=float, default=14.5)
    p.add_argument("--width", type=int, default=1200)
    p.add_argument("--height", type=int, default=600)
    p.add_argument("--quality", type=int, default=78)
    a = p.parse_args()

    places = json.load(open(a.spots))
    if a.only:
        wanted = set(a.only.split(","))
        places = [s for s in places if s["id"] in wanted]
        missing = wanted - {s["id"] for s in places}
        if missing:
            raise SystemExit(f"no such place: {', '.join(sorted(missing))}")
    areas, attribution = areas_of(a.imagery, a.data_host, a.index)
    getters = {}
    os.makedirs(a.out, exist_ok=True)
    listed, left_out = [], []
    for place in places:
        lon, lat = place["lon"], place["lat"]
        area = area_for(areas, lon, lat)
        if area is None:
            left_out.append((place["id"], "outside every area"))
            continue
        images = {}
        for tide in TIDES:
            key = (area["id"], tide)
            if key not in getters:
                getters[key] = tile_getter(area["source"](area["options"][tide]["url"]))
            images[tide], cover = picture(getters[key], area, lon, lat, a.zoom, a.width, a.height)
            if cover < MIN_COVER:
                break
        else:
            entry = {"id": place["id"], "lonLat": [round(lon, 6), round(lat, 6)]}
            for tide, image in images.items():
                entry[tide] = f"{place['id']}-{tide}.webp"
                with open(os.path.join(a.out, entry[tide]), "wb") as fh:
                    fh.write(encode(image, a.quality))
            listed.append(entry)
            print(f"{place['id']}: {area['id']}", flush=True)
            continue
        left_out.append((place["id"], f"{cover:.0%} imagery at {tide} tide"))

    doc = {
        "schemaVersion": 1,
        "kind": "satellite-spots",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "zoom": a.zoom,
        "width": a.width,
        "height": a.height,
        "attribution": attribution,
        "imagery": {area["id"]: area["base"] for area in areas if area["base"]},
        "spots": listed,
    }
    with open(os.path.join(a.out, "spots.json"), "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    size = sum(os.path.getsize(os.path.join(a.out, e[t])) for e in listed for t in TIDES)
    print(f"{len(listed)} places pictured, {size / 1e6:.1f} MB; left out: "
          + (", ".join(f"{i} ({why})" for i, why in left_out) or "none"))


if __name__ == "__main__":
    sys.exit(main())
