"""Heights read straight out of a built set at known places round the coast.

    python -I spotcheck.py --set /tmp/wf-foildepth-national/out [lon,lat,name ...]

For each place: the archive that holds it (a pilot's box first, else the
region whose station is nearest, as the map picks), and over a box of about
1 km round it (11 x 11 points) the heights above LAT at the archive's max
zoom: their spread, and the share of the water that is dry, too shallow, or
deep enough (a metre of clearance) at the station's mean low and high water
(stations.json). A single pixel can land on a beach's top or in a channel;
the box says what the place is.
"""
import argparse
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader

HERE = os.path.dirname(os.path.abspath(__file__))
SPOTS = [
    (-6.163, 53.370, "Bull Island lagoon flats (pilot)"),
    (-6.195, 53.329, "Sandymount, 1 km out (pilot)"),
    (-10.060, 52.270, "Brandon Bay, Fermoyle shallows (pilot)"),
    (-9.131, 53.256, "Silverstrand, Galway Bay"),
    (-9.115, 53.258, "Rusheen Bay"),
    (-6.420, 52.345, "Wexford Harbour flats"),
    (-6.350, 52.250, "Rosslare Strand"),
    (-9.455, 51.682, "Bantry, inner harbour"),
    (-7.528, 55.095, "Lough Swilly off Rathmullan"),
    (-9.580, 53.800, "Clew Bay, Westport Quay flats"),
    (-9.660, 53.790, "Clew Bay, Bertra Strand"),
    (-7.600, 52.075, "Dungarvan Harbour flats"),
    (-8.270, 51.830, "Cork Harbour, Cuskinny/Lough Mahon"),
    (-9.380, 52.620, "Shannon, Clonderalaw Bay"),
    (-6.120, 53.580, "Skerries, South Strand"),
    (-5.640, 54.500, "Strangford Lough (expected: no region)"),
]


def distance_km(lon1, lat1, lon2, lat2):
    r = math.pi / 180
    a = (math.sin((lat2 - lat1) * r / 2) ** 2
         + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(min(1, a)))


def pick(areas, lon, lat):
    boxes = [a for a in areas if a["bounds"][0] <= lon <= a["bounds"][2] and a["bounds"][1] <= lat <= a["bounds"][3]]
    pilots = [a for a in boxes if a.get("kind") != "region"]
    if pilots:
        return pilots
    regions = sorted(boxes, key=lambda a: distance_km(lon, lat, *a["stationLonLat"]))
    return regions[:1]


def height(path, area, lon, lat, index):
    z = area["maxzoom"]
    n = 2 ** z
    x = (lon + 180) / 360 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    tx, ty = int(x), int(y)
    size = area["tileSize"]
    with open(path, "rb") as fh:
        data = Reader(MmapSource(fh)).get(z, tx, ty)
    if data is None:
        return "no tile"
    rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(float)
    px, py = min(size - 1, int((x - tx) * size)), min(size - 1, int((y - ty) * size))
    rr, g, b = rgb[py, px]
    v = rr * 256 + g + b / 256 - 32768
    if v >= index["landMetres"] - 1:
        return "land"
    if abs(v - index["noSurveyMetres"]) < 1:
        return "unsurveyed"
    if abs(v - index.get("deepMetres", -999)) < 1:
        return "deep"
    return round(v, 2)


def at(z, tide):
    if isinstance(z, str):
        return {"deep": "deep", "unsurveyed": "wet", "land": "-", "no tile": "-"}[z]
    if z > tide:
        return "dry"
    return "deep enough" if tide - z >= 1 else "too shallow"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--set", required=True)
    p.add_argument("points", nargs="*", help="lon,lat,name")
    a = p.parse_args()
    index = json.load(open(os.path.join(a.set, "index.json")))
    stations = json.load(open(os.path.join(HERE, "stations.json")))["stations"]
    spots = [(float(s.split(",")[0]), float(s.split(",")[1]), s.split(",", 2)[2]) for s in a.points] or SPOTS
    print("| Place | Archive | heights, m LAT (10th/50th/90th) | deep / unsurveyed / land | MLW: dry/shallow/ok | MHW: dry/shallow/ok |")
    print("| --- | --- | --- | --- | --- | --- |")
    for lon, lat, name in spots:
        found = pick(index["areas"], lon, lat)
        if not found:
            print(f"| {name} | none | | | | |")
            continue
        area = found[0]
        heights, other = [], {"deep": 0, "unsurveyed": 0, "land": 0, "no tile": 0}
        for dy in np.linspace(-0.0045, 0.0045, 11):
            for dx in np.linspace(-0.0075, 0.0075, 11):
                v = "no tile"
                for cand in pick(index["areas"], lon + dx, lat + dy) or found:
                    v = height(os.path.join(a.set, cand["url"]), cand, lon + dx, lat + dy, index)
                    if v not in ("land", "no tile"):
                        break
                if isinstance(v, str):
                    other[v] += 1
                else:
                    heights.append(v)
        st = stations.get(area["station"], {})
        h = np.array(heights)

        def share(tide):
            if not len(h):
                return ""
            dry, shallow = (h > tide).mean(), ((h <= tide) & (h > tide - 1)).mean()
            return f"{dry:.0%}/{shallow:.0%}/{1 - dry - shallow:.0%}"
        spread = "/".join(f"{q:.1f}" for q in np.percentile(h, [10, 50, 90])) if len(h) else ""
        print(f"| {name} | {area['id']} ({st.get('name', area['station'])}) | {spread} | "
              f"{other['deep']}/{other['unsurveyed']}/{other['land'] + other['no tile']} | "
              f"{share(st.get('mlwMetres', 0))} | {share(st.get('mhwMetres', 0))} |")

if __name__ == "__main__":
    sys.exit(main())
