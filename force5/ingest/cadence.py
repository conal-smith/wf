"""Explicit source timesteps: no temporal interpolation or invented hours."""

ECMWF_HOURS = tuple(range(0, 145, 3)) + tuple(range(150, 361, 6))
ECMWF_RANGES = [{"throughHour": 144, "stepHours": 3},
                {"throughHour": 360, "stepHours": 6}]


def expected_hours(manifest):
    if manifest["model"] == "ecmwf":
        if manifest.get("stepHours") != 3 or manifest.get("stepRanges") != ECMWF_RANGES:
            raise ValueError("Invalid ECMWF source cadence")
        return ECMWF_HOURS
    step = manifest.get("stepHours")
    if step not in (1, 3) or manifest.get("stepRanges"):
        raise ValueError("Unsupported source cadence")
    if not manifest["frames"] and manifest.get("kind") == "wave":
        # A wave bundle may publish spot series with no map frames; the horizon is
        # then declared rather than implied by the frame count.
        horizon = manifest.get("horizonHours")
        if (not isinstance(horizon, int) or isinstance(horizon, bool)
                or not 0 < horizon <= 384 or horizon % step):
            raise ValueError("Unsupported source cadence")
        return tuple(range(0, horizon + step, step))
    return tuple(range(0, len(manifest["frames"]) * step, step))
