#!/usr/bin/env bash
# Acceptance for a pair of built images, end to end, against the real providers:
#
#   1. the worker image fetches real forecasts into a volume, as the Compose
#      stack and Home Compute run it;
#   2. status.py calls what it wrote fresh and complete;
#   3. the worker publishes that output to an S3-compatible bucket (moto), the
#      path production takes to R2, and the bucket holds every object the
#      manifests reference;
#   4. the web image serves the volume, and the deployed-site smoke suite
#      (e2e/smoke) draws the map, the dock and a spot page from it.
#
#   scripts/release/acceptance.sh WORKER_IMAGE WEB_IMAGE
#
# ACCEPTANCE_MODELS picks the models. The default is HARMONIE, which the map
# boots from (without it the site says the forecast is not ready), and GFS: about
# 1.5 minutes and a few MB from Met Éireann and NOAA, the most dependable sources
# the worker reads. Adding a feed that is often down (the Marine Institute's tide
# server answered 504 for an hour on 10 October 2026) would fail releases for a
# fault in nobody's image.
# Needs Docker, network access to the providers, and `npm ci` plus Playwright's
# Chromium for step 4.
set -euo pipefail

WORKER="${1:?usage: acceptance.sh WORKER_IMAGE WEB_IMAGE}"
WEB="${2:?usage: acceptance.sh WORKER_IMAGE WEB_IMAGE}"
MODELS="${ACCEPTANCE_MODELS:-harmonie gfs}"
PORT="${ACCEPTANCE_WEB_PORT:-18081}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN="wingfoil-acceptance-$$"
BUCKET=wingfoil
PREFIX=acceptance
S3_ENV=(-e AWS_ACCESS_KEY_ID=acceptance -e AWS_SECRET_ACCESS_KEY=acceptance-secret -e AWS_REGION=us-east-1)

step() { printf '\n== %s\n' "$*"; }
cleanup() {
  docker rm -f "$RUN-s3" "$RUN-web" >/dev/null 2>&1 || true
  docker network rm "$RUN" >/dev/null 2>&1 || true
  docker volume rm "$RUN" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$RUN" >/dev/null
docker network create "$RUN" >/dev/null
# The web image's /data is laid out for the non-root worker; a fresh named volume
# copies it, as the Compose stack's seed service relies on.
docker run --rm --user 10001:10001 -v "$RUN:/data" --entrypoint sh "$WEB" \
  -c 'mkdir -p /data/public/weather /data/public/marine'

# shellcheck disable=SC2086 # MODELS is a word list
{
  step "Fetch $MODELS from the providers into a volume"
  # One retry: a provider's mirror answering 5xx for a minute is not a broken image.
  docker run --rm -v "$RUN:/data" "$WORKER" --models $MODELS --step 3 \
    || { echo "Retrying once in 60s"; sleep 60; docker run --rm -v "$RUN:/data" "$WORKER" --models $MODELS --step 3; }

  step "Every model fresh and complete"
  docker run --rm -v "$RUN:/data" --entrypoint python "$WORKER" /app/force5/ingest/status.py --models $MODELS

  step "Publish to an S3-compatible bucket, the way production publishes to R2"
  # moto's S3 server: MinIO no longer publishes a public image. Any credentials
  # are accepted; the uploader's conditional-write fallback covers either answer.
  docker run -d --name "$RUN-s3" --network "$RUN" motoserver/moto:5.1.22 -H 0.0.0.0 -p 9000 >/dev/null
  docker run --rm --network "$RUN" "${S3_ENV[@]}" --entrypoint python "$WORKER" -c "
import time, boto3
s3 = boto3.client('s3', endpoint_url='http://$RUN-s3:9000')
for attempt in range(30):
    try:
        s3.create_bucket(Bucket='$BUCKET'); break
    except Exception as error:
        if attempt == 29: raise
        time.sleep(1)"
  docker run --rm --network "$RUN" -v "$RUN:/data" "${S3_ENV[@]}" "$WORKER" \
    --models $MODELS --publish-only --bucket "$BUCKET" --prefix "$PREFIX" --endpoint-url "http://$RUN-s3:9000"
  docker run --rm --network "$RUN" -v "$RUN:/data:ro" "${S3_ENV[@]}" \
    -v "$ROOT/scripts/release/verify_bucket.py:/verify_bucket.py:ro" --entrypoint python "$WORKER" \
    /verify_bucket.py --bucket "$BUCKET" --prefix "$PREFIX" --endpoint-url "http://$RUN-s3:9000" $MODELS
}

step "Serve the volume with the web image"
docker run -d --name "$RUN-web" -p "127.0.0.1:$PORT:8080" -v "$RUN:/data:ro" "$WEB" >/dev/null
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done

step "Smoke the site it serves"
# The pointer manifests those models publish, from the image's own registry.
# shellcheck disable=SC2086
manifests="$(docker run --rm --entrypoint python -w /app/force5/ingest "$WORKER" -c \
  'import sys; from registry import MANIFESTS; print(",".join(MANIFESTS[m] for m in sys.argv[1:]))' $MODELS)"
(cd "$ROOT" && SMOKE_BASE_URL="http://127.0.0.1:$PORT" SMOKE_MANIFESTS="$manifests" \
  npx playwright test -c playwright.smoke.config.ts)

echo
echo "Acceptance passed: $WORKER with $WEB"
