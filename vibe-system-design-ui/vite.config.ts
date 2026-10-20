import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const BACKEND_ORIGIN = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // The browser calls the API on its own origin. The dev server forwards
      // the call to the backend, so the browser never sends a CORS preflight
      // request. The response streams through the proxy without buffering.
      "/v1": {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
      },
    },
  },
});
