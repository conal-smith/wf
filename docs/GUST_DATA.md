# Gust forecasts: source semantics and validation

## Current support

- **ICON-EU:** existing DWD scalar `vmax_10m` ingestion remains enabled. Each
  frame retains the GRIB maximum's start/end time, not a guessed period.
- **ECMWF IFS:** scalar 10 m maximum gust ingestion is now implemented. Gusts
  have the same run/grid/valid-time identity as the wind, but a separate source
  interval. Every post-initialization frame must have a validated gust field
  before the snapshot may publish.
- **HARMONIE DINI:** the numerical model produces gusts, but the current Irish
  GRIB export provides time-maximised components. Scalar gusts remain disabled
  pending confirmation of this export's component semantics or a scalar source.
  No other model's gusts are substituted.

## ECMWF

The [open-data catalogue](https://www.ecmwf.int/en/forecasts/datasets/open-data)
lists `10fg` / `10fg3`. In the actual 2026091300 inventory, the aliases are
`10fg` through +90h, `10fg3` from +93h to +144h, and `10fg` beyond +144h.
The importer tries the other documented alias only if the preferred alias is
absent from the index. Network errors are not treated as missing fields.

Probe GRIBs from this run show +3h has interval [2,3], +150h [144,150], and +360h
[354,360]. Thus a table with three-hourly times can show **one-hour gust maxima**,
not necessarily maxima over the whole three hours between columns. Never claim
continuous coverage of unsampled hours. Each gust cell's tooltip gives its actual
start/end in Irish local time. Source details explain the distinction.

Validation requires an ECMWF control forecast, accepted scalar maximum-gust
parameter, 10 m height, m/s, regular earth-relative grid identical to the wind,
correct run and valid time, finite nonnegative values, no missing cells, and a
positive 1/3/6-hour maximum interval ending at the forecast hour. Instantaneous
gusts, vector components, duplicate messages and mismatched grids are rejected.
The [ECMWF GRIB2 migration documentation](https://confluence.ecmwf.int/spaces/MTG2US/pages/554148197/Migration+to+GRIB2+-+changes+to+encoding+of+parameters)
explains why the statistical interval must be read separately from the parameter.

At +0h there is no preceding forecast interval. The manifest explicitly declares
`gustAvailable: true, gustMissingHours: [0]`; that frame and its spot samples use
`gust: null`, `gustIntervalHours: null`. Later missing gusts fail the whole refresh.
Older wind-only snapshots remain readable. Frame schema otherwise remains v1;
content-addressed files use a `360h-v2` prefix so old open tabs keep their files.

Source gusts are cached separately from wind GRIBs. All downloads and checks
finish before the local manifest advances. The S3 publisher validates intervals
and prevents an older wind-only worker removing gusts from the same model run.

## HARMONIE investigation (13 September 2026)

Inspected live control run **2026091317**, hours +0 and +3. Its 10 m fields are
wind parameters 2/3 and gust parameters 23/24. ecCodes identifies the latter as
`max_10efg` / `max_10nfg` (IDs 237384/237385), with `stepType=max`, grid-relative
vectors, and matching [2,3] periods at +3h. At initialization their period is [0,0].
There was no scalar parameter 22 among the inspected 10 m fields.

The HIRLAM verification toolkit [HARP's parameter definitions](https://github.com/harphub/harpIO/blob/master/R/harp_params.R)
derive gust speed as the vector magnitude for `ugst`/`vgst`. That is evidence of
a component-based method, but does not by itself establish that this particular
DINI export's time-maximised fields represent a coincident gust vector. In general,
combining independently attained component maxima need not give the maximum
vector speed. A rotation check or plausible-looking speed cannot prove that.

Before enabling this feed, obtain documentation/confirmation of the DINI
component generation and time pairing, or locate a validated scalar gust field.
Then calculate magnitude at native points before scalar regridding, check
component identity/interval/geometry, and verify against provider output. This
work must not replace a blank with an unverified derived safety-relevant value.

## Operating during mirror failures

The existing snapshot stays live after a failed refresh. Official public mirrors
can be selected explicitly; they carry the same model, not replacement forecasts:

```sh
npm run weather:refresh:ecmwf -- --source google
.venv/bin/python force5/ingest/worker.py --models ecmwf --ecmwf-source google
```

The container also accepts `ECMWF_SOURCE=google`. Normal freshness and completeness
checks still apply. Respect provider rate limits; use the cache and retry scheduled
jobs instead of raising request concurrency.

## Verified local snapshot

The complete 2026091300 ECMWF run is saved with 85 wind frames and 84 validated
gust fields through +360h, fetched using the official Google mirror after AWS
503 and ECMWF-origin 429 responses. The v2 JSON frame bundle is about 5 MB.
The local publisher validation succeeds for ECMWF, ICON-EU and HARMONIE; the
regional snapshots were not replaced. The mobile browser test checks gust values,
1/3/6-hour interval labels, initialization's blank and return to HARMONIE.
No AWS publication or deployment was performed.
