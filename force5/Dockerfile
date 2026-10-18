# The blend job (force5/blend/build.ts) runs the site's own TypeScript, bundled
# here into one dependency-free file, so the worker needs only the node binary.
# node:22-slim is multi-arch. buildx sets TARGETARCH and builds this stage for
# the image platform, so the binary copied into the runtime image matches it.
FROM node:22-slim AS blend
ARG TARGETARCH
WORKDIR /opt/esbuild
COPY package-lock.json /tmp/package-lock.json
# esbuild's binary is the optional package @esbuild/linux-x64 or linux-arm64,
# published at the same version the lock pins. Install that one by TARGETARCH:
# npm's platform guess is what a cross build gets wrong.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) esbuild_arch=x64; node_arch=x64 ;; \
      arm64) esbuild_arch=arm64; node_arch=arm64 ;; \
      *) echo "force5 image supports linux/amd64 and linux/arm64 (TARGETARCH=${TARGETARCH:-unset})" >&2; exit 1 ;; \
    esac; \
    version="$(node -p "require('/tmp/package-lock.json').packages['node_modules/esbuild'].version")"; \
    npm init -y >/dev/null; \
    npm install --no-audit --no-fund \
      "esbuild@${version}" \
      "@esbuild/linux-${esbuild_arch}@${version}"; \
    test "$(node -p process.arch)" = "$node_arch"; \
    "/opt/esbuild/node_modules/@esbuild/linux-${esbuild_arch}/bin/esbuild" --version
WORKDIR /src
COPY force5/src/ force5/src/
COPY force5/blend/ force5/blend/
COPY src/ src/
# The run layout the blend is published in (a run directory of spot squares).
COPY scripts/runs.mjs scripts/runs.mjs
RUN /opt/esbuild/node_modules/.bin/esbuild force5/blend/build.ts --bundle \
      --platform=node --format=esm --target=node22 '--define:import.meta.env={}' \
      --outfile=force5/blend/dist/blend.mjs

FROM python:3.12-slim
ARG TARGETARCH

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    FORCE5_WORK_DIR=/data FORCE5_SPOTS_FILE=/app/public/riding-locations.json
WORKDIR /app
COPY force5/ingest/requirements*.txt /app/force5/ingest/
# requirements-lock.txt pins every package, transitive ones too, to a set the
# image smoke test has passed with (scripts/release/worker-image-smoke.sh).
# --only-binary refuses a source build, so a wheel published for one architecture
# cannot stand in for the other. The locked native packages (eccodeslib, eckitlib,
# pyproj, numpy, cffi, brotli) publish manylinux wheels for x86_64 and aarch64.
RUN pip install --no-cache-dir --only-binary=:all: \
       -r force5/ingest/requirements-worker.txt \
       -c force5/ingest/requirements-lock.txt \
    && groupadd --gid 10001 force5 \
    && useradd --uid 10001 --gid 10001 --no-create-home force5 \
    && mkdir /data && chown 10001:10001 /data
COPY force5/ingest/ /app/force5/ingest/
COPY --from=blend /usr/local/bin/node /usr/local/bin/node
COPY --from=blend /src/force5/blend/dist/blend.mjs /app/force5/blend/dist/blend.mjs
COPY public/spots.json public/riding-locations.json /app/public/
# Default cadence schedule; the local deployment bind-mounts its own over this one.
COPY deploy/local/jobs.toml /app/deploy/local/jobs.toml
# node was copied from the blend stage, and pip selected wheels for this platform.
# Fail the build if either is the other architecture.
RUN TARGETARCH="$TARGETARCH" python /app/force5/ingest/check_native_arch.py
USER 10001:10001
# No VOLUME: a batch container gets a fresh empty /data each run and uploads to the
# bucket, and declaring one only makes plain Docker leave an anonymous volume behind
# per run. The local deployment still mounts its own named volume over /data.
ENTRYPOINT ["python", "/app/force5/ingest/worker.py"]
