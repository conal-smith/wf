"""Explicit source timesteps: no temporal interpolation or invented hours."""

ECMWF_HOURS = tuple(range(0, 145, 3)) + tuple(range(150, 361, 6))
ECMWF_RANGES = [{"throughHour": 144, "stepHours": 3},
                {"throughHour": 360, "stepHours": 6}]
# Products published on the IFS open-data ladder above. The wind control and the
# wave stream share it exactly, so both are held to it rather than to the looser
# general rule: a resampled or invented hour cannot publish under these ids.
ECMWF_LADDER_MODELS = ("ecmwf", "ecmwf-wave")


def ladder_hours(ranges):
    """Expand an explicit [{throughHour, stepHours}] ladder from initialization."""
    if not isinstance(ranges, list) or not ranges:
        raise ValueError("Unsupported source cadence")
    hours, end = [0], 0
    for entry in ranges:
        step = entry.get("stepHours") if isinstance(entry, dict) else None
        through = entry.get("throughHour") if isinstance(entry, dict) else None
        if (not isinstance(step, int) or isinstance(step, bool) or step <= 0
                or not isinstance(through, int) or isinstance(through, bool)
                or not end < through <= 1000 or (through - end) % step):
            raise ValueError("Invalid forecast cadence ladder")
        hours.extend(range(end + step, through + 1, step))
        end = through
    return tuple(hours)


def ecmwf_ladder(ranges):
    """The IFS open-data ladder, whole or stopped early but never resampled.

    The full product is 3-hourly to +144h then 6-hourly to +360h. A shorter run —
    an acceptance snapshot, or a horizon an operator asked for — may declare a
    prefix of that ladder, but every hour it declares must be one the source
    actually publishes, so a 4-hourly or an interpolated hour is still refused.
    """
    if ranges == ECMWF_RANGES:
        return ECMWF_HOURS
    hours = ladder_hours(ranges)
    if hours != ECMWF_HOURS[:len(hours)]:
        raise ValueError("Invalid ECMWF source cadence")
    return hours


def expected_hours(manifest):
    if manifest["model"] in ECMWF_LADDER_MODELS:
        if manifest.get("stepHours") != 3:
            raise ValueError("Invalid ECMWF source cadence")
        return ecmwf_ladder(manifest.get("stepRanges"))
    step = manifest.get("stepHours")
    if manifest.get("stepRanges") is not None:
        hours = ladder_hours(manifest["stepRanges"])
        if step != manifest["stepRanges"][0]["stepHours"]:
            raise ValueError("Declared step must match the first cadence range")
        return hours
    if step not in (1, 3, 6):
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
