#!/bin/sh
# The rocks pilot end to end, after the downloads (fetch_s2.py, fetch_gauge.py, fetch_osm.sh,
# the EOT20 model and the UKHO Killard events: see README.md).
# usage: sh run_all.sh <python> <root> <foildepth-data>
#   <python>          a venv's python with the packages in README.md
#   <root>            e.g. /Volumes/workdrive/rocks-pilot (downloads/ in, out/ and the viewer out)
#   <foildepth-data>  the foil-depth build's data directory (for the LiDAR mosaics)
set -eu
PY="$1"; ROOT="$2"; FD="$3"
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../.." && pwd)"
DL="$ROOT/downloads"; OUT="$ROOT/out"
run() { "$PY" -I -W ignore "$@"; }

run "$S/tide_model.py" --eot20 "$DL/eot20/x" --s2 "$DL/s2" --tide "$DL/tide" --out "$OUT/tide"
for a in down dublin portmarnock; do
  run "$S/build_heights.py" --area "$a" --s2 "$DL/s2" --tide "$DL/tide" --model-tide "$OUT/tide" --out "$OUT/$a"
done
run "$S/compare_foildepth.py" --area dublin --heights "$OUT/dublin" --pmtiles "$REPO/public/foildepth/dublin-north.pmtiles" \
  --lidar "$FD/lidar/mal/mosaic_DTM_mal_ITM_ODMalin_2m.tif" --s2 "$DL/s2" --out "$OUT/dublin" > /dev/null
run "$S/compare_foildepth.py" --area portmarnock --heights "$OUT/portmarnock" --pmtiles "$REPO/public/foildepth/dublin-north.pmtiles" \
  --lidar "$FD/lidar/dub/mosaic_DTM_dub_ITM_ODMalin_2m.tif" --s2 "$DL/s2" --out "$OUT/portmarnock" > /dev/null
run "$S/experiments.py" --area dublin --s2 "$DL/s2" --tide "$DL/tide" --model-tide "$OUT/tide" --heights "$OUT/dublin" \
  --reference "$OUT/dublin/dublin-foildepth-on-grid.tif" --band 1 --out "$OUT/dublin/dublin-sensitivity-vs-foildepth.json"
run "$S/experiments.py" --area portmarnock --s2 "$DL/s2" --tide "$DL/tide" --model-tide "$OUT/tide" --heights "$OUT/portmarnock" \
  --reference "$OUT/portmarnock/portmarnock-foildepth-on-grid.tif" --band 3 --band-min 1.7 --out "$OUT/portmarnock/portmarnock-sensitivity-vs-lidar.json"
for a in dublin portmarnock; do
  run "$S/check_layer_scenes.py" --area "$a" --s2 "$DL/s2" --heights "$OUT/$a" > /dev/null
done
run "$S/tide_consistency.py" --s2 "$DL/s2" --out "$OUT" --areas dublin portmarnock down
for a in down dublin; do
  run "$S/osm_to_geojson.py" "$DL/osm/$a.osm.json" "$OUT/$a/$a-osm.geojson"
  run "$S/rock_features.py" --area "$a" --s2 "$DL/s2" --heights "$OUT/$a" --out "$OUT/$a"
  run "$S/classify_rocks.py" --area "$a" --s2 "$DL/s2" --out "$OUT/$a"
  run "$S/figures.py" --area "$a" --s2 "$DL/s2" --out "$OUT/$a"
done
run "$S/make_viewer_data.py" --s2 "$DL/s2" --out "$OUT" --viewer "$ROOT"
run "$S/shoot_viewer.py" "$ROOT/viewer.html" "$ROOT/screenshots"
run "$S/collect_findings.py" "$OUT" "$ROOT/screenshots"
