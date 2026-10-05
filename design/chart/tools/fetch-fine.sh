F=0.00104166666666667
get() { [ -s tif/fine/$1.tif ] && return; curl -s -m 600 -o tif/fine/$1.tif "https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326&BBOX=$2,$3,$4,$5&format=image/tiff&interpolation=nearest&resx=$F&resy=$F"; echo "$1 $(stat -f %z tif/fine/$1.tif)"; }
for x in 0 1 2 3 4 5; do
  W=$(echo "-11.2 + $x" | bc); E=$(echo "$W + 1" | bc)
  for S in 51.3 52.3 53.3 54.3; do N=$(echo "$S + 1" | bc); [ "$S" = "54.3" ] && N=55.5
    get "f_${x}_${S}" $W $S $E $N &
  done
  wait
done
