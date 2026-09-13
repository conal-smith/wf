# Ireland wind-map prototype

## Outcome

A locally runnable, responsive wingfoil.ie map using a genuine, timestamped forecast snapshot. Pan and zoom Ireland, play or scrub forecast time, see wind colours and particle trails, inspect any point, and compare named spots. No fabricated weather or inferred safety scores.

## Build sequence

1. **Data** — Python importer for DWD ICON-EU 10 m U/V and maximum gust GRIB2. Discover complete runs, download with bounded concurrency/retries, validate metadata/units/vector orientation/times, crop Ireland, and publish immutable JSON frames plus a manifest atomically. Preserve the last successful snapshot on failure.
2. **Map** — React, TypeScript, Vite and MapLibre. A coloured raster overlay and browser particle layer use the same bilinearly sampled vector field. Wind arrows point downwind; labels use meteorological direction-from.
3. **Experience** — Time slider/playback, selectable spots, arbitrary point inspection, knots/m/s, layer controls, model/source/run/valid-time information, loading and error states, stale-data notice, reduced-motion support and responsive layout.
4. **Verification** — Unit tests for interpolation/direction/bounds/time and importer validation; real download; production build; browser checks on desktop/mobile and failure paths.
5. **Handoff** — Repeatable setup/refresh commands, architecture and limitations documented. Leave a local dev server running.

## Architecture decisions

- Start with DWD's publicly downloadable ICON-EU regular latitude/longitude GRIB2 files. The Met Éireann NWP index was empty when checked; keep the frontend manifest independent of provider for a later HARMONIE adapter.
- Download forecast hours 0–72 at three-hour intervals by default. Label this cadence honestly. No invented hourly forecast or gust interpolation across incompatible statistical periods.
- Store a cropped regular grid in each JSON file; static hosting/CDN suffices for this MVP. No database, cloud account, API secrets, or deployment required.
- Use MapLibre for geography. The MVP particle animation uses a Canvas overlay; the heatmap is rendered by MapLibre's GPU raster layer. A GPU particle implementation is a later optimisation based on mobile measurements.
- OpenFreeMap's public vector basemap with attribution and a configurable replacement style. Weather frames are self-served, not scraped from Windy.
- Approximate coastline forecasts remain model grid estimates, not launch-site measurements. No tides, waves, alerts, marketplace, accounts or automated safety judgments in this feature.

## Acceptance criteria

- `npm run dev` displays the saved genuine forecast without running Python.
- `npm run weather:refresh` can reproduce it from DWD, and failures do not replace the current manifest.
- Map, spot numbers and point inspector agree for the selected valid time.
- Forecast animation stops for reduced-motion preference; controls work by keyboard.
- Missing frames/data/WebGL show an actionable error, not simulated values.
- Tests and production build pass; desktop and mobile interaction are checked.

## Next infrastructure milestone

Containerise importer; run on a schedule; publish immutable run prefixes to object storage/CDN with atomic `latest.json`; monitor freshness and failures. Add HARMONIE, then a global fallback, and validate each against observations before ranking model accuracy.

## Implemented and verified

- The initial implementation stages are complete. ICON-EU and HARMONIE control wind now have real adapters and selectable snapshots; a global model remains future work.
- Real DWD 2026-09-13 06 UTC snapshot: 25 frames, 72 hours, 321 × 177 grid. The crop includes an Atlantic/UK buffer so overview maps do not end at the Irish coastline.
- Colour map, moving particles, eight spot markers and forecasts, arbitrary location picking, forecast playback/slider, units, layers, source information and mobile spot panel are implemented.
- 17 TypeScript/snapshot tests, twelve importer tests and eleven production-browser scenarios passed. Browser tests use the actual built app and real forecast assets.
- The app is locally hosted, not deployed to wingfoil.ie. Refresh is a manual command; static snapshots retain their run/valid-time labels and are flagged as older or expired.

## Force5 / full-screen experience update

- Map, weather utilities, importer and branding grouped under `force5/` as a source module.
- Edge-to-edge map with floating glass identity, search, source, layer and navigation controls.
- Left sidebar replaced by a bottom forecast sheet, initially closed, opening on point/spot selection.
- Wind, gusts and direction across all forecast times; arbitrary-point series loaded from the genuine grids with bounded concurrency and retry.
- Responsive phone layout, visible provider attribution, keyboard/Escape dismissal and camera adjustment to keep selections above the sheet.
- HARMONIE and model switching are implemented using the newer Met Éireann portal, not the empty legacy index.

## HARMONIE integration

- Met Éireann HARMONIE-AROME DINI control, native 2 km Lambert grid, member 0; bundled 13 September 2026 13 UTC run with 21 three-hourly frames through +60h.
- Validates source parameters/member/run/times/scanning geometry. Checks ecCodes coordinates against pyproj and tests vector rotation against independent geodesic bearings.
- Rotates native grid-relative U/V to earth-relative east/north before bilinear resampling. Ireland-only display crop is wholly inside native coverage, with no extrapolation or model blending.
- Independent manifest and immutable hashed frames; failed import leaves previously published manifests intact. Source filenames and extracted-GRIB hashes are retained in the manifest.
- Model switch loads and validates both manifest and first frame before atomically changing all UI consumers. Nearest valid time is selected explicitly, with a notice where timelines differ. Download failures and cancellations retain the previous model.
- Gust speed is intentionally unavailable for HARMONIE: component maxima are present but their combination is not yet validated. The UI labels missing gusts; no synthetic or ICON-EU gust substitution is used.
