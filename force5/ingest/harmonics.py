"""Harmonic tide prediction and analysis in plain numpy.

A tide is the sum of constituents, each a cosine at an astronomical speed:

    h(t) = Z0 + sum_k f_k(t) H_k cos(V_k(t) + u_k(t) - g_k)

with H and g the constituent's amplitude (metres) and Greenwich phase lag
(degrees), V its equilibrium argument from Doodson's numbers and the mean
longitudes of the Moon, Sun, lunar perigee, lunar node and solar perigee
(Meeus's polynomials), and f and u the nodal corrections for the 18.6-year
cycle of the lunar node (Schureman's formulas as tabulated by Pugh & Woodworth,
"Sea-Level Science", 2014). Shallow-water and compound constituents take the
products of their parents' corrections. L2 is two lines (L2 and L2B, as pyTMD
has it) rather than one with a perigee-dependent correction. The phase offsets
are those of the published global models: fitted to EOT20's own predictions
(pyTMD, with its minor-constituent inference) over two years, this reproduces
EOT20's amplitudes and Greenwich phases to 0.1 mm and 0.2 degrees for M2, S2,
N2, K1, O1, P1, Q1, SA and SSA, and its series to 1.2 mm RMS.

`analyse` fits H and g to a level series by least squares with the same V, f
and u that `predict` uses, so a fit and its prediction agree by construction.
A short record cannot separate constituents closer in speed than one cycle over
its length (S2 and K2, K1 and P1 need six months); those are *inferred*: tied
to a parent by an amplitude ratio and phase difference taken from a reference
(here the EOT20 model at the same place), as is standard practice for a
29-day analysis. Long-period constituents can be held fixed from a reference.

No dependency beyond numpy: this runs inside the tide ingest.
"""
import numpy as np

# name: (Doodson numbers on tau, s, h, p, N', p1; phase offset in degrees; nodal type)
CONSTITUENTS = {
    "SA": ((0, 0, 1, 0, 0, -1), 0, None),
    "SSA": ((0, 0, 2, 0, 0, 0), 0, None),
    "MM": ((0, 1, 0, -1, 0, 0), 0, "MM"),
    "MSF": ((0, 2, -2, 0, 0, 0), 0, "MSF"),
    "MF": ((0, 2, 0, 0, 0, 0), 0, "MF"),
    "2Q1": ((1, -3, 0, 2, 0, 0), 90, "O1"),
    "SIGMA1": ((1, -3, 2, 0, 0, 0), 90, "O1"),
    "Q1": ((1, -2, 0, 1, 0, 0), 90, "O1"),
    "RHO1": ((1, -2, 2, -1, 0, 0), 90, "O1"),
    "O1": ((1, -1, 0, 0, 0, 0), 90, "O1"),
    "M1": ((1, 0, 0, 1, 0, 0), 90, "M1"),
    "CHI1": ((1, 0, 2, -1, 0, 0), 90, "J1"),
    "PI1": ((1, 1, -3, 0, 0, 1), 90, None),
    "P1": ((1, 1, -2, 0, 0, 0), 90, None),
    "S1": ((1, 1, -1, 0, 0, 0), 0, None),
    "K1": ((1, 1, 0, 0, 0, 0), -90, "K1"),
    "PSI1": ((1, 1, 1, 0, 0, -1), -90, None),
    "PHI1": ((1, 1, 2, 0, 0, 0), -90, None),
    "THETA1": ((1, 2, -2, 1, 0, 0), -90, "J1"),
    "J1": ((1, 2, 0, -1, 0, 0), -90, "J1"),
    "OO1": ((1, 3, 0, 0, 0, 0), -90, "OO1"),
    "EPS2": ((2, -3, 2, 1, 0, 0), 0, "M2"),
    "2N2": ((2, -2, 0, 2, 0, 0), 0, "M2"),
    "MU2": ((2, -2, 2, 0, 0, 0), 0, "M2"),
    "N2": ((2, -1, 0, 1, 0, 0), 0, "M2"),
    "NU2": ((2, -1, 2, -1, 0, 0), 0, "M2"),
    "M2": ((2, 0, 0, 0, 0, 0), 0, "M2"),
    "LAMBDA2": ((2, 1, -2, 1, 0, 0), 180, "M2"),
    "L2": ((2, 1, 0, -1, 0, 0), 180, "M2"),
    "L2B": ((2, 1, 0, 1, 0, 0), 0, "M2"),
    "T2": ((2, 2, -3, 0, 0, 1), 0, None),
    "S2": ((2, 2, -2, 0, 0, 0), 0, None),
    "R2": ((2, 2, -1, 0, 0, -1), 180, None),
    "K2": ((2, 2, 0, 0, 0, 0), 0, "K2"),
    "ETA2": ((2, 3, 0, -1, 0, 0), 0, "K2"),
    "MO3": ((3, -1, 0, 0, 0, 0), 90, "M2*O1"),
    "M3": ((3, 0, 0, 0, 0, 0), 0, "M3"),
    "MK3": ((3, 1, 0, 0, 0, 0), -90, "M2*K1"),
    "SK3": ((3, 3, -2, 0, 0, 0), -90, "K1"),
    "MN4": ((4, -1, 0, 1, 0, 0), 0, "M2^2"),
    "M4": ((4, 0, 0, 0, 0, 0), 0, "M2^2"),
    "MS4": ((4, 2, -2, 0, 0, 0), 0, "M2"),
    "MK4": ((4, 2, 0, 0, 0, 0), 0, "M2*K2"),
    "S4": ((4, 4, -4, 0, 0, 0), 0, None),
    "2MN6": ((6, -1, 0, 1, 0, 0), 0, "M2^3"),
    "M6": ((6, 0, 0, 0, 0, 0), 0, "M2^3"),
    "2MS6": ((6, 2, -2, 0, 0, 0), 0, "M2^2"),
    "2SM6": ((6, 4, -4, 0, 0, 0), 0, "M2"),
    "M8": ((8, 0, 0, 0, 0, 0), 0, "M2^4"),
}

def _astro(epoch_seconds):
    """tau, s, h, p, N' and p1 in degrees at each time (UT seconds since 1970)."""
    t = np.asarray(epoch_seconds, dtype=np.float64)
    T = (t / 86400.0 + 2440587.5 - 2451545.0) / 36525.0
    s = 218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2
    h = 280.46646 + 36000.76983 * T + 0.0003032 * T ** 2
    p = 83.3532465 + 4069.0137287 * T - 0.0103200 * T ** 2
    N = 125.04452 - 1934.136261 * T + 0.0020708 * T ** 2
    p1 = 282.93735 + 1.71946 * T + 0.00046 * T ** 2
    hours = np.mod(t, 86400.0) / 3600.0
    tau = 180.0 + 15.0 * hours + h - s  # lunar time: the mean sun's hour angle, plus h - s
    return tau, s, h, p, -N, p1


def speed(name):
    """Degrees per hour."""
    d = np.array(CONSTITUENTS[name][0], dtype=float)
    per_hour = np.array([15.0 + (36000.76983 - 481267.88123421) / (36525 * 24),
                         481267.88123421 / (36525 * 24), 36000.76983 / (36525 * 24),
                         4069.0137287 / (36525 * 24), 1934.136261 / (36525 * 24), 1.71946 / (36525 * 24)])
    return float(d @ per_hour)


def _nodal(kind, N, p):
    """f (factor) and u (degrees) for one nodal type; N, p in degrees."""
    n = np.radians(N)
    if kind is None:
        return np.ones_like(n), np.zeros_like(n)
    if kind == "M2":
        return (1.0004 - 0.0373 * np.cos(n) + 0.0002 * np.cos(2 * n),
                -2.14 * np.sin(n))
    if kind == "O1":
        return (1.0089 + 0.1871 * np.cos(n) - 0.0147 * np.cos(2 * n) + 0.0014 * np.cos(3 * n),
                10.80 * np.sin(n) - 1.34 * np.sin(2 * n) + 0.19 * np.sin(3 * n))
    if kind == "K1":
        return (1.0060 + 0.1150 * np.cos(n) - 0.0088 * np.cos(2 * n) + 0.0006 * np.cos(3 * n),
                -8.86 * np.sin(n) + 0.68 * np.sin(2 * n) - 0.07 * np.sin(3 * n))
    if kind == "K2":
        return (1.0241 + 0.2863 * np.cos(n) + 0.0083 * np.cos(2 * n) - 0.0015 * np.cos(3 * n),
                -17.74 * np.sin(n) + 0.68 * np.sin(2 * n) - 0.04 * np.sin(3 * n))
    if kind == "J1":
        return (1.1029 + 0.1676 * np.cos(n) - 0.0170 * np.cos(2 * n) + 0.0016 * np.cos(3 * n),
                -12.94 * np.sin(n) + 1.34 * np.sin(2 * n) - 0.19 * np.sin(3 * n))
    if kind == "OO1":
        return (1.1027 + 0.6504 * np.cos(n) + 0.0317 * np.cos(2 * n) - 0.0014 * np.cos(3 * n),
                -36.68 * np.sin(n) + 4.02 * np.sin(2 * n) - 0.57 * np.sin(3 * n))
    if kind == "MM":
        return 1.0000 - 0.1300 * np.cos(n) + 0.0013 * np.cos(2 * n), np.zeros_like(n)
    if kind == "MF":
        return (1.0429 + 0.4135 * np.cos(n) - 0.0040 * np.cos(2 * n),
                -23.74 * np.sin(n) + 2.68 * np.sin(2 * n) - 0.38 * np.sin(3 * n))
    if kind == "M1":
        q = np.radians(p)
        c = 2 * np.cos(q) + 0.4 * np.cos(q - n)
        s = np.sin(q) + 0.2 * np.sin(q - n)
        return np.hypot(c, s), np.degrees(np.arctan2(s, c))
    if kind == "MSF":
        f, u = _nodal("M2", N, p)
        return f, -u
    if kind == "M3":
        f, u = _nodal("M2", N, p)
        return f ** 1.5, 1.5 * u
    if "^" in kind:
        base, power = kind.split("^")
        f, u = _nodal(base, N, p)
        return f ** int(power), int(power) * u
    if "*" in kind:
        f, u = np.ones_like(n), np.zeros_like(n)
        for part in kind.split("*"):
            fp, up = _nodal(part, N, p)
            f, u = f * fp, u + up
        return f, u
    raise KeyError(kind)


def arguments(names, epoch_seconds):
    """(f, V + u in radians), each shaped (len(times), len(names))."""
    tau, s, h, p, Nprime, p1 = _astro(epoch_seconds)
    astro = np.stack([tau, s, h, p, Nprime, p1], axis=-1)
    N = -Nprime
    fs, args = [], []
    for name in names:
        doodson, offset, kind = CONSTITUENTS[name]
        V = astro @ np.array(doodson, dtype=float) + offset
        f, u = _nodal(kind, N, p)
        fs.append(f)
        args.append(np.radians(np.mod(V + u, 360.0)))
    return np.stack(fs, axis=-1), np.stack(args, axis=-1)


def predict(constituents, z0, epoch_seconds, chunk=200_000):
    """Level at each time: z0 + the constituents ({name: (amplitude m, phase deg)})."""
    t = np.asarray(epoch_seconds, dtype=np.float64).ravel()
    names = list(constituents)
    H = np.array([constituents[n][0] for n in names], dtype=float)
    g = np.radians([constituents[n][1] for n in names])
    out = np.empty(len(t))
    for i in range(0, len(t), chunk):
        f, arg = arguments(names, t[i:i + chunk])
        out[i:i + chunk] = z0 + (f * H * np.cos(arg - g)).sum(axis=1)
    return out


def analyse(epoch_seconds, levels, names, inferred=None, fixed=None):
    """Least-squares harmonic constants.

    names: constituents solved for.
    inferred: {child: (parent, ratio, phase_difference_deg)}: child = ratio x
      parent's amplitude at the parent's phase + difference; solved with it.
    fixed: {name: (amplitude, phase)} subtracted before the fit, kept as given.
    Returns ({name: (amplitude, phase)}, z0, residual array)."""
    t = np.asarray(epoch_seconds, dtype=np.float64)
    y = np.asarray(levels, dtype=np.float64).copy()
    inferred, fixed = dict(inferred or {}), dict(fixed or {})
    if fixed:
        y = y - predict(fixed, 0.0, t)
    columns = [np.ones(len(t))]
    f, arg = arguments(names, t)
    children = {}
    for child, (parent, ratio, diff) in inferred.items():
        children.setdefault(parent, []).append((child, ratio, diff))
    for j, name in enumerate(names):
        c, s = f[:, j] * np.cos(arg[:, j]), f[:, j] * np.sin(arg[:, j])
        for child, ratio, diff in children.get(name, []):
            fc, ac = arguments([child], t)
            shifted = ac[:, 0] - np.radians(diff)
            c = c + ratio * fc[:, 0] * np.cos(shifted)
            s = s + ratio * fc[:, 0] * np.sin(shifted)
        columns += [c, s]
    A = np.stack(columns, axis=1)
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    out = {}
    for j, name in enumerate(names):
        a, b = coef[1 + 2 * j], coef[2 + 2 * j]
        out[name] = (float(np.hypot(a, b)), float(np.degrees(np.arctan2(b, a)) % 360.0))
    for child, (parent, ratio, diff) in inferred.items():
        amplitude, phase = out[parent]
        out[child] = (amplitude * ratio, (phase + diff) % 360.0)
    out.update(fixed)
    residual = y - A @ coef
    return out, float(coef[0]), residual


def extremes(epoch_seconds, levels, minimum_range=0.05):
    """High and low waters of a finely sampled curve: [(index, "high"|"low")].

    Turning points alternate; a rise or fall smaller than minimum_range (a stand,
    or a double low water's shallow dip) is merged away, keeping the higher high
    and the lower low, so each tide has one high and one low water."""
    y = np.asarray(levels, dtype=float)
    d = np.sign(np.diff(y))
    # Carry flat steps forward so a plateau counts once.
    for i in range(1, len(d)):
        if d[i] == 0:
            d[i] = d[i - 1]
    turns = []
    for i in range(1, len(d)):
        if d[i - 1] > 0 and d[i] < 0:
            turns.append([i, "high"])
        elif d[i - 1] < 0 and d[i] > 0:
            turns.append([i, "low"])
    changed = True
    while changed and len(turns) > 1:
        changed = False
        gaps = [abs(y[turns[k + 1][0]] - y[turns[k][0]]) for k in range(len(turns) - 1)]
        k = int(np.argmin(gaps))
        if gaps[k] < minimum_range:
            # Remove the smaller swing: the pair k, k+1, leaving the neighbours to alternate;
            # at either end of the series only the end's turn, which has no neighbour.
            if k + 1 == len(turns) - 1:
                del turns[k + 1]
            elif k == 0:
                del turns[0]
            else:
                del turns[k:k + 2]
            changed = True
            # Neighbours of one kind that now touch: keep the more extreme.
            merged = []
            for index, kind in turns:
                if merged and merged[-1][1] == kind:
                    better = (y[index] > y[merged[-1][0]]) if kind == "high" else (y[index] < y[merged[-1][0]])
                    if better:
                        merged[-1] = [index, kind]
                else:
                    merged.append([index, kind])
            turns = merged
    return [(int(i), kind) for i, kind in turns]


def lowest_and_highest(constituents, z0, start_seconds, years=18.61, step_minutes=10):
    """The lowest and highest predicted level over a nodal cycle from start."""
    t = start_seconds + np.arange(0, years * 365.25 * 86400, step_minutes * 60.0)
    lo, hi = np.inf, -np.inf
    for i in range(0, len(t), 100_000):
        z = predict(constituents, z0, t[i:i + 100_000])
        lo, hi = min(lo, float(z.min())), max(hi, float(z.max()))
    return lo, hi
