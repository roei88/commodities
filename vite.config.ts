import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single source of truth for the app version: package.json. Injected as a
// compile-time constant (__APP_VERSION__) so the UI tag never drifts from the
// published version. Works in dev (vite-express) and in `vite build`.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// SPA build output goes to dist/; server serves it in production via vite-express.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
