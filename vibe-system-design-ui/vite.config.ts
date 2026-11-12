import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import json from "@rollup/plugin-json";

const BACKEND_ORIGIN = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // @ts-expect-error - types don't match actual ES module export
    json({
      include: ["**/*.json"],
      preferConst: true,
      indent: "  ",
    }),
  ],
  optimizeDeps: { exclude: ["@excalidraw/excalidraw"] },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "open-color": path.resolve(import.meta.dirname, "./src/shims/open-color.js"),
    },
    conditions: ["development", "import", "module", "default"],
    mainFields: ["module", "main"],
    extensions: [".js", ".ts", ".jsx", ".tsx", ".json"],
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
  experimental: {
    renderBuiltUrl: () => "",
  },
});
