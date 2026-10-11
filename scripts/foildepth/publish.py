"""Version the chart's static archives and put them in the data bucket.

The foilable-depth archives (the pilots of build.py and the regions of
national.py, with their index) and the chart's bathymetry
(scripts/bathymetry) are served from the data bucket behind
https://data.wingfoil.ie, not from the site: Cloudflare Pages serves no byte
ranges and caps a file at 25 MiB, and the national set is far larger. Each
set goes under an immutable, content-versioned prefix,

    foildepth/v<12 hex>/index.json, <area>.pmtiles ...
    bathy/v<12 hex>/ireland.pmtiles

the version being the SHA-256 of the set's files (name and bytes), so a new
build is a new prefix and a cached copy can never be stale. Objects are only
ever added: one already there with the same size is left alone, one with a
different size stops the run (that would be a hash collision, or a bug), and
nothing is deleted. The bucket sweep (force5/ingest/prune.py) never touches
either prefix.

Then the repo is pointed at them:
- public/foildepth/index.json, the site's copy of the index, whose `base`
  names the prefix (the client reads it from the site and the archives through
  the data base URL, force5/src/urls.ts);
- force5/src/chartStyle.ts's BATHY_PATH;
- public-data/: the pilots' and the bathymetry's archives under the same
  paths, committed so the dev server and the e2e site work offline (the
  regions are too large: in dev they come through the data base URL).

    python -I publish.py --set /tmp/wf-foildepth-national/out --bathy public-data/bathy/v…/ireland.pmtiles \\
        [--env deploy/home-compute/.env --upload]

Credentials come from the env file (S3_BUCKET, S3_ENDPOINT_URL,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) and are never printed.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
IMMUTABLE = "public, max-age=31536000, immutable"


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


def foildepth_set(set_dir):
    """The index (without its base) and the archives it names."""
    index = json.load(open(os.path.join(set_dir, "index.json")))
    files = {}
    for area in index["areas"]:
        name = area["url"]
        if "/" in name or not name.endswith(".pmtiles"):
            raise SystemExit(f"index: {name} is not an archive beside the index")
        files[name] = os.path.join(set_dir, name)
    for path in files.values():
        if not os.path.exists(path):
            raise SystemExit(f"missing archive {path}")
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
    if not (key.startswith("foildepth/v") or key.startswith("bathy/v")):
        raise SystemExit(f"refusing to write outside the static prefixes: {key}")
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


def point_repo(base, index, files, bathy_key, bathy_path, repo):
    # The site's copy of the index.
    site_index = dict(index, base=base)
    with open(os.path.join(repo, "public", "foildepth", "index.json"), "w") as fh:
        json.dump(site_index, fh, indent=1)
        fh.write("\n")
    # The offline copies: the pilots (small) and the bathymetry.
    data = os.path.join(repo, "public-data")
    keep = {os.path.normpath(os.path.join(data, base))}
    if bathy_key:
        keep.add(os.path.normpath(os.path.join(data, os.path.dirname(bathy_key))))
    for d in ("foildepth", "bathy") if bathy_key else ("foildepth",):
        if os.path.isdir(os.path.join(data, d)):
            for old in os.listdir(os.path.join(data, d)):
                path = os.path.normpath(os.path.join(data, d, old))
                if old.startswith("v") and path not in keep:
                    shutil.rmtree(path)
    os.makedirs(os.path.join(data, base), exist_ok=True)
    for area in index["areas"]:
        if area.get("kind") == "pilot":
            shutil.copyfile(files[area["url"]], os.path.join(data, base, area["url"]))
    if bathy_path:
        dest = os.path.join(data, bathy_key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.abspath(dest) != os.path.abspath(bathy_path):
            shutil.copyfile(bathy_path, dest)
        style = os.path.join(repo, "force5", "src", "chartStyle.ts")
        text = open(style).read()
        text, n = re.subn(r'export const BATHY_PATH = "[^"]*";', f'export const BATHY_PATH = "{bathy_key}";', text)
        if n != 1:
            raise SystemExit("chartStyle.ts: BATHY_PATH not found")
        open(style, "w").write(text)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--set", required=True, help="national.py's --out, with index.json")
    p.add_argument("--bathy", help="the bathymetry archive (scripts/bathymetry)")
    p.add_argument("--env", help="the env file with the bucket's credentials")
    p.add_argument("--upload", action="store_true", help="put the objects in the bucket (else only the repo)")
    p.add_argument("--repo", default=REPO)
    a = p.parse_args()

    index, files = foildepth_set(a.set)
    version = version_of(files)
    base = f"foildepth/{version}/"
    bathy_key = f"bathy/{version_of({'ireland.pmtiles': a.bathy})}/ireland.pmtiles" if a.bathy else None
    total = sum(os.path.getsize(f) for f in files.values())
    print(f"{base}: {len(files)} archives + index, {total / 1e6:.1f} MB")
    if bathy_key:
        print(f"{bathy_key}: {os.path.getsize(a.bathy) / 1e6:.1f} MB")

    if a.upload:
        if not a.env:
            raise SystemExit("--upload needs --env")
        env = read_env(a.env)
        s3, bucket = client(env), env["S3_BUCKET"]
        done = {"put": 0, "kept": 0}
        for name, path in sorted(files.items()):
            done[put_new(s3, bucket, base + name, body_path=path)] += 1
        body = (json.dumps(dict(index, base=base), indent=1) + "\n").encode()
        done[put_new(s3, bucket, base + "index.json", body=body, content_type="application/json")] += 1
        if bathy_key:
            done[put_new(s3, bucket, bathy_key, body_path=a.bathy)] += 1
        print(f"bucket: {done['put']} put, {done['kept']} already there")
    point_repo(base, index, files, bathy_key, a.bathy, a.repo)
    print(f"repo: public/foildepth/index.json → {base}; public-data/ holds the pilots"
          + (f" and {bathy_key}" if bathy_key else ""))


if __name__ == "__main__":
    sys.exit(main())
