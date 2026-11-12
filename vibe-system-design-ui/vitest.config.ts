import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import json from "@rollup/plugin-json";

export default defineConfig({
  plugins: [
    react(),
    // @ts-expect-error - types don't match actual ES module export
    json(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "open-color": path.resolve(import.meta.dirname, "./src/shims/open-color.js"),
      "/Users/jussaurabh/Work/pet-projects/vibe-system-design/node_modules/.bun/open-color@1.9.1/node_modules/open-color/open-color.json": path.resolve(import.meta.dirname, "./src/shims/open-color.js"),
    },
    conditions: ["development", "import", "module", "default"],
    mainFields: ["module", "main"],
    extensions: [".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts", "./src/test/jest-globals.ts"],
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    deps: {
      inline: ["@excalidraw/excalidraw", "open-color"],
      optimizer: {
        web: {
          include: ["open-color"],
        },
      },
    },
  },
});
