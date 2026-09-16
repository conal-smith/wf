"""Explicit source timesteps: no temporal interpolation or invented hours."""

ECMWF_HOURS = tuple(range(0, 145, 3)) + tuple(range(150, 361, 6))
ECMWF_RANGES = [{"throughHour": 144, "stepHours": 3},
                {"throughHour": 360, "stepHours": 6}]


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


def expected_hours(manifest):
    if manifest["model"] == "ecmwf":
        if manifest.get("stepHours") != 3 or manifest.get("stepRanges") != ECMWF_RANGES:
            raise ValueError("Invalid ECMWF source cadence")
        return ECMWF_HOURS
    step = manifest.get("stepHours")
    if manifest.get("stepRanges") is not None:
        hours = ladder_hours(manifest["stepRanges"])
        if step != manifest["stepRanges"][0]["stepHours"]:
            raise ValueError("Declared step must match the first cadence range")
        return hours
    if step not in (1, 3, 6):
        raise ValueError("Unsupported source cadence")
    return tuple(range(0, len(manifest["frames"]) * step, step))
