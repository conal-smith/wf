set -e
mkdir -p tif
get() { # name w s e n res
  [ -s tif/$1.tif ] && return
  curl -s -m 300 -o tif/$1.tif "https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326&BBOX=$2,$3,$4,$5&format=image/tiff&interpolation=nearest&resx=$6&resy=$6"
  echo "$1 $(ls -la tif/$1.tif | awk '{print $5}')"
}
R=0.0025
get ie-sw -11.2 51.3 -8.2 53.4 $R &
get ie-nw -11.2 53.4 -8.2 55.5 $R &
get ie-se -8.2 51.3 -5.2 53.4 $R &
get ie-ne -8.2 53.4 -5.2 55.5 $R &
F=0.00104166666
get brandon -10.45 52.13 -9.65 52.42 $F &
get dollymount -6.33 53.22 -5.95 53.5 $F &
get rusheen -9.4 53.1 -8.85 53.32 $F &
get keel -10.35 53.82 -9.8 54.12 $F &
get the-burrow -6.6 52.12 -6.15 52.42 $F &
wait
