# The chart's depths: `public/bathy/ireland.pmtiles`

The map's depth tints, contours, soundings and land relief come from one static
file, `public/bathy/ireland.pmtiles` (~11.5 MB), committed. The seabed does not
change, so nothing rebuilds it: these scripts are kept so that it can be
rebuilt by hand if the survey is updated or the style wants another contour.
They are a one-off, not part of any job, and nothing in the build runs them.

**Source.** EMODnet Bathymetry's DTM (which includes INFOMAR's surveys), read
over WCS as `emodnet:mean`. Depths are metres below chart datum, which is
Lowest Astronomical Tide where the surveys allow: the datum of the Marine
Institute tide predictions the dock shows, so depth + tide height is roughly
the water over the bottom. Not for navigation.

**Licence.** EMODnet data is free to reuse with attribution under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see
[EMODnet's data policy](https://emodnet.ec.europa.eu/en/emodnet-web-service-documentation)).
`public/bathy/ireland.pmtiles` is a derived work of the DTM, and the chart's
attribution names "EMODnet Bathymetry" (`force5/src/chartStyle.ts`). It is not
covered by this repository's AGPL licence.

**What is in it.** Four vector layers, gzip-compressed MVT in one PMTiles
archive:

| Layer | Properties | Zooms |
| --- | --- | --- |
| `bands` | `depth`: areas at least that deep (0, 2, 5, 10, 20, 30, 50, 100, 200 m; 1 and 3 m too from z10) | 5–12 |
| `contours` | `depth`: the bands' outlines | 5–12 |
| `soundings` | `d`, `label` (decimetres as subscripts, `4₇`), `rank` | 5–12 |
| `relief` | `height`: land contours at 50, 150, 300, 600, 900 m | 5–9 |

z5–9 come from a 0.0025° grid of all Ireland, z10–12 from EMODnet's own
1/16′ (~115 m) grid of the whole coast, Northern Ireland included. MapLibre
overzooms past 12.

## Rebuilding

From this folder, in a scratch directory for the downloads (`tif/` is ~120 MB):

```sh
npm i --no-save geotiff d3-contour geojson-vt vt-pbf
pip install pmtiles
bash fetch.sh                                  # the coarse quarters → tif/ie-*.tif
bash fetch-fine.sh                             # the 115 m tiles → tif/fine/*.tif
node --max-old-space-size=12000 tiles.mjs tiles  # vector tiles → tiles/{z}/{x}/{y}.pbf
python pack.py tiles ../../public/bathy/ireland.pmtiles
```

## Serving

The map reads the archive by HTTP range requests (the `pmtiles` package,
registered as MapLibre's `pmtiles://` protocol in `force5/src/chartStyle.ts`).
`vite` and `vite preview` serve `public/` with range support; so does any
static host (Cloudflare Pages, nginx). `python -m http.server` does not.
