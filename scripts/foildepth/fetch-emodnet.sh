#!/bin/sh
# The fallback seabed: EMODnet Bathymetry's DTM (emodnet:mean, 1/16' ~115 m,
# metres relative to chart datum ~LAT, negative down) over one area's box, into
# the download directory given. Also the DTM's source references (WFS
# `emodnet:source_references`, a polygon per survey or gap-fill per release):
# where no survey reached, EMODnet fills in from GEBCO, and over drying flats
# that fill is a smooth hollow metres under LAT (Sandymount's was −11 m), so
# build.py drops the DTM's cells whose 2024 source is GEBCO.
#   sh fetch-emodnet.sh <out-dir> <id> <W> <S> <E> <N>
set -e
out=$1
id=$2
mkdir -p "$out"
F=0.00104166666666667
[ -s "$out/$id.tif" ] || curl -s -m 600 -o "$out/$id.tif" "https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326&BBOX=$3,$4,$5,$6&format=image/tiff&interpolation=nearest&resx=$F&resy=$F"
[ -s "$out/$id.sources.json" ] || curl -s -m 600 -o "$out/$id.sources.json" "https://ows.emodnet-bathymetry.eu/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=emodnet:source_references&outputFormat=application/json&srsName=EPSG:4326&bbox=$3,$4,$5,$6,EPSG:4326"
echo "$id $(wc -c < "$out/$id.tif") + $(wc -c < "$out/$id.sources.json") bytes"
