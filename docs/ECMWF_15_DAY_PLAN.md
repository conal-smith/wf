# Force5: ECMWF 15-day outlook

## Scope and product decisions

Add ECMWF IFS medium-range control as a third model; keep HARMONIE as the default.
The selector reads **ECMWF · 15 days**. It is not a blend or silent extension of
HARMONIE. Selecting a different model chooses its nearest available valid time;
returning from week two to HARMONIE clamps to its final frame and explains why.
Force5 remains the rendering/processing brand, not the numerical weather model.

Use the public **0.25°** product, not a claim to native 9 km data. Retain its
sampling: +0–144h in 3h steps; +150–360h in 6h steps (**85 frames**). Only 00/12 UTC
cycles have this horizon. The 06/18 products must not replace the full outlook.
Source: [ECMWF open-data catalogue](https://www.ecmwf.int/en/forecasts/datasets/open-data).

Fields are earth-relative 10 m eastward/northward wind and scalar maximum gust,
in m/s. Derive speed and direction consistently for the map, spots, table and
scrubber. Gusts retain their own source maximum periods; these can differ from
the spacing of the displayed times. Only initialization gusts are unavailable.
See [gust semantics and validation](GUST_DATA.md), including the HARMONIE component-to-scalar verification.

At +168h and beyond, the existing compact status line says “Long-range outlook ·
less certain”. No invented confidence percentage, fake hourly samples, or claim
that resolution alone determines accuracy. Ensemble probabilities are future work.

## Implementation sequence

1. **Ingest:** `force5/ingest/fetch_ecmwf.py` uses the official
   [ecmwf-opendata client](https://github.com/ecmwf/ecmwf-opendata), defaulting to
   its public AWS mirror. Probe +360h to discover a full-horizon candidate; then
   download and validate every required component and timestep. Three concurrent
   requests, bounded retries; cached GRIBs are revalidated and repaired if corrupt.
2. **Validate and crop:** reject wrong provider/control product, parameter, run,
   lead/valid time, vector orientation, unit, grid, missing component and implausible
   values. Reuse the existing regular-grid decoder. Crop west −18°, south 48°,
   east 2°, north 59°: 81 × 45 cells. Do not spatially downscale the input.
3. **Publish:** write content-addressed frame JSONs and named-spot summaries;
   write `weather/ecmwf.json` last. The Docker worker validates the complete
   cadence again, uploads immutable objects, then atomically advances the S3
   pointer. Interrupted/invalid jobs never publish a partial forecast.
4. **Frontend:** register the model, support explicit mixed-step metadata, display
   truthful resolution/source details and terms. The scrubber uses elapsed hours,
   wind colours use those same positions, and six-hour table columns are wider.
   Keyboard arrows advance one real frame. Scrubbing follows the selected table
   column; downloads retain existing buffering/error handling and atomic switching.
5. **Verify:** unit tests for GRIB validation/cadence, full real snapshot/spot
   consistency, publisher rejection of missing steps, and browser tests for model
   switching, week-two data, keyboard navigation, table following and mobile fit.

## Contract additions (backwards-compatible schema version 1)

`model: "ecmwf"`, `modelName: "ECMWF IFS"`, `resolutionKm: null`,
`resolutionLabel: "0.25° open-data grid"`. Existing models retain their kilometre
resolution. `stepHours: 3` is the initial cadence; consumers **must use frame
hours/valid times**, not `index * stepHours`, when `stepRanges` exists:

```json
[
  { "throughHour": 144, "stepHours": 3 },
  { "throughHour": 360, "stepHours": 6 }
]
```

Frame 48 is +144h; frame 49 is +150h; frame 84 is +360h. Frames and spot summaries
are aligned by index. `gustAvailable: true, gustMissingHours: [0]` declares the
initialization exception: its gust array, samples and interval are null. All later
frames carry scalar gusts and `gustIntervalHours`. Geographic interpolation is
bilinear on wind components and scalar gusts separately.

## Run and operate

```sh
.venv/bin/pip install -r force5/ingest/requirements-worker.txt
npm run weather:refresh:ecmwf
.venv/bin/python force5/ingest/worker.py --models ecmwf --publish-only

docker build -f force5/Dockerfile -t force5-forecast:local .
docker run --rm -v force5-work:/data force5-forecast:local --models ecmwf
```

The worker's `--step` setting applies only to HARMONIE/ICON; ECMWF always keeps
its mixed native cadence. `--run YYYYMMDDHH` pins a 00/12 cycle for diagnosis.
For a mirror outage, the importer accepts `--source ecmwf` or `--source google`;
there is no silent fallback to another numerical model.

Production uses the same ECR → scheduled ECS job → S3 → CloudFront arrangement
as [the live pipeline](LIVE_FORECAST_PIPELINE.md). The shipped timetable takes the
**00 UTC run once a day**: open data publishes all of it, +0 h to +360 h, at about
07:35 UTC (the index files of 8–11 October 2026 were all stamped 07:34; the 12 UTC
run lands at 19:34), so `deploy/local/jobs.toml` runs `--ecmwf-cycle 00` at 08:20
UTC with a retry at 10:20 that downloads nothing once the first has published.
`--ecmwf-cycle 00` (the adapter's `--cycle`) limits the `latest` probe to 00 UTC
runs, so a slot that fires before today's run is complete finds yesterday's 00 UTC
run, which the bucket already serves, rather than importing yesterday's 12 UTC run
and then the 00 UTC run as well. Without the flag the importer takes the newer of
the two full-length runs, as an hourly schedule would. Jobs discover published
data, not a presumed wall-clock release. Persistent cache avoids repeat GRIB
downloads; ephemeral tasks re-download. S3 skips an identical/already-newer snapshot.

ECMWF has a **40-hour age limit** (`maxAgeHours` in `force5/ingest/registry.py`)
versus 12h for the regional models: a 00 UTC run fetched once a day is 32–36 h old
just before the next morning's replaces it, and must not read as stale then. The
importer refuses to download anything older (the run the bucket already serves is
simply "unchanged"), the worker refuses to publish it, and `status.py` calls a
published run stale past it, from 16 UTC on a day neither slot succeeded. Set
`--max-age-hours` explicitly to override the worker limit. Existing UI marks runs
older than 18h as older, cosmetically, which a once-a-day run is every afternoon;
nothing hides or refuses it before its last forecast hour has passed. Operators
should alert on the 40-hour age, job failures and a missing day-15 horizon.
Keep the previous snapshot available during provider failures. Open-tab manifest
polling, AWS provisioning, production scheduling and Docker image execution are
not part of this local integration; follow the live runbook before launch.

No API key or paid delivery agreement is used for public-mirror HTTP retrieval.
Cloud processing/storage/egress are still our costs. Keep ECMWF attribution,
modification notice, licence and [provider terms](https://apps.ecmwf.int/datasets/licences/general/)
with the data and in the website's data/source panel. The map selector visibly
identifies ECMWF. A future Force5 licence must not restrict recipients' existing
rights to the underlying CC BY weather data.

## Acceptance / deliberately deferred

- All 85 downloaded real frames pass metadata, numeric and spot-sampling checks.
- Day 15 is selectable; selected cells, map and wind-coloured track agree.
- 3h → 6h transition never fabricates a +147h field; keyboard navigation works.
- Failed or mislabelled ECMWF loads leave the previous model intact.
- Regional model, mobile, playback and point-selection regressions remain green.
- Deferred: ensemble spread/probabilities, waves, automatic
  model blending, global coverage and automatic refresh of already-open pages.

## Local verification, 13 September 2026

Downloaded and validated the 00 UTC run through 28 September 00 UTC. All 85
wind-only frames initially totalled about 3.3 MB of JSON (about 141 MB of cached
source GRIB); the gust-enabled v2 adds scalar arrays and separate source GRIBs.
The full local worker path completes successfully without a bucket; no upload
or external resource creation occurred. Unit/data tests cover every frame and
named spot. Browser tests include a rendered mobile map at day 15 and safe
return to the shorter HARMONIE horizon. Docker is not installed on this machine,
so the image build/runtime and real AWS publication still require verification.
