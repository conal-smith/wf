"""The single model registry: one line per adapter.

`script` runs inside the worker, `manifest` is the published pointer path under
`public/` (its first segment is also the immutable object root for that model),
`kind` selects the validator, `maxAgeHours` is the default freshness limit, and
`workerStep` is False for an adapter whose cadence is its own, so the worker never
forces its 1/3-hour `--step` on a source that does not publish those steps.
`cache` names the directory under `.cache/` that holds the model's raw downloads;
the worker empties it after every job, because a published run never needs them
again and a failed one simply downloads afresh. Models without it write small
state there instead (station catalogues, SWAN's last-seen files, lagged members).
None of that state survives a one-shot container, which starts on an empty disk:
it is re-derived or re-downloaded, except for `harmonie-eps`, whose members are
the controls of earlier cycles and which therefore publishes a smaller ensemble
there (see docs/LIVE_FORECAST_PIPELINE.md). Adding a model means adding one entry
here and its fetch script.

`readsBucket` marks a job that reads what the bucket already serves rather than an
upstream source (the blend, the forecast archive, the verification): the worker
passes it the bucket, prefix, endpoint and region, and the credentials stay in the
environment it inherits. Without a bucket such a job reads the work directory.
"""

# The exit code an adapter that declares `readsPublishedRun` uses to say "the run I
# resolved is the one the BUCKET already serves, so I downloaded nothing and wrote
# nothing". There is no local bundle to validate afterwards, which is why the worker
# only accepts it from such an adapter, and only when it actually passed the run
# below. From anything else, exit 3 is an ordinary failure.
UNCHANGED_EXIT = 3
# How the worker tells an adapter which run the bucket currently serves. On an
# empty disk that is the only way to know, and it is what stops an hourly job
# re-downloading a twice-daily run.
PUBLISHED_RUN_ENV = "FORCE5_PUBLISHED_RUN"

# `readsPublishedRun` marks an adapter that implements the FORCE5_PUBLISHED_RUN
# contract: it is what makes the worker send the bucket's run and what makes
# UNCHANGED_EXIT mean something from the adapter's exit status. Every forecast does,
# because every slot that fires before its source has a newer run (ECMWF's retry
# slot after the morning one has published, a fallback to the previous Météo-France or GEFS cycle,
# SWAN's one run a day checked three times) would otherwise download, process and
# re-upload a run the site already serves. Tides and sea temperature do not: see
# their entries.
MODELS = {
    "harmonie": {"script": "fetch_harmonie.py", "manifest": "weather/harmonie.json",
                 "kind": "wind", "maxAgeHours": 24, "cache": "harmonie", "readsPublishedRun": True},
    "icon-eu": {"script": "fetch_forecast.py", "manifest": "weather/latest.json",
                "kind": "wind", "maxAgeHours": 30, "cache": "grib", "readsPublishedRun": True},
    "icon-eu-weather": {"script": "fetch_icon_weather.py", "manifest": "weather/icon-eu-weather.json",
                        "kind": "weather", "maxAgeHours": 30, "cache": "grib",
                        "readsPublishedRun": True},
    # Fetched once a day, the 00 UTC run (complete on open data at about 07:35 UTC)
    # at 08:20 with a 10:20 retry: the run it replaces is 32-36 h old by then, and
    # a day with neither slot succeeding is stale from 16 UTC.
    "ecmwf": {"script": "fetch_ecmwf.py", "manifest": "weather/ecmwf.json",
              "kind": "wind", "maxAgeHours": 40, "cache": "ecmwf", "readsPublishedRun": True},
    "ecmwf-ens": {"script": "fetch_ecmwf_ens.py", "manifest": "weather/ecmwf-ens.json",
                  "kind": "wind", "maxAgeHours": 36, "cache": "ecmwf-ens",
                  "readsPublishedRun": True},
    # AIFS Single runs at all four cycles about six hours behind the clock, so a run
    # is never more than twelve hours old when the next one is due. Its cadence is a
    # uniform six hours and never the worker's 1/3-hour step.
    "aifs": {"script": "fetch_aifs.py", "manifest": "weather/aifs.json",
             "kind": "wind", "maxAgeHours": 12, "cache": "aifs", "workerStep": False,
             "readsPublishedRun": True},
    # The wave stream is twice daily on the wind control's own ladder.
    "ecmwf-wave": {"script": "fetch_ecmwf_wave.py", "manifest": "weather/ecmwf-wave.json",
                   "kind": "wave", "maxAgeHours": 24, "cache": "ecmwf-wave",
                   "readsPublishedRun": True},
    "gfs": {"script": "fetch_gfs.py", "manifest": "weather/gfs.json",
            "kind": "wind", "maxAgeHours": 12, "cache": "gfs", "readsPublishedRun": True},
    # GEFS is 3-hourly at best and defaults to 6-hourly; it has no hourly product.
    # The newest GEFS cycle is often still publishing at its slot; accept the previous one.
    "gefs": {"script": "fetch_gefs.py", "manifest": "weather/gefs.json",
             "kind": "wind", "maxAgeHours": 18, "cache": "gefs", "workerStep": False,
             "readsPublishedRun": True},
    # Météo-France publishes whole-domain packages with no subsetting; both adapters
    # read only the messages they publish, over byte ranges. ARPEGE runs four times a
    # day and AROME every three hours, both about 4.5 hours behind their cycle.
    "arpege": {"script": "fetch_arpege.py", "manifest": "weather/arpege.json",
               "kind": "wind", "maxAgeHours": 12, "cache": "meteofrance/arpege",
               "readsPublishedRun": True},
    "arome": {"script": "fetch_arome.py", "manifest": "weather/arome.json",
              "kind": "wind", "maxAgeHours": 12, "cache": "meteofrance/arome",
              "readsPublishedRun": True},
    "harmonie-eps": {"script": "fetch_harmonie_eps.py", "manifest": "weather/harmonie-eps.json",
                     "kind": "wind", "maxAgeHours": 12, "readsPublishedRun": True},
    "gfs-wave": {"script": "fetch_gfswave.py", "manifest": "weather/gfs-wave.json",
                 "kind": "wave", "maxAgeHours": 12, "cache": "gfswave", "readsPublishedRun": True},
    # Predictions, not a run: `run` is the hour the job ran, so it never repeats from
    # one daily slot to the next and there is no provider run to compare it with.
    "tides": {"script": "fetch_tides.py", "manifest": "marine/tides.json",
              "kind": "tide", "maxAgeHours": 30},
    # Observations, not a forecast: `run` is the newest observation hour, so this
    # limit is how stale a reading the site will still show. It is also why the run
    # is not compared: it is known only once every reading has been fetched, and an
    # unchanged newest hour still lets other stations catch up, which is new data.
    "sea-temperature": {"script": "fetch_sea_temperature.py",
                        "manifest": "marine/sea-temperature.json",
                        "kind": "observation", "maxAgeHours": 48},
    # One SWAN run a day, published around 09 UTC and occasionally a day late.
    "mi-swan": {"script": "fetch_mi_swan.py", "manifest": "weather/mi-swan.json",
                "kind": "wave", "maxAgeHours": 36, "readsPublishedRun": True},
    # Not a model: every riding place's consensus of the wind models above, worked
    # out from what they have published (src/spotBlend.ts), so the map's stars need
    # a few small files instead of every manifest: a run directory of 2° spot squares,
    # of which the map reads those in view. `run` is the hour it was worked out,
    # so an hourly job publishes a new one each hour and three missed hours is stale.
    "blend": {"script": "fetch_blend.py", "manifest": "weather/blend.json",
              "kind": "blend", "maxAgeHours": 3, "readsBucket": True},
    # Measured wind at Met Éireann stations and Marine Institute buoys, the truth the
    # forecasts are verified against (docs/VERIFICATION.md). Like sea temperature,
    # `run` is the newest observation hour; the feeds lag the clock by about an hour.
    "wind-obs": {"script": "fetch_wind_obs.py", "manifest": "marine/wind-observations.json",
                 "kind": "observation", "maxAgeHours": 6},
    # Not a model either: copies every wind run the bucket serves, sampled where we
    # observe, and the observations, into archive/ before the runs are deleted. The
    # pointer is only a summary of what it copied; `run` is the hour it ran.
    "forecast-archive": {"script": "archive_forecasts.py",
                         "manifest": "verify/forecast-archive.json",
                         "kind": "archive", "maxAgeHours": 3, "readsBucket": True},
    # Daily scores of every model, and of the blend, against the archived observations.
    "verify": {"script": "verify.py", "manifest": "verify/scores.json",
               "kind": "verification", "maxAgeHours": 36, "readsBucket": True},
}

MANIFESTS = {model: entry["manifest"] for model, entry in MODELS.items()}


def object_root(model):
    """Immutable frames/station files live beside the model's manifest."""
    return MANIFESTS[model].split("/")[0]
