# Force5

Reusable wind-map engine and forecast-data foundation, first hosted by wingfoil.ie.
Force5 is the **platform brand**, not a numerical weather prediction model. Provider,
model, initialization, valid times and source licences remain explicit.

## Structure

- `src/WindMap.tsx`: MapLibre geography, wind colours, particles and point selection.
- `src/weather.ts`: provider-neutral types, validation, interpolation and frame cache.
- `src/index.ts`: source-module exports consumed by the host app.
- `src/Force5Brand.tsx`, `assets/force5-logo.png`: platform branding.
- `ingest/`: ICON-EU download, validation and atomic snapshot publication.

This is a source module inside the prototype, not yet a published/licensable SDK.
The host still supplies map-control styling from `src/styles.css`; bundling isolated
styles, configurable data URLs, an embed API and versioned SDK builds remain future
work. No commercial licence or trademark clearance is implied by the branding.

HARMONIE is not implemented yet. Met Éireann's newer public portal exposes near-real-time
downloads, but the control wind fields, Lambert projection and grid-relative vector
rotation must be validated before a HARMONIE option can be enabled. The map currently
uses only genuine DWD ICON-EU output.

## Logo

The transparent PNG was created using the built-in image-generation tool. Original
brief: a small horizontal `force5` wordmark with a wind-stream / numeral 5 emblem,
clean lowercase geometric sans serif, forest green (#164b3e) and teal, transparent
background, no slogan or mockup. This is a prototype raster asset; a reviewed vector
master and usage guidelines are future brand work.
