#!/usr/bin/env bash
# The marketplace API image (market/Dockerfile) boots and answers its health
# check. Production refuses the in-memory database and dev sign-in, and needs
# Postgres, Clerk and a bucket, so this starts the built server in development
# mode: it proves the compiled tree and its production dependencies run.
#
#   scripts/release/market-image-smoke.sh ghcr.io/sprintengine/wingfoil-market@sha256:...
set -euo pipefail

IMAGE="${1:?usage: market-image-smoke.sh IMAGE}"
PORT="${SMOKE_MARKET_PORT:-18787}"
NAME="wingfoil-market-smoke-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8787" \
  -e NODE_ENV=development -e MARKET_DB=memory -e MARKET_AUTH_MODE=dev -e MARKET_STORAGE=local \
  "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  if [ "$(curl -s "http://127.0.0.1:$PORT/api/market/health")" = '{"ok":true}' ]; then
    echo "Marketplace API image smoke passed: $IMAGE"
    exit 0
  fi
  sleep 1
done
echo "FAIL the marketplace API never answered /api/market/health" >&2
docker logs "$NAME" 2>&1 | tail -n 20 >&2
exit 1
