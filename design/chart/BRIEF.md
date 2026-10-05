# Brief: four chart directions for wingfoil.ie

The owner picked direction A, "Shipping Forecast" (`../directions/a-shipping-forecast.html`):
an Admiralty chart crossed with a broadsheet, paper and ink, chart magenta, and a red
pen that circles things and writes notes in the margin "like somebody taking notes on
paper". What they asked for next:

- **The map is the focus**: big, and **zoomable**, showing the **real coastline** in this
  style as you zoom in.
- **Real bathymetry** (A's depth lines were fake). It "could actually be quite useful
  for people": shallow banks matter to a foil (a 75–95 cm mast touches down in water
  shallower than about a metre and a bit), and depth explains where the chop and
  current are.
- **Wind lines**, the way the real map shows them (moving streamlines of the forecast).
- Keep the **old newspaper / magazine** feel and the **red-pen circling and notes**.
- They liked B's **3D timeline ribbon** (`../directions/b-isobar.html`) and wonder how
  something like it could live with the bathymetry.

## What is ready for you (do not edit these; extend them in your own file)

- `chart-kit.js`, global `WFChart` (read its header): `createMap(el, opts)` makes a
  MapLibre map styled as a chart with the real coast (OpenStreetMap via OpenFreeMap),
  real depths (EMODnet: tinted depth bands, contours with labels, soundings in the
  chart's italic with small decimetres, finer 115 m detail in the five featured bays
  from zoom 9), land relief lines, places. `wind(map, {time})` draws the real wind as
  ink streamlines (`setTime(ms)`, `set({color, alpha, density, width})`). `pen(map)`
  is a red pen that writes on the chart at map coordinates and stays put while it
  pans/zooms (`circle`, `note`, `arrow`, `underline`, `clear`). `windAt(lon, lat, ms)`,
  `depthAt(lon, lat)` (featured bays), `grid(id)`, `tideAt(id, ms)`, `C` (palette),
  `TINTS`, `chartStyle()`.
- Data (load these as plain `<script>`s so the page opens from disk too):
  - `../directions/data.js` → `window.WF`: `now` (2026-10-05T12:00Z), `spots` (146
    riding places: id, name, county, lat, lon, facing, `now`, `days[]` with the best
    hour's stars/wind/gust/dir per day), `featured` (brandon, dollymount, rusheen,
    keel, the-burrow: `spot`, `sun`, `tides.events` (LAT), `hours[]` with wind, waves,
    weather and `rating` (stars, potential, session, wing…; null in the dark)).
  - `data/wind.js` (`WFWIND`, 3-hourly 5 Oct 06Z → 9 Oct 21Z), `data/bathy-ireland.js`
    (`WFBATHY`), `data/bathy-bays.js` (`WFBAYS`), `data/soundings.js`
    (`WFSOUNDINGS`), `data/bathy-grids.js` (`WFGRIDS`, raw depth grids of the five bays).
- MapLibre: `https://unpkg.com/maplibre-gl@5.7.0/dist/maplibre-gl.{js,css}`. Fonts in
  the map's own labels come from OpenFreeMap (Noto Sans Regular/Italic/Bold only); use
  HTML/SVG overlays for anything set in A's faces (Fraunces, Newsreader, IBM Plex Mono,
  Kalam for the hand).
- `kit-test.html` is a minimal working page.

Star semantics (the product's): solid stars are the hour as forecast for the rider;
faded stars are what the wind alone would give. The dark is not rated. Every rating
carries a wing size and a session name. Star ratings are the product's core; show them.

## Rules

- One self-contained HTML file of your own (inline CSS/JS) plus the shared files. It
  must work at `http://127.0.0.1:5182/chart/<your-file>.html` (a server is running on
  the `design/` folder) with no console errors. Support `#map`, `#spot/<id>` (featured
  ids) and any views of your own as hashes, so a link opens a view.
- Desktop first (1440×900), and it must still work on a phone (390×844).
- Real data only: no invented forecasts or depths. If you need something the data
  lacks, say so in the page's small print rather than faking it.
- Write the copy as a person would: plain, specific, short. British/Irish spelling.
- Check your work by looking at it: screenshot with Playwright (it is installed in
  `/Volumes/workdrive/worktrees/wingfoil-demo/node_modules`; run scripts from that
  directory) and read the images. Map tiles need a few seconds to load. Save final
  shots as `shots/<prefix>-*.jpg` (3–4 per mockup: map, spot, the signature
  interaction, phone).
- Don't commit, and don't touch other mockups or the shared files. If the kit has a bug
  you can't work around, say exactly what in your report.
- Report back: what you built, how each of the owner's asks is answered, the
  interactions, and anything rough or unfinished.
