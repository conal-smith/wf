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
    return tuple(range(0, len(manifest["frames"]) * step, step))
