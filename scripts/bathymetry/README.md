# The chart's depths: `bathy/v…/ireland.pmtiles` on the data host

The map's depth tints, contours, soundings and land relief come from one static
file, `ireland.pmtiles` (~11.5 MB). It is served from the data host
(https://data.wingfoil.ie, the R2 bucket) under an immutable, content-versioned
prefix, `bathy/v<12 hex>/ireland.pmtiles`, which `force5/src/chartStyle.ts`'s
`BATHY_PATH` names and the map reads through the data base URL, by range;
the committed copy in `public-data/` (same path) is what the dev server and
the e2e site serve. `scripts/foildepth/publish.py --bathy` versions, uploads
and points the repo at a new build. The seabed does not
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
`ireland.pmtiles` is a derived work of the DTM, and the chart's
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
python pack.py tiles /tmp/ireland.pmtiles
python -I ../foildepth/publish.py --set <the foildepth set> --bathy /tmp/ireland.pmtiles --env <bucket env> --upload
```

## Serving

The map reads the archive by HTTP range requests (the `pmtiles` package,
registered as MapLibre's `pmtiles://` protocol in `force5/src/chartStyle.ts`,
through `force5/src/archives.ts`). R2 serves ranges (206) to the site's
origins; Cloudflare Pages does not, which is why the file is not in the site.
`vite` and `vite preview` serve `public-data/` with range support (the
`wingfoil:static-data` plugin in `vite.config.ts`). The bucket sweep never
touches `bathy/` (`force5/ingest/prune.py`, STATIC_ROOTS).
