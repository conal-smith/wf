"""The platforms inside an image index, from `docker buildx imagetools inspect`.

The forecast image is published as one manifest list. CI and the nightly merge
job both refuse a list that does not contain linux/amd64 and linux/arm64.
Attestations (platform unknown, reference type attestation-manifest) are not
images and do not count.

    docker buildx imagetools inspect --format '{{json .Manifest}}' IMAGE \
      | python3 scripts/release/manifest_platforms.py check - linux/amd64 linux/arm64
    python3 scripts/release/manifest_platforms.py digest manifest.json
"""

import json
import sys

ATTESTATION = "attestation-manifest"


def load_manifest(path):
    if path == "-":
        return json.load(sys.stdin)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def platform_name(descriptor):
    """`os/arch` or `os/arch/variant` for a runnable image, else None.

    linux/arm64/v8 is the variant Docker asks Colima for; it still satisfies
    a requirement of linux/arm64.
    """
    annotations = descriptor.get("annotations") or {}
    if annotations.get("vnd.docker.reference.type") == ATTESTATION:
        return None
    platform = descriptor.get("platform") or {}
    operating_system = platform.get("os")
    architecture = platform.get("architecture")
    if not operating_system or not architecture:
        return None
    if operating_system == "unknown" or architecture == "unknown":
        return None
    name = f"{operating_system}/{architecture}"
    variant = platform.get("variant")
    if variant:
        name = f"{name}/{variant}"
    return name


def platforms(manifest):
    """Runnable platforms named by an OCI index or a Docker manifest list."""
    if not isinstance(manifest, dict):
        return []
    descriptors = manifest.get("manifests")
    if not isinstance(descriptors, list):
        return []
    found = []
    for descriptor in descriptors:
        if not isinstance(descriptor, dict):
            continue
        name = platform_name(descriptor)
        if name and name not in found:
            found.append(name)
    return found


def missing(manifest, required):
    """Required platforms that no descriptor satisfies."""
    found = platforms(manifest)
    absent = []
    for want in required:
        if not any(name == want or name.startswith(want + "/") for name in found):
            absent.append(want)
    return absent


def digest(manifest):
    """The index digest imagetools puts on `{{json .Manifest}}`."""
    value = manifest.get("digest") if isinstance(manifest, dict) else None
    if not isinstance(value, str) or not value.startswith("sha256:") or len(value) != 7 + 64:
        raise SystemExit("manifest JSON has no sha256 digest; inspect with --format '{{json .Manifest}}'")
    return value


def main(argv):
    if len(argv) < 2 or argv[0] not in ("check", "digest"):
        print("usage: manifest_platforms.py check FILE PLATFORM... | digest FILE", file=sys.stderr)
        return 2
    manifest = load_manifest(argv[1])
    if argv[0] == "digest":
        print(digest(manifest))
        return 0
    required = argv[2:]
    if not required:
        print("usage: manifest_platforms.py check FILE PLATFORM...", file=sys.stderr)
        return 2
    found = platforms(manifest)
    absent = missing(manifest, required)
    listed = ", ".join(found) if found else "none"
    if absent:
        print(f"manifest list is missing {', '.join(absent)} (has {listed})", file=sys.stderr)
        return 1
    print(f"manifest list has {listed}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
