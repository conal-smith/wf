"""Version the satellite imagery and the intertidal heights and put them in the data bucket.

As scripts/foildepth/publish.py does for the foilable depth: each set goes
under an immutable, content-versioned prefix on the bucket behind
https://data.wingfoil.ie,

    satellite/v<12 hex>/index.json, high.pmtiles, low.pmtiles
    intertidal/v<12 hex>/index.json, tide-<station>.pmtiles ...

the version being the SHA-256 of the set's archives (name and bytes). Objects
are only ever added: one already there with the same size is left alone, one
with a different size stops the run, nothing is deleted, and nothing outside
the two prefixes is written. The bucket sweep (force5/ingest/prune.py) never
touches either prefix.

Then the repo is pointed at the imagery: public/satellite/index.json, the
site's copy of the index with its `base`. The intertidal heights have no
reader in the app: their index is on the bucket, for the foil-depth build.

`--offline DIR` versions a small imagery set (tiles.py imagery --bbox) into
public-data/satellite/v…/ with its own index, committed, so the dev server
and the e2e site draw the imagery with no network (scripts/e2e-site.mjs
serves that index in place of the national one). Any older offline set there
is removed.

    python -I publish.py --imagery <root>/out/satellite [--intertidal <root>/out/intertidal] \\
        [--offline <root>/out/satellite-offline] [--env deploy/home-compute/.env --upload]

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


def intertidal_set(set_dir):
    index = json.load(open(os.path.join(set_dir, "index.json")))
    files = {}
    for area in index["areas"]:
        name = area["url"]
        if "/" in name or not name.endswith(".pmtiles"):
            raise SystemExit(f"index: {name} is not an archive beside the index")
        files[name] = os.path.join(set_dir, name)
    return index, files


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


def put_new(s3, bucket, key, body_path=None, body=None, content_type="application/octet-stream"):
    """Add one object; never overwrite. Returns 'put' or 'kept'."""
    if not key.startswith(PREFIXES):
        raise SystemExit(f"refusing to write outside the satellite and intertidal prefixes: {key}")
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


def upload(s3, bucket, base, index, files):
    done = {"put": 0, "kept": 0}
    for name, path in sorted(files.items()):
        done[put_new(s3, bucket, base + name, body_path=path)] += 1
    body = (json.dumps(dict(index, base=base), indent=1) + "\n").encode()
    done[put_new(s3, bucket, base + "index.json", body=body, content_type="application/json")] += 1
    return done


def site_index(index, base):
    """The index as the site serves it: what the app reads, and its base."""
    keep = ("schemaVersion", "kind", "generatedAt", "bounds", "minzoom", "maxzoom", "tileSize", "options",
            "stations", "attribution")
    out = {k: index[k] for k in keep if k in index}
    out["stations"] = [{k: s[k] for k in ("id", "name", "lonLat", "high", "low")} for s in index["stations"]]
    out["base"] = base
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--imagery", help="tiles.py imagery's --out (index.json, high.pmtiles, low.pmtiles)")
    p.add_argument("--intertidal", help="tiles.py intertidal's --out")
    p.add_argument("--offline", help="a small imagery set for public-data/ (tiles.py imagery --bbox)")
    p.add_argument("--env", help="the env file with the bucket's credentials")
    p.add_argument("--upload", action="store_true", help="put the objects in the bucket (else only the repo)")
    p.add_argument("--repo", default=REPO)
    a = p.parse_args()
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
        out = os.path.join(a.repo, "public", "satellite", "index.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            json.dump(site_index(index, base), fh, indent=1)
            fh.write("\n")
        print(f"repo: public/satellite/index.json → {base}")

    if a.intertidal:
        index, files = intertidal_set(a.intertidal)
        base = f"intertidal/{version_of(files)}/"
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"{base}: {len(files)} archives + index, {total / 1e6:.1f} MB")
        if s3:
            print(f"bucket: {upload(s3, bucket, base, index, files)}")

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
        for name, path in files.items():
            shutil.copyfile(path, os.path.join(dest, name))
        with open(os.path.join(dest, "index.json"), "w") as fh:
            json.dump(site_index(index, base), fh, indent=1)
            fh.write("\n")
        total = sum(os.path.getsize(f) for f in files.values())
        print(f"offline: public-data/{base} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
