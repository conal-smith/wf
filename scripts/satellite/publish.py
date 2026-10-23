"""Version the satellite imagery and the intertidal heights and put them in the data bucket.

As scripts/foildepth/publish.py does for the foilable depth: each set goes
under an immutable, content-versioned prefix on the bucket behind
https://data.wingfoil.ie,

    satellite/v<12 hex>/index.json, high.pmtiles, low.pmtiles
    intertidal/v<12 hex>/index.json, tide-<station>.pmtiles ...
    satellite/v<12 hex>/spots.json, <place>-high.webp, <place>-low.webp ...

the version being the SHA-256 of the set's archives (name and bytes). Objects
are only ever added: one already there with the same size is left alone, one
with a different size stops the run, nothing is deleted, and nothing outside
the two prefixes is written. The bucket sweep (force5/ingest/prune.py) never
touches either prefix.

Then the repo is pointed at them: public/satellite/index.json and
public/intertidal/index.json, the site's copies, list every published run as
an area (`--area`: "ireland", "great-britain"), each with its own `base`. A
run replaces only its own area's entries, so publishing Great Britain adds it
beside Ireland, and the app needs no change. Each imagery area carries its
`cover`: the z8 tiles its archive has, as boxes, row by row, so a view of
Dublin never opens Great Britain's archive, though Britain's box holds Dublin.

`--spots DIR` (spots.py's --out: a picture of each riding place at each
tide, cut from the published imagery) goes the same way, and its list is the
site's public/satellite/spots.json with the set's `base`, read by the spot
page; the set replaces the one before it whole.

`--offline DIR` versions a small imagery set (tiles.py imagery --bbox) into
public-data/satellite/v…/ with its own index, committed, so the dev server
and the e2e site draw the imagery with no network (scripts/e2e-site.mjs
serves that index in place of the national one). Any older offline set there
is removed. `--offline-intertidal DIR --offline-bbox w,s,e,n` does the same
for the intertidal heights: the `--offline-areas` regions of a national set,
cut to the box, into public-data/intertidal/v…/.

    python -I publish.py --area ireland --imagery <root>/out/satellite [--intertidal <root>/out/intertidal] \\
        [--offline <root>/out/satellite-offline] [--env deploy/home-compute/.env --upload]
    python -I publish.py --spots <root>/out/spots --env deploy/home-compute/.env --upload
    python -I publish.py --offline-intertidal <root>/out/intertidal --offline-bbox -6.24,53.36,-6.06,53.49 \\
        --offline-areas tide-howth

Credentials come from the env file (S3_BUCKET, S3_ENDPOINT_URL,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) and are never printed.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
IMMUTABLE = "public, max-age=31536000, immutable"
PREFIXES = ("satellite/v", "intertidal/v")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def version_of(files):
    """v + 12 hex of the SHA-256 over each file's name and digest, in name order."""
    h = hashlib.sha256()
    for name, path in sorted(files.items()):
        h.update(name.encode() + b"\0" + sha256_file(path).encode() + b"\n")
    return "v" + h.hexdigest()[:12]


def imagery_set(set_dir):
    index = json.load(open(os.path.join(set_dir, "index.json")))
    files = {}
    for opt in ("high", "low"):
        name = index["options"][opt]["url"]
        if "/" in name or not name.endswith(".pmtiles"):
            raise SystemExit(f"index: {name} is not an archive beside the index")
        files[name] = os.path.join(set_dir, name)
    for p in files.values():
        if not os.path.exists(p):
            raise SystemExit(f"missing archive {p}")
    return index, files


def spots_set(set_dir):
    """spots.py's pictures, and the list that names them."""
    index = json.load(open(os.path.join(set_dir, "spots.json")))
    if index.get("kind") != "satellite-spots" or not index.get("spots"):
        raise SystemExit(f"{set_dir}/spots.json is no list of spot pictures")
    files = {}
    for spot in index["spots"]:
        for tide in ("high", "low"):
            name = spot[tide]
            if "/" in name or not name.endswith(".webp"):
                raise SystemExit(f"spots.json: {name} is not a picture beside the list")
            files[name] = os.path.join(set_dir, name)
    for p in files.values():
        if not os.path.exists(p):
            raise SystemExit(f"missing picture {p}")
    return index, files


def intertidal_set(set_dir):
    index = json.load(open(os.path.join(set_dir, "index.json")))
    files = {}
    for area in index["areas"]:
        name = area["url"]
        if "/" in name or not name.endswith(".pmtiles"):
            raise SystemExit(f"index: {name} is not an archive beside the index")
        files[name] = os.path.join(set_dir, name)
    return index, files


def tile_ids(path):
    """Every tile id an archive has, from its directories alone (no tile is read)."""
    from pmtiles.tile import deserialize_directory, deserialize_header
    with open(path, "rb") as fh:
        def get(offset, length):
            fh.seek(offset)
            return fh.read(length)
        header = deserialize_header(get(0, 127))

        def walk(offset, length):
            for e in deserialize_directory(get(offset, length)):
                if e.run_length:
                    yield from range(e.tile_id, e.tile_id + e.run_length)
                else:
                    yield from walk(header["leaf_directory_offset"] + e.offset, e.length)
        yield from walk(header["root_offset"], header["root_length"])


def cover(path, zoom=8):
    """The archive's tiles at `zoom` and under, as boxes (w, s, e, n): one per
    run of neighbouring tiles in a row, rounded outward."""
    import math
    from pmtiles.tile import tileid_to_zxy
    have = set()
    for tid in tile_ids(path):
        z, x, y = tileid_to_zxy(tid)
        if z >= zoom:
            have.add((x >> (z - zoom), y >> (z - zoom)))
    n = 2 ** zoom
    lon = lambda x: x / n * 360 - 180
    lat = lambda y: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    boxes = []
    for y in sorted({y for _, y in have}):
        xs = sorted(x for x, yy in have if yy == y)
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            boxes.append([math.floor(lon(start) * 1e4) / 1e4, math.floor(lat(y + 1) * 1e4) / 1e4,
                          math.ceil(lon(prev + 1) * 1e4) / 1e4, math.ceil(lat(y) * 1e4) / 1e4])
            if x is not None:
                start = prev = x
    return boxes


def clip(src, dst, bbox):
    """An archive cut to the tiles that meet a box (w, s, e, n), its header and metadata kept."""
    import math
    from pmtiles.reader import MmapSource, Reader, all_tiles
    from pmtiles.tile import zxy_to_tileid
    from pmtiles.writer import Writer
    w, s, e, n = bbox

    def meets(z, x, y):
        k = 2 ** z
        lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / k))))
        return x / k * 360 - 180 <= e and (x + 1) / k * 360 - 180 >= w and lat(y + 1) <= n and lat(y) >= s

    with open(src, "rb") as fh:
        reader = Reader(MmapSource(fh))
        header, metadata = reader.header(), reader.metadata()
        keep = sorted((zxy_to_tileid(*zxy), data) for zxy, data in all_tiles(reader.get_bytes) if meets(*zxy))
    header.update(min_lon_e7=int(w * 1e7), min_lat_e7=int(s * 1e7), max_lon_e7=int(e * 1e7),
                  max_lat_e7=int(n * 1e7), center_lon_e7=int((w + e) / 2 * 1e7), center_lat_e7=int((s + n) / 2 * 1e7))
    with open(dst, "wb") as fh:
        writer = Writer(fh)
        for tid, data in keep:
            writer.write_tile(tid, data)
        writer.finalize(header, metadata)
    return len(keep)


def read_env(path):
    out = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def client(env):
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=env["S3_ENDPOINT_URL"], region_name=env.get("AWS_REGION") or "auto",
                        aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                        config=Config(retries={"mode": "standard", "max_attempts": 5},
                                      connect_timeout=15, read_timeout=300))


def put_new(s3, bucket, key, body_path=None, body=None, content_type="application/octet-stream",
            prefixes=PREFIXES):
    """Add one object; never overwrite. Returns 'put' or 'kept'."""
    if not key.startswith(prefixes):
        raise SystemExit(f"refusing to write outside the {' and '.join(p.split('/')[0] for p in prefixes)} "
                         f"prefixes: {key}")
    size = os.path.getsize(body_path) if body_path else len(body)
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except Exception as e:  # botocore ClientError: 404 is "not there"
        code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if code not in ("404", "NoSuchKey", "NotFound"):
            raise
        head = None
    if head is not None:
        if head.get("ContentLength") != size:
            raise SystemExit(f"{key} is already there with another size: not overwriting")
        return "kept"
    extra = {"ContentType": content_type, "CacheControl": IMMUTABLE}
    if body_path:
        s3.upload_file(body_path, bucket, key, ExtraArgs=extra)
    else:
        s3.put_object(Bucket=bucket, Key=key, Body=body, **extra)
    return "put"


def upload(s3, bucket, base, index, files, index_name="index.json", content_type="application/octet-stream"):
    done = {"put": 0, "kept": 0}
    for name, path in sorted(files.items()):
        done[put_new(s3, bucket, base + name, body_path=path, content_type=content_type)] += 1
    body = (json.dumps(dict(index, base=base), indent=1) + "\n").encode()
    done[put_new(s3, bucket, base + index_name, body=body, content_type="application/json")] += 1
    return done


def site_area(index, base, area, name, files):
    """One run's imagery as the site's index lists it: what the app reads."""
    out = {"id": area, "name": name, "base": base}
    out.update({k: index[k] for k in ("generatedAt", "bounds", "minzoom", "maxzoom", "tileSize", "options")
                if k in index})
    out["cover"] = cover(files[index["options"]["high"]["url"]])
    out["stations"] = [{k: s[k] for k in ("id", "name", "lonLat", "high", "low")} for s in index["stations"]]
    return out


def intertidal_areas(index, base, area):
    """One run's intertidal regions as the site's index lists them."""
    keep = ("id", "kind", "url", "bounds", "minzoom", "maxzoom", "tileSize", "station", "stationLonLat",
            "lowestSeenMetres", "highestSeenMetres")
    return [dict({k: a[k] for k in keep}, set=area, base=base) for a in index["areas"]]


RESERVED = ("deepMetres", "landMetres", "noSurveyMetres", "belowSeenMetres")


def merge_site_index(path, fresh, area, entries):
    """The site's index with `area`'s entries replaced by `entries`, the others kept."""
    try:
        old = json.load(open(path))
    except FileNotFoundError:
        old = None
    if old and old.get("schemaVersion") == fresh["schemaVersion"]:
        if any(old.get(k) != fresh.get(k) for k in RESERVED if k in fresh):
            raise SystemExit(f"{path}: another set's reserved heights differ; not merging")
        kept = [e for e in old["areas"] if (e.get("set", e["id"]) != area)]
        clash = {e["id"] for e in kept} & {e["id"] for e in entries}
        if clash:
            raise SystemExit(f"{path}: {sorted(clash)} already listed by another set; not merging")
    else:
        kept = []
    out = dict(fresh, areas=kept + entries)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")


def write_site_imagery(path, index, base, area, name, files):
    merge_site_index(path, {"schemaVersion": 2, "kind": "satellite", "attribution": index["attribution"]},
                     area, [site_area(index, base, area, name, files)])


def write_site_spots(path, index, base):
    """The site's list of the spot pictures: the set's own, with its `base`."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(dict(index, base=base), fh, indent=1)
        fh.write("\n")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--area", default="ireland", help="the run's id in the site's indexes (great-britain, ...)")
    p.add_argument("--name", help="its name (default: from --area)")
    p.add_argument("--imagery", help="tiles.py imagery's --out (index.json, high.pmtiles, low.pmtiles)")
    p.add_argument("--intertidal", help="tiles.py intertidal's --out")
    p.add_argument("--spots", help="spots.py's --out (spots.json and a picture per place and tide)")
    p.add_argument("--offline", help="a small imagery set for public-data/ (tiles.py imagery --bbox)")
    p.add_argument("--offline-intertidal", help="a national intertidal set to cut a small offline one from")
    p.add_argument("--offline-bbox", help="w,s,e,n: the offline intertidal set's box")
    p.add_argument("--offline-areas", help="comma-separated region ids for it, e.g. tide-howth")
    p.add_argument("--env", help="the env file with the bucket's credentials")
    p.add_argument("--upload", action="store_true", help="put the objects in the bucket (else only the repo)")
    p.add_argument("--repo", default=REPO)
    a = p.parse_args()
    name = a.name or a.area.replace("-", " ").title()
    s3 = bucket = None
    if a.upload:
        if not a.env:
            raise SystemExit("--upload needs --env")
        env = read_env(a.env)
        s3, bucket = client(env), env["S3_BUCKET"]

    if a.imagery:
        index, files = imagery_set(a.imagery)
        base = f"satellite/{version_of(files)}/"
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"{base}: high and low + index, {total / 1e6:.1f} MB")
        if s3:
            print(f"bucket: {upload(s3, bucket, base, index, files)}")
        write_site_imagery(os.path.join(a.repo, "public", "satellite", "index.json"), index, base, a.area, name,
                           files)
        print(f"repo: public/satellite/index.json, {a.area} → {base}")

    if a.intertidal:
        index, files = intertidal_set(a.intertidal)
        base = f"intertidal/{version_of(files)}/"
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"{base}: {len(files)} archives + index, {total / 1e6:.1f} MB")
        if s3:
            print(f"bucket: {upload(s3, bucket, base, index, files)}")
        fresh = {k: index[k] for k in ("schemaVersion", "kind", "datum", "encoding") + RESERVED}
        fresh["attribution"] = index["attribution"]
        merge_site_index(os.path.join(a.repo, "public", "intertidal", "index.json"), fresh, a.area,
                         intertidal_areas(index, base, a.area))
        print(f"repo: public/intertidal/index.json, {a.area} → {base}")

    if a.spots:
        index, files = spots_set(a.spots)
        base = f"satellite/{version_of(files)}/"
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"{base}: {len(index['spots'])} places' pictures + spots.json, {total / 1e6:.1f} MB")
        if s3:
            print(f"bucket: {upload(s3, bucket, base, index, files, 'spots.json', 'image/webp')}")
        write_site_spots(os.path.join(a.repo, "public", "satellite", "spots.json"), index, base)
        print(f"repo: public/satellite/spots.json → {base}")

    if a.offline:
        index, files = imagery_set(a.offline)
        base = f"satellite/{version_of(files)}/"
        data = os.path.join(a.repo, "public-data", "satellite")
        if os.path.isdir(data):
            for old in os.listdir(data):
                if old.startswith("v") and f"satellite/{old}/" != base:
                    shutil.rmtree(os.path.join(data, old))
        dest = os.path.join(a.repo, "public-data", base)
        os.makedirs(dest, exist_ok=True)
        for archive_name, path in files.items():
            shutil.copyfile(path, os.path.join(dest, archive_name))
        write_site_imagery(os.path.join(dest, "index.json"), index, base, a.area, name,
                           {n: os.path.join(dest, n) for n in files})
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"offline: public-data/{base} ({total / 1e6:.1f} MB)")

    if a.offline_intertidal:
        import tempfile
        index, files = intertidal_set(a.offline_intertidal)
        box = [float(v) for v in a.offline_bbox.split(",")]
        wanted = a.offline_areas.split(",")
        index = dict(index, areas=[dict(r, bounds=box) for r in index["areas"] if r["id"] in wanted])
        with tempfile.TemporaryDirectory() as tmp:
            cut = {}
            for r in index["areas"]:
                cut[r["url"]] = os.path.join(tmp, r["url"])
                print(f"{r['id']}: {clip(files[r['url']], cut[r['url']], box)} tiles")
            base = f"intertidal/{version_of(cut)}/"
            data = os.path.join(a.repo, "public-data", "intertidal")
            if os.path.isdir(data):
                for old in os.listdir(data):
                    if old.startswith("v") and f"intertidal/{old}/" != base:
                        shutil.rmtree(os.path.join(data, old))
            dest = os.path.join(a.repo, "public-data", base)
            os.makedirs(dest, exist_ok=True)
            for name, path in cut.items():
                shutil.copyfile(path, os.path.join(dest, name))
        fresh = {k: index[k] for k in ("schemaVersion", "kind", "datum", "encoding") + RESERVED}
        fresh["attribution"] = index["attribution"]
        merge_site_index(os.path.join(dest, "index.json"), fresh, a.area, intertidal_areas(index, base, a.area))
        total = sum(os.path.getsize(os.path.join(dest, n)) for n in cut)
        print(f"offline: public-data/{base} ({total / 1e3:.0f} kB)")


if __name__ == "__main__":
    sys.exit(main())
