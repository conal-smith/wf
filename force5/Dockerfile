# The blend job (force5/blend/build.ts) runs the site's own TypeScript, bundled
# here into one dependency-free file, so the worker needs only the node binary.
FROM node:22-slim AS blend
WORKDIR /opt/esbuild
COPY package-lock.json /tmp/package-lock.json
RUN npm init -y >/dev/null \
    && npm install --no-audit --no-fund \
       "esbuild@$(node -p "require('/tmp/package-lock.json').packages['node_modules/esbuild'].version")"
WORKDIR /src
COPY force5/src/ force5/src/
COPY force5/blend/ force5/blend/
COPY src/ src/
RUN /opt/esbuild/node_modules/.bin/esbuild force5/blend/build.ts --bundle \
      --platform=node --format=esm --target=node22 '--define:import.meta.env={}' \
      --outfile=force5/blend/dist/blend.mjs

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    FORCE5_WORK_DIR=/data FORCE5_SPOTS_FILE=/app/public/riding-locations.json
WORKDIR /app
COPY force5/ingest/requirements*.txt /app/force5/ingest/
RUN pip install --no-cache-dir -r force5/ingest/requirements-worker.txt \
    && groupadd --gid 10001 force5 \
    && useradd --uid 10001 --gid 10001 --no-create-home force5 \
    && mkdir /data && chown 10001:10001 /data
COPY force5/ingest/ /app/force5/ingest/
COPY --from=blend /usr/local/bin/node /usr/local/bin/node
COPY --from=blend /src/force5/blend/dist/blend.mjs /app/force5/blend/dist/blend.mjs
COPY public/spots.json public/riding-locations.json /app/public/
# Default cadence schedule; the local deployment bind-mounts its own over this one.
COPY deploy/local/jobs.toml /app/deploy/local/jobs.toml
USER 10001:10001
# No VOLUME: a batch container gets a fresh empty /data each run and uploads to the
# bucket, and declaring one only makes plain Docker leave an anonymous volume behind
# per run. The local deployment still mounts its own named volume over /data.
ENTRYPOINT ["python", "/app/force5/ingest/worker.py"]
