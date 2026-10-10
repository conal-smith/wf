# Forecast verification

Until October 2026 nothing recorded what we forecast. The publisher deletes a run's
frames the moment the next run replaces it, and the only observations ingested were sea
temperatures, so nobody could say which model had been right last week, or whether the
blend riders see beats any one of its models. Three jobs fix that:

| job                | cadence        | reads                               | writes                                              |
| ------------------ | -------------- | ----------------------------------- | --------------------------------------------------- |
| `wind-obs`         | hourly at :50  | Met Éireann EDR, Marine Institute ERDDAP | `marine/wind-observations.json` (last 72 h)    |
| `forecast-archive` | hourly at :15  | every wind manifest being served, and `wind-obs` | `archive/forecasts/…`, `archive/observations/…`, `verify/forecast-archive.json` |
| `verify`           | daily at 07:25 | the archive                         | `archive/verify/sums/…`, `verify/scores.json`       |

All three are ordinary registry entries (`force5/ingest/registry.py`) run by the worker,
so they run the same way locally, on Home Compute and on Cloudflare Containers. The
archive and verification jobs are `readsBucket`: with a bucket they read what it serves
and write its archive, and without one they read and write the work directory's
`public/`.

## What is observed

`force5/ingest/fetch_wind_obs.py`, registry id `wind-obs`, kind `observation` with
`"observes": "wind"`.

- **Met Éireann** hourly station observations from its OGC EDR API,
  `https://opendata2.met.ie/edr/collections/observations-swob-nrt-60min`, which keeps
  about six days. It is labelled a proof of concept by Met Éireann; the same data is
  browsable as files at `https://opendata2.met.ie/obs_public/` if the API changes. 21
  stations are in the feed; 18 report wind (Knock, Markree Castle and Phoenix Park do
  not). Dublin, Shannon and Cork airports are not in it. For each hour: `wind_speed_mean`
  (the hour's mean of 3-second samples), `wind_gust` (the hour's highest 3-second
  sample) and `wind_direction` (the 3-second direction at the top of the hour), in knots
  and degrees true, `-99` for no sensor.
- **Marine Institute** Irish Weather Buoy Network (M2–M6 and any other station the
  dataset carries) from ERDDAP `IWBNetwork`: `WindSpeed`, `Gust`, `WindDirection`, with
  rows the network flags as bad (`QC_Flag` other than 0 or 1) dropped. The units are read
  from ERDDAP's own units line and converted from what it says.
- **Commissioners of Irish Lights MetOcean** is not read: it publishes no
  machine-readable feed and no open licence, only preliminary data behind a disclaimer.

Every station has an id (`ME_<WMO number>` or `MI_<buoy>`), name, position, source, an
exposure **class** — `buoy` (open sea), `coastal` (an exposed shore site: Malin Head,
Belmullet, Mace Head, Valentia, Sherkin Island, Roches Point, Finner) or `inland` — and
an anemometer height where known (10 m, the WMO standard, for Met Éireann; not published
for the buoys). The classes and heights live in `force5/ingest/wind_stations.json`, which
is also the station list the archive falls back to when no observations are published.
A station the feed adds that the list does not know is published as `inland` and logged
as `station_unclassified`.

Readings are `[time, speed, gust, direction]` in m/s (0.1) and whole degrees. Quality
control (`qc_readings`) drops and counts, per source, in `qc.rejected`:

- a reading with no speed (`missing`) or a speed outside 0–75 m/s (`range`);
- a gust outside 0–90 m/s (`gustRange`) or below the speed it accompanies
  (`gustBelowSpeed`), and a direction outside 0–360° (`directionRange`): only that value
  is dropped, because the sensors are independent;
- six or more consecutive hours of the same non-zero speed (`stuck`; twelve for the
  buoys, whose resolution is coarser) and the same bearing while the wind blows
  (`stuckDirection`);
- duplicates; and a bearing at under 0.5 m/s, which is a vane at rest, not a fault.

Each source is fetched independently. ERDDAP answers `504` for hours at a time; when it
does, that hour's manifest has no buoys, says so in `sources["marine-institute"]`, and
the next hour's run re-reads 72 hours of the buoys' history.

## What is archived

`archive/` is a top-level prefix beside `weather/`, `marine/` and `verify/`, never inside
them, and **nothing ever deletes from it**:

- no registered manifest may live under it (`prune.py` refuses to start if one does), so
  it is never a data root, and neither sweep ever lists it;
- the local prune, the bucket sweep and the publisher's superseded delete each skip an
  `archive` path by name (`prune.is_archived`);
- `prune.delete_keys`, which every bucket delete goes through, refuses the whole call if
  any key has an `archive` segment.

`force5/ingest/test_archive.py` checks each guard against an archive that is old,
unreferenced and named like the objects they normally delete.

```text
archive/forecasts/<model>/<run>.json   one wind run, written once
archive/observations/YYYY-MM-DD.json   one UTC day of wind observations, merged hourly
archive/verify/sums/YYYY-MM-DD.json    one UTC day's verification sums, once final
```

In the bucket these are gzip-encoded JSON like every other JSON object; locally they are
plain JSON under `public/archive/`.

A forecast record is written the first hour `forecast-archive` sees a run being served.
It holds, in m/s rounded to 0.1 (the binary frames' own precision):

- `stations`: u, v and gust at every observing station, sampled bilinearly from the
  run's frames exactly as the adapters sample a riding spot. A station off the grid, or
  touching a missing cell, is left out rather than clamped to the edge.
- `spots`: the run's own `spotForecasts`, copied, under the shared `spotHours`.
- `members` (ensembles): per spot and step, the 10th/50th/90th percentile and mean of the
  member speeds, and the mean member gust.
- `generatedAt`, when the run became available, which is what rebuilding the blend a
  rider saw at a given hour needs; `resolutionKm`, which sets its blend weight;
  `gustKind` and `gustWindowHours`.

An ensemble publishes only mean frames, so **at a station an ensemble is its mean wind**.
A run the archive job never saw being served (because the job was down for longer than
the run was current) is not recoverable.

Observation days are merged idempotently: keyed by station and time, so merging the same
manifest twice writes nothing, and a reading the source later revised replaces the old
value.

## How the scores are computed

`force5/ingest/verify.py`, daily, publishes `verify/scores.json` (`schemaVersion` 1,
`kind: "verification"`).

**Pairs.** A model's forecast and an observation pair when the run's valid time is the
reading's hour exactly. Nothing is interpolated in time for a model. The lead is hours
after the run.

**The blend** is scored as model `blend`. At 00, 06, 12 and 18 UTC each day it is rebuilt
from the newest run of each blended model whose `generatedAt` was by then, exactly as the
site works it out: `force5/ingest/consensus.py` replicates `blendWeight` and
`weightedMedian` (`force5/src/weights.ts`) and `placeConsensus` (`src/ratings.ts`) — grid
weights 3/2/1, ensembles collapsed to their member-mean speed, weighted median speed and
gust, weighted vector-mean bearing, linear in u/v between a model's steps but never
across a gap wider than twice its step. The fixture `force5/ingest/fixtures/blend-consensus.json`
holds the two together: `force5/src/consensusReplica.test.ts` checks that the TypeScript
produces its `expected` values and `test_consensus.py` checks that the Python does. After
changing the blend, regenerate it (`npx tsx force5/blend/consensus-fixture.ts`) and bring
the replica back into line. The blend's lead is hours after its issue time.

**Groups.** Every model (and the blend) × lead bucket (0–12, 12–24, 24–48, 48–72,
72–120, 120+ h) × station class, plus an `all` class (`byClass`), and every model ×
station over all leads (`byStation`), each over the last 30 and 90 complete UTC days.

**Scores**, in the row order `fields` declares:

- `n`, `speedBias` (forecast − observed), `speedMae`, `speedRmse`;
- `gustN`, `gustBias`, `gustMae`, where both sides have a gust;
- `dirN`, `dirMae`: mean absolute angular difference (0–180°), only where the observed
  speed is at least 3 m/s;
- `hits`, `misses`, `falseAlarms` for "rideable" (at least 6 m/s, about 12 kn), and
  `pod` = hits / (hits + misses), `far` = false alarms / (hits + false alarms).

Empty groups are `null`, never zero. The scoring functions are pure and tested in
`test_verify.py`.

**Sums, not pairs.** Every score is a ratio of sums, so a day is stored as its sums
(`archive/verify/sums/`) once it ended more than 72 hours ago — after that the
observation manifest no longer covers it and nothing can change it. Each run recomputes
only the newer days. A stored day carries `sumsVersion` and the blend replica's
`blendSignature`, and is recomputed when either has changed.

## Licences and attribution

- Met Éireann data are CC BY 4.0. The published manifest and the scores carry the
  attribution "Contains Met Éireann data, licensed under CC BY 4.0" with Met Éireann's
  no-liability statement. **A public display of these readings must also show Met
  Éireann's current weather warnings** (https://www.met.ie/warnings), as Met Éireann's
  open-data terms ask of a public weather display; `wind-observations.json` says so in
  its `notice`.
- Marine Institute weather buoy data are CC BY 4.0: "Weather buoy data © Marine
  Institute, CC BY 4.0".
- The forecasts are each model's own, under the terms in each wind manifest.

## Known limits

- **Station exposure.** An anemometer measures one mast. Inland stations sit in fields,
  airports and valleys; even the coastal ones are often on headlands (Malin Head, Mace
  Head), which read windier than a sheltered bay. A model's bias at a station is partly
  the station's exposure, so compare models at the same station or class, not stations
  with each other.
- **Buoys are not spots.** M2–M6 are 20–300 km offshore, in open-sea wind with no coast
  to slow it. They say how well a model handles the synoptic wind, not how it handles a
  bay. Their anemometers are on the buoy's own mast, whose height the dataset does not
  state, so they are not at the models' 10 m reference height either.
- **The observation is not the model's quantity.** Met Éireann's speed is an hourly mean
  ending at the hour, a model's is the wind at the valid time; a model's gust is a
  maximum over its own window (`gustWindowHours`: one, three or six hours, or an
  instant), the station's over the hour. Gust scores across models are therefore not
  like for like.
- **Rounding.** Met Éireann publishes hundredths of a knot, but a buoy feed and older
  METAR-style sources report whole knots and ten-degree bearings, so small differences
  (under about 0.3 m/s or 5°) are inside the observation's own resolution.
- **The blend at a station** uses an ensemble's mean wind, not its members' mean speed,
  which reads slightly lower in a spread ensemble; at spots the site uses the members.
- **Coverage.** The archive starts the day the jobs are deployed: the first scores cover
  only short leads (and a 30-day window that is mostly empty) until enough days have
  passed. `windows[].daysWithData` says how many days a window really holds.
