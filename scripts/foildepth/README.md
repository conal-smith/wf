# Foilable depth: `public/foildepth/`

A pilot map layer that shows, at the forecast hour the dock has selected,
where the water is deep enough to wing-foil:

- **blue**: deep enough, the bed at least the clearance (1 m, `FOIL_CLEARANCE_METRES`) under the tide;
- **pale blue**: wet, but too shallow for the mast;
- **grey-brown**: dry at this tide (sand and mud flats);
- **mid blue**: wet at every tide, but no survey says how deep.

The seabed and foreshore do not change, so they are built once, here, into one
elevation archive per pilot area. The tide makes it dynamic in the browser:
`depth = tide − z`, both in metres above Lowest Astronomical Tide (LAT).

| Area | File | Size | Tide station |
| --- | --- | --- | --- |
| `dublin-north`: the Malahide estuary, Donabate, Portmarnock, Baldoyle, Bull Island, Howth, and Dublin Bay south to Sandymount, Seapoint and Dún Laoghaire | `dublin-north.pmtiles` | 3.2 MB | Howth |
| `brandon`: Brandon Bay, the Maharees, Castlegregory to Banna | `brandon.pmtiles` | 4.9 MB | Fenit |
| | `index.json` | 3 kB | |

Each archive holds raster-dem tiles: Terrarium RGB (`m = R·256 + G + B/256 − 32768`)
in **lossless** WebP (a lossy one would corrupt the heights), 512 px, z10–14
(~2.9 m a pixel at z14 at 53°N; MapLibre overzooms past 14). Heights are
quantised to 1/32 m and clamped at −6 m (always deep enough, and far smaller to
store). Two values are reserved: **50 m** is not water (land, or ground cut off
from the sea), drawn as nothing; **40 m** is water of unsurveyed depth.

## How the map uses it

- `force5/src/foilDepth.ts`: the pure parts. `foilRamp(tide, colours, …)`
  builds the `color-relief-color` interpolate on `["elevation"]` whose stops are
  `tide − clearance`, `tide` and the area's dry ceiling (MapLibre wants literal
  stops, so the ramp is rebuilt and set with `setPaintProperty` as the hour
  moves; that is a small texture upload, not a re-tile). Also the datum
  conversion (`malinToLat`), the class rule (`foilClass`), Terrarium decoding and
  the tapped-point wording.
- `force5/src/WindMap.tsx`: one `raster-dem` source and `color-relief` layer
  per area, under the rivers, the coast's ink and the names.
- `src/useFoilDepth.ts`: loads `index.json` and each area's station curve
  (`tideForStation` in `force5/src/tides.ts`) the first time the layer is on.
- `src/App.tsx`: the tide at the dock's selected column (`tideAt`), the layer
  switch (Layers → Chart → "Foilable depth at the tide (pilot)"), the key
  (`src/FoilLegend.tsx`, in the map's information dialog, not on the chart),
  and a tapped point's water
  (`force5/src/foilProbe.ts` reads one pixel out of the archive).
- The colours are `--map-foil-*` in `ui/theme.css`.

## Sources (all CC BY 4.0)

In order of trust; a later one wins where it has data, feathered over 12 px.

1. **EMODnet Bathymetry DTM** (`emodnet:mean`, 1/16′ ≈ 115 m), fallback only.
   Relative to chart datum ≈ LAT, negative down. It fills the intertidal with
   0 and land with a coarse, low DEM: both are thrown out. Where no survey
   reached, it fills from GEBCO, a global grid; its source references
   (`emodnet:source_references`, fetched beside the DTM) say which cells, and
   those are thrown out too (`gapFill` in `areas.json`; see Sandymount below).
2. **EMODnet satellite-derived waterlines** (WFS `emodnet:coastlines`, types
   `LAT`, `MSL`, `MHW`). Where no LiDAR or sonar has been (the whole Malahide
   estuary), `waterlines.py` interpolates an intertidal surface between the
   three lines (0, MSL and MHW above LAT, set per area from the station: Howth
   2.5/3.8 m, Fenit 2.7/4.1 m). Under the LAT line is wet at every tide; above
   MHW is land, and nothing below it (EMODnet's DEM, a LiDAR's fields behind a
   beach) is let into the sea unless a bathymetric survey has been there.
3. **INFOMAR** multibeam (Geological Survey Ireland & Marine Institute), 2–5 m,
   relative to LAT, positive up (despite the CRS saying "LAT depth, down"),
   nodata 0 or −99999. Surveys used: Dublin north CB13_01, GEO13_01, GEO17_01,
   KRY17_01 (2013–17, VORF), CV03_01 (2003), KRY09_02 (2009), KRY10_01 (2010),
   GEO11_01 (2011), TON16_01, LIR17_02 (2016–17), GEO21_06 (2021), the same
   surveys cut again south of 53.34° N for Sandymount to Dún Laoghaire
   (`a4_dublinbay_south__*`; none of them sounds the flats); Brandon
   CB14_05, CV14_02, GEO14_03, KRY14_05 (2014), GEO17_03 (2017). Surveys before
   March 2011 were reduced with a Proudman tidal model rather than VORF and are
   on average 0.54 m deeper; the ones here are offshore (−4 to −26 m, always
   deep) so they are not shifted.
4. **INFOMAR bathymetric LiDAR**, Tralee Bay 2008 (Tenix LADS), 5 m, LAT: the
   shallows and lower beach of Brandon Bay and the Maharees (pre-VORF).
5. **GSI/OPW/TII topographic LiDAR** (2 m DTM, ITM, OD Malin): OPW 2011 and TII
   2010–11 round Dublin, OPW 2006–07 coastal round Brandon. Brought to LAT with
   the tide station's published offset (`z_LAT = z_Malin + odMalinOffsetMetres`;
   Howth 2.561, Fenit 2.677, from `force5/ingest/fetch_tides.py`, which defines
   the offset as LAT height − Malin height). A LiDAR sees the water's surface,
   not the bed: returns well above a bathymetric survey are dropped, and round
   Dublin, where the 2011 flight saw water at about −1.0 m OD (≈1.6 m LAT; the
   open sea's surface that day, in Dublin Port, Dún Laoghaire harbour and off
   Seapoint), so is anything at or under 1.65 m LAT.

### What was wrong at Sandymount (fixed 2026-10)

The flats off Sandymount and Merrion, which dry for a kilometre and more at
low water, were drawn deep blue. Sampled across them (metres above LAT):

| Point | LiDAR | EMODnet DTM | Built before | Built after |
| --- | --- | --- | --- | --- |
| Sandymount, upper beach (−6.207, 53.331) | 3.55 | – | 3.56 | 3.56 |
| Sandymount, 1 km out (−6.195, 53.329) | – (water in flight) | −3.99 | −3.81 | 2.09 |
| Sandymount, 2 km out (−6.184, 53.329) | – | −3.44 | −3.06 | 0.53 |
| Flats under the South Bull Wall (−6.180, 53.339) | 2.89 | −0.12 | 1.66 | 2.62 |
| Merrion Strand, 1 km out (−6.194, 53.317) | – | −1.65 | outside | 0.91 |
| Booterstown, 700 m out (−6.184, 53.309) | – | 0.39 | outside | 1.25 |

INFOMAR has no sounding on the flats at all, and the 2011 LiDAR stops a few
hundred metres out, where the flight met the water. So the merge fell back on
EMODnet's DTM, and EMODnet has no survey there either: its source references
name **GEBCO 2024** for a block of cells from −6.203 to −6.167 E, 53.302 to
53.339 N, and GEBCO's global grid draws a smooth hollow 2–11 m under LAT
across the sand. Worse, those cells seeded the waterline method's "under LAT"
walk, so the whole flat inside the satellite LAT line was taken for sea and
the waterlines never laid their 0–2.5 m surface over it. The datum was not at
fault: the LiDAR's beach at +3.5 to +4.2 m LAT sits where the chart puts the
upper strand (Howth's offset of 2.561 m against Dublin Port's 2.458 m is a
0.1 m difference here), and the tide station is not the issue either.

The fix: GEBCO-filled cells are dropped from the fallback (they are not a
sounding), and are not allowed to seed the sea; where the line-walk has to
guess round a line's open end, they still count as sea, not land. Inside the
LAT line the flats are now the waterlines' surface (0 at the LAT line rising
to 2.5 m at the MSL line), under the LiDAR's beach; outside it, between the
LAT line and the first real soundings, a strip is wet at every tide and
unsurveyed. The area now reaches south to 53.287° N (Seapoint and Dún
Laoghaire), with the OPW 2011 and TII tiles there added to the LiDAR mosaic
and the INFOMAR surveys cut again for the band.

Then the mask: ground at or under the area's dry ceiling (HAT plus a margin:
5.0 m at Howth, 5.6 m at Fenit) and connected to water under LAT; small no-data
holes inside the water become "unsurveyed"; and water more than 1.5 km from the
shore or the intertidal is dropped (deep at any tide; the chart's tints carry it).

Attribution, as the licences ask: "Contains Irish Public Sector Data
(Geological Survey Ireland, Marine Institute, the Office of Public Works &
Transport Infrastructure Ireland) licensed under CC BY 4.0"; "EMODnet
Bathymetry Consortium: EMODnet Digital Bathymetry (DTM 2024) and coastlines".

### What is missing

- **The Malahide inner estuary** (west of the railway viaduct, Kilcrea's
  water) has no open LiDAR or INFOMAR survey. The satellite LAT line says it
  holds water at every tide (the weir under the viaduct holds it up), so it is
  drawn "unsurveyed", with its rim from the waterlines. A Fingal/OPW flood-study
  LiDAR, a drone survey or a few soundings at low water would fill it.
- **The outer Malahide flats, North Bull/Baldoyle and Sandymount** come from
  the waterlines, not a survey: right in shape, ±0.5 m or so in height. Off
  Merrion and Booterstown the strip between the LAT line and the first
  soundings is drawn unsurveyed (deep blue), though it is probably only a
  metre or less under LAT.
- The tide is **one station's astronomical prediction** for the whole area: no
  surge, no waves, and no estuary lag or damping (inside an estuary low water
  is later and higher than at Howth; the inner lagoon is perched behind its weir).
  Sandymount uses Howth too: Dublin Port's low waters agree with
  Howth's to a few centimetres, its high waters are about 0.15 m lower and
  5–10 minutes later, which matters little on a flat that dries at half tide.
- LAT from OD Malin is one constant per station, not a modelled surface (a
  VORF-style separation model would be better).

## Rebuilding

Downloads go in a directory of their own, outside the repo. Python 3 with
numpy, scipy, rasterio, pyproj, pillow and pmtiles (a scratch venv is fine);
run it isolated (`python -I`).

```sh
D=/tmp/wf-foildepth/data
sh fetch-emodnet.sh    $D/emodnet    dublin-north -6.30 53.27 -5.96 53.52
sh fetch-emodnet.sh    $D/emodnet    brandon     -10.22 52.18 -9.78 52.38
sh fetch-coastlines.sh $D/coastlines dublin-north -6.27 53.28 -5.99 53.50
sh fetch-coastlines.sh $D/coastlines brandon     -10.18 52.22 -9.83 52.35
# INFOMAR and the LiDAR by hand, from the portals below, cut to the areas'
# boxes into $D/infomar/clipped/ and $D/lidar/{dub,mal,bran}/ (see areas.json
# for the names it globs). The Dublin LiDAR mosaic reaches 53.285° N: OPW
# 3235–3237, 3257–3259, 3282–3284, 3311–3312, 3335–3336, 3355–3356 and TII
# 2472, 2493–2494, 2502–2503, 2509–2510, 2522 joined the first build's tiles.
python -I build.py --data $D --out ../../public/foildepth [--area dublin-north] [--debug /tmp/wf-foildepth/debug]
node shots.mjs http://127.0.0.1:5173 /tmp/wf-foildepth/shots kilcrea 2   # a look by eye, with the app running
```

`build.py` takes 3–4 minutes an area. `--debug` writes each merged grid as a
GeoTIFF (EPSG:3857) to look at.

Where the data came from (2026-10):

- INFOMAR survey grids: the download portal linked from <https://www.infomar.ie/data>,
  whose footprint layers give direct zips,
  `gsi.geodata.gov.ie/server/rest/services/Marine/IE_GSI_MI_Marine_Download_Seabed_Survey_{Leg,Merged}_Data_IE_Waters_WGS84/FeatureServer/0/query`,
  files under `gsi.geodata.gov.ie/downloads/Marine/Data/Downloads/<year>/<survey>/`.
  `maps.marine.ie` answered 503 throughout; the merged 10 m grid is also an
  ImageServer at `gsi.geodata.gov.ie/imagehost/…/IE_GSI_MI_Bathymetry_10m_Inshore_IE_WGS84_LAT_GRID`.
- LiDAR: GSI's tile indexes, zips under `gsi.geodata.gov.ie/downloads/LIDAR/`
  (TII) and `…/LiDAR/OPW_NASC/` and `…/lidar/OPW_*` (OPW). The GSI image
  services serve shaded relief only, not heights.
- EMODnet: `ows.emodnet-bathymetry.eu` WCS and WFS, as in the two fetch scripts.

To add an area: a box, its station and offset (`public/marine/tides.json`), its
dry ceiling and waterline levels, and its sources in `areas.json`; then build
it with `--area`. The index keeps the others.
