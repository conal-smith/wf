#!/bin/sh
# EMODnet Bathymetry's satellite-derived coastlines (LAT, MSL, MHW waterlines,
# and OSM's) touching one area's box, as GeoJSON, into the download directory.
# The layer is not in the WFS capabilities but is served (CC BY 4.0).
#   sh fetch-coastlines.sh <out-dir> <id> <W> <S> <E> <N>
set -e
out=$1
id=$2
mkdir -p "$out"
[ -s "$out/$id.json" ] && exit 0
curl -s -m 300 -o "$out/$id.json" "https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:coastlines&outputFormat=application/json&srsName=EPSG:4326&bbox=$3,$4,$5,$6,EPSG:4326"
echo "$id $(wc -c < "$out/$id.json") bytes"
