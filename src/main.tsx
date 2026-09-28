import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./compact.css";
import "./dock.css";
import "../ui/theme.css";
import App from "./App";
import { isAiPath, isCommunityPath, isMarketPath } from "../force5/src/siteNav";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {Gallery && isGallery ? (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    ) : isMarket ? (
      <Suspense fallback={null}>
        <MarketApp />
      </Suspense>
    ) : isCommunity ? (
      <Suspense fallback={null}>
        <CommunityApp />
      </Suspense>
    ) : isAi ? (
      <Suspense fallback={null}>
        <AiApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
