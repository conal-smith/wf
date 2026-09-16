import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import "./compact.css";
import App from "./App";

// The marketplace is its own bundle; the map never loads it and it never
// loads the map. Everything under /market goes there.
const MarketApp = React.lazy(() => import("../market/web/MarketApp"));
const isMarket = /^\/market(\/|$)/.test(window.location.pathname);

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
