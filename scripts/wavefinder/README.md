# Wave Finder: where waves break, from the Sentinel-2 archive and the swell

Every clear Sentinel-2 look of the coast since 2017, paired with the swell and
wind at the time it was taken. A 10 m pixel that turns white in big,
long-period swell and stays dark in calm is breaking water: a beach's surf
zone, a sand bar, a reef or a point. Counted over hundreds of looks a tile, the
pixels that break, how often, and in which swells, say where the waves are,
and the known breaks check it.

Two regions, each on its own satellite run (`scripts/satellite`): **ireland**
(the island, Northern Ireland with it; `config.json`, `SATELLITE_ROOT` default
`/Volumes/workdrive/satellite`) and **gb** (`config-gb.json`,
`/Volumes/workdrive/satellite-gb`). Wave Finder reuses each run's catalogue of
acquisitions, its 100 m coast and sea grid (`coarse.tif`), its tile plan and
ownership (`plan.json`), its COG reader (`fetch.Scene`) and the EMODnet DTM
`bathyguard.py fetch` brought down (`work/emodnet.tif`). Nothing it writes goes
in the repo or on the site: everything is under `WAVEFINDER_ROOT` (default
`/Volumes/workdrive/wavefinder`), by region.

Python 3.12 venv as `scripts/satellite`'s (`rasterio numpy scipy pyproj
pystac-client planetary-computer pillow`); every script runs with `python -I`.
The tests need numpy only:
`python -m unittest discover -s scripts/wavefinder -p 'test_*.py'`.

## Steps

```sh
W=scripts/wavefinder; PY=/Volumes/workdrive/satellite/venv/bin/python
$PY -I $W/mask.py --region ireland        # the search mask on the 100 m grid (15 s; GB 2 min)
$PY -I $W/seastate.py fetch --region ireland   # ERA5 waves and wind at each 0.5° point (minutes)
$PY -I $W/seastate.py tiles --region ireland   # ... at every acquisition, per tile (seconds)
$PY -I $W/run.py --region ireland         # read.py then score.py, tile by tile (hours, on the VM)
$PY -I $W/rank.py --region ireland        # rank, places, candidates-ireland.geojson, validation
$PY -I $W/report.py                       # report/index.html over the regions done
```

`read.py --tile <t>` and `score.py --tile <t>` do one tile; `chips.py` cuts a
picture of one place in one look, with the foam it finds (`--foam`), for
eyeballing the detector. Each step is resumable: the Open-Meteo answers are
cached, `read.py` skips the looks in its tile's log, `run.py` skips a tile
with its `done.json`, and the report keeps the pictures it has cut.

On the VM (`satellite-run`, beside Planetary Computer's storage) the regions'
satellite roots are `~/sat` and `~/sat-gb`:

```sh
export WAVEFINDER_ROOT=~/wavefinder WAVEFINDER_SATELLITE_IRELAND=~/sat WAVEFINDER_SATELLITE_GB=~/sat-gb
cd /tmp && nohup ~/venv/bin/python -I ~/wf/scripts/wavefinder/run.py --region gb >> ~/wavefinder/run-gb.log 2>&1 &
```

The VM shuts itself down at 22:00 UTC (its DevTestLab schedule); start it
again (`az vm start -g SATELLITE-RUN -n satellite-run`) and run the same
command: it carries on where it stopped.

## Method

### Where to look (`mask.py`)

On the satellite run's 100 m grid, a cell is searched when it is:

- **in the nearshore band**: sea within 1.5 km of land, or land within 300 m
  of the sea (a beach's surf zone sits on what the coarse grid calls land as
  the tide moves the shore), on the region's own coast (its coverage: not
  Kintyre in Ireland's grid);
- **shallow**: EMODnet Bathymetry's DTM (about 115 m, depths about LAT where
  charted) no deeper than 15 m in the shallowest of the 3×3 cells round it.
  Waves break in water about 1.3 times their height deep, so 15 m keeps every
  break of a 10 m wave, the outer reefs with them; where the DTM has no value
  (its own land, by the shore) the cell is kept;
- **not enclosed**: water reachable from the open sea only through a gap
  narrower than 1.5 km (a sea lough's narrows, a harbour mouth, a bar across
  an estuary) is left out, more than 2.5 km in through the water. The sea is
  opened with a 750 m disc, the opened sea joined to the grid's edge is the
  open water, and a walk from it through the sea for 2.5 km brings back the
  mouths and their bars. Nothing is left out for the way a coast faces: long
  swell wraps round headlands and into the Irish Sea (Donabate's comes in by
  St George's Channel), so the imagery decides.

`search.tif` keeps each cell's flags (searched, too deep, enclosed, the
offshore ring), the DTM's depth, the way the shore faces (up the gradient of
the distance from land) and the seabed's slope; `search.json` the areas.

### The swell and the wind (`seastate.py`)

[Open-Meteo](https://open-meteo.com)'s archives, no account: the marine
archive's `era5_ocean` model (ECMWF's ERA5 ocean waves, 0.5°, hourly from
1940) and the weather archive's `era5` (0.25°). Through Open-Meteo ERA5 gives
the total sea only (significant height Hs, peak period Tp, mean period, mean
direction): the swell partition comes back empty, so a long Tp is what says
swell. Wind: 10 m speed and direction. At every 0.5° cell over the sea within
45 km of the coast (Ireland 38, Great Britain about 150), one request a point
and archive for 2017 to now, cached; then at each acquisition's time, per tile.

Each coastal block takes the point nearest its searched pixels. A look is
**big** there when Hs ≥ 2 m (or the point's own 75th percentile where that is
less: the Irish Sea's and the North Sea's best days are their big ones) with
Tp ≥ 11 s, **calm** when Hs ≤ 1 m and the wind ≤ 6 m/s, else **mid**.

### Reading (`read.py`)

Per tile, every acquisition with tile cloud under 70% where some block's point
had Hs ≥ 1.2 m, and the 30 clearest calm ones. The whole SCL first (3 MB); a
look whose searched pixels are over 60% no data, cloud, shadow or cirrus stops
there. Else B02, B03, B04, B08 (10 m) and B11 (20 m) over the blocks with
searched pixels the tile owns (the plan's ownership: the tile with the most
weight, so overlaps are read once), and one byte a searched pixel:

- **foam** (`wf.foam`): B03 ≥ 0.07, B08 ≥ 0.04, B11 ≤ 0.35 × B03 and
  B02 ≥ 0.85 × B04. Breaking foam is white from blue to red and still bright
  in the near infrared, but the water under it absorbs the shortwave infrared,
  so B11 stays dark. Sand, rock and weed are redder than blue and bright in
  B11; cloud, haze and glint are bright in B11. The value kept is how white
  (B03 − B11, `wf.foam_score`);
- **unusable**: SCL's no data or saturation; its cloud, shadow, cirrus or snow
  *unless* the pixel passes the foam test (SCL calls heavy surf cloud); anything
  bright in B11 (`wf.cloud_like`: cloud and haze, and also dry sand, rock and
  fields, so on the shore's edge a pixel counts only in the looks it was water
  or foam: P(foam) is "when the sea is over it"); and SCL's snow on land (snow is white and
  dark in B11 too: it put winter "surf" on the dunes behind Rossnowlagh before
  this rule);
- else clear.

Per block it also counts the **offshore ring** (sea 2–5 km out, inside the
same blocks): its clear pixels, its foam and its SCL cloud.

### Scoring (`score.py`)

A big or mid look counts as **clean** in a block when the ring's foam is under
2% of its clear pixels and its SCL cloud under 30%: foam out there is an
onshore gale's whitecaps or haze, which would be read as breaking at the shore
too. Per pixel: P(foam | big, clean), P(foam | calm) and P(foam | mid), and the
lift P big / P calm (a pseudo-look at 0.2% added to each). A pixel is
breaking water when it was seen in 6 big and 4 calm looks, foamed in 25% of
the big ones and 4 times as often as in calm. Neighbours within 3 pixels join;
the groups (12 pixels at least) are cut into pieces about 1 km across. Each
piece: its centre (weighted by P big), area, the probabilities, the seabed
under it (EMODnet's depths where its cells are sea, the slope), how far its
foam lies from the shore, the way the shore faces, and its **swell window**:
in every look clear over most of it, the share of its pixels foaming, against
that look's Hs, Tp, direction and wind (lit = over 30%): lit share by direction
sector, period and size, the swells that lit it (Hs, Tp, power), and the winds.

### Ranking and checking (`rank.py`)

A piece's score is (P big − P calm) × its area in ha: the hectares of extra white
water a big swell brings there. (The first try, the same with √area capped at
20 ha, put 4 of Ireland's first 21 known breaks among the top 25 places, 2.7
times chance; this puts 7, 4.2 times; P(foam | mid) or the bare difference did
worse. Chosen on those tiles, so Great Britain's breaks are the fair check.)
Pieces within 1.5 km join into **places**, named by their best. Kinds: *shore* (the surf zone
of a beach, or the foot of a rock), *outer* (foam mostly over 300 m out: a reef
or bar), *bigwave* (outer and lit mostly by the biggest swells: P mid under a
third of P big).

`breaks.json` lists known breaks (positions to about 0.5 km); one is found when
a piece lies within 1.5 km. That alone is weak: on a surf coast most of the
shore breaks in big swell, so `rank.py` also measures chance, the share of
random searched shore cells with a piece within 1.5 km (for all pieces, and for
the top 25, 50, 100 and 200 places'), and how many known breaks the top places
hold against it.

### Outputs

- `<root>/candidates-<region>.geojson`: every piece, a point, with its score,
  ranks, kind, probabilities, looks, seabed, swell window and winds;
- `<root>/<region>/work/`: `search.tif`, `seastate/`, `looks/<tile>.json`,
  `score/<tile>.{json,tif,png}` (the per-pixel P big, P calm, P mid and look
  counts at 10 m), `places.json`, `validation.json`;
- `<root>/<region>/s2/<tile>/`: the bytes per look (`<stamp>.npz`), the masks,
  the log;
- `<root>/report/index.html`: the report, its images relative (`img/`), so the
  folder publishes as it is. It is not on the site.

## Data and licences

- **Sentinel-2**: contains modified Copernicus Sentinel data 2017–2026 (L2A,
  read from Microsoft Planetary Computer; free and open, attribution as given).
- **ERA5**: Hersbach et al. (2023), ERA5 hourly data, Copernicus Climate Change
  Service; ECMWF's ERA5 ocean waves. Served by Open-Meteo (open-meteo.com),
  CC BY 4.0; its free tier (non-commercial, under 10,000 calls a day) is enough:
  two calls a point.
- **Bathymetry**: EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry
  (DTM), CC BY 4.0.
- **Place names in the report**: © OpenStreetMap contributors (ODbL), by
  Nominatim's reverse geocoding (one request a second, cached).

## Caveats

- ERA5 at 0.5° is offshore swell; a block takes its nearest point, which by a
  headland can be the point round the corner.
- The calm looks are mostly summer's (calm and clear go together), the big
  ones winter's: anything white in winter alone looks like breaking. Snow on
  land is handled (above); low winter sun on wet rock is not.
- 10 m pixels see the surf zone and the foam it leaves, not the peak: a reef's
  foam drifts inside it, and a narrow reef break can be a few pixels.
- Whitecaps far from shore on an onshore gale are taken out only through the
  ring test; a gale whose whitecaps stop short of the ring passes.
