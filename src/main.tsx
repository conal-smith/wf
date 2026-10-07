import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
// The base every section stands on. The map's own stylesheets (MapLibre's,
// map.css, dock.css, panels.css) are imported by src/App.tsx and travel in
// its chunk.
import "./styles.css";
import "../ui/fonts.css";
import "../ui/theme.css";
import { mapFirstRequests, startEarly } from "../force5/src/boot";
import {
  isAiPath,
  isCommunityPath,
  isMarketPath,
  isSpotPath,
} from "../force5/src/siteNav";

// The marketplace is its own bundle; the map never loads it and it never
// loads the map. Everything under /market goes there — which is also what the
// shared site menu links to, from the same one match.
const MarketApp = React.lazy(() => import("../market/web/MarketApp"));
const isMarket = isMarketPath(window.location.pathname);

// The community is the third bundle, split off the same way: everything under
// /community, and nothing of it in the map's chunk or the marketplace's.
const CommunityApp = React.lazy(() => import("../community/web/CommunityApp"));
const isCommunity = isCommunityPath(window.location.pathname);

// The page that adds the forecast to an AI assistant, at /ai: a fourth bundle,
// split off the same way.
const AiApp = React.lazy(() => import("../ai/web/AiApp"));
const isAi = isAiPath(window.location.pathname);

// A riding place's own page, at /spot/<id>, and "How the stars work" at
// /stars: a fifth bundle, split off the same way (isSpotPath matches both). It
// reads the forecast's pure modules and never the map.
const SpotApp = React.lazy(() => import("../spot/web/SpotApp"));
const isSpot = isSpotPath(window.location.pathname);

// The kit gallery, at /ui, under the dev server only. The mode is a constant in
// a build, and `vite build` is "production" whatever the shell says, so the
// import it guards is dropped there and no gallery chunk is written: in
// production /ui is the map, as any other path is. `import.meta.env.DEV` would
// not do: it follows NODE_ENV, and a shell that exports NODE_ENV=development
// makes `npm run build` a development build that ships the gallery.
const Gallery =
  import.meta.env.MODE === "development"
    ? React.lazy(() => import("../ui/Gallery"))
    : null;
const isGallery = /^\/ui\/?$/.test(window.location.pathname);

// The wind map, at / and at any path no section above claims: a bundle of its
// own like the others, so that a spot page, /stars or /ai never downloads
// MapLibre and the map's 1.6 MB.
//
// Imported rather than `React.lazy`, and rendered once it is here. A lazy
// component suspends on the first render, and React holds back the content
// that replaces a committed fallback for up to 300 ms (FALLBACK_THROTTLE_MS):
// measured on a phone profile, that put the map's first paint ~150 ms and a
// usable map ~165 ms behind the single bundle it replaced. Nothing is drawn
// meanwhile, as nothing was while the single bundle was being parsed.
const loadMap = () => import("./App");

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (Gallery && isGallery)
  root.render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    </React.StrictMode>,
  );
else if (isMarket || isCommunity || isAi || isSpot)
  root.render(
    <React.StrictMode>
      <Suspense fallback={null}>
        {isMarket ? (
          <MarketApp />
        ) : isCommunity ? (
          <CommunityApp />
        ) : isAi ? (
          <AiApp />
        ) : (
          <SpotApp />
        )}
      </Suspense>
    </React.StrictMode>,
  );
else {
  // The map's manifest and places, alongside its chunk rather than after it
  // (force5/src/boot.ts).
  startEarly(mapFirstRequests());
  void loadMap().then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
