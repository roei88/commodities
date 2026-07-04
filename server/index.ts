// Load .env if present (Node 20.12+ built-in, zero dependency).
try { (process as any).loadEnvFile?.(); } catch { /* .env absent - use shell env */ }

import express from "express";
import ViteExpress from "vite-express";
import { api } from "./routes/api.ts";
import { validateRegistryOnStartup } from "./plans/resolver.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", api);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3000);

ViteExpress.config({
  mode: (process.env.NODE_ENV === "production" ? "production" : "development") as "production" | "development",
});

ViteExpress.listen(app, PORT, async () => {
  console.log(`[commodity-research] http://localhost:${PORT}  (${process.env.NODE_ENV ?? "development"})`);
  // Non-blocking startup validation of every registry COT code (single CFTC API call).
  validateRegistryOnStartup().catch((e) => console.warn("[registry-validate]", e?.message ?? e));
});
