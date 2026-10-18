# Northern Ireland's tides

The tide ingest (`force5/ingest/fetch_tides.py`, published as
`marine/tides.json`) takes the Republic's tides from the Marine Institute's
ERDDAP. The Marine Institute has no station in Northern Ireland, and the UK
Hydrographic Office's predictions are Crown copyright and not open, so Northern
Ireland's stations are our own: harmonic constants per station, made once here
from open data and committed (`force5/ingest/tide_stations_ni.json`), and the
curve and high and low waters predicted from them at ingest in plain numpy
(`force5/ingest/harmonics.py`, `tides_ni.py`). The ingest job needs no model
file and no new dependency.

## Sources and licences

| What                                                                                                                     | Source                                                                                | Licence                      |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------- |
| Portrush and Bangor gauge levels (UK National Tide Gauge Network), 15-minute, above chart datum and above Ordnance Datum | Environment Agency real-time flood-monitoring API (`/id/measures/E73924…`, `E73824…`) | Open Government Licence v3.0 |
| Every other station; the gauges' minor and long-period constituents                                                      | EOT20 global ocean tide model (Hart-Davis et al. 2021, DGFI-TUM), 1/8°, via pyTMD     | CC BY 4.0                    |
| Strangford Lough's lag behind Killard Point                                                                              | Copernicus Sentinel-2, read by `scripts/satellite/lag.py`                             | Copernicus open data         |

Not used, and why: the UKHO's predictions and tide tables (not open); BODC's
copies of the same gauges (its licence forbids passing products to third
parties without consent and charges for commercial use); EMODnet Physics'
copies (its ERDDAP marks them CC BY-SA, which a CC BY / ODbL project cannot
take into its constants; they are downloaded **for validation only**); FES2022
(AVISO's registration and terms) and TPXO (academic licence). The Environment
Agency's API asks for the line "This uses Environment Agency flood and river
level data from the real-time data API (Beta)"; each station in `tides.json`
carries its own `attribution`, and the UI shows it (web spot page and dock,
mobile spot page, map info).

## The stations

| Station              | Kind              | Model point      | M2 (m, °)   | HAT above LAT |
| -------------------- | ----------------- | ---------------- | ----------- | ------------- |
| Portrush             | gauge (EA month)  |                  | 0.544, 198  | 2.52          |
| Ballycastle_MODELLED | EOT20             | 55.215 N 6.235 W | 0.250, 244  | 1.27          |
| Larne_MODELLED       | EOT20             | 54.860 N 5.775 W | 0.997, 318  | 3.62          |
| Bangor               | gauge (EA month)  |                  | 1.149, 318  | 4.07          |
| Portavogie_MODELLED  | EOT20             | 54.460 N 5.415 W | 1.575, 321  | 5.68          |
| Killard_MODELLED     | EOT20             | 54.312 N 5.495 W | 1.726, 320  | 6.23          |
| Strangford_MODELLED  | Killard + 100 min |                  | (Killard's) | (Killard's)   |
| Ardglass_MODELLED    | EOT20             | 54.250 N 5.580 W | 1.732, 320  | 6.24          |
| Dundrum_Bay_MODELLED | EOT20             | 54.215 N 5.800 W | 1.731, 320  | 6.24          |

The ids are the satellite run's where it had the station
(`scripts/satellite/stations_ni.json`), so its intertidal archives and the
foil-depth regions cut on them find their tide by the same name. A riding
location takes the nearest station of either provider within 40 km.

- **The gauges**: a harmonic analysis of the latest month the Environment
  Agency's API holds: Bangor 2026-09-19 to 10-18 (29.3 days), Portrush
  2026-09-19 to 10-14 (25.5 days: its gauge has read 0 m since), solving M2, S2,
  N2, MU2, L2, K1, O1, Q1 and the shallow-water MO3, M3, MK3, MN4, M4, MS4,
  2MN6, M6, 2MS6 and M8. A month cannot separate S2 from K2 or K1 from P1, so
  those and the other minor constituents are _inferred_: tied to a solved
  parent with EOT20's amplitude ratio and phase difference at the gauge. SA,
  SSA, MM and MF are EOT20's. MU2 and L2 are a little under one Rayleigh cycle
  apart from N2 and M2 in a month, and are solved anyway: in these shallow seas
  MU2 carries the 2MS2 shallow-water tide, which no inference gives (adding
  them took the error against a four-year analysis from 8.3 to 6.7 cm at
  Bangor). MSF is left out: in one month it takes up the weather. The
  gauge's dropouts (Portrush reads exactly 0 m in 360 of a month's readings)
  and stuck spells are removed, and readings more than 1 m off a first fit.
- **EOT20 stations**: EOT20 at a point of open water 1–3 km off the coast,
  predicted by pyTMD every hour for two years (its minor constituents
  inferred), and analysed with the same code that predicts it at ingest; the
  fit is within 0.5–1.6 mm RMS. The Down coast's three (Killard, Ardglass,
  Dundrum Bay) come out nearly the same: EOT20's cells there are 14 km across.
- **Strangford Lough inside the Narrows**: Killard Point's tide 100 minutes
  later, the lag the satellite run read off the lough's flats (the median
  misfit of 21,340 wet-and-dry pixels falls from 0.26 at no lag to 0.065 at
  100 minutes; `scripts/satellite/README.md`). Its heights are Killard's: no
  open gauge inside the Narrows gives the lough's range, which is probably
  smaller, and its station note says so. The foil-depth layer's intertidal
  heights in the lough were read against this same lagged curve, so they agree
  with it.
- **Ballycastle** lies by the North Channel's degenerate amphidrome, where
  EOT20 is least sure (it is 18% low at Portrush). No riding location is
  nearest to it; it is there for the foil-depth layer's north coast.

**Datum.** Each station's heights are above its own LAT: its `z0` is its mean
level above the lowest level its constants predict every 10 minutes over the
18.61 years from 2026-01-01 (a full nodal cycle). Against the gauges' long
record, chart datum lies 0.08 m (Portrush) and 0.14 m (Bangor) below it. The
Environment Agency's two measures put chart datum 1.24 m (Portrush) and 2.01 m
(Bangor) below Ordnance Datum (its mAOD; Belfast datum in Northern Ireland).
The Marine Institute's stations publish an OD Malin offset; these do not.

## Validation (`validation.json`)

Heights: RMS of the series minus the prediction once their mean difference is
removed. Turns: each predicted high or low water against the series' own (a
parabola through its samples within 45 minutes), minutes, mean/RMS. Observed
series carry the weather (surge), which no prediction has; the "full analysis"
line is what a four-year harmonic analysis of the record leaves against
itself, the floor.

Against the gauges' own hourly record (Copernicus Marine in-situ via EMODnet
Physics, downloaded only for this), years before the month the constants
came from:

| Gauge    | Series                                | Height RMS  | High water (mean / RMS) | Low water (mean / RMS) |
| -------- | ------------------------------------- | ----------- | ----------------------- | ---------------------- |
| Portrush | observed 2012-10 to 2024-11, 60,613 h | **0.189 m** | +0 / 20 min             | +1 / 22 min            |
|          | full analysis of the record (floor)   | 0.173 m     | −1 / 14 min             | +1 / 16 min            |
|          | EOT20 alone                           | 0.206 m     | −4 / 22 min             | +0 / 24 min            |
|          | vs the full analysis, 2026–2027       | 0.068 m     | +4 / 14 min             | +4 / 17 min            |
| Bangor   | observed 2020-08 to 2024-11, 28,933 h | **0.212 m** | +0 / 13 min             | −1 / 13 min            |
|          | full analysis of the record (floor)   | 0.188 m     | +1 / 7 min              | −1 / 7 min             |
|          | EOT20 alone                           | 0.215 m     | −1 / 9 min              | −4 / 14 min            |
|          | vs the full analysis, 2026–2027       | 0.087 m     | −1 / 8 min              | +0 / 9 min             |

Portrush's tide is small (0.5 m M2) and flat at the top and bottom, so its
turns are hard to time even for a full analysis (14–16 minutes RMS).

The same two methods at the Marine Institute's stations, against its own
5-minute predictions for January–September 2026 (an authoritative series from
long gauge records):

| Station    | Method                                                       | Height RMS  | High water (mean / RMS) | Low water (mean / RMS) |
| ---------- | ------------------------------------------------------------ | ----------- | ----------------------- | ---------------------- |
| Malin Head | a month of its gauge (2026-09-13 to 10-12) + EOT20 inference | **0.073 m** | +1 / 10 min             | −0 / 6 min             |
| Howth      | a month of its gauge + EOT20 inference                       | **0.063 m** | −1 / 6 min              | +0 / 5 min             |
| Malin Head | EOT20 alone                                                  | 0.108 m     | −5 / 10 min             | −5 / 9 min             |
| Port Oriel | EOT20 alone                                                  | **0.099 m** | +4 / 7 min              | +3 / 9 min             |
| Howth      | EOT20 alone                                                  | 0.093 m     | +2 / 8 min              | +2 / 12 min            |
| Skerries   | EOT20 alone                                                  | 0.086 m     | +4 / 6 min              | +2 / 10 min            |

So expect a decimetre or so and 5–15 minutes from an EOT20 station on the
Irish Sea coast, less from the gauges, and more at Ballycastle. The tests
(`force5/ingest/test_tides_ni.py`) hold these numbers, pin the harmonic code
to EOT20's own prediction (0.6 mm, in 2026 and 2035), and check the
datum, the lag and the events.

## Rebuilding

```sh
PY=/Volumes/workdrive/satellite/venv/bin/python   # numpy, requests; pyTMD and EOT20 for `eot20`
D=/tmp/wf-ni-tides                                 # downloads/ (untrusted) and work/
$PY -I scripts/tides/build_ni.py --data $D fetch       # the EA month; validation downloads
$PY -I scripts/tides/build_ni.py --data $D eot20 --eot20 /Volumes/workdrive/satellite/downloads/eot20
$PY -I scripts/tides/build_ni.py --data $D constants   # force5/ingest/tide_stations_ni.json
$PY -I scripts/tides/build_ni.py --data $D validate    # scripts/tides/validation.json
```

The Environment Agency's API keeps about 29 days. `fetch` keeps each month it
fetches under `$D/downloads/ea`, and `constants` analyses all of them (or
`--since DATE`): a few months fetched over a year would let the analysis solve
K2 and P1 itself. EOT20 is `https://www.seanoe.org/data/00683/79489/data/85762.zip`
(`EOT20/ocean_tides/*.nc`), as for the satellite run.

## For the foil-depth build

The foil build reads each station's curve from `public/marine/tides.json`
like any other. For the levels its regions need (as
`scripts/foildepth/stations.json` has them for the Marine Institute's):

```sh
python force5/ingest/tides_ni.py levels --from 2026-01-01 --to 2029-01-01 > ni-levels.json
```

prints per station `mslMetres`, `mhwMetres`, `mlwMetres`, `hatMetres` (the
highest predicted level over the window) and `lowestMetres`, metres above the
station's LAT, plus `lagOf`/`lagMinutes` for Strangford Lough. There is no
`odMalinOffsetMetres`: Northern Ireland's land datum is OD Belfast (above).
The 18.6-year HAT is each station's `hatMetres` in `tide_stations_ni.json`.
