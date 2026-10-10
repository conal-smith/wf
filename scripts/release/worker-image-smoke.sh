#!/usr/bin/env bash
# The forecast worker image, checked as the artifact it is: what force5/Dockerfile
# built, with the Python and the wheels inside it, not the developer's venv.
#
#   scripts/release/worker-image-smoke.sh ghcr.io/sprintengine/wingfoil-forecast@sha256:...
#
# No network and no bucket: that is scripts/release/acceptance.sh. This is the
# gate a broken dependency fails. Each importer is imported in a process of its
# own and must exit 0, because an importer that crashes on its way out (eccodes
# and pyproj freeing the same memory, see force5/ingest/requirements-lock.txt)
# publishes its run and is still counted as failed by the worker.
set -euo pipefail

IMAGE="${1:?usage: worker-image-smoke.sh IMAGE}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

step() { printf '\n== %s\n' "$*"; }

step "Every ingest module imports and exits cleanly"
docker run --rm --entrypoint sh "$IMAGE" -euc '
  cd /app/force5/ingest
  failed=0
  for script in *.py; do
    case "$script" in test_*) continue ;; esac
    module="${script%.py}"
    if python -c "import $module" >/tmp/import.log 2>&1; then
      echo "ok   $module"
    else
      code=$?
      echo "FAIL $module (exit $code)"
      sed "s/^/     /" /tmp/import.log
      failed=1
    fi
  done
  exit "$failed"'

# The suite reads its golden files from tests/fixtures, which the image does not
# carry, and expects the catalogue default the image overrides for production.
step "The ingest unit tests, on the image's own Python"
docker run --rm -v "$ROOT/tests:/app/tests:ro" --entrypoint sh "$IMAGE" -euc '
  unset FORCE5_SPOTS_FILE
  cd /app/force5/ingest
  python -m unittest discover -s . -p "test_*.py" >/tmp/tests.log 2>&1 && code=0 || code=$?
  if [ "$code" -ne 0 ]; then
    grep -E "^(ERROR|FAIL):" /tmp/tests.log || true
  fi
  tail -n 4 /tmp/tests.log
  exit "$code"' || { echo "The ingest unit tests failed in the image (or the interpreter crashed on exit)." >&2; exit 1; }

step "The entry points answer"
docker run --rm "$IMAGE" --help >/dev/null
for script in scheduler.py status.py prune.py; do
  docker run --rm --entrypoint python "$IMAGE" "/app/force5/ingest/$script" --help >/dev/null
done
# The cadence file baked into the image parses and names only registered models.
docker run --rm --entrypoint python "$IMAGE" /app/force5/ingest/scheduler.py --list >/dev/null

step "The blend job's bundle runs on the image's node"
docker run --rm --entrypoint sh "$IMAGE" -euc '
  test -f /app/force5/blend/dist/blend.mjs
  node --version'

step "Runs as the unprivileged worker"
user="$(docker run --rm --entrypoint id "$IMAGE" -u)"
[ "$user" = 10001 ] || { echo "The image runs as uid $user, not 10001." >&2; exit 1; }

echo
echo "Worker image smoke passed: $IMAGE"
