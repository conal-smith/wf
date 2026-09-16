"""The single model registry: one line per adapter.

`script` runs inside the worker, `manifest` is the published pointer path under
`public/` (its first segment is also the immutable object root for that model),
`kind` selects the validator, `maxAgeHours` is the default freshness limit.
Adding a model means adding one entry here and its fetch script.
"""

MODELS = {
    "harmonie": {"script": "fetch_harmonie.py", "manifest": "weather/harmonie.json",
                 "kind": "wind", "maxAgeHours": 12},
    "icon-eu": {"script": "fetch_forecast.py", "manifest": "weather/latest.json",
                "kind": "wind", "maxAgeHours": 12},
    "ecmwf": {"script": "fetch_ecmwf.py", "manifest": "weather/ecmwf.json",
              "kind": "wind", "maxAgeHours": 24},
    "gfs": {"script": "fetch_gfs.py", "manifest": "weather/gfs.json",
            "kind": "wind", "maxAgeHours": 12},
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
