# Wingfoil mobile

The wingfoil.ie forecast as a native app (Expo, React Native). The brief is the
site's: [`docs/BRAND.md`](../docs/BRAND.md), an Admiralty chart crossed with a
broadsheet weather report. [`docs/MOBILE.md`](../docs/MOBILE.md) says how it is
built, released and updated.

## Expo moves fast: do not trust memory

Expo ships breaking changes every SDK. Before touching an Expo, EAS or React
Native API, read the major version of `expo` in `package.json` and the matching
docs (`https://docs.expo.dev/versions/v<major>.0.0/`, and
`https://docs.expo.dev/llms.txt`). Add packages with `npx expo install <pkg>`.

## How it is put together

- **The forecast is the site's code.** Stars, the blend, tides, tiles, the
  satellite, intertidal and foil indexes are imported from the repository root
  (`force5/src`, `src`, `spot/web`, `mcp/api`, `alerts/shared`). Never copy one
  into the app: change it where it lives, and the site's tests cover it.
  `metro.config.js` swaps the site's two browser seams for the app's
  (`force5/src/urls.ts` → `src/config/urls.ts`, `force5/src/pageLife.ts` →
  `src/config/pageLife.ts`).
- **One forecast for every screen**: `src/data/forecast.tsx` (`useForecast`).
  The chart's lights, the dock, the spot page and the spots tab read its one
  table of rated hours, so they cannot disagree.
- **Routes** are Expo Router files in `src/app/`; feature code lives in
  `src/features/<feature>/`, a screen beside a pure `*Logic.ts` that has tests.
- **Tokens only.** Colours, type, space come from `src/theme/tokens.ts`, which
  is generated from the site's `ui/theme.css` (`npm run tokens`).
  `npm run lint:tokens` refuses a raw hex, number spacing, font or weight.
- **Text** is `<T variant=… />`; buttons, segmented controls and stars are in
  `src/components`. Touch targets are 44 points at least; every control has an
  accessibility role and label.
- **Native folders are generated** (`expo prebuild`): change `app.config.ts` or
  a config plugin, never `ios/` or `android/`.

## Checks

```sh
npm run ci           # typecheck, eslint, token lint (with its self-test), unit tests
npm run export:check # Metro bundles both platforms
```

Run them before calling anything done. A change to a site module also runs the
site's own `npm test` and `npm run build` at the root.
