# Gust forecasts: source semantics and validation

## Current support

- **ICON-EU:** existing DWD scalar `vmax_10m` ingestion remains enabled. Each
  frame retains the GRIB maximum's start/end time, not a guessed period.
- **ECMWF IFS:** scalar 10 m maximum gust ingestion is now implemented. Gusts
  have the same run/grid/valid-time identity as the wind, but a separate source
  interval. Every post-initialization frame must have a validated gust field
  before the snapshot may publish.
- **HARMONIE DINI:** scalar gust ingestion is now enabled. The Irish subset
  exports the control's time-maximum gust as components; their magnitude is the
  provider's own scalar gust, verified against it directly (below). Each value is
  the maximum over the one hour ending at the forecast time. No other model's
  gusts are substituted, and a run missing components publishes wind-only.

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
derive gust speed as the vector magnitude for `ugst`/`vgst`. That was evidence of
a component-based method, but did not by itself establish that this particular
DINI export's time-maximised fields represent a coincident gust vector. In general,
combining independently attained component maxima need not give the maximum
vector speed. A rotation check or plausible-looking speed cannot prove that.

## HARMONIE resolution (16 September 2026): the components are the provider's gust

The missing evidence was found by enumerating every GRIB2 message of each control
variant of the same cycle on the near-real-time portal. Run **2026091620**, +3h:

| Subset                                       | Size                  | 10 m gust fields | Scalar 22? |
| -------------------------------------------- | --------------------- | ---------------- | ---------- |
| `CONTROL_grib2_ieIoI` (used by the importer) | 13.3 MB, 229 × 386    | 23, 24           | no         |
| `CONTROL_grib2_ieIRL25`                      | 45.9 MB, 639 × 730    | 23, 24           | no         |
| `CONTROL_grib2_ieDINI`                       | 105.3 MB, 1909 × 1609 | 23, 24           | no         |
| `CONTROL_grib2_ie`                           | 557.0 MB, 1909 × 1609 | **22**, 23, 24   | **yes**    |
| `CONTROL_grib2_pp` / `_mllow` / `_mlIoI`     | 73.2 / 8.6 / 60.5 MB  | none at 10 m     | no         |

The full-domain `CONTROL_grib2_ie` export carries the scalar
`max_i10fg` (parameter 22, `Time-maximum 10 metre wind gust`) **beside** its
components, for the same run, step and grid, all with
`typeOfStatisticalProcessing=2`, `lengthOfTimeRange=1`,
`indicatorOfUnitForTimeRange=1` and interval [2,3]. That makes the component
semantics directly testable rather than inferred.

### Measured agreement

`hypot(max_10efg, max_10nfg)` against `max_i10fg`, all **3,071,581** points of
the full DINI grid, run 2026091620 +3h:

| statistic                        | value (m/s)       |
| -------------------------------- | ----------------- |
| max abs difference               | 0.001377          |
| mean abs difference              | 0.000474          |
| RMS difference                   | 0.000564          |
| 99.9th percentile abs difference | 0.001298          |
| points with difference > 0.05    | 0                 |
| scalar range                     | 0.2244 to 62.9024 |

The residual is GRIB packing precision, not a modelling difference: the
components are packed at 16 bits with `binaryScaleFactor = -9` (a ~0.002 m/s
step) while the scalar uses 24 bits. The components are signed and genuinely
directional (30% negative east, 49% negative north), so this is a coincident
gust vector, not two independently attained maxima. **Taking the magnitude
reproduces the provider's own gust field**, so nothing is manufactured.

The same test inside the Ireland subset the importer actually downloads
(88,394 points of `CONTROL_grib2_ieIoI`, compared against the full-domain
scalar at the same grid points) gives max 0.000341, mean 0.000120, RMS 0.000141.
The subset's components equal the full-domain components at the shared points to
within 0.0011 m/s, and its first grid point coincides with full-domain
(row 485, column 658) to 2.4e-07 degrees.

Across steps, against the control scalar for the same cycle (max abs difference,
m/s, 88,394 subset points each):

| +h  | source interval | max abs diff | mean abs diff |
| --- | --------------- | ------------ | ------------- |
| 1   | [0, 1]          | 0.000340     | 0.000120      |
| 3   | [2, 3]          | 0.000341     | 0.000120      |
| 6   | [5, 6]          | 0.000340     | 0.000121      |
| 12  | [11, 12]        | 0.000342     | 0.000120      |
| 24  | [23, 24]        | 0.000333     | 0.000121      |
| 48  | [47, 48]        | 0.000343     | 0.000118      |
| 60  | [59, 60]        | 0.000343     | 0.000118      |

Every step's window is exactly one hour ending at the forecast time. At +0h the
window is [0, 0] with `lengthOfTimeRange=0`: a zero-length maximum, published as
unavailable rather than zero.

### The other two candidate routes, and why they are not needed

**Ensemble subsets.** `fcYYYYMMDDHH+HHHgrib2_enIoI` does contain scalar
`max_i10fg` on the same 229 × 386 grid, but each file is an arbitrary member:
the same cycle gave `perturbationNumber` 12 at +1h, 0 at +3h and 11 at +6h, with
`typeOfProcessedData` `pf` except where it happened to be `cf`. It cannot be used
for the control. The +3h file that happened to be member 0 gives an independent
same-file confirmation of the rule on the subset grid: max 0.000341, mean
0.000120 over its 88,394 points.

**`opendata2.met.ie/nwp/<cycle>/mbr000/`.** This publishes the control's scalar
`fg` with a JSON sidecar declaring `ensemble_member: 0`, plus `ws`/`wdir`, on the
full 1909 × 1609 grid at 6.8 MB per step, hourly to +60 h. Its +3h `fg` is
**bit-identical** to `CONTROL_grib2_ie`'s parameter 22 (max abs difference
0.000000), which confirms both that `mbr000` is the control and that the two
portals carry the same field. Its `ws` agrees with `hypot(u, v)` from our decoded
control wind to 0.058 m/s max / 0.013 m/s mean, the packing precision of a
pre-computed speed. Correct, but it would add 6.8 MB per step (about 410 MB for a
60-hour run) and a regridding step.

**Chosen route: the components already in the ZIP we download.** Zero extra
bytes, native 2 km resolution, and the exact value the provider publishes.

### How the importer uses it

`fetch_harmonie.py` validates each component message's parameter number,
`stepType=max`, `typeOfStatisticalProcessing=2`,
`indicatorOfUnitForTimeRange=1`, `lengthOfTimeRange` and start/end steps against
the expected one-hour window, along with the existing member/provider/grid/valid-time
checks. It combines the pair at native points and bilinearly resamples the
resulting scalar with exactly the same `resample` used for wind. The gust
components are grid-relative like U/V, but a magnitude is rotation invariant, so
combining before rotation is exact and no gust rotation is performed; a unit test
asserts the invariance. Derived values must be finite, non-negative and at most
150 m/s. If any step after initialization lacks both components, the entire run
publishes with `gustAvailable: false` and a manifest description saying so, under
a distinct immutable frame prefix.

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

A HARMONIE gust run of control 2026091621 (`--hours 12 --step 3`) publishes five
frames at about 834 KB each and passes the S3 publisher's bundle validation.
Brandon Bay: +0h 19.3 kn wind with no gust, +3h 19.6 kn / 28.8 kn gust over
[2,3] h, +6h 20.0 / 28.7 over [5,6] h, +9h 13.7 / 26.2 over [8,9] h, +12h
22.3 / 33.8 over [11,12] h. A full 60-hour, three-hourly gust run would be about
17 MB, so the bundled repository snapshot is deliberately left at the earlier
wind-only run (`gustAvailable: false`) and the browser tests assert whichever
state the bundled manifest declares.
