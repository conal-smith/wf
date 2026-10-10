#!/usr/bin/env bash
# The self-hosted site image (deploy/local/Dockerfile.web), started and asked the
# questions deploy/local/README.md promises it answers: the health check, the app
# shell on every client-side route, the content-hashed assets, and a 404 -- not
# the app's HTML -- for forecast data that has not been published.
#
#   scripts/release/web-image-smoke.sh ghcr.io/sprintengine/wingfoil-web@sha256:...
set -euo pipefail

IMAGE="${1:?usage: web-image-smoke.sh IMAGE}"
PORT="${SMOKE_WEB_PORT:-18080}"
NAME="wingfoil-web-smoke-$$"
BASE="http://127.0.0.1:$PORT"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 1
done

fail() { echo "FAIL $*" >&2; docker logs "$NAME" 2>&1 | tail -n 20 >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
header() { curl -sI "$BASE$1" | tr -d '\r' | awk -v name="$2" 'tolower($1) == tolower(name) ":" { $1 = ""; sub(/^ /, ""); print }'; }

[ "$(curl -fsS "$BASE/healthz")" = ok ] || fail "/healthz did not answer ok"

for route in / /spot /spot/brandon /stars /market /community /ai; do
  [ "$(status "$route")" = 200 ] || fail "$route is not 200"
  curl -fsS "$BASE$route" | grep -q '<div id="root">' || fail "$route did not serve the app shell"
done
[ "$(header / Cache-Control)" = "max-age=0, must-revalidate" ] || fail "/ is cacheable"

asset="$(curl -fsS "$BASE/" | grep -oE '/assets/[^"]+\.js' | head -n 1)"
[ -n "$asset" ] || fail "the app shell names no script"
[ "$(status "$asset")" = 200 ] || fail "$asset is not 200"
[ "$(header "$asset" Cache-Control)" = "public, max-age=31536000, immutable" ] || fail "$asset is not immutable"
header "$asset" Content-Type | grep -q '^text/javascript' || fail "$asset is not served as JavaScript"

# An empty volume: the pointer manifest must 404, never fall back to index.html.
[ "$(status /weather/harmonie.json)" = 404 ] || fail "/weather/harmonie.json is not a 404 on an empty volume"

docker exec "$NAME" id -u >/dev/null
echo "Web image smoke passed: $IMAGE"
