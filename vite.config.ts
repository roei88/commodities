import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA build output goes to dist/; server serves it in production via vite-express.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
