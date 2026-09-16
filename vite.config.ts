import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the marketplace API runs as its own process (npm run
// market:api); proxying /api keeps the browser on one origin so no CORS or
// VITE_MARKET_API_URL is needed locally.
const marketApi = process.env.MARKET_API_PROXY ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
  preview: { proxy: { "/api": { target: marketApi, changeOrigin: true } } },
});
