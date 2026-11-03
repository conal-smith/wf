"""The riding window: when a fresh wind forecast is worth fetching.

A forecast job given `--daylight-only` (worker.py) runs only between
`LEAD_BEFORE_FIRST_LIGHT` before civil first light and civil last light over
Ireland, and otherwise exits at once, downloading nothing. The lead is there so
the run fetched before dawn has landed by first light: HARMONIE's import takes
minutes, but a run is only listed complete about 2 h 25 m after its run time, so
a slot then takes a run already that old.

Everything here is in UTC, like the timetable (deploy/local/jobs.toml). The
window follows the season by itself: in early November it is about 04:25 to
17:40 UTC, in late June about 00:40 to 21:55 UTC, and nothing jumps when the
clocks change, because the sun does not.

`always_hours` are UTC hours whose slot runs whatever the light: the evening
run riders read to plan tomorrow, and the early one that must be there before
the morning commute however late winter's first light is.

The sun's position is the NOAA low-precision form of Meeus's equations, a
minute or better at Irish latitudes, mirrored from force5/src/sun.ts (which the
site uses for its night shading), so the two agree. Standard library only: the
worker imports it before anything else, so a gated slot costs nothing.
"""
from datetime import datetime, timedelta, timezone
import math

# The middle of Ireland. Across the island civil twilight moves by about 25
# minutes east to west and less north to south, well inside the lead.
CENTRE = (53.4, -8.0)
# Civil twilight: the sun 6° below the horizon, light enough to rig and ride.
CIVIL_ZENITH = 96.0
# How long before first light the window opens.
LEAD_BEFORE_FIRST_LIGHT = timedelta(hours=2, minutes=30)


def _solar_position(julian):
    """Sun declination (degrees) and equation of time (minutes) at a Julian day."""
    t = (julian - 2451545) / 36525
    mean_long = (280.46646 + t * (36000.76983 + t * 0.0003032) + 360000) % 360
    anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    centre = (math.sin(math.radians(anomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t))
              + math.sin(math.radians(2 * anomaly)) * (0.019993 - 0.000101 * t)
              + math.sin(math.radians(3 * anomaly)) * 0.000289)
    apparent_long = (mean_long + centre - 0.00569
                     - 0.00478 * math.sin(math.radians(125.04 - 1934.136 * t)))
    mean_obliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    obliquity = mean_obliquity + 0.00256 * math.cos(math.radians(125.04 - 1934.136 * t))
    declination = math.degrees(math.asin(math.sin(math.radians(obliquity))
                                         * math.sin(math.radians(apparent_long))))
    y = math.tan(math.radians(obliquity / 2)) ** 2
    long2, anomaly_r = 2 * math.radians(mean_long), math.radians(anomaly)
    equation = 4 * math.degrees(
        y * math.sin(long2) - 2 * eccentricity * math.sin(anomaly_r)
        + 4 * eccentricity * y * math.sin(anomaly_r) * math.cos(long2)
        - 0.5 * y * y * math.sin(2 * long2)
        - 1.25 * eccentricity * eccentricity * math.sin(2 * anomaly_r))
    return declination, equation


def civil_twilight(day, latitude=CENTRE[0], longitude=CENTRE[1]):
    """(first light, last light) in UTC for the UTC calendar day of `day`.

    Raises ValueError where the sun never reaches 6° below the horizon that
    day, which does not happen anywhere in Ireland.
    """
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    # The sun's position near local solar noon, where the series is most
    # accurate for both ends of the day (as sun.ts).
    julian_noon = start.timestamp() / 86400 + 2440587.5 + 0.5 - longitude / 360
    declination, equation = _solar_position(julian_noon)
    noon = 720 - 4 * longitude - equation
    cos_angle = (math.cos(math.radians(CIVIL_ZENITH))
                 / (math.cos(math.radians(latitude)) * math.cos(math.radians(declination)))
                 - math.tan(math.radians(latitude)) * math.tan(math.radians(declination)))
    if not -1 <= cos_angle <= 1:
        raise ValueError(f"No civil twilight at {latitude}, {longitude} on {start.date()}")
    angle = math.degrees(math.acos(cos_angle))
    return (start + timedelta(minutes=noon - 4 * angle),
            start + timedelta(minutes=noon + 4 * angle))


def riding_window(moment):
    """(opens, closes): the gate's window on the UTC day of `moment`."""
    first, last = civil_twilight(moment)
    return first - LEAD_BEFORE_FIRST_LIGHT, last


def gate(moment, always_hours=()):
    """Whether a `--daylight-only` slot at `moment` runs, and the line it logs.

    Returns (runs, details); details name the reason and the day's window, so a
    skipped slot's log says why at a glance.
    """
    if moment.tzinfo is None:
        raise ValueError("gate() needs an aware datetime")
    moment = moment.astimezone(timezone.utc)
    opens, closes = riding_window(moment)
    window = {"opens": opens.isoformat(timespec="minutes"),
              "closes": closes.isoformat(timespec="minutes")}
    if moment.hour in always_hours:
        return True, {"reason": "always", "window": window}
    if opens <= moment <= closes:
        return True, {"reason": "daylight", "window": window}
    when = "before the riding window" if moment < opens else "after dark"
    return False, {"reason": "dark", "window": window,
                   "message": f"Skipped {when}: today's window is "
                              f"{opens:%H:%M} to {closes:%H:%M} UTC, so nothing was fetched"}


def hours_list(value):
    """argparse type for `--always-hours 5,19`: whole UTC hours, comma-separated."""
    try:
        hours = sorted({int(item) for item in value.split(",") if item.strip()})
    except ValueError:
        raise ValueError(f"Expected UTC hours like 5,19, got {value!r}") from None
    if not hours or not all(0 <= hour < 24 for hour in hours):
        raise ValueError(f"Expected UTC hours between 0 and 23, got {value!r}")
    return tuple(hours)


def slot_runs(args, moment):
    """Whether a worker job with these jobs.toml `args` would fetch at `moment`.

    For the timetable's tests and docs, which reason about the slots that run
    rather than the slots written down. Mirrors worker.py's two arguments.
    """
    if "--daylight-only" not in args:
        return True
    always = ()
    if "--always-hours" in args:
        always = hours_list(args[args.index("--always-hours") + 1])
    return gate(moment, always)[0]
