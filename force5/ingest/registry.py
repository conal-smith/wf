"""The single model registry: one line per adapter.

`script` runs inside the worker, `manifest` is the published pointer path under
`public/` (its first segment is also the immutable object root for that model),
`kind` selects the validator, `maxAgeHours` is the default freshness limit, and
`workerStep` is False for an adapter whose cadence is its own, so the worker never
forces its 1/3-hour `--step` on a source that does not publish those steps.
Adding a model means adding one entry here and its fetch script.
"""

MODELS = {
    "harmonie": {"script": "fetch_harmonie.py", "manifest": "weather/harmonie.json",
                 "kind": "wind", "maxAgeHours": 12},
    "icon-eu": {"script": "fetch_forecast.py", "manifest": "weather/latest.json",
                "kind": "wind", "maxAgeHours": 12},
    "icon-eu-weather": {"script": "fetch_icon_weather.py", "manifest": "weather/icon-eu-weather.json",
                        "kind": "weather", "maxAgeHours": 12},
    "ecmwf": {"script": "fetch_ecmwf.py", "manifest": "weather/ecmwf.json",
              "kind": "wind", "maxAgeHours": 24},
    "ecmwf-ens": {"script": "fetch_ecmwf_ens.py", "manifest": "weather/ecmwf-ens.json",
                  "kind": "wind", "maxAgeHours": 24},
    # AIFS Single runs at all four cycles about six hours behind the clock, so a run
    # is never more than twelve hours old when the next one is due. Its cadence is a
    # uniform six hours and never the worker's 1/3-hour step.
    "aifs": {"script": "fetch_aifs.py", "manifest": "weather/aifs.json",
             "kind": "wind", "maxAgeHours": 12, "workerStep": False},
    # The wave stream is twice daily on the wind control's own ladder.
    "ecmwf-wave": {"script": "fetch_ecmwf_wave.py", "manifest": "weather/ecmwf-wave.json",
                   "kind": "wave", "maxAgeHours": 24},
    "gfs": {"script": "fetch_gfs.py", "manifest": "weather/gfs.json",
            "kind": "wind", "maxAgeHours": 12},
    # GEFS is 3-hourly at best and defaults to 6-hourly; it has no hourly product.
    # The newest GEFS cycle is often still publishing at its slot; accept the previous one.
    "gefs": {"script": "fetch_gefs.py", "manifest": "weather/gefs.json",
             "kind": "wind", "maxAgeHours": 18, "workerStep": False},
    "harmonie-eps": {"script": "fetch_harmonie_eps.py", "manifest": "weather/harmonie-eps.json",
                     "kind": "wind", "maxAgeHours": 12},
    "gfs-wave": {"script": "fetch_gfswave.py", "manifest": "weather/gfs-wave.json",
                 "kind": "wave", "maxAgeHours": 12},
    "tides": {"script": "fetch_tides.py", "manifest": "marine/tides.json",
              "kind": "tide", "maxAgeHours": 30},
    # One SWAN run a day, published around 09 UTC and occasionally a day late.
    "mi-swan": {"script": "fetch_mi_swan.py", "manifest": "weather/mi-swan.json",
                "kind": "wave", "maxAgeHours": 36},
}

MANIFESTS = {model: entry["manifest"] for model, entry in MODELS.items()}


def object_root(model):
    """Immutable frames/station files live beside the model's manifest."""
    return MANIFESTS[model].split("/")[0]
