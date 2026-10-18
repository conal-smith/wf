#!/usr/bin/env bash
# Build a one-off manifest list from two single-platform `docker save` archives
# and refuse it unless both platforms are in the list. CI uses this so a pull
# request proves the merge, not only that each platform image built. The
# nightly does the same merge against GHCR with `docker buildx imagetools`.
#
#   scripts/release/local-manifest.sh forecast-linux-amd64.tar forecast-linux-arm64.tar
#
# The builder must already be able to pull from http://127.0.0.1:5000
# (ci.yml's setup-buildx: network=host and an insecure registry entry).
# Each archive must load as wingfoil-forecast:ci, which is how CI tags the build.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: local-manifest.sh AMD64_TAR ARM64_TAR" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AMD64_TAR=$1
ARM64_TAR=$2
REGISTRY=127.0.0.1:5000
IMAGE=wingfoil-forecast
NAME=wingfoil-manifest-registry

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p 5000:5000 registry:2 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 30); do
  if curl -sf "http://${REGISTRY}/v2/" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "The local registry did not answer on ${REGISTRY}." >&2
  exit 1
fi

load_and_push() {
  local tar=$1 arch=$2 loaded ref
  loaded="$(docker load -i "$tar")"
  printf '%s\n' "$loaded"
  ref="$(printf '%s\n' "$loaded" | sed -n 's/^Loaded image: //p' | head -n 1)"
  if [ "$ref" != "${IMAGE}:ci" ]; then
    echo "Expected ${tar} to load as ${IMAGE}:ci, got: ${ref:-nothing}" >&2
    exit 1
  fi
  docker tag "$ref" "${REGISTRY}/${IMAGE}:${arch}"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if docker push "${REGISTRY}/${IMAGE}:${arch}"; then
      return 0
    fi
    sleep 1
  done
  echo "Could not push ${arch} to ${REGISTRY}." >&2
  return 1
}

# Push each archive before loading the next: both files restore the same local tag.
load_and_push "$AMD64_TAR" amd64
load_and_push "$ARM64_TAR" arm64

docker buildx imagetools create \
  -t "${REGISTRY}/${IMAGE}:ci" \
  "${REGISTRY}/${IMAGE}:amd64" \
  "${REGISTRY}/${IMAGE}:arm64"

manifest="$(mktemp)"
docker buildx imagetools inspect --format '{{json .Manifest}}' "${REGISTRY}/${IMAGE}:ci" >"$manifest"
python3 "$ROOT/scripts/release/manifest_platforms.py" check "$manifest" linux/amd64 linux/arm64
