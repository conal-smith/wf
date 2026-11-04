"""The hours the site rates its stars from, in Python, so the verification can score them.

The hours riders see are worked out in TypeScript: `placeConsensus` (src/ratings.ts)
under the rule in force5/src/lead.ts. Verifying "the blend" means verifying *that*
arithmetic, so this is a line-by-line replica of it and nothing more. Since the
ruling of 19 October 2026 the stars come from one model, never a blend of several:
each hour is the first of two models that reaches it, its own wind, gust and
bearing — HARMONIE, then ECMWF where HARMONIE's run ends (`STARS_FROM`), or the two
a rider chooses — and nothing where neither does. Since the ruling of 4 November
2026 a rider may choose the blend instead (`BLEND_MODEL`): each hour the weighted
blend of every model that reaches it (force5/src/windBlend.ts, `blend_hour`). The gust is that model's too, and
none where it gives none. Each model is put on the axis the TypeScript way: linear
in u and v between its own steps, never across a gap wider than twice its typical
step, and never past either end of its run. The models' agreement, which the site
shows beside the stars as context, is not replicated: it is not scored.

It even keeps JavaScript's coercions where they matter: a null u or v counts as
zero, as `Math.hypot(null, v)` and a Float64Array store do, while a null gust is
NaN and is left out. A series with no finite point at all is a model that does not
cover the place, and is left out entirely, as `spotSeries` does.

The two are held together by a fixture, force5/ingest/fixtures/blend-consensus.json:
force5/src/consensusReplica.test.ts checks that the TypeScript produces its
`expected` values, for each choice of models it lists, and test_consensus.py checks
that this does. Change the TypeScript and the vitest test fails first; regenerate
the fixture with `npx tsx force5/blend/consensus-fixture.ts` and this module's test
then fails until the replica agrees again.
"""
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import math

# force5/src/lead.ts `BLEND_MODEL`: the choice that is no model, but the blend of
# every model in `STARS_MODELS` (force5/src/windBlend.ts `blendHour`). Its pair is
# ("blend", "blend"): it reaches as far as any model, so hands over to nothing.
BLEND_MODEL = "blend"
# force5/src/lead.ts `STARS_MODELS`: every published deterministic wind model, in
# catalogue order, the blend's members and the order it sums them in.
STARS_MODELS = ("harmonie", "icon-eu", "ecmwf", "gfs")
# force5/src/weights.ts `MODEL_WEIGHTS`: each judged model's weight on day 0, 1, 2
# and 3 on of its run.
MODEL_WEIGHTS = {
    "harmonie": (4, 4, 4, 4),
    "arome": (2, 1, 1, 1),
    "icon-eu": (2, 1, 1, 1),
    "gfs": (2, 2, 1, 1),
    "gefs": (1, 1, 1, 1),
    "ecmwf-ens": (1, 1, 1.5, 1.5),
    "aifs": (0.5, 1, 1.5, 1.5),
    "ecmwf": (0.5, 0.5, 0.5, 0.5),
    "arpege": (0.5, 0.5, 0.5, 0.5),
}
# force5/src/lead.ts `DEFAULT_STARS_FROM`: the model each hour's stars come from
# wherever it reaches the hour, and the one that takes over where its run ends.
STARS_FROM = ("harmonie", "ecmwf")
# The rule's own name, for the verification's signature: changes when the rule does.
RULE = "one-model-2026-10-19"
# force5/src/manifests.ts `windModels()`: every wind model that is neither planned
# nor retired, in catalogue order. The published blend reads every one the bucket
# serves.
BLEND_MODELS = ("harmonie", "icon-eu", "ecmwf", "gfs")
HOUR_MS = 3_600_000
NAN = float("nan")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


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


def blend_weight(resolution_km):
    """weights.ts `blendWeight`: an unjudged model's weight by its grid."""
    if not finite(resolution_km):
        return 1
    if resolution_km <= 3:
        return 3
    if resolution_km <= 8:
        return 2
    return 1


def lead_day(lead_hours):
    """weights.ts `leadDay`: 0 for the first 24 hours (or no lead), 3 from day 3."""
    if not (finite(lead_hours) and lead_hours >= 24):
        return 0
    if lead_hours < 48:
        return 1
    if lead_hours < 72:
        return 2
    return 3


def model_weight(model, lead_hours, resolution_km=None):
    """weights.ts `modelWeight`."""
    row = MODEL_WEIGHTS.get(model)
    return row[lead_day(lead_hours)] if row else blend_weight(resolution_km)


def blend_hour(members):
    """windBlend.ts `blendHour`: weighted means of speed, gust (of the models that
    give one) and the wind's vector, summed in the members' order. Each member is a
    dict with model, speed, gust (None for none), u, v, lead_hours, resolution_km."""
    if not members:
        return None
    weights = [max(0, model_weight(m["model"], m["lead_hours"], m.get("resolution_km")))
               for m in members]
    total = 0
    for w in weights:
        total += w

    def weight_of(i):
        return weights[i] if total > 0 else 1

    def mean(key, only=None):
        value = 0.0
        weight = 0
        for i, m in enumerate(members):
            if only is not None and not only[i]:
                continue
            value += m[key] * weight_of(i)
            weight += weight_of(i)
        return value / weight if weight > 0 else None

    gusty = [m["gust"] is not None and finite(m["gust"]) for m in members]
    return {
        "speed": mean("speed"),
        "gust": mean("gust", gusty) if any(gusty) else None,
        "u": mean("u"),
        "v": mean("v"),
    }


def lead_models(stars_from):
    """lead.ts `leadModels`: the models an hour is worked out from."""
    return list(STARS_MODELS) if stars_from[0] == BLEND_MODEL else lead_order(stars_from)


def lead_order(stars_from):
    """lead.ts `leadOrder`: the chosen model, then its fallback, once each."""
    model, then = stars_from
    return [model] if then == model else [model, then]


def place_consensus(manifests, blend_ids, spot, axis, stars_from=STARS_FROM):
    """ratings.ts `placeConsensus` without the agreement: wind, gust, bearing and model.

    `manifests` are dicts shaped like the published wind manifests with their
    spot squares merged back in (squares.with_spot_data); only `model` and
    `spotForecasts` are read. verify.py builds them from the archive instead.
    `axis` is a list of ISO times; `stars_from` the (model, then) pair. Speeds
    come back in m/s, and None where neither model reaches the hour. `blend_ids`
    are the models the site's agreement reads; the hours themselves never
    depend on them.
    """
    del blend_ids  # Only the agreement reads them, and it is not replicated.
    axis_times = [parse_ms(value) for value in axis]
    own = {}
    for model in lead_models(stars_from):
        manifest = next((m for m in manifests if m.get("model") == model), None)
        mean = spot_series(manifest, spot) if manifest is not None else None
        if mean is None:
            continue
        plan = plan_for([parse_ms(point["validTime"]) for point in mean], axis_times)
        speed, gust = line_on(mean, plan)
        u, v = vector_on(mean, plan)
        resolution = manifest.get("resolutionKm")
        own[model] = {"speed": speed, "gust": gust, "u": u, "v": v,
                      "run": parse_ms(manifest["runTime"]),
                      "resolution_km": resolution if finite(resolution) else None}
    out = {"median": [], "gust": [], "from": [], "model": []}
    blended = stars_from[0] == BLEND_MODEL
    for c in range(len(axis_times)):
        if blended:
            members = [{"model": model, "speed": line["speed"][c],
                        "gust": line["gust"][c] if math.isfinite(line["gust"][c]) else None,
                        "u": line["u"][c], "v": line["v"][c],
                        "lead_hours": (axis_times[c] - line["run"]) / HOUR_MS,
                        "resolution_km": line["resolution_km"]}
                       for model, line in own.items() if math.isfinite(line["speed"][c])]
            b = blend_hour(members)
            out["model"].append(BLEND_MODEL if b else None)
            out["median"].append(b["speed"] if b else None)
            out["gust"].append(b["gust"] if b else None)
            out["from"].append(direction(b["u"], b["v"]) if b and math.isfinite(b["u"])
                               and math.isfinite(b["v"]) and math.hypot(b["u"], b["v"]) >= 0.1
                               else None)
            continue
        model = next((m for m in lead_order(stars_from)
                      if m in own and math.isfinite(own[m]["speed"][c])), None)
        out["model"].append(model)
        if model is None:
            out["median"].append(None)
            out["gust"].append(None)
            out["from"].append(None)
            continue
        line = own[model]
        out["median"].append(line["speed"][c])
        out["gust"].append(line["gust"][c] if math.isfinite(line["gust"][c]) else None)
        u, v = line["u"][c], line["v"][c]
        out["from"].append(direction(u, v) if math.isfinite(u) and math.isfinite(v)
                           and math.hypot(u, v) >= 0.1 else None)
    return out
