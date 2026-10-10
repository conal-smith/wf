#!/bin/sh
# The fallback seabed: EMODnet Bathymetry's DTM (emodnet:mean, 1/16' ~115 m,
# metres relative to chart datum ~LAT, negative down) over one area's box, into
# the download directory given.
#   sh fetch-emodnet.sh <out-dir> <id> <W> <S> <E> <N>
set -e
out=$1
id=$2
mkdir -p "$out"
[ -s "$out/$id.tif" ] && exit 0
F=0.00104166666666667
curl -s -m 600 -o "$out/$id.tif" "https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326&BBOX=$3,$4,$5,$6&format=image/tiff&interpolation=nearest&resx=$F&resy=$F"
echo "$id $(wc -c < "$out/$id.tif") bytes"
