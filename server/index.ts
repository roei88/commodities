import express from "express";
import ViteExpress from "vite-express";
import { api } from "./routes/api.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", api);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3000);

ViteExpress.config({
  mode: (process.env.NODE_ENV === "production" ? "production" : "development") as "production" | "development",
});

ViteExpress.listen(app, PORT, () => {
  console.log(`[commodity-research] http://localhost:${PORT}  (${process.env.NODE_ENV ?? "development"})`);
});
