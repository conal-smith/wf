# Rocks pilot: intertidal rock and heights from Sentinel-2 at known tides

A research prototype (October 2026). Not part of the app or the build. It answers two questions for
two stretches of coast the owner rides:

1. Can open satellite imagery taken at known tide states find rock and reef in the intertidal, and
   give each foreshore pixel a height (the tide level at which it covers and uncovers)?
2. Does that agree with the foil-depth layer (`scripts/foildepth/`) where the layer has heights?

Areas: **Co. Down** (Ballyhornan, Benderg Bay, Killard Point: no Irish tide station, outside the
foil-depth layer) and **Co. Dublin** (Donabate, Portrane, the Malahide/Broadmeadow estuary: inside
`dublin-north`). A third box, **Portmarnock/Baldoyle**, was added as the check against surveyed
heights, because the layer's only LiDAR inside the Dublin box is the TII strip along the M1.

Results, numbers and images are in `findings/`. The full outputs (GeoTIFFs, PNGs, the viewer) are
outside the repo, in `/Volumes/workdrive/rocks-pilot/` (`out/<area>/README.md` for each area; `viewer.html`).

## Method

- **Imagery**: Sentinel-2 L2A from Microsoft Planetary Computer (public STAC, COG URLs signed
  without an account), 2017-01 to 2026-10. Only the area's window is read, on the tile's own 10 m
  grid (`fetch_s2.py`). The 04.00+ processing baseline's +1000 offset is removed. Scenes where SCL
  says more than 35% of the window is cloud, shadow or no data are not kept. Copernicus licence:
  derived data can ship.
- **Tide at each scene**:
  - *Dublin*: the Marine Institute's **Howth gauge**, observed level above LAT, from the Irish National
    Tide Gauge Network on ERDDAP (`fetch_gauge.py`). The prediction dataset the app uses
    (`imiTidePrediction`) only goes back to 2026-01-01. The few gauge gaps are filled from EOT20 fitted to the gauge.
  - *Co. Down*: **EOT20** (open global ocean-tide model, DGFI-TUM, CC BY 4.0, via `pyTMD`), calibrated
    against UKHO's published Killard Point high and low waters for one week (`tide_model.py`; the
    28 events were read by hand from a public tide-table site and are kept out of the repo,
    being Crown copyright).
- **Water masks**: NDWI (green/NIR) > 0 per scene, as DEA Intertidal uses on Sentinel-2. Masked:
  SCL cloud, shadow, cirrus, saturation and no data, plus very bright blue (haze the SCL missed).
  Scene QC drops scenes that disagree with the always-wet and always-dry pixels by more than 6%.
- **Heights** (`build_heights.py`): sort the scenes by tide. Each pixel's height is the threshold
  that best separates "dry below" from "wet above", and its misfit is the share of scenes that
  contradict it. To count as intertidal a pixel must be seen dry below its flip at least 3 times,
  wet above it at least 3 times, have misfit under 0.2, be joined to the sea, and not be lush land
  vegetation (NDVI > 0.7 in most dry looks). Without that last rule, fields that are flooded or
  shadowed in winter turn up as intertidal, because the highest tides at S2's overpass fall in winter.
- **Rocks** (`rock_features.py`, `classify_rocks.py`): from the low-tide scenes (≤ 2.2 m), the dry
  looks of each pixel give brightness, NDVI, the share of years with weed, and texture (3×3,
  among foreshore neighbours only). The score is the mean of four 0-1 ramps: dark, weedy, weedy
  every year, textured. Rock is a score ≥ 0.6 with some texture; ≥ 0.8 is high confidence.
  Thin strips along the land are flagged `shorelineFringe` (sea walls, rock armour, marsh edges).
  Polygons carry the flip heights of their pixels (`zMin`, `zMedian`, `zMax`) and the share that
  never dried in any scene.
- **Comparisons**: OSM/OpenSeaMap rocks (`fetch_osm.sh`, `osm_to_geojson.py`). The foil-depth
  archive is decoded at z14 and put on the satellite grid, along with the OPW/TII LiDAR
  (`compare_foildepth.py`). `check_layer_scenes.py` tests the layer against single low-tide scenes,
  `experiments.py` tries other water rules and tide directions, and `tide_consistency.py` compares
  each scene's waterline-implied tide with the tide it was given.
- Seabed substrate maps were tried (GSI/INFOMAR sediment classification, EMODnet Geology
  1:250k-1:10k). They have nothing in the intertidal at either site: offshore polygons only.

## Findings

### Scenes and tides

| | Co. Down | Dublin | Portmarnock (check) |
| --- | --- | --- | --- |
| Acquisitions (tile cloud ≤ 80%) | 733 | 699 | 699 |
| Clear over the window / kept after QC | 386 / 361 | 325 / 318 | 355 / 311 |
| Tide range of kept scenes | 0.94-5.22 m CD (EOT20) | 0.82-4.84 m LAT (Howth) | 0.82-4.84 m LAT |
| Intertidal mapped | 2.81 km² | 7.79 km² | 4.84 km² |

- **Tidal aliasing** is the main limit. S2 passes at about 11:30-11:45 UTC, and on this coast the
  spring high water falls near midday. No scene catches spring low water. The lowest scene is
  0.82 m LAT at Howth and 0.94 m CD at Killard, so the bottom ~0.8-0.9 m of the range, and any rock
  in it, is never seen. Landsat 8/9 (~11:15 UTC) has the same problem. Sentinel-1 radar
  (~06:30 and 18:20 UTC) does see spring lows, and is the obvious next step for the lower shore.
- **Season is confounded with tide**: the lowest-tide scenes fall mostly in May-August (31 of the
  48 lowest at Dublin) and the highest mostly in December-February. Rock spectra come mainly from summer.
- **EOT20 on this coast**: at Howth it matches the Marine Institute prediction to 0.07 m RMS
  (−10 min timing) and the observed gauge to 0.17 m RMS (the rest is surge). At Killard, after
  calibration (−11 min, ×0.915, MSL 2.61 m above CD), it fits UKHO's extremes to 0.24 m RMS.
  The images agree: each scene's waterline-implied tide matches the assigned tide to a robust SD
  of 0.11 m in Co. Down (0.30 m RMS), against 0.07 m (0.17 m RMS) in Dublin on a gauge. A model
  tide is therefore good enough where there is no gauge.

### Heights against surveyed ground and against the foil-depth layer

- **Against LiDAR** (Portmarnock, 10,071 pixels above 1.7 m LAT): satellite minus LiDAR median
  **+0.26 m**, IQR 0.00 to +0.51, 66% within 0.5 m. The bias is +0.18 to +0.30 m from 1.7 to 3.7 m,
  +0.48 m at 3.7-4.2 m, and −0.27 m above 4.2 m, the top of the tides seen. NDWI > −0.1 takes the bias
  to +0.06 m at the cost of more misfit. For use, subtract about 0.25 m.
- **Against the foil-depth layer**: at Dublin, satellite minus layer is **+0.90 m** median (IQR
  +0.63 to +1.29, 39,861 pixels; Malahide lagoon left out). At Portmarnock it is +0.31 m where the
  layer is LiDAR but **+0.99 m where the layer is the EMODnet waterline interpolation**. Round
  Donabate and Malahide, the layer is that interpolation everywhere. So the satellite agrees with the
  LiDAR to about 0.3 m, and the layer's interpolated flats are **about 0.7-1 m too low** (the outer
  Malahide estuary, Baldoyle). The README there said ±0.5 m. This is independent of the satellite's
  bias: in the eight lowest scenes, 16-26% of the pixels the layer draws as at least 0.3 m deep are
  plainly dry ground in the image.
- **Wet/dry agreement** (coastal strip, Dublin) at 1.5 / 2.5 / 3.5 m LAT: 84 / 85 / 92%, or
  71 / 73 / 85% counting only pixels in either source's intertidal. Almost all the disagreement is
  the layer saying wet where the satellite sees dry (12% of pixels at 1.5 and 2.5 m, against 3-4% the other way).
- The tide's direction does not explain it: rising tides only +0.93 m, falling only +0.88 m against
  the layer. The heights are in Howth terms (the Howth level at which a pixel covers), which is what
  the app's `depth = tide − z` needs, local lag included.
- The lagoon behind the viaduct never flips with Howth's tide (held by the weir), which fits the basin model.

### Rocks

| | Co. Down | Dublin |
| --- | --- | --- |
| Polygons (high / medium / fringe) | 80 (38 / 14 / 28) | 182 (26 / 59 / 97) |
| Area flagged (not fringe) | 2.45 km² (2.42) | 1.01 km² (0.69) |
| OSM rock features on the foreshore hit | 43 of 43 | 7 of 12 |
| OSM rock pixels detected | 90% | 48% |
| OSM sand/flat pixels flagged as rock | 14% | 5% |

- Co. Down: the reefs and platforms from Ballyhornan and Guns Island to Benderg, Killard and
  Ballyquintin, with many not in OSM (OSM's rock is incomplete, so "within 20 m of OSM rock", 40%
  of detections, says little about precision). False positives are weed-strewn lower beach next
  to rock, e.g. Killard beach. 45 non-fringe polygons start drying below 2 m CD, and 12 never fully
  dried: they go on below the lowest tide seen.
- Dublin: the Portrane platform, the rocky shore from Malahide past Low Rock towards Portmarnock,
  and rock armour on the railway causeways. Smooth green mats on the flats (seagrass, Ulva, marsh)
  are the main confusion, and only texture separates them. The estuary rims are flagged as fringe.
- Resolution: 10 m pixels and a 300 m² minimum find **reefs, platforms and rock fields, not single
  boulders or isolated pinnacles**. Bare, weedless rock is mostly missed. A polygon's flip
  height is the level at which a 10 m pixel is mostly covered, so the highest points of a rock can
  stand 0.5 m or more above it.

## A national rollout

- **Jobs**: one job per app tide station (the stations in `tides.json`), on coastal windows of about
  8 × 8 km along a 1.5-2 km strip of the coast. That is about 70-100 pilot-sized windows for the
  island. Each window's heights are then in its own station's terms, as the foil-depth layer needs.
- **Tide**: an Irish National Tide Gauge Network gauge where the station is one. Elsewhere, EOT20
  calibrated per station against the Marine Institute curves the ingest already fetches
  (`force5/ingest/fetch_tides.py`; 0.07 m RMS at Howth). For Northern Ireland, EOT20 against UKHO
  extremes, or BODC gauges (Bangor, Portrush; free registration).
- **Runtime and data**: the pilot read ~700 acquisitions per window in 10-15 minutes (8 threads,
  home connection), about 1M pixel-scenes a second, and stored 1.3-1.9 GB per window. Heights take
  ~1 min and rock features ~2 min per window on a laptop. Nationally that is roughly 60-90M
  pixels × 700 scenes: about a day on one machine, or a few hours run near the data (Azure West
  Europe) with more threads. Keeping only 1-bit water masks and running feature statistics,
  rather than the bands, brings storage from about 150-200 GB to a few GB. Outputs are small:
  heights as int16 cm COGs (well under 100 MB for the island) and rock polygons in the tens of MB
  as GeoJSON, a few MB as PMTiles. Rerun yearly, since sandbanks and channels move.
- **What the app would get**:
  1. **A rocks layer** (vector PMTiles): polygons styled by confidence, and a tap that says "rocky
     ground, dries at about z m (satellite, 10 m; single boulders not detected)".
  2. **Rock-near-the-surface warnings at the selected hour**: depth over rock = tide − z (z less
     the bias). Warn "rock within X m of the surface" when it is under the clearance plus a margin
     (e.g. 1.5 m), and never say "no rocks" where nothing was found. Rock that never dried in any
     scene is "extends below the lowest tide seen".
  3. **Depth-layer validation and repair**: where the foil-depth layer has no LiDAR or sonar, the
     satellite heights (−0.25 m) should replace the EMODnet waterline interpolation, which this
     pilot finds about 1 m too low on the Malahide and Baldoyle flats. They would also extend the
     layer to coasts with no survey at all, such as Co. Down. The band below the lowest tide seen
     stays "unsurveyed". A per-area report of the numbers above belongs with each build.

## Running it

Python 3.12 venv: `rasterio numpy scipy pyproj shapely pystac-client planetary-computer pillow
matplotlib pmtiles requests pyTMD h5py netCDF4 playwright`. Downloads go in their own directories
outside the repo, and everything runs with `python -I`.

```sh
R=/Volumes/workdrive/rocks-pilot; PY=$R/venv/bin/python
$PY -I fetch_s2.py --area down --out $R/downloads/s2          # and dublin, portmarnock (10-15 min each)
$PY -I fetch_gauge.py --scenes $R/downloads/s2/dublin/scenes.json --station "Howth Water Level 1" --out $R/downloads/tide/dublin-howth.json
sh fetch_osm.sh $R/downloads/osm down 54.285 -5.600 54.345 -5.490
# EOT20: https://www.seanoe.org/data/00683/79489/data/85762.zip -> $R/downloads/eot20/x/EOT20/ocean_tides/*.nc
# UKHO Killard events: $R/downloads/tide/killard_ukho_events.json (by hand; see tide_model.py)
sh run_all.sh $PY $R /tmp/wf-foildepth/data                    # everything else, ~15 min
```

`quicklook.py`, `overlay.py` and `feature_stats.py` are development aids. Attribution: contains
modified Copernicus Sentinel data 2017-2026; tide gauge data © Marine Institute (CC BY 4.0); EOT20
(DGFI-TUM, CC BY 4.0); OpenStreetMap © contributors (ODbL); foil-depth sources as in `scripts/foildepth/README.md`.
