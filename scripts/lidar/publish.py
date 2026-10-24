"""Version the LiDAR layer and put it in the data bucket.

As scripts/satellite/publish.py does for the imagery: the set (build.py's
--out: lidar.pmtiles, coverage.json, index.json) goes under an immutable,
content-versioned prefix on the bucket behind https://data.wingfoil.ie,

    lidar/v<12 hex>/index.json, lidar.pmtiles, coverage.json

the version being the SHA-256 of the archive and the outline (name and
bytes). Objects are only ever added: one already there with the same size is
left alone, one with a different size stops the run, nothing is deleted, and
nothing outside lidar/v… is written. The bucket sweep (force5/ingest/prune.py,
STATIC_ROOTS) never touches the prefix.

The layer is off since 2026-10-24 (README.md, "Off"): the site has no LiDAR
layer, and the repo is not pointed at the set unless `--site` asks for it.
With `--site`, it writes public/lidar/index.json, the site's copy of the index
with the set's `base`, which a LiDAR layer would read when turned on; the
layer's client code is in git history (the commit that took it off).

`--offline` (with `--site`) cuts the set to a box (`--offline-bbox`, default
the Malahide estuary to Howth) into public-data/lidar/v…/ with its own index,
so the dev server and the e2e site could draw the layer with no network. Any
older offline set there is removed.

    python -I publish.py --set <root>/out [--env deploy/home-compute/.env --upload] [--site [--offline]]

Credentials come from the env file (S3_BUCKET, S3_ENDPOINT_URL,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) and are never printed.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "scripts", "satellite"))
import publish as satellite  # noqa: E402  (its versioning, clip and bucket helpers)

PREFIXES = ("lidar/v",)
OFFLINE_BBOX = "-6.20,53.37,-6.05,53.47"


def lidar_set(set_dir):
    index = json.load(open(os.path.join(set_dir, "index.json")))
    if index.get("kind") != "lidar":
        raise SystemExit(f"{set_dir}/index.json is no LiDAR index")
    files = {}
    for name in (index["url"], index["coverage"]):
        if "/" in name:
            raise SystemExit(f"index: {name} is not a file beside the index")
        files[name] = os.path.join(set_dir, name)
        if not os.path.exists(files[name]):
            raise SystemExit(f"missing {files[name]}")
    return index, files


def site_index(index, base):
    """The index as the site serves it: the set's own, with its `base`, less the build's stats."""
    return {k: v for k, v in dict(index, base=base).items() if k != "stats"}


def write_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


def upload(s3, bucket, base, index, files):
    done = {"put": 0, "kept": 0}
    for name, path in sorted(files.items()):
        kind = "application/json" if name.endswith(".json") else "application/octet-stream"
        done[satellite.put_new(s3, bucket, base + name, body_path=path, content_type=kind,
                               prefixes=PREFIXES)] += 1
    body = (json.dumps(dict(index, base=base), indent=1, ensure_ascii=False) + "\n").encode()
    done[satellite.put_new(s3, bucket, base + "index.json", body=body, content_type="application/json",
                           prefixes=PREFIXES)] += 1
    return done


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--set", required=True, help="build.py's --out")
    p.add_argument("--env", help="the env file with the bucket's credentials")
    p.add_argument("--upload", action="store_true", help="put the objects in the bucket (else only the repo)")
    p.add_argument("--site", action="store_true",
                   help="point the site at the set (public/lidar/index.json); the layer is off since "
                        "2026-10-24, so not by default")
    p.add_argument("--offline", action="store_true",
                   help="with --site, also cut a small set into public-data/lidar/")
    p.add_argument("--offline-bbox", default=OFFLINE_BBOX, help="w,s,e,n")
    p.add_argument("--repo", default=REPO)
    a = p.parse_args()
    if a.offline and not a.site:
        raise SystemExit("--offline is for the site's copy: it needs --site")

    index, files = lidar_set(a.set)
    base = f"lidar/{satellite.version_of(files)}/"
    total = sum(os.path.getsize(f) for f in files.values())
    print(f"{base}: {', '.join(sorted(files))} + index, {total / 1e6:.1f} MB")
    if a.upload:
        if not a.env:
            raise SystemExit("--upload needs --env")
        env = satellite.read_env(a.env)
        print(f"bucket: {upload(satellite.client(env), env['S3_BUCKET'], base, index, files)}")
    if not a.site:
        print("repo: untouched (the LiDAR layer is off; --site points the site at the set)")
        return
    write_json(os.path.join(a.repo, "public", "lidar", "index.json"), site_index(index, base))
    print(f"repo: public/lidar/index.json → {base}")

    if a.offline:
        box = [float(v) for v in a.offline_bbox.split(",")]
        with tempfile.TemporaryDirectory() as tmp:
            cut = {index["url"]: os.path.join(tmp, index["url"]), index["coverage"]: files[index["coverage"]]}
            print(f"offline: {satellite.clip(files[index['url']], cut[index['url']], box)} tiles")
            obase = f"lidar/{satellite.version_of(cut)}/"
            data = os.path.join(a.repo, "public-data", "lidar")
            if os.path.isdir(data):
                for old in os.listdir(data):
                    if old.startswith("v") and f"lidar/{old}/" != obase:
                        shutil.rmtree(os.path.join(data, old))
            dest = os.path.join(a.repo, "public-data", obase)
            os.makedirs(dest, exist_ok=True)
            for name, path in cut.items():
                shutil.copyfile(path, os.path.join(dest, name))
        write_json(os.path.join(dest, "index.json"), site_index(dict(index, bounds=box), obase))
        size = sum(os.path.getsize(os.path.join(dest, n)) for n in cut)
        print(f"offline: public-data/{obase} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
