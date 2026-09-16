# Force5

Reusable wind-map engine and forecast-data foundation, first hosted by wingfoil.ie.
Force5 is the **platform brand**, not a numerical weather prediction model. Provider,
model, initialization, valid times and source licences remain explicit.

## Structure

- `src/WindMap.tsx`: MapLibre geography, wind colours, particles and point selection.
- `src/weather.ts`: provider-neutral types, validation, interpolation and frame cache.
- `src/index.ts`: source-module exports consumed by the host app.
- `src/Force5Brand.tsx`, `assets/force5-logo.png`: platform branding.
- `src/models.ts`: the three map models and validated model-switch loading.
- `src/manifests.ts`: full model registry (including planned models) and the manifest cache.
- `src/units.ts`: display units, conversion and formatting.
- `src/series.ts`: precomputed per-spot and per-member series access.
- `src/blend.ts`: common hourly axis, interpolation, per-hour statistics, candles and plot helpers.
- `src/sun.ts`: sunrise, sunset, civil twilight and night intervals.
- `src/prefs.ts`: dock display preferences with best-effort persistence.
- `src/tides.ts`: tide manifest, station curves and readings.
- `src/timeline.ts`: fractional now-position and scrubber colours.
- `src/testing.ts`: synthetic manifests for unit tests; never bundled.
- `ingest/`: independent ICON-EU and HARMONIE download, validation and atomic publication.

This is a source module inside the prototype, not yet a published/licensable SDK.
The host still supplies map-control styling from `src/styles.css`; bundling isolated
styles, configurable data URLs, an embed API and versioned SDK builds remain future
work. No commercial licence or trademark clearance is implied by the branding.

Both models are connected with genuine snapshots. HARMONIE uses Met Éireann's
near-real-time control (member 0) files: native 2 km Lambert winds, rotated to
true east/north then resampled for the map. Switching commits frame, metadata and
time together and never substitutes data from the other model. HARMONIE coverage
is an Ireland-only crop, with a 60-hour bundled forecast. Gust speed remains
unavailable until the source gust-component semantics are validated; `null` is
shown as unavailable, not calm. See the root README for refresh commands and details.

## Logo

The transparent PNG was created using the built-in image-generation tool. Original
brief: a small horizontal `force5` wordmark with a wind-stream / numeral 5 emblem,
clean lowercase geometric sans serif, forest green (#164b3e) and teal, transparent
background, no slogan or mockup. This is a prototype raster asset; a reviewed vector
master and usage guidelines are future brand work.
