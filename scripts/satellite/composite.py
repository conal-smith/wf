"""The pure parts of compositing and of the intertidal heights, on arrays.

No I/O here, so test_composite.py can check them on small made-up stacks.
"""
import numpy as np

# Looks this far from the first median, in the 8-bit square-root encoding
# (common.encode_refl), are taken for cloud, haze or shadow the masks missed
# and left out of the second: 25 steps is about a doubling of dark water's
# reflectance, or a third of bright sand's.
OUTLIER_STEPS = 25


def masked_median(stack, valid):
    """Per-pixel median over the looks that are valid.

    stack: (n, ...) uint8; valid: (n, ...) bool (broadcastable). The mean of
    the two middle values when the count is even. Returns (median float32,
    NaN where there are none, count)."""
    n = stack.shape[0]
    if n == 0:
        return np.full(stack.shape[1:], np.nan, np.float32), np.zeros(stack.shape[1:], np.int64)
    v = np.broadcast_to(valid, stack.shape)
    # Invalid looks sort to the top (as 256), so the valid ones are the first `count`.
    keyed = np.where(v, stack.astype(np.int16), 256)
    keyed.sort(axis=0)
    count = v.sum(axis=0)
    lo = np.clip((count - 1) // 2, 0, n - 1)
    hi = np.clip(count // 2, 0, n - 1)
    a = np.take_along_axis(keyed, lo[None], axis=0)[0].astype(np.float32)
    b = np.take_along_axis(keyed, hi[None], axis=0)[0].astype(np.float32)
    med = (a + b) / 2
    return np.where(count > 0, med, np.nan).astype(np.float32), count


def robust_rgb_median(rgb, valid):
    """The median colour of the valid looks, a second time without the looks
    whose brightness (the mean of the three bands' codes) is more than
    OUTLIER_STEPS from the first median's.

    rgb: (n, 3, h, w) uint8, 0 where a look is not usable; valid: (n, h, w)
    bool. Returns ((3, h, w) float32 codes, NaN where none; count used)."""
    ok = valid & (rgb > 0).all(axis=1)
    bright = rgb.astype(np.float32).mean(axis=1)
    first, count = masked_median(np.round(bright).astype(np.uint8), ok)
    keep = ok & (np.abs(bright - first[None]) <= OUTLIER_STEPS)
    # Where rejecting would leave fewer than half, the first median's looks stand.
    kept = keep.sum(axis=0)
    keep = np.where((kept * 2 >= count)[None], keep, ok)
    out = np.empty((3,) + rgb.shape[2:], dtype=np.float32)
    used = None
    for band in range(3):
        out[band], used = masked_median(rgb[:, band], keep)
    return out, used


def median_level(levels, use):
    """Each pixel's median tide over the looks it uses. levels: (n,) floats; use: (n, h, w) bool."""
    order = np.argsort(levels)
    u = use[order]
    count = u.sum(axis=0)
    csum = np.cumsum(u, axis=0)
    k = (count + 1) // 2
    idx = np.argmax(csum >= np.maximum(k, 1)[None], axis=0)
    return np.where(count > 0, levels[order][idx], np.nan).astype(np.float32)


def flip_heights(stack, tides, rows=64):
    """The rocks pilot's flip level (scripts/rockspilot/build_heights.py).

    stack: (n, h, w) int8, 1 wet, 0 dry, -1 not seen; tides: (n,). With the
    looks sorted by tide, each pixel's height is the threshold between them
    with the fewest contradictions (wet below it plus dry above it); its
    misfit is that count over its looks. Returns z (NaN unless it flips),
    misfit, n valid, state (0 no looks, 1 flips, 2 wet in every look, 3 dry
    in every look) and the spread of the tied thresholds."""
    order = np.argsort(tides)
    t = np.asarray(tides, dtype=np.float64)[order]
    n, h, w = stack.shape
    z = np.full((h, w), np.nan, np.float32)
    misfit = np.full((h, w), np.nan, np.float32)
    nvalid = np.zeros((h, w), np.int16)
    state = np.zeros((h, w), np.int8)
    spread = np.full((h, w), np.nan, np.float32)
    if n == 0:
        return z, misfit, nvalid, state, spread
    mids = np.concatenate([[t[0] - 0.05], (t[:-1] + t[1:]) / 2, [t[-1] + 0.05]])
    kk = np.arange(n + 1)[:, None, None]
    for r0 in range(0, h, rows):
        block = stack[order, r0:r0 + rows]
        wet = (block == 1).astype(np.int16)
        dry = (block == 0).astype(np.int16)
        cw = np.concatenate([np.zeros((1,) + wet.shape[1:], np.int16), np.cumsum(wet, 0, dtype=np.int16)])
        cd = np.concatenate([np.zeros((1,) + dry.shape[1:], np.int16), np.cumsum(dry, 0, dtype=np.int16)])
        errors = cw + (cd[-1:] - cd)
        best = errors.min(0)
        ties = errors == best[None]
        tie_count = ties.sum(0)
        kmid = np.round((ties * kk).sum(0) / np.maximum(tie_count, 1)).astype(int)
        lo = np.where(ties, kk, n + 1).min(0)
        hi = np.where(ties, kk, -1).max(0)
        valid = cw[-1] + cd[-1]
        sl = slice(r0, r0 + block.shape[1])
        nvalid[sl] = valid
        misfit[sl] = np.where(valid > 0, best / np.maximum(valid, 1), np.nan)
        st = np.where(valid == 0, 0, np.where(kmid == 0, 2, np.where(kmid == n, 3, 1)))
        z[sl] = np.where(st == 1, mids[kmid], np.nan)
        spread[sl] = np.where(st == 1, mids[np.clip(hi, 0, n)] - mids[np.clip(lo, 0, n)], np.nan)
        state[sl] = st
    return z, misfit, nvalid, state, spread


def below_above_counts(stack, tides, z):
    """Looks dry below each pixel's flip level and wet above it."""
    dry_below = np.zeros(z.shape, np.int16)
    wet_above = np.zeros(z.shape, np.int16)
    zz = np.where(np.isfinite(z), z, np.inf)
    zz_hi = np.where(np.isfinite(z), z, -np.inf)
    for i, t in enumerate(tides):
        dry_below += (stack[i] == 0) & (t < zz)
        wet_above += (stack[i] == 1) & (t > zz_hi)
    return dry_below, wet_above


def scene_errors(stack, always_wet, always_dry, near):
    """Per look: (looks of the always-wet seen dry, always-wet seen, always-dry
    seen wet, always-dry seen, near pixels seen, near pixels): the counts the
    scene QC sums over a neighbourhood of blocks."""
    seen = stack >= 0
    out = np.empty((stack.shape[0], 6), dtype=np.int64)
    out[:, 0] = ((stack == 0) & always_wet).sum(axis=(1, 2))
    out[:, 1] = (seen & always_wet).sum(axis=(1, 2))
    out[:, 2] = ((stack == 1) & always_dry).sum(axis=(1, 2))
    out[:, 3] = (seen & always_dry).sum(axis=(1, 2))
    out[:, 4] = (seen & near).sum(axis=(1, 2))
    out[:, 5] = near.sum()
    return out


def keep_from_errors(err, max_error, min_cover=0.3, min_ref=400):
    """Which looks pass: at most max_error of either reference set
    contradicted, and at least min_cover of the near-coast pixels seen.
    err: (n, 6) counts. A look with too few reference pixels seen to judge passes."""
    ew = err[:, 0] / np.maximum(err[:, 1], 1)
    ed = err[:, 2] / np.maximum(err[:, 3], 1)
    cover = err[:, 4] / np.maximum(err[:, 5], 1)
    judged = (err[:, 1] >= min_ref) | (err[:, 3] >= min_ref)
    bad = (np.maximum(np.where(err[:, 1] >= min_ref, ew, 0), np.where(err[:, 3] >= min_ref, ed, 0)) > max_error)
    return ~(judged & bad) & (cover >= min_cover)


def decode(code):
    """8-bit square-root codes (float, NaN for none) to reflectance."""
    from common import REFL_MAX
    c = (np.asarray(code, dtype=np.float32) - 1) / 254
    return c * c * REFL_MAX
