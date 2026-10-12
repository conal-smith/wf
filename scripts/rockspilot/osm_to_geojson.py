"""Overpass JSON (from fetch_osm.sh) to GeoJSON: rocks and reefs, sand and flats, the coastline.

    python -I osm_to_geojson.py <osm.json> <out.geojson>
"""
import json
import sys

ROCK_NATURAL = {"reef", "rock", "bare_rock", "stone", "shoal"}
SEAMARK_ROCK = {"rock", "obstruction", "wreck"}
SOFT_NATURAL = {"beach", "sand", "shingle"}


def kind(tags):
    if tags.get("natural") in ROCK_NATURAL or tags.get("seamark:type") in SEAMARK_ROCK:
        return "rock"
    if tags.get("natural") in SOFT_NATURAL or tags.get("wetland") == "tidalflat":
        return "soft"
    if tags.get("natural") == "coastline":
        return "coastline"
    if tags.get("natural") == "cliff":
        return "cliff"
    return "seamark" if any(k.startswith("seamark") for k in tags) else None


def ring_closed(coords):
    return len(coords) >= 4 and coords[0] == coords[-1]


def main(src, dst):
    data = json.load(open(src))
    features = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        k = kind(tags)
        if k is None:
            continue
        props = {"osm": f"{el['type']}/{el['id']}", "class": k,
                 "natural": tags.get("natural"), "seamark": tags.get("seamark:type"),
                 "name": tags.get("name"), "tidal": tags.get("tidal"), "wetland": tags.get("wetland")}
        props = {a: b for a, b in props.items() if b is not None}
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif el["type"] == "way" and "geometry" in el:
            coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
            if ring_closed(coords) and k != "coastline":
                geom = {"type": "Polygon", "coordinates": [coords]}
            else:
                geom = {"type": "LineString", "coordinates": coords}
        elif el["type"] == "relation" and "members" in el:
            outers = [[[p["lon"], p["lat"]] for p in m["geometry"]] for m in el["members"]
                      if m.get("role") == "outer" and "geometry" in m]
            polys = [[c] for c in outers if ring_closed(c)]
            if not polys:
                continue
            geom = {"type": "MultiPolygon", "coordinates": polys}
        else:
            continue
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    json.dump({"type": "FeatureCollection",
               "attribution": "© OpenStreetMap contributors, ODbL", "features": features}, open(dst, "w"))
    counts = {}
    for f in features:
        counts[f["properties"]["class"]] = counts.get(f["properties"]["class"], 0) + 1
    print(dst, counts)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
