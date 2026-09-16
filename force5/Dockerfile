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
COPY public/spots.json public/riding-locations.json /app/public/
USER 10001:10001
VOLUME ["/data"]
ENTRYPOINT ["python", "/app/force5/ingest/worker.py"]
