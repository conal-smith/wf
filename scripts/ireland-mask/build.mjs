// The chart shows Ireland alone. This writes public/mask/ireland.png: a mask
// laid over everything beyond Ireland's own waters, so Britain, the Isle of
// Man and the hard edge of the finest wind model's grid are not drawn.
//
//   node scripts/ireland-mask/build.mjs [path/to/ne_10m_land.geojson]
//
// Run once, like the bathymetry (scripts/bathymetry): the coast does not move.
// The land is Natural Earth's 1:10m land polygons (public domain), downloaded
// to .cache/ne/ when no path is given:
//   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
//
// The image is grey and alpha, in Web Mercator rows over MASK_BOUNDS
// (force5/src/irelandMask.ts holds the same numbers). Alpha is 0 on Ireland
// and its islands and out to CLEAR_KM from them, rises to 1 at GONE_KM, and is
// 1 anywhere nearer Britain than Ireland, so the North Channel splits down its
// middle. The map tints it with the theme's sea colour.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BOUNDS = { west: -15, east: -1, south: 48.5, north: 58.5 };
const WIDTH = 1600;
const CLEAR_KM = 10;
const GONE_KM = 24;
/** Islands this big are landmasses of their own; smaller ones go to the nearer. */
const BIG_KM2 = 500;
/** No Irish island is further out than this; the Calf of Man is. */
const ISLAND_KM = 20;
/** The edge is smoothed over about this much, so it does not trace every bay. */
const SOFTEN_KM = 7;
const IRELAND_AT = [-8, 53.4];

const source = process.argv[2] ?? ".cache/ne/ne_10m_land.geojson";
if (!existsSync(source)) {
  console.error(
    `No ${source}: download ne_10m_land.geojson there first (see the header).`,
  );
  process.exit(1);
}

const rad = Math.PI / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
const yN = merc(BOUNDS.north);
const yS = merc(BOUNDS.south);
const HEIGHT = Math.round(
  (WIDTH * (yN - yS)) / ((BOUNDS.east - BOUNDS.west) * rad),
);
const px = (lng) => ((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * WIDTH;
const py = (lat) => ((yN - merc(lat)) / (yN - yS)) * HEIGHT;
const latOfRow = (y) =>
  (2 * Math.atan(Math.exp(yN - ((y + 0.5) / HEIGHT) * (yN - yS))) -
    Math.PI / 2) /
  rad;
/** Ground size of a pixel on each row, in km: Mercator is the same both ways locally. */
const kmPerPx = Float64Array.from(
  { length: HEIGHT },
  (_, y) =>
    ((BOUNDS.east - BOUNDS.west) / WIDTH) *
    111.32 *
    Math.cos(latOfRow(y) * rad),
);

// ---- the land, as polygons near the chart --------------------------------
const polygons = [];
for (const feature of JSON.parse(readFileSync(source, "utf8")).features) {
  const g = feature.geometry;
  const list =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : [];
  for (const rings of list) {
    const outer = rings[0];
    let w = 180,
      e = -180,
      s = 90,
      n = -90;
    for (const [x, y] of outer) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    if (
      e < BOUNDS.west - 1 ||
      w > BOUNDS.east + 1 ||
      n < BOUNDS.south - 1 ||
      s > BOUNDS.north + 1
    )
      continue;
    let area = 0,
      cx = 0,
      cy = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const k = 111.32 * Math.cos(((outer[i][1] + outer[j][1]) / 2) * rad);
      const a =
        outer[j][0] * k * (outer[i][1] * 110.57) -
        outer[i][0] * k * (outer[j][1] * 110.57);
      area += a / 2;
      cx += outer[i][0];
      cy += outer[i][1];
    }
    polygons.push({
      rings,
      area: Math.abs(area),
      centre: [cx / outer.length, cy / outer.length],
    });
  }
}

/** Even-odd fill of a polygon's rings into `grid`, at pixel centres. */
function fill(grid, rings, value) {
  const edges = [];
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      edges.push([
        px(ring[j][0]),
        py(ring[j][1]),
        px(ring[i][0]),
        py(ring[i][1]),
      ]);
  let top = Infinity,
    bottom = -Infinity;
  for (const [, y0, , y1] of edges) {
    top = Math.min(top, y0, y1);
    bottom = Math.max(bottom, y0, y1);
  }
  for (
    let y = Math.max(0, Math.floor(top));
    y <= Math.min(HEIGHT - 1, Math.ceil(bottom));
    y++
  ) {
    const c = y + 0.5;
    const xs = [];
    for (const [x0, y0, x1, y1] of edges)
      if ((y0 <= c && y1 > c) || (y1 <= c && y0 > c))
        xs.push(x0 + ((c - y0) / (y1 - y0)) * (x1 - x0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (
        let x = Math.max(0, Math.ceil(xs[k] - 0.5));
        x <= Math.min(WIDTH - 1, Math.floor(xs[k + 1] - 0.5));
        x++
      )
        grid[y * WIDTH + x] = value;
  }
}

const contains = (rings, [x, y]) => {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  return inside;
};

// ---- distances: Felzenszwalb & Huttenlocher's exact transform, in pixels ---
const INF = 1e20;
function edt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const r = v[k];
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    } while (s <= z[k] && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}
/** Distance in km from every pixel to the nearest pixel where `on` is set. */
function distanceKm(on) {
  const g = new Float64Array(WIDTH * HEIGHT);
  for (let i = 0; i < g.length; i++) g[i] = on[i] ? 0 : INF;
  const n = Math.max(WIDTH, HEIGHT);
  const f = new Float64Array(n),
    d = new Float64Array(n),
    v = new Int32Array(n),
    z = new Float64Array(n + 1);
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) f[y] = g[y * WIDTH + x];
    edt1(f, HEIGHT, d, v, z);
    for (let y = 0; y < HEIGHT; y++) g[y * WIDTH + x] = d[y];
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) f[x] = g[y * WIDTH + x];
    edt1(f, WIDTH, d, v, z);
    for (let x = 0; x < WIDTH; x++)
      g[y * WIDTH + x] = Math.sqrt(d[x]) * kmPerPx[y];
  }
  return g;
}

// ---- which land is Ireland's -----------------------------------------------
const island = polygons.find((p) => contains(p.rings, IRELAND_AT));
if (!island) throw new Error("No polygon contains the middle of Ireland");
const big = polygons.filter((p) => p !== island && p.area >= BIG_KM2);
const islandGrid = new Uint8Array(WIDTH * HEIGHT);
fill(islandGrid, island.rings, 1);
const bigGrid = new Uint8Array(WIDTH * HEIGHT);
for (const p of big) fill(bigGrid, p.rings, 1);
const toIsland = distanceKm(islandGrid);
const toBig = distanceKm(bigGrid);
const at = ([lng, lat]) => {
  const x = Math.min(WIDTH - 1, Math.max(0, Math.floor(px(lng))));
  const y = Math.min(HEIGHT - 1, Math.max(0, Math.floor(py(lat))));
  return y * WIDTH + x;
};

const irish = new Uint8Array(WIDTH * HEIGHT);
const other = new Uint8Array(WIDTH * HEIGHT);
let irishIslands = 0;
for (const p of polygons) {
  if (p === island) {
    fill(irish, p.rings, 1);
    continue;
  }
  const i = at(p.centre);
  const mine =
    p.area < BIG_KM2 && toIsland[i] < ISLAND_KM && toIsland[i] < toBig[i];
  if (mine) irishIslands++;
  fill(mine ? irish : other, p.rings, 1);
}
const dIrish = distanceKm(irish);
const dOther = distanceKm(other);

// ---- the mask -------------------------------------------------------------
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
let alpha = new Float64Array(WIDTH * HEIGHT);
for (let i = 0; i < alpha.length; i++)
  alpha[i] = Math.max(
    smooth(CLEAR_KM, GONE_KM, dIrish[i]),
    smooth(-3, 3, dIrish[i] - dOther[i]),
  );
// Three box blurs make a Gaussian: a buffer round a ragged coast is a chain
// of arcs, and this rounds them off. Ireland's own land stays clear.
const r = Math.round(SOFTEN_KM / kmPerPx[Math.round(HEIGHT / 2)] / 2);
for (let pass = 0; pass < 3; pass++)
  for (const horizontal of [true, false]) {
    const next = new Float64Array(alpha.length);
    const [len, lines] = horizontal ? [WIDTH, HEIGHT] : [HEIGHT, WIDTH];
    const idx = horizontal ? (l, k) => l * WIDTH + k : (l, k) => k * WIDTH + l;
    for (let l = 0; l < lines; l++) {
      let sum = 0;
      for (let k = -r; k <= r; k++)
        sum += alpha[idx(l, Math.min(len - 1, Math.max(0, k)))];
      for (let k = 0; k < len; k++) {
        next[idx(l, k)] = sum / (2 * r + 1);
        sum +=
          alpha[idx(l, Math.min(len - 1, k + r + 1))] -
          alpha[idx(l, Math.max(0, k - r))];
      }
    }
    alpha = next;
  }
for (let i = 0; i < alpha.length; i++) if (irish[i]) alpha[i] = 0;
const raw = Buffer.alloc((WIDTH * 2 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH * 2 + 1)] = 0;
  for (let x = 0; x < WIDTH; x++) {
    const o = y * (WIDTH * 2 + 1) + 1 + x * 2;
    raw[o] = 255;
    raw[o + 1] = Math.round(255 * alpha[y * WIDTH + x]);
  }
}

// ---- PNG, grey + alpha ----------------------------------------------------
const crcTable = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 4; // grey + alpha
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("public/mask", { recursive: true });
writeFileSync("public/mask/ireland.png", png);
console.log(
  `public/mask/ireland.png: ${WIDTH}×${HEIGHT}, ${(png.length / 1024).toFixed(0)} kB; ` +
    `${polygons.length} land polygons near, ${irishIslands} of them Irish islands, ${big.length} other landmasses`,
);
