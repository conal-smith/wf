"""The Wave Finder report: one self-contained HTML page (and its images, all
relative, so the folder publishes as it is) over every region run.

For each region: the search mask, a map of the candidate places and the
known breaks, a card per known break and per best new find (the look with
the biggest clear swell that lit it up beside a calm look, the detector's
foam on the big one, and its breaking frequency), the ranked list, and the
check against the known breaks. Chips are read from Planetary Computer
(chips.py), a 4 km box each, and kept (not read again).

    python -I report.py [--region ireland --region gb] [--new 12] [--top 60]

Reads <root>/<region>/work/{search.tif,search.json,places.json,validation.json,
score/*.json,score/*.tif} and <root>/candidates-<region>.geojson; writes
<root>/report/index.html and <root>/report/img/.
"""
import argparse
import html
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chips  # noqa: E402
import wf  # noqa: E402

NAMES = {"ireland": "Ireland (with Northern Ireland)", "gb": "Great Britain"}
KIND_COL = {"shore": "#2c7fb8", "outer": "#e66101", "bigwave": "#b2182b"}
SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
REPORT = wf.path("report")


def esc(s):
    return html.escape(str(s))


# ---- names ----------------------------------------------------------------------------


def place_name(lon, lat, cache):
    """The nearest locality, from OpenStreetMap's Nominatim (cached; at most one request a
    second, as its usage policy asks)."""
    key = f"{lat:.3f},{lon:.3f}"
    if key in cache:
        return cache[key]
    q = urllib.parse.urlencode({"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 14, "addressdetails": 1})
    req = urllib.request.Request("https://nominatim.openstreetmap.org/reverse?" + q,
                                 headers={"User-Agent": "wingfoil.ie wavefinder report (research)"})
    name = None
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
        a = d.get("address", {})
        local = next((a[k] for k in ("hamlet", "village", "suburb", "town", "locality", "city", "neighbourhood")
                      if k in a), None)
        county = a.get("county") or a.get("state_district") or a.get("state")
        name = ", ".join(x for x in (local, county) if x) or d.get("display_name", "").split(",")[0]
    except Exception as e:  # offline, refused: the coordinates will do
        print(f"  name {key}: {e!r}"[:120], flush=True)
    time.sleep(1.1)
    cache[key] = name
    return name


# ---- maps -----------------------------------------------------------------------------


class MapGrid:
    """The region's 100 m grid, drawn at `step` cells a pixel."""

    def __init__(self, region, step):
        import rasterio
        from pyproj import Transformer
        wf.set_region(region)
        common = wf.satellite()
        with rasterio.open(common.path("work", "coarse.tif")) as src:
            self.cov = src.read(1)[::step, ::step] > 0
            self.sea = src.read(3)[::step, ::step] > 0
            self.tf, crs = src.transform, src.crs
        with rasterio.open(wf.rpath("work", "search.tif")) as src:
            f = src.read(1).astype(np.uint8)
        # Each drawn pixel takes the flags of any of its cells (searched wins).
        h, w = f.shape[0] // step * step, f.shape[1] // step * step
        blocks = f[:h, :w].reshape(h // step, step, w // step, step)
        self.flags = np.zeros(blocks.shape[0:1] + blocks.shape[2:3], np.uint8)
        for bit in (8, 2, 4, 1):
            self.flags[((blocks & bit) > 0).any(axis=(1, 3))] = bit
        self.cov = self.cov[:self.flags.shape[0], :self.flags.shape[1]]
        self.sea = self.sea[:self.flags.shape[0], :self.flags.shape[1]]
        self.step = step
        self.to = Transformer.from_crs(4326, crs, always_xy=True)

    def xy(self, lon, lat):
        x, y = self.to.transform(lon, lat)
        c, r = ~self.tf * (x, y)
        return c / self.step, r / self.step

    def base(self, mask=False):
        img = np.full(self.flags.shape + (3,), (232, 238, 243), np.uint8)  # sea
        land = ~self.sea & self.cov
        img[land] = (250, 248, 242)
        img[~self.sea & ~self.cov] = (238, 236, 230)
        if mask:
            img[self.flags == 8] = (214, 224, 234)
            img[self.flags == 2] = (70, 100, 200)
            img[self.flags == 4] = (240, 150, 40)
            img[self.flags == 1] = (20, 160, 60)
        else:
            img[self.flags == 1] = (150, 150, 150)
        return img


def save_png(img, p):
    from PIL import Image
    os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.fromarray(img).save(p, optimize=True)


def map_svg(grid, img_rel, places, breaks, scale, top):
    h, w = grid.flags.shape
    W, H = int(w * scale), int(h * scale)
    out = [f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" class="map">',
           f'<image href="{img_rel}" x="0" y="0" width="{W}" height="{H}"/>']
    for p in reversed(places[:top]):
        x, y = grid.xy(p["lon"], p["lat"])
        r = 3 + 6 * min(p["score"] / max(places[0]["score"], 1e-9), 1)
        out.append(f'<a href="#{esc(p["id"])}"><circle cx="{x * scale:.1f}" cy="{y * scale:.1f}" r="{r:.1f}" '
                   f'fill="{KIND_COL.get(p["kind"], "#555")}" fill-opacity="0.8" stroke="white" stroke-width="0.8">'
                   f'<title>#{p["rank"]} {esc(p.get("name") or "")} ({p["kind"]}, score {p["score"]})</title></circle></a>')
    for b in breaks:
        x, y = grid.xy(b["lon"], b["lat"])
        col = "#111" if b["found"] else "#d7191c"
        out.append(f'<a href="#break-{esc(slug(b["name"]))}"><rect x="{x * scale - 4:.1f}" y="{y * scale - 4:.1f}" '
                   f'width="8" height="8" fill="none" stroke="{col}" stroke-width="1.6"><title>{esc(b["name"])}: '
                   f'{"found" if b["found"] else "missed"} ({b["km"]} km)</title></rect></a>')
    out.append("</svg>")
    return "\n".join(out)


def slug(s):
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in s).strip("-")


# ---- chips ----------------------------------------------------------------------------


def best_looks(piece_looks, fields, facing=None):
    """The biggest swell that lit the piece, on a light or offshore wind and a clear tile if
    there was one (clean breaking, not an onshore gale's chaos), and its clearest calm look."""
    ix = {k: n for n, k in enumerate(fields)}

    def onshore_gale(lk):
        if facing is None or lk[ix["wind"]] is None or lk[ix["windFrom"]] is None:
            return 1
        return int(wf.wind_kind(lk[ix["wind"]], lk[ix["windFrom"]], facing) in ("onshore", "cross"))

    big = [lk for lk in piece_looks if lk[ix["class"]] in ("big", "mid") and lk[ix["clean"]]
           and lk[ix["seenShare"]] >= 0.95 and lk[ix["foamShare"]] >= 0.3 and lk[ix["hs"]] is not None]
    # Clean wind first, then a clear tile (haze over the rest of the picture spoils it), then
    # the most powerful swell.
    big.sort(key=lambda lk: (onshore_gale(lk), (lk[ix["tileCloud"]] if lk[ix["tileCloud"]] is not None else 100) > 30,
                             -float(wf.swell_power(lk[ix["hs"]], lk[ix["tp"]] or 0))))
    calm = [lk for lk in piece_looks if lk[ix["class"]] == "calm" and lk[ix["seenShare"]] >= 0.95]
    calm.sort(key=lambda lk: (lk[ix["tileCloud"]] if lk[ix["tileCloud"]] is not None else 100, lk[ix["foamShare"]]))
    return (big[0] if big else None), (calm[0] if calm else None)


def chip_set(region, tile, piece, big, calm, out_dir, km=4.0):
    """Big look (colour and foam), calm look and the breaking frequency; paths relative to the report."""
    from PIL import Image
    rel = {}
    name = piece["id"]
    jobs = [("big", big), ("calm", calm)]
    for kind, lk in jobs:
        if lk is None:
            continue
        p = os.path.join(out_dir, f"{name}-{kind}-{lk[0][:8]}.jpg")
        pf = p.replace(".jpg", "-foam.jpg")
        if not os.path.exists(p):
            try:
                item, epsg = chips.item_of(tile, lk[0])
                bands = chips.read_box(item, epsg, piece["lon"], piece["lat"], km)
            except Exception as e:  # a read that fails leaves the card without that picture
                print(f"  {name} {kind}: {e!r}"[:160], flush=True)
                continue
            Image.fromarray(chips.rgb(bands)).save(p, quality=85)
            img, _ = chips.foam_overlay(bands, wf.config())
            Image.fromarray(img).save(pf, quality=85)
        rel[kind] = os.path.relpath(p, REPORT)
        rel[kind + "Foam"] = os.path.relpath(pf, REPORT)
    pq = os.path.join(out_dir, f"{name}-freq.png")
    if not os.path.exists(pq):
        pb, _ = chips.freq_box(wf.rpath("work", "score", f"{tile}.tif"), piece["lon"], piece["lat"], km)
        base = None
        if "calm" in rel:
            base = np.array(Image.open(os.path.join(REPORT, rel["calm"])).convert("RGB"))
            if base.shape[:2] != pb.shape:
                base = None
        Image.fromarray(chips.freq_image(pb, base)).save(pq, optimize=True)
    rel["freq"] = os.path.relpath(pq, REPORT)
    return rel


# ---- cards ----------------------------------------------------------------------------


def sector_svg(by_sector):
    """Eight wedges, one per direction the swell came from: out to the share of that
    direction's looks that lit the place, darker for more looks."""
    out = ['<svg viewBox="-60 -60 120 120" width="110" height="110" class="rose">',
           '<circle r="50" fill="none" stroke="#ccc"/><circle r="25" fill="none" stroke="#eee"/>']
    for k, s in enumerate(SECTORS):
        n, lit = by_sector.get(s, [0, 0])
        if n == 0:
            continue
        r = 50 * lit / n
        a0, a1 = math.radians(k * 45 - 20), math.radians(k * 45 + 20)
        x0, y0, x1, y1 = math.sin(a0) * r, -math.cos(a0) * r, math.sin(a1) * r, -math.cos(a1) * r
        op = 0.35 + 0.6 * min(n, 30) / 30
        out.append(f'<path d="M0,0 L{x0:.1f},{y0:.1f} A{r:.1f},{r:.1f} 0 0 1 {x1:.1f},{y1:.1f} Z" fill="#2c7fb8" '
                   f'opacity="{op:.2f}"><title>from {s}: {lit}/{n} looks lit</title></path>')
    for k, s in enumerate(SECTORS[::2]):
        a = math.radians(k * 90)
        out.append(f'<text x="{math.sin(a) * 57:.0f}" y="{-math.cos(a) * 57 + 3:.0f}" font-size="9" '
                   f'text-anchor="middle" fill="#777">{s}</text>')
    out.append("</svg>")
    return "".join(out)


def look_caption(lk, fields, facing):
    ix = {k: n for n, k in enumerate(fields)}
    d = lk[0]
    date = f"{d[:4]}-{d[4:6]}-{d[6:8]} {d[9:11]}:{d[11:13]}"
    hs, tp, dr, ws, wfrom = (lk[ix[k]] for k in ("hs", "tp", "dir", "wind", "windFrom"))
    wk = wf.wind_kind(ws if ws is not None else np.nan, wfrom if wfrom is not None else np.nan,
                      facing if facing is not None else np.nan) if facing is not None else ""
    return (f"{date} UTC · Hs {hs} m, Tp {tp} s from {dr:.0f}° · wind {ws} m/s from {wfrom:.0f}° ({wk}) · "
            f"{lk[ix['foamShare']] * 100:.0f}% foaming")


def card(region, piece, title, rel, big, calm, fields, anchor, extra=""):
    lit = piece.get("lit") or {}
    rows = [f"<tr><th>P(foam | big)</th><td>{piece['pBig']:.2f} over {piece['nBig']} big looks</td></tr>",
            f"<tr><th>P(foam | calm)</th><td>{piece['pCalm']:.3f} over {piece['nCalm']} calm looks</td></tr>",
            f"<tr><th>P(foam | moderate)</th><td>{piece['pMid']:.2f}</td></tr>",
            f"<tr><th>Kind</th><td>{piece['kind']} (foam {piece.get('offshoreM', '?')} m from shore, "
            f"90% within {piece.get('offshoreP90M', '?')} m)</td></tr>",
            f"<tr><th>Seabed</th><td>{piece.get('depthMin')}–{piece.get('depthMax')} m, median {piece.get('depthMedian')} m "
            f"(EMODnet DTM under the piece's sea), slope {piece.get('slope')}"
            f", shore faces {piece.get('facing')}°</td></tr>"]
    if lit:
        rows.append(f"<tr><th>Lit by</th><td>Hs {lit['hs'][0]}–{lit['hs'][1]} m, Tp {lit['tp'][0]}–{lit['tp'][1]} s, "
                    f"from {lit['dir']}° (offshore point {piece['point']}); {piece['nLit']} of {piece['nSwell']} "
                    f"swell looks</td></tr>")
    winds = piece.get("litWinds") or {}
    if winds:
        rows.append("<tr><th>Wind when lit</th><td>" + ", ".join(f"{k} {v}" for k, v in sorted(winds.items(), key=lambda kv: -kv[1]))
                    + "</td></tr>")
    pics = []
    if "big" in rel:
        pics.append(f'<figure><img src="{rel["big"]}" loading="lazy"><figcaption>Big swell: '
                    f'{esc(look_caption(big, fields, piece.get("facing")))}</figcaption></figure>')
        pics.append(f'<figure><img src="{rel["bigFoam"]}" loading="lazy"><figcaption>The same look, foam the '
                    f'detector found in red</figcaption></figure>')
    if "calm" in rel:
        pics.append(f'<figure><img src="{rel["calm"]}" loading="lazy"><figcaption>Calm: '
                    f'{esc(look_caption(calm, fields, piece.get("facing")))}</figcaption></figure>')
    pics.append(f'<figure><img src="{rel["freq"]}" loading="lazy"><figcaption>How often each 10 m pixel foamed in '
                f'big swell (pale 5% to deep blue 80%+)</figcaption></figure>')
    return (f'<section class="card" id="{esc(anchor)}"><h3>{esc(title)}</h3>'
            f'<p class="meta">{piece["lat"]:.4f}, {piece["lon"]:.4f} · piece {esc(piece["id"])} · place #{piece["placeRank"]} '
            f'· score {piece["score"]}{extra}</p>'
            f'<div class="row"><table>{"".join(rows)}</table>{sector_svg(piece.get("bySector") or {})}</div>'
            f'<div class="pics">{"".join(pics)}</div></section>')


# ---- the page -------------------------------------------------------------------------


CSS = """
body{font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;margin:0;color:#1d2731;background:#fbfaf7}
main{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:30px;margin:0 0 4px} h2{margin-top:40px;border-bottom:2px solid #1d2731;padding-bottom:4px}
.lead{font-size:17px;color:#33414d} .meta{color:#6a7680;font-size:13px;margin:0 0 8px}
.card{background:white;border:1px solid #e3e0d8;border-radius:8px;padding:14px 16px;margin:16px 0}
.card h3{margin:0 0 2px} .row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.card table{border-collapse:collapse;font-size:13px} .card th{text-align:left;color:#6a7680;font-weight:500;padding:2px 10px 2px 0}
.pics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
figure{margin:0} figure img{width:100%;display:block;border-radius:4px} figcaption{font-size:11px;color:#5d6973}
table.list{border-collapse:collapse;width:100%;font-size:13px} table.list td,table.list th{border-bottom:1px solid #e6e3dc;padding:4px 6px;text-align:left}
.map{max-width:100%;height:auto;background:#e8eef3;border-radius:8px} .found{color:#1a7f37} .missed{color:#d7191c}
.legend span{display:inline-block;margin-right:14px;font-size:13px} .sw{display:inline-block;width:12px;height:12px;border-radius:6px;margin-right:4px;vertical-align:-1px}
.kpi{display:flex;gap:24px;flex-wrap:wrap} .kpi div{background:white;border:1px solid #e3e0d8;border-radius:8px;padding:10px 14px}
.kpi b{display:block;font-size:22px}
@media (max-width:800px){.pics{grid-template-columns:repeat(2,1fr)}}
"""


def region_section(region, out_root, top, n_new, names):
    wf.set_region(region)
    cfg = wf.config()
    gj = wf.read_json(wf.path(f"candidates-{region}.geojson"))
    pieces = {f["properties"]["id"]: dict(f["properties"], lon=f["geometry"]["coordinates"][0],
                                          lat=f["geometry"]["coordinates"][1]) for f in gj["features"]}
    places = wf.read_json(wf.rpath("work", "places.json"))["places"]
    val = wf.read_json(wf.rpath("work", "validation.json"))
    search = wf.read_json(wf.rpath("work", "search.json"))
    tiles_done = val["tiles"]
    common = wf.satellite()
    plan_tiles = sorted(common.read_json(common.path("work", "plan.json"))["tiles"])
    looks = {}  # piece id -> its looks, from the tile files
    fields = None
    for t in tiles_done:
        d = wf.read_json(wf.rpath("work", "score", f"{t}.json"))
        fields = d["fields"]
        for c in d["candidates"]:
            looks[c["id"]] = c["looks"]
    img_dir = os.path.join(out_root, "img", region)
    os.makedirs(img_dir, exist_ok=True)

    for p in places[:top]:
        p["name"] = place_name(p["lon"], p["lat"], names)
    step = 5 if region == "ireland" else 12
    grid = MapGrid(region, step)
    save_png(grid.base(mask=True), os.path.join(img_dir, "search-mask.png"))
    save_png(grid.base(), os.path.join(img_dir, "map-base.png"))
    scale = 1.0 if region == "ireland" else 0.9
    svg = map_svg(grid, f"img/{region}/map-base.png", places, val["results"], scale, top)

    # Cards: the known breaks (their nearest piece), then the best places away from them.
    out_cards = []
    known_pieces = set()
    for b in val["results"]:
        pc = pieces.get(b["piece"])
        if pc is None:
            continue
        known_pieces.add(pc["id"])
        # The best piece near the break (within the validation radius), not just the nearest.
        near = [q for q in pieces.values() if float(wf.haversine_km(b["lon"], b["lat"], q["lon"], q["lat"])) <= val["km"]]
        if near:
            pc = max(near, key=lambda q: q["score"])
        big, calm = best_looks(looks.get(pc["id"], []), fields, pc.get("facing"))
        rel = chip_set(region, pc["tile"], pc, big, calm, img_dir)
        status = (f' · <b class="found">found</b>, {b["km"]} km' if b["found"]
                  else f' · <b class="missed">missed</b>: nearest piece {b["km"]} km')
        out_cards.append(card(region, pc, b["name"], rel, big, calm, fields, f"break-{slug(b['name'])}", status))
    new = []
    for p in places:
        if len(new) >= n_new:
            break
        if min((float(wf.haversine_km(p["lon"], p["lat"], b["lon"], b["lat"])) for b in val["results"]),
               default=99) <= 3:
            continue
        new.append(p)
    new_cards = []
    for p in new:
        pc = pieces[p["id"]]
        big, calm = best_looks(looks.get(pc["id"], []), fields, pc.get("facing"))
        rel = chip_set(region, pc["tile"], pc, big, calm, img_dir)
        new_cards.append(card(region, pc, f"#{p['rank']} {p.get('name') or ''}", rel, big, calm, fields, p["id"]))

    rows = []
    for p in places[:top]:
        pc = pieces[p["id"]]
        lit = pc.get("lit") or {}
        rows.append(f'<tr id="{esc(p["id"])}-row"><td>{p["rank"]}</td><td><a href="#{esc(p["id"])}">{esc(p.get("name") or "")}</a></td>'
                    f'<td>{pc["lat"]:.4f}, {pc["lon"]:.4f}</td><td>{p["score"]}</td><td>{p["kind"]}</td>'
                    f'<td>{pc["pBig"]:.2f} / {pc["pCalm"]:.3f}</td><td>{pc["nBig"]} / {pc["nCalm"]}</td>'
                    f'<td>{"" if not lit else str(lit["dir"]) + "°, " + str(lit["tp"][0]) + "–" + str(lit["tp"][1]) + " s, " + str(lit["hs"][0]) + "–" + str(lit["hs"][1]) + " m"}</td>'
                    f'<td>{pc.get("depthMin")}–{pc.get("depthMedian")} m</td><td>{len(p["pieces"])}</td></tr>')
    vrows = []
    for b in val["results"]:
        vrows.append(f'<tr><td><a href="#break-{slug(b["name"])}">{esc(b["name"])}</a></td><td>{b["kind"]}{" (east)" if b["east"] else ""}</td>'
                     f'<td class="{"found" if b["found"] else "missed"}">{"found" if b["found"] else "missed"}</td>'
                     f'<td>{b["km"]}</td><td>#{b["placeRank"]}</td><td>{b["pBig"]}</td><td>{b["nBig"]}</td></tr>')
    base = val.get("baseline", {})
    km2 = search
    missing = [t for t in plan_tiles if t not in tiles_done]
    parts = [f'<h2 id="{region}">{esc(NAMES.get(region, region))}</h2>',
             f'<p class="meta">{len(tiles_done)} of {len(plan_tiles)} Sentinel-2 tiles done'
             + (f" (still to come: {', '.join(missing)})" if missing else "") + "</p>",
             '<div class="kpi">'
             f'<div><b>{km2["searchedKm2"]:,} km²</b>searched</div>'
             f'<div><b>{km2["deepKm2"]:,} km²</b>left out: deeper than {cfg["depth"]["maxMetres"]} m</div>'
             f'<div><b>{km2["enclosedKm2"]:,} km²</b>left out: enclosed water</div>'
             f'<div><b>{len(pieces):,}</b>breaking pieces in {len(places):,} places</div>'
             f'<div><b>{val["found"]} / {val["breaks"]}</b>known breaks found (within {val["km"]} km)</div></div>',
             '<h3>Where it looked</h3><p>Green: searched (sea within '
             f'{cfg["band"]["seaKm"]} km of land and land within {cfg["band"]["landKm"] * 1000:.0f} m of the sea, '
             f'no deeper than {cfg["depth"]["maxMetres"]} m on EMODnet\'s DTM). Blue: too deep. Orange: enclosed water '
             f'(behind a gap under {cfg["enclosed"]["gapKm"] * 2:.1f} km, more than {cfg["enclosed"]["keepKm"]} km in). '
             'Pale blue: the offshore ring where whitecaps are measured.</p>',
             f'<img class="map" src="img/{region}/search-mask.png" alt="search mask">',
             f'<h3>Candidate places (top {top})</h3><p class="legend">'
             + "".join(f'<span><i class="sw" style="background:{c}"></i>{k}</span>' for k, c in KIND_COL.items())
             + '<span>□ known break: black found, red missed</span></p>' + svg,
             '<h3>Known breaks</h3>',
             f'<p>A known break is found when a breaking piece lies within {val["km"]} km of it. '
             f'Chance would give: {base.get("all", 0) * 100:.0f}% of random searched shore cells have a piece within '
             f'{val["km"]} km (all pieces); {base.get("25", 0) * 100:.0f}%, {base.get("50", 0) * 100:.0f}% and '
             f'{base.get("100", 0) * 100:.0f}% for the top 25, 50 and 100 places\' pieces. The known breaks among the '
             f'top 25, 50 and 100 places: {val["top"]["25"]}, {val["top"]["50"]} and {val["top"]["100"]} of '
             f'{val["breaks"]}.</p>',
             '<table class="list"><tr><th>Break</th><th>Kind</th><th></th><th>km</th><th>Place</th><th>P(big)</th>'
             '<th>Big looks</th></tr>' + "".join(vrows) + "</table>",
             "".join(out_cards),
             f'<h3>Best places away from the known breaks</h3><p>The {len(new)} best places more than 3 km from '
             'any known break in the list: new finds, or breaks the list does not name.</p>',
             "".join(new_cards),
             f'<h3>Ranked places</h3><table class="list"><tr><th>#</th><th>Place</th><th>Lat, lon</th><th>Score</th>'
             '<th>Kind</th><th>P big / calm</th><th>Looks big / calm</th><th>Lit by (dir, Tp, Hs)</th><th>Depth</th>'
             '<th>Pieces</th></tr>' + "".join(rows) + "</table>"]
    return "\n".join(parts), {"tiles": len(tiles_done), "planTiles": len(plan_tiles), "pieces": len(pieces),
                              "places": len(places), "found": val["found"], "breaks": val["breaks"]}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--region", action="append")
    p.add_argument("--top", type=int, default=60)
    p.add_argument("--new", type=int, default=12)
    a = p.parse_args()
    regions = a.region or ["ireland", "gb"]
    out_root = wf.path("report")
    os.makedirs(out_root, exist_ok=True)
    names_path = wf.path("report", "names.json")
    names = wf.read_json(names_path) if os.path.exists(names_path) else {}
    secs, stats = [], {}
    for r in regions:
        if not os.path.exists(wf.path(f"candidates-{r}.geojson")):
            print(f"{r}: no candidates yet (rank.py)", flush=True)
            continue
        s, st = region_section(r, out_root, a.top, a.new, names)
        secs.append(s)
        stats[r] = st
        wf.write_json(names_path, names, indent=1)
    cfg = wf.config()
    s = cfg["seaState"]
    head = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Wave Finder</title><style>{CSS}</style></head>
<body><main><h1>Wave Finder</h1>
<p class="lead">Where waves break round the coast, from every clear Sentinel-2 look since 2017 paired with the swell
and wind at the time. A 10 m pixel that turns white in big, long-period swell and stays dark in calm is breaking water:
a beach's surf zone, a bar, a reef or a point.</p>
<p class="meta">Built {time.strftime('%Y-%m-%d %H:%M')} · {' · '.join(f'<a href="#{r}">{esc(NAMES.get(r, r))}</a>: {v["tiles"]}/{v["planTiles"]} tiles, {v["places"]} places, {v["found"]}/{v["breaks"]} known breaks found' for r, v in stats.items())}</p>
<h2>How</h2>
<ol>
<li><b>Swell and wind at every overpass.</b> ERA5's ocean waves (0.5°, significant height Hs, peak period Tp, mean
direction) and ERA5's 10 m wind, hourly from 2017, at every 0.5° cell within {s['pointSeaKmMax']} km of the coast
(Open-Meteo's archives), interpolated to each Sentinel-2 acquisition (about 11:30 UTC). Each coastal block takes its
nearest point; its "big" swell is Hs ≥ {s['bigHs']} m (or the point's own 75th percentile where that is less: the
Irish Sea, the North Sea) with Tp ≥ {s['bigTp']} s, its "calm" Hs ≤ {s['calmHs']} m and wind ≤ {s['calmWind']} m/s.</li>
<li><b>Which looks.</b> Every acquisition with tile cloud under {cfg['select']['maxTileCloud']}% and Hs ≥
{s['readHs']} m at one of the tile's points, and the {cfg['select']['calmLooks']} clearest calm ones; a look whose
searched pixels are over {cfg['select']['maxBadShare'] * 100:.0f}% cloud, shadow or no data (the scene
classification) is dropped after its first 3 MB.</li>
<li><b>Where.</b> The open coast's shallow band only (map per region below).</li>
<li><b>Foam.</b> Per 10 m pixel: B03 ≥ {cfg['foam']['minGreen']}, B08 ≥ {cfg['foam']['minNir']}, B11 ≤
{cfg['foam']['maxSwirShare']}×B03 and B02 ≥ {cfg['foam']['minBlueRed']}×B04: white in the visible, bright in the
near infrared, dark in the shortwave infrared (the water under the foam absorbs it). Sand, rock and weed are redder
and bright in B11; cloud, haze and glint are bright in B11. The scene classification often calls surf cloud, so a
pixel it calls cloud is kept when it passes the foam test.</li>
<li><b>Whitecaps and haze.</b> For each look and block, the offshore ring (2–5 km out) too: over
{cfg['score']['maxWhitecap'] * 100:.0f}% foam there (an onshore gale's whitecaps, or haze) and the block's look is
not counted as clean.</li>
<li><b>Breaking.</b> Per pixel, P(foam | big, clean) and P(foam | calm); a pixel foaming in at least
{cfg['score']['minFoamBig'] * 100:.0f}% of at least {cfg['score']['minBigLooks']} big looks and {cfg['score']['minLift']}×
as often as in calm is breaking water. Joined into pieces about {cfg['score']['segmentKm']} km across, scored
(P big − P calm) × √(area, ha, capped at 20), and joined within {cfg['rank']['placeKm']} km into places.</li>
<li><b>Swell window.</b> Each piece's share of pixels foaming in every look clear over it: the directions, periods
and sizes that light it up (the rose: share of the looks from each direction that lit it; thicker for more looks).</li>
</ol>
<p class="meta">Data: contains modified Copernicus Sentinel data 2017–2026 (Sentinel-2 L2A, read from Microsoft
Planetary Computer). Hersbach et al., ERA5 (Copernicus Climate Change Service) and ECMWF ERA5 ocean waves, via
Open-Meteo (CC BY 4.0). EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM), CC BY 4.0. Place names ©
OpenStreetMap contributors (ODbL), via Nominatim.</p>
"""
    page = head + "\n".join(secs) + "</main></body></html>\n"
    with open(os.path.join(out_root, "index.html"), "w") as fh:
        fh.write(page)
    print(f"report: {os.path.join(out_root, 'index.html')}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
