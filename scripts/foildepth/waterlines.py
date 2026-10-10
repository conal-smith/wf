"""An intertidal surface from EMODnet's satellite-derived waterlines.

EMODnet Bathymetry publishes three coastlines traced from satellite images at
known tide stages: the lowest astronomical tide (LAT), mean sea level (MSL)
and mean high water (MHW) lines. Where nothing better has been surveyed (the
Malahide estuary's flats have no open LiDAR or INFOMAR cover) they bound the
intertidal zone, and an elevation can be interpolated between them: the
"waterline method".

On the target grid:

1. the three line sets are burned in as barriers;
2. the gaps between them are labelled as regions, and each region placed on a
   level (0 under the LAT line, 1 between LAT and MSL, 2 between MSL and MHW,
   3 above MHW) by walking out from the open sea (level 0, where a survey says
   the bed is well under LAT) and stepping a level each time a line is crossed;
3. in levels 1 and 2 the height is interpolated by distance between the two
   bounding lines; level 0 is wet at every tide but its depth is not known;
   level 3 is land.

Returns (heights above LAT with NaN where none, a mask of level 0, a mask
of level 3, region counts).
"""
from collections import deque

import numpy as np
from rasterio import features
from rasterio.transform import Affine
from scipy import ndimage

KINDS = ("LAT", "MSL", "MHW")


def _merc(coords):
    a = np.asarray(coords, dtype=np.float64)[:, :2]
    x = np.radians(a[:, 0]) * 6378137.0
    y = np.log(np.tan(np.pi / 4 + np.radians(a[:, 1]) / 2)) * 6378137.0
    return np.column_stack([x, y])


def _lines(geojson):
    for f in geojson["features"]:
        g = f.get("geometry") or {}
        t = g.get("type")
        if t == "LineString":
            parts = [g["coordinates"]]
        elif t in ("MultiLineString", "Polygon"):
            parts = g["coordinates"]
        elif t == "MultiPolygon":
            parts = [ring for poly in g["coordinates"] for ring in poly]
        else:
            continue
        for part in parts:
            if len(part) > 1:
                yield {"type": "LineString", "coordinates": _merc(part).tolist()}


def _burn(geojson, kind, transform, shape):
    only = {"features": [f for f in geojson["features"]
                         if str((f.get("properties") or {}).get("type", "")).upper() == kind]}
    shapes = [(line, 1) for line in _lines(only)]
    if not shapes:
        return np.zeros(shape, dtype=bool)
    return features.rasterize(shapes, out_shape=shape, transform=transform,
                              all_touched=True, dtype="uint8").astype(bool)


def _edges(labels, lines):
    """(a, b, crossed) for regions a ≠ b facing each other across 1–3 line pixels."""
    h, w = labels.shape
    code = lines[0].astype(np.uint8) | (lines[1].astype(np.uint8) << 1) | (lines[2].astype(np.uint8) << 2)
    found = set()
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        for k in (2, 3, 4):
            r0, r1 = max(0, -k * dy), h - max(0, k * dy)
            c0, c1 = max(0, -k * dx), w - max(0, k * dx)

            def at(arr, m):
                return arr[r0 + m * dy:r1 + m * dy, c0 + m * dx:c1 + m * dx]

            a = at(labels, 0)
            b = at(labels, k)
            between = np.ones(a.shape, dtype=bool)
            crossed = np.zeros(a.shape, dtype=np.uint8)
            for m in range(1, k):
                c = at(code, m)
                between &= c > 0
                crossed |= c
            pick = between & (a > 0) & (b > 0) & (a != b)
            if pick.any():
                trip = np.unique(np.column_stack([a[pick], b[pick], crossed[pick]]), axis=0)
                for p, q, c in trip:
                    found.add((int(p), int(q), int(c)))
                    found.add((int(q), int(p), int(c)))
    return found


def _step(level, crossed):
    """The level across a set of lines (bitmask over LAT, MSL, MHW), or None."""
    idx = [i for i in range(3) if crossed & (1 << i)]
    if min(idx) == level:  # the line above this level: up past all of them
        return max(idx) + 1
    if max(idx) == level - 1:  # the line below: down
        return min(idx)
    return None


def waterline_surface(geojson, levels, transform, shape, survey, coarsen=2,
                      sea_below=-1.0, land_above=8.0, sea_hint=None):
    """Heights above LAT from the three waterlines on a (coarsened) grid.

    `geojson` holds all three line sets, told apart by their `type` property
    ("LAT", "MSL", "MHW"); `levels` gives each one's height above LAT.
    `sea_hint` (full grid, optional) marks cells known to be sea though the
    survey has no height there (a gap-fill thrown out)."""
    h, w = shape
    ch, cw = -(-h // coarsen), -(-w // coarsen)
    t = transform * Affine.scale(coarsen)
    lines = [_burn(geojson, k, t, (ch, cw)) for k in KINDS]
    barrier = lines[0] | lines[1] | lines[2]
    labels, count = ndimage.label(~barrier)  # 4-connected: no leaks on the diagonal

    # The survey so far, coarsened, to find the open sea and the high land.
    pad = np.full((ch * coarsen, cw * coarsen), np.nan, dtype=np.float32)
    pad[:h, :w] = survey
    with np.errstate(all="ignore"):
        coarse = np.nanmedian(pad.reshape(ch, coarsen, cw, coarsen), axis=(1, 3))
    seeds = []
    for target, test in ((0, coarse < sea_below), (3, coarse > land_above)):
        ids, n = np.unique(labels[test & (labels > 0)], return_counts=True)
        sizes = ndimage.sum(np.ones_like(labels), labels, index=ids) if len(ids) else []
        for i, k, size in zip(ids, n, sizes):
            if k >= max(20, 0.3 * size):
                seeds.append((int(i), target))

    edges = {}
    for a, b, c in _edges(labels, lines):
        edges.setdefault(a, []).append((b, c))
    level = np.full(count + 1, -1, dtype=np.int8)
    queue = deque()
    for i, lv in seeds:
        if level[i] < 0:
            level[i] = lv
            queue.append(i)
    while queue:
        a = queue.popleft()
        for b, c in edges.get(a, []):
            if level[b] >= 0:
                continue
            nxt = _step(int(level[a]), c)
            if nxt is not None:
                level[b] = nxt
                queue.append(b)
    # A gap in a line joins a band to the land behind it, and the band's level
    # then spreads over fields: a band whose survey (EMODnet's land heights,
    # coarse as they are) mostly stands well above high water is land.
    mhw = float(levels["MHW"])
    for i in np.flatnonzero((level == 1) | (level == 2)):
        values = coarse[labels == i]
        values = values[np.isfinite(values)]
        if values.size >= 20 and np.median(values) > mhw + 1.5:
            level[i] = 3
    grid = level[labels]
    grid[labels == 0] = -1
    # And pixel by pixel, where the band reaches well up a slope.
    grid[np.isin(grid, (1, 2)) & (coarse > mhw + 2.5)] = 3
    # A line that stops short of the grid's edge joins the sea to the land
    # round its end, and the land would be "under LAT". Such a region (one
    # with real hills in it) is kept as sea only where the survey has seabed.
    hills = np.isfinite(coarse) & (coarse > mhw + 2.0)
    leaked = np.zeros(count + 1, dtype=bool)
    for i in np.flatnonzero(level == 0):
        leaked[i] = hills[labels == i].sum() >= 50
    in_leaked = leaked[labels] & (grid == 0)
    sea = coarse <= 0
    if sea_hint is not None:
        # A gap-fill thrown out is still sea, not the land round a line's end:
        # off Sandymount it is the strip between the flats and the soundings.
        hint = np.zeros((ch * coarsen, cw * coarsen), dtype=bool)
        hint[:h, :w] = sea_hint
        sea |= hint.reshape(ch, coarsen, cw, coarsen).any(axis=(1, 3))
    grid[in_leaked & ~sea] = -1

    zs = [float(levels[k]) for k in KINDS]
    d = [ndimage.distance_transform_edt(~ln) for ln in lines]
    z = np.full((ch, cw), np.nan, dtype=np.float32)
    for lv in (1, 2):
        lo, hi = lv - 1, lv
        sel = grid == lv
        t_ = d[lo][sel] / np.maximum(d[lo][sel] + d[hi][sel], 1e-6)
        z[sel] = zs[lo] + (zs[hi] - zs[lo]) * t_
    # On a line: its own level (the mean where lines share a pixel).
    on = np.zeros((ch, cw), dtype=np.float32)
    n_on = np.zeros((ch, cw), dtype=np.float32)
    for k in range(3):
        on[lines[k]] += zs[k]
        n_on[lines[k]] += 1
    # Only lines between known intertidal or sea regions, not stray ones on land.
    near = ndimage.maximum_filter(np.isin(grid, (0, 1, 2)).astype(np.uint8), size=3) > 0
    sel = (n_on > 0) & near
    z[sel] = on[sel] / n_on[sel]
    wet = grid == 0
    land = grid == 3

    # Back to the full grid.
    z_full = np.repeat(np.repeat(z, coarsen, axis=0), coarsen, axis=1)[:h, :w]
    z_full = ndimage.uniform_filter(np.nan_to_num(z_full, nan=0.0), size=coarsen + 1) / np.maximum(
        ndimage.uniform_filter(np.isfinite(z_full).astype(np.float32), size=coarsen + 1), 1e-6)
    z_full[~np.repeat(np.repeat(np.isfinite(z), coarsen, axis=0), coarsen, axis=1)[:h, :w]] = np.nan
    wet_full = np.repeat(np.repeat(wet, coarsen, axis=0), coarsen, axis=1)[:h, :w]
    land_full = np.repeat(np.repeat(land, coarsen, axis=0), coarsen, axis=1)[:h, :w]
    counts = {name: int((grid == lv).sum()) for lv, name in enumerate(["underLAT", "LAT-MSL", "MSL-MHW", "land"])}
    counts["unplaced"] = int(((grid < 0) & (labels > 0)).sum())
    return z_full.astype(np.float32), wet_full, land_full, counts
