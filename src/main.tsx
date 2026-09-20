import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./compact.css";
import "./dock.css";
import "../ui/theme.css";
import App from "./App";
import { isMarketPath } from "../force5/src/siteNav";

// The marketplace is its own bundle; the map never loads it and it never
// loads the map. Everything under /market goes there — which is also what the
// shared site menu links to, from the same one match.
const MarketApp = React.lazy(() => import("../market/web/MarketApp"));
const isMarket = isMarketPath(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isMarket ? (
      <Suspense fallback={null}>
        <MarketApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
