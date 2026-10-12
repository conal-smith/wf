#!/bin/sh
# OpenStreetMap / OpenSeaMap rocks, reefs and hazards over a pilot area (Overpass, ODbL).
# usage: sh fetch_osm.sh <out-dir> <area-id> <south> <west> <north> <east>
set -eu
out="$1"; area="$2"; s="$3"; w="$4"; n="$5"; e="$6"
mkdir -p "$out"
bbox="$s,$w,$n,$e"
query="[out:json][timeout:120];
(
  nwr[\"natural\"~\"^(reef|rock|bare_rock|stone|shoal|cliff|beach|sand|shingle)$\"]($bbox);
  nwr[\"wetland\"=\"tidalflat\"]($bbox);
  nwr[\"seamark:type\"~\"^(rock|obstruction|wreck|seabed_area|light_minor|beacon_isolated_danger|beacon_lateral|beacon_cardinal|buoy_cardinal|buoy_lateral|buoy_isolated_danger)$\"]($bbox);
  nwr[\"natural\"=\"coastline\"]($bbox);
);
out body geom;"
curl -sS -m 180 -A "wingfoil.ie rocks pilot" --data-urlencode "data=$query" \
  https://overpass-api.de/api/interpreter -o "$out/$area.osm.json"
ls -la "$out/$area.osm.json"
