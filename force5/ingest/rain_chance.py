"""The chance of rain at a riding place, from one deterministic model's own grid.

A single model run says where its showers fall to the kilometre, but not where
they will really fall: a shower the model puts 10 km up the coast is as likely
to cross the spot as one it puts on it. So the chance is the neighbourhood
probability (Theis, Hense and Damrath 2005, "Probabilistic precipitation
forecasts from a deterministic model: a pragmatic approach", Meteorological
Applications 12; Roberts and Lean 2008): the share of the model's cells whose
centres lie within RADIUS_KM of the place that have WET_MM or more in the
step's interval. It answers for where the rain falls, not for the model being
wrong about rain altogether, which only other models can (mcp/api/forecast.ts
averages the weather models that reach an hour).

The weather importers publish it per place as `pop`, a whole per cent, beside
`precip` and over the same interval (`precipIntervalHours`).
"""
import math

import numpy as np

# 25 km takes in about 70 ICON-EU cells of 0.0625° and four of GFS's 0.25° at
# Irish latitudes: the scale of a passing shower's track in an hour or two.
RADIUS_KM = 25.0
# The published rain, rounded to 0.1 mm, is wet from its first tenth: the
# threshold rain_mm itself shows as rain (the WMO's "measurable" precipitation).
WET_MM = 0.1
KM_PER_DEGREE = 111.195

VARIABLE = {
    "decimals": 0, "range": (0.0, 100.0), "units": "%", "label": "Chance of rain",
    "description": (f"Share of the model's cells within {RADIUS_KM:g} km of the place with "
                    f"{WET_MM:g} mm or more of precip in the interval ending at this hour "
                    "(a neighbourhood probability from this one run); null at initialization, "
                    "which has no interval"),
}
NOTE = (
    f"pop is the share, in whole per cent, of the model's grid cells whose centres lie within "
    f"{RADIUS_KM:g} km of the place that have {WET_MM:g} mm or more of precip in the step's "
    "interval: a neighbourhood probability (Theis et al. 2005) from this one deterministic run. "
    "It accounts for where the model's rain falls, not for the run being wrong altogether, and "
    "is published in the series only, never on a frame."
)


def neighbourhood(grid, lon, lat, radius_km=RADIUS_KM):
    """Flat indices of the grid cells whose centres lie within `radius_km` of a place.

    The grid is the shared crop's: rows north-to-south from `north`, columns
    west-to-east from `west`, cell centres `dy` and `dx` degrees apart. Distances
    are on the local plane, which over 25 km is good to well under a per cent.
    """
    north_south = radius_km / KM_PER_DEGREE
    east_west = north_south / math.cos(math.radians(lat))
    # The box around the circle, in whole rows and columns, clipped to the grid.
    y0, x0 = (grid["north"] - lat) / grid["dy"], (lon - grid["west"]) / grid["dx"]
    rows = np.arange(max(0, math.ceil(y0 - north_south / grid["dy"])),
                     min(grid["height"] - 1, math.floor(y0 + north_south / grid["dy"])) + 1)
    columns = np.arange(max(0, math.ceil(x0 - east_west / grid["dx"])),
                        min(grid["width"] - 1, math.floor(x0 + east_west / grid["dx"])) + 1)
    if not len(rows) or not len(columns):
        return np.zeros(0, dtype=int)
    y = (grid["north"] - rows * grid["dy"] - lat) * KM_PER_DEGREE
    x = (grid["west"] + columns * grid["dx"] - lon) * KM_PER_DEGREE * math.cos(math.radians(lat))
    inside = (y[:, None] ** 2 + x[None, :] ** 2) <= radius_km ** 2
    row, column = np.nonzero(inside)
    return rows[row] * grid["width"] + columns[column]


def chance(precip, cells):
    """Whole per cent of `cells` wet in `precip` (a flat array), or None without either."""
    if precip is None or not len(cells):
        return None
    wet = np.asarray(precip, dtype=float)[cells] >= WET_MM - 1e-9
    return int(round(100 * float(wet.mean())))
