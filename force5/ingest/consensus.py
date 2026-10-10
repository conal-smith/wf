"""The site's wind blend, in Python, so the verification can score it.

The blend riders see is worked out in TypeScript: `blendWeight` and
`weightedMedian` (force5/src/weights.ts) and `placeConsensus` (src/ratings.ts).
Verifying "the blend" means verifying *that* arithmetic, so this is a line-by-line
replica of it and nothing more: each model taken once at its grid's weight (3 for
a grid of 3 km or finer, 2 up to 8 km, else 1), an ensemble's members collapsed
to their hourly mean speed, the weighted median of the speeds and of the gusts,
and the weighted mean of the models' mean wind vectors for the bearing. Every
model is put on the axis the TypeScript way too: linear in u and v between its
own steps, never across a gap wider than twice its typical step, and never past
either end of its run.

It even keeps JavaScript's coercions where they matter: a null u or v counts as
zero, as `Math.hypot(null, v)` and a Float64Array store do, while a null gust is
NaN and is left out. A series with no finite point at all is a model that does not
cover the place, and is left out entirely, as `spotSeries` does.

The two are held together by a fixture, force5/ingest/fixtures/blend-consensus.json:
force5/src/consensusReplica.test.ts checks that the TypeScript produces its
`expected` values, and test_consensus.py checks that this does. Change the
TypeScript and the vitest test fails first; regenerate the fixture with
`npx tsx force5/blend/consensus-fixture.ts` and this module's test then fails
until the replica agrees again.
"""
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import math

# force5/src/weights.ts
FINE_GRID_KM = 3
REGIONAL_GRID_KM = 8
# force5/src/manifests.ts `windModels()`: every wind model that is not planned, in
# catalogue order. The published blend reads every one the bucket serves.
BLEND_MODELS = ("harmonie", "icon-eu", "ecmwf", "gfs", "ecmwf-ens", "gefs", "arpege",
                "arome", "aifs")
HOUR_MS = 3_600_000
NAN = float("nan")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def blend_weight(resolution_km):
    """weights.ts `blendWeight`: 3 at 3 km or finer, 2 up to 8 km, else 1."""
    if isinstance(resolution_km, bool) or not isinstance(resolution_km, (int, float)) \
            or not math.isfinite(resolution_km):
        return 1
    if resolution_km <= FINE_GRID_KM:
        return 3
    if resolution_km <= REGIONAL_GRID_KM:
        return 2
    return 1


def weighted_median(values, weights):
    """weights.ts `weightedMedian`: the value at half the total weight."""
    order = sorted(({"value": value, "weight": weights[i] if i < len(weights) else 1}
                    for i, value in enumerate(values)), key=lambda item: item["value"])
    half = 0
    for item in order:
        half += item["weight"]
    half /= 2
    below = 0
    for i, item in enumerate(order):
        below += item["weight"]
        if abs(below - half) < 1e-9 and i + 1 < len(order):
            return (item["value"] + order[i + 1]["value"]) / 2
        if below > half:
            return item["value"]
    return order[-1]["value"]


def direction(u, v):
    """weather.ts `direction`: where the wind blows from, in degrees."""
    return math.fmod((math.atan2(-u, -v) * 180) / math.pi + 360, 360)


@lru_cache(maxsize=1 << 16)
def parse_ms(value):
    """`Date.parse` of an ISO time, in whole milliseconds. Cached: verification
    rebuilds the blend thousands of times over the same few hundred times."""
    at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return (at - EPOCH) // timedelta(milliseconds=1)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def js_number(value):
    """What JavaScript arithmetic makes of a series value: null is 0, absent is NaN."""
    if value is None:
        return 0.0
    return float(value) if finite(value) else NAN


def median_step(at):
    steps = sorted((at[i] - at[i - 1]) / HOUR_MS for i in range(1, len(at)))
    return steps[(len(steps) - 1) // 2] if steps else 0


def plan_for(at, axis):
    """ratings.ts `planFor`: (index, fraction) per axis time, index -1 where none."""
    max_gap = 2 * median_step(at)
    plan = []
    for time in axis:
        if not at or not finite(time) or time < at[0] or time > at[-1]:
            plan.append((-1, 0.0))
            continue
        if time == at[-1]:
            plan.append((len(at) - 1, 0.0))
            continue
        right = bisect_right(at, time)
        if right < 1:
            plan.append((-1, 0.0))
            continue
        left = right - 1
        fraction = (time - at[left]) / (at[right] - at[left])
        if fraction != 0 and (at[right] - at[left]) / HOUR_MS > max_gap + 1e-9:
            plan.append((-1, 0.0))
            continue
        plan.append((left, fraction))
    return plan


def gust_value(point):
    gust = point.get("gust")
    return float(gust) if finite(gust) else NAN


def line_on(points, plan):
    """ratings.ts `lineOn`: one series' speed and gust on the axis, NaN for none."""
    speeds, gusts = [], []
    for index, fraction in plan:
        if index < 0:
            speeds.append(NAN)
            gusts.append(NAN)
            continue
        a = points[index]
        if fraction == 0:
            speeds.append(math.hypot(js_number(a.get("u")), js_number(a.get("v"))))
            gusts.append(gust_value(a))
            continue
        b = points[index + 1]
        au, av, bu, bv = (js_number(a.get("u")), js_number(a.get("v")),
                          js_number(b.get("u")), js_number(b.get("v")))
        speeds.append(math.hypot(au + (bu - au) * fraction, av + (bv - av) * fraction))
        ga, gb = a.get("gust"), b.get("gust")
        gusts.append(NAN if ga is None or gb is None
                     else js_number(ga) + (js_number(gb) - js_number(ga)) * fraction)
    return speeds, gusts


def vector_on(points, plan):
    """The mean series' u and v on the axis, as `placeConsensus` builds its arrows."""
    us, vs = [], []
    for index, fraction in plan:
        if index < 0:
            us.append(NAN)
            vs.append(NAN)
            continue
        a = points[index]
        au, av = js_number(a.get("u")), js_number(a.get("v"))
        if fraction == 0:
            us.append(au)
            vs.append(av)
            continue
        b = points[index + 1]
        bu, bv = js_number(b.get("u")), js_number(b.get("v"))
        us.append(au + (bu - au) * fraction)
        vs.append(av + (bv - av) * fraction)
    return us, vs


def spot_series(manifest, spot):
    """series.ts `spotSeries`: the series, or None when no point has a finite u and v."""
    series = (manifest.get("spotForecasts") or {}).get(spot)
    if isinstance(series, list) and series and any(
            finite(point.get("u")) and finite(point.get("v")) for point in series):
        return series
    return None


def member_lines(manifest, spot):
    """series.ts `memberSeries`, as point lists, or None for a deterministic model."""
    frames = (manifest.get("spotMembers") or {}).get(spot)
    ensemble = manifest.get("ensemble")
    if not ensemble or not isinstance(frames, list) or not frames:
        return None

    def pick(values, member):
        return values[member] if isinstance(values, list) and member < len(values) else NAN

    return [[{"validTime": frame["validTime"], "u": pick(frame.get("u"), member),
              "v": pick(frame.get("v"), member), "gust": pick(frame.get("gust"), member)}
             for frame in frames] for member in range(ensemble["members"])]


def place_consensus(manifests, blend_ids, spot, axis):
    """ratings.ts `placeConsensus` without the agreement: median, gust and bearing.

    `manifests` are dicts shaped like the published wind manifests (only `model`,
    `resolutionKm`, `spotForecasts`, and for an ensemble `ensemble`/`spotMembers`,
    are read); `axis` is a list of ISO times. Speeds come back in m/s, and None
    where no model has a value.
    """
    axis_times = [parse_ms(value) for value in axis]
    count = len(axis_times)
    lines, vectors = [], []
    for blend_id in blend_ids:
        manifest = next((m for m in manifests if m.get("model") == blend_id), None)
        if manifest is None:
            continue
        mean = spot_series(manifest, spot)
        if mean is None:
            continue
        weight = blend_weight(manifest.get("resolutionKm"))
        members = member_lines(manifest, spot)
        for points in (members if members is not None else [mean]):
            plan = plan_for([parse_ms(point["validTime"]) for point in points], axis_times)
            speed, gust = line_on(points, plan)
            lines.append({"model": manifest["model"], "member": members is not None,
                          "weight": weight, "speed": speed, "gust": gust})
        plan = plan_for([parse_ms(point["validTime"]) for point in mean], axis_times)
        u, v = vector_on(mean, plan)
        vectors.append({"u": u, "v": v, "weight": weight})
    # `perModelLines`: an ensemble's members collapse to their hourly mean.
    per_model, groups = [], {}
    for line in lines:
        if not line["member"]:
            per_model.append(line)
        else:
            groups.setdefault(line["model"], []).append(line)
    for group in groups.values():
        if len(group) == 1:
            per_model.append(group[0])
            continue
        speed, gust = [], []
        for c in range(count):
            speeds = [line["speed"][c] for line in group if math.isfinite(line["speed"][c])]
            gusts = [line["gust"][c] for line in group if math.isfinite(line["gust"][c])]
            speed.append(sum_js(speeds) / len(speeds) if speeds else NAN)
            gust.append(sum_js(gusts) / len(gusts) if gusts else NAN)
        per_model.append({"weight": group[0]["weight"], "speed": speed, "gust": gust})
    out = {"median": [], "gust": [], "from": []}
    for c in range(count):
        speeds, speed_weights, gusts, gust_weights = [], [], [], []
        for line in per_model:
            if math.isfinite(line["speed"][c]):
                speeds.append(line["speed"][c])
                speed_weights.append(line["weight"])
            if math.isfinite(line["gust"][c]):
                gusts.append(line["gust"][c])
                gust_weights.append(line["weight"])
        out["gust"].append(weighted_median(gusts, gust_weights) if gusts else None)
        out["median"].append(weighted_median(speeds, speed_weights) if speeds else None)
        u = v = k = 0
        for vector in vectors:
            if math.isfinite(vector["u"][c]) and math.isfinite(vector["v"][c]):
                u += vector["u"][c] * vector["weight"]
                v += vector["v"][c] * vector["weight"]
                k += vector["weight"]
        out["from"].append(direction(u / k, v / k)
                           if k and math.hypot(u / k, v / k) >= 0.1 else None)
    return out


def sum_js(values):
    """Left-to-right addition from zero, as the TypeScript loop does it."""
    total = 0
    for value in values:
        total += value
    return total
