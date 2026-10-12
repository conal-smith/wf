"""Tide at each scene's time for an area with no Irish gauge: EOT20, checked and calibrated.

EOT20 (Hart-Davis et al. 2021, DGFI-TUM; CC BY 4.0) is a global ocean-tide model
on a 1/8 degree grid, heights about mean sea level. pyTMD predicts from it with
nodal corrections and inferred minor constituents.

1. Howth: the model at the gauge against the gauge's observed levels at the
   Dublin scenes' times (obs = a + b * model), and against the Marine
   Institute's own prediction where we have it: how good the model is on this
   coast, before it is trusted where there is no gauge.
2. Killard Point: against the UK Hydrographic Office's published high and low
   waters for a week (heights above chart datum). Matching each extreme gives
   the timing error, and a fit gives the datum (MSL above chart datum) and an
   amplitude scale. Those are applied to the model at the scenes' times.
3. LAT from the calibrated model itself: the lowest level over 19 years, as a
   check on the datum fit.

    python -I tide_model.py --eot20 <dir with EOT20/ocean_tides> --s2 <s2 dir> --tide <tide dir> --out <dir>
"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyTMD.compute

HOWTH = (-6.06809, 53.391335)
# 3 km off Killard Point / Benderg, in water on EOT20's grid.
DOWN = (-5.495, 54.312)


def model(eot20, lon, lat, times):
    t = np.array([np.datetime64(x.replace(tzinfo=None), "s") for x in times])
    z = pyTMD.compute.tide_elevations(np.array([lon]), np.array([lat]), t, directory=str(eot20), model="EOT20",
                                      type="time series", standard="datetime", extrapolate=True, cutoff=40,
                                      crop=True, bounds=[lon % 360 - 1, lon % 360 + 1, lat - 1, lat + 1])
    return np.asarray(z, dtype=float).ravel()


def fit(x, y):
    b, a = np.polyfit(x, y, 1)
    resid = y - (a + b * x)
    return float(a), float(b), float(np.sqrt(np.mean(resid ** 2))), resid


def extremes(times, z):
    out = []
    for i in range(1, len(z) - 1):
        if z[i] >= z[i - 1] and z[i] > z[i + 1]:
            out.append((times[i], "H", z[i]))
        elif z[i] <= z[i - 1] and z[i] < z[i + 1]:
            out.append((times[i], "L", z[i]))
    return out


def scene_times(s2, area):
    meta = json.loads((s2 / area / "scenes.json").read_text())
    return [(s["stamp"], datetime.fromisoformat(s["datetime"].replace("Z", "+00:00")))
            for s in meta["scenes"] if s["status"] == "kept"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--eot20", required=True, type=Path)
    p.add_argument("--s2", required=True, type=Path)
    p.add_argument("--tide", required=True, type=Path, help="downloaded gauge levels and the UKHO events")
    p.add_argument("--mi-prediction", type=Path, help="a Marine Institute Howth curve (tides-Howth-*.json)")
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {}

    # 1. Howth: model against the gauge at the Dublin scenes.
    gauge = json.loads((args.tide / "dublin-howth.json").read_text())["levels"]
    dub = [(k, t) for k, t in scene_times(args.s2, "dublin") if gauge.get(k, {}).get("level") is not None]
    zh = model(args.eot20, *HOWTH, [t for _, t in dub])
    obs = np.array([gauge[k]["level"] for k, _ in dub])
    a, b, rmse, resid = fit(zh, obs)
    report["howth_vs_gauge"] = {"n": len(dub), "msl_above_lat": round(a, 3), "scale": round(b, 3),
                                "rmse": round(rmse, 3), "rmse_unscaled_offset_only": round(float(np.std(obs - zh)), 3),
                                "p95_abs_resid": round(float(np.percentile(np.abs(resid), 95)), 3)}
    print("Howth, EOT20 vs observed at scene times:", report["howth_vs_gauge"])

    if args.mi_prediction and args.mi_prediction.exists():
        mi = json.loads(args.mi_prediction.read_text())
        start = datetime.fromisoformat(mi["from"].replace("Z", "+00:00"))
        times = [start + timedelta(minutes=mi["stepMinutes"] * i) for i in range(len(mi["curve"]))]
        zm = model(args.eot20, *HOWTH, times)
        a2, b2, rmse2, _ = fit(zm, np.array(mi["curve"]))
        mi_ext = [(t, k, v) for t, k, v in extremes(times, np.array(mi["curve"]))]
        mo_ext = extremes(times, a2 + b2 * zm)
        dt = []
        for t, k, v in mi_ext:
            near = min((m for m in mo_ext if m[1] == k), key=lambda m: abs((m[0] - t).total_seconds()))
            dt.append((near[0] - t).total_seconds() / 60)
        report["howth_vs_mi_prediction"] = {"from": mi["from"], "to": mi["to"], "msl_above_lat": round(a2, 3),
                                            "scale": round(b2, 3), "rmse": round(rmse2, 3),
                                            "extreme_timing_minutes_median": round(float(np.median(dt)), 1)}
        print("Howth, EOT20 vs MI prediction:", report["howth_vs_mi_prediction"])

    # 2. Killard: model extremes against UKHO's.
    ev = json.loads((args.tide / "killard_ukho_events.json").read_text())["events"]
    bst = timezone(timedelta(hours=1))
    events = [(datetime.fromisoformat(t).replace(tzinfo=bst).astimezone(timezone.utc), k, h) for t, k, h in ev]
    t0 = events[0][0] - timedelta(hours=3)
    times = [t0 + timedelta(minutes=2 * i) for i in range(int((events[-1][0] - t0).total_seconds() / 120) + 120)]
    zk = model(args.eot20, *DOWN, times)
    mext = extremes(times, zk)
    pairs, dts = [], []
    for t, k, h in events:
        near = min((m for m in mext if m[1] == k), key=lambda m: abs((m[0] - t).total_seconds()))
        dts.append((near[0] - t).total_seconds() / 60)
        pairs.append((near[2], h))
    x, y = np.array([q[0] for q in pairs]), np.array([q[1] for q in pairs])
    ak, bk, rk, _ = fit(x, y)
    lag = float(np.median(dts))
    report["killard_vs_ukho"] = {"events": len(events), "model_minus_ukho_minutes_median": round(lag, 1),
                                 "model_minus_ukho_minutes_range": [round(min(dts), 1), round(max(dts), 1)],
                                 "msl_above_cd": round(ak, 3), "scale": round(bk, 3), "rmse_at_extremes": round(rk, 3),
                                 "raw_model_range_high_minus_low_mean": round(float(np.mean([m[2] for m in mext if m[1] == 'H']) - np.mean([m[2] for m in mext if m[1] == 'L'])), 3),
                                 "ukho_range_high_minus_low_mean": round(float(np.mean([e[2] for e in events if e[1] == 'H']) - np.mean([e[2] for e in events if e[1] == 'L'])), 3)}
    print("Killard, EOT20 vs UKHO extremes:", report["killard_vs_ukho"])

    # 3. LAT check: the calibrated model's lowest over 19 years (15-minute steps).
    base = datetime(2020, 1, 1, tzinfo=timezone.utc)
    long_t = [base + timedelta(minutes=15 * i) for i in range(int(19 * 365.25 * 96))]
    zl = ak + bk * model(args.eot20, *DOWN, long_t)
    report["killard_calibrated_19y"] = {"lowest": round(float(zl.min()), 3), "highest": round(float(zl.max()), 3),
                                        "p01": round(float(np.percentile(zl, 1)), 3), "mean": round(float(zl.mean()), 3)}
    print("Killard calibrated, 19 years:", report["killard_calibrated_19y"])
    zl_h = a + b * model(args.eot20, *HOWTH, long_t)
    report["howth_calibrated_19y"] = {"lowest": round(float(zl_h.min()), 3), "highest": round(float(zl_h.max()), 3)}
    print("Howth calibrated, 19 years:", report["howth_calibrated_19y"])

    # Scenes: Co. Down from the calibrated model, shifted by the timing error.
    down = scene_times(args.s2, "down")
    shift = timedelta(minutes=lag)
    z_now = ak + bk * model(args.eot20, *DOWN, [t + shift for _, t in down])
    z_next = ak + bk * model(args.eot20, *DOWN, [t + shift + timedelta(minutes=30) for _, t in down])
    z_prev = ak + bk * model(args.eot20, *DOWN, [t + shift - timedelta(minutes=30) for _, t in down])
    levels = {k: {"level": round(float(z), 3), "change1h": round(float(n - pv), 3)}
              for (k, _), z, n, pv in zip(down, z_now, z_next, z_prev)}
    (args.out / "down-tide.json").write_text(json.dumps({
        "method": "EOT20 at %.3f,%.3f, timing shifted %.0f min and scaled to UKHO's Killard Point extremes" % (DOWN[0], DOWN[1], lag),
        "datum": "chart datum (about LAT)", "calibration": report, "levels": levels}, indent=1))
    # Dublin scenes from the model as well, to compare with the gauge.
    zd = a + b * model(args.eot20, *HOWTH, [t for _, t in scene_times(args.s2, "dublin")])
    (args.out / "dublin-eot20.json").write_text(json.dumps({k: round(float(z), 3) for (k, _), z in zip(scene_times(args.s2, "dublin"), zd)}))
    (args.out / "tide-calibration.json").write_text(json.dumps(report, indent=1))
    zz = np.array([v["level"] for v in levels.values()])
    print(f"Co. Down scenes: {len(zz)}, tide {zz.min():.2f}..{zz.max():.2f} m CD")


if __name__ == "__main__":
    main()
