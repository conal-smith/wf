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
"""

# The exit code an adapter uses to say "the run I resolved is the one already
# published, so I downloaded nothing and wrote nothing". It is part of the worker
# contract, not a failure: there is no local bundle to validate afterwards.
UNCHANGED_EXIT = 3
# How the worker tells an adapter which run the bucket currently serves. On an
# empty disk that is the only way to know, and it is what stops an hourly job
# re-downloading a twice-daily run.
PUBLISHED_RUN_ENV = "FORCE5_PUBLISHED_RUN"

MODELS = {
    "harmonie": {"script": "fetch_harmonie.py", "manifest": "weather/harmonie.json",
                 "kind": "wind", "maxAgeHours": 12, "cache": "harmonie"},
    "icon-eu": {"script": "fetch_forecast.py", "manifest": "weather/latest.json",
                "kind": "wind", "maxAgeHours": 12, "cache": "grib"},
    "icon-eu-weather": {"script": "fetch_icon_weather.py", "manifest": "weather/icon-eu-weather.json",
                        "kind": "weather", "maxAgeHours": 12, "cache": "grib"},
    "ecmwf": {"script": "fetch_ecmwf.py", "manifest": "weather/ecmwf.json",
              "kind": "wind", "maxAgeHours": 24, "cache": "ecmwf"},
    "ecmwf-ens": {"script": "fetch_ecmwf_ens.py", "manifest": "weather/ecmwf-ens.json",
                  "kind": "wind", "maxAgeHours": 24, "cache": "ecmwf-ens"},
    # AIFS Single runs at all four cycles about six hours behind the clock, so a run
    # is never more than twelve hours old when the next one is due. Its cadence is a
    # uniform six hours and never the worker's 1/3-hour step.
    "aifs": {"script": "fetch_aifs.py", "manifest": "weather/aifs.json",
             "kind": "wind", "maxAgeHours": 12, "cache": "aifs", "workerStep": False},
    # The wave stream is twice daily on the wind control's own ladder.
    "ecmwf-wave": {"script": "fetch_ecmwf_wave.py", "manifest": "weather/ecmwf-wave.json",
                   "kind": "wave", "maxAgeHours": 24, "cache": "ecmwf-wave"},
    "gfs": {"script": "fetch_gfs.py", "manifest": "weather/gfs.json",
            "kind": "wind", "maxAgeHours": 12, "cache": "gfs"},
    # GEFS is 3-hourly at best and defaults to 6-hourly; it has no hourly product.
    # The newest GEFS cycle is often still publishing at its slot; accept the previous one.
    "gefs": {"script": "fetch_gefs.py", "manifest": "weather/gefs.json",
             "kind": "wind", "maxAgeHours": 18, "cache": "gefs", "workerStep": False},
    # Météo-France publishes whole-domain packages with no subsetting; both adapters
    # read only the messages they publish, over byte ranges. ARPEGE runs four times a
    # day and AROME every three hours, both about 4.5 hours behind their cycle.
    "arpege": {"script": "fetch_arpege.py", "manifest": "weather/arpege.json",
               "kind": "wind", "maxAgeHours": 12, "cache": "meteofrance/arpege"},
    "arome": {"script": "fetch_arome.py", "manifest": "weather/arome.json",
              "kind": "wind", "maxAgeHours": 12, "cache": "meteofrance/arome"},
    "harmonie-eps": {"script": "fetch_harmonie_eps.py", "manifest": "weather/harmonie-eps.json",
                     "kind": "wind", "maxAgeHours": 12},
    "gfs-wave": {"script": "fetch_gfswave.py", "manifest": "weather/gfs-wave.json",
                 "kind": "wave", "maxAgeHours": 12, "cache": "gfswave"},
    "tides": {"script": "fetch_tides.py", "manifest": "marine/tides.json",
              "kind": "tide", "maxAgeHours": 30},
    # Observations, not a forecast: `run` is the newest observation hour, so this
    # limit is how stale a reading the site will still show.
    "sea-temperature": {"script": "fetch_sea_temperature.py",
                        "manifest": "marine/sea-temperature.json",
                        "kind": "observation", "maxAgeHours": 48},
    # One SWAN run a day, published around 09 UTC and occasionally a day late.
    "mi-swan": {"script": "fetch_mi_swan.py", "manifest": "weather/mi-swan.json",
                "kind": "wave", "maxAgeHours": 36},
}

MANIFESTS = {model: entry["manifest"] for model, entry in MODELS.items()}


def object_root(model):
    """Immutable frames/station files live beside the model's manifest."""
    return MANIFESTS[model].split("/")[0]
