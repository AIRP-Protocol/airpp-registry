// src/server.js — AIRPP Registry v0.3.0
import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isDatabaseRequired } from "./lib/config.js";
import { Store } from "./lib/store.js";
import { createApiRouter } from "./routes/api.js";
import { createAuthRouter } from "./routes/auth.js";
import { generalLimiter } from "./lib/rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (isDatabaseRequired()) {
  console.error("FATAL: DATABASE_URL is required in production. Set NODE_ENV=development to use in-memory demo mode.");
  process.exit(1);
}

const app = express();
const store = new Store();

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "6mb" })); // slightly over maxManifestBytes to give a clean 413 from our guard
app.use(express.urlencoded({ extended: true }));

// General rate limit on all API routes
app.use("/api/", generalLimiter);

// Static UI
app.use(express.static(path.resolve(__dirname, "../public")));

// Routes
app.use("/api/v1/auth", createAuthRouter(store));
app.use("/api/v1", createApiRouter(store));

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../public/index.html"));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "internal_error", message: err.message });
});

app.listen(config.port, () => {
  console.log(`AIRPP Registry v0.3.0 listening on ${config.publicBaseUrl}`);
  console.log(`Storage: ${config.databaseUrl ? "Postgres" : "in-memory demo"}`);
  if (!config.bootstrapApiKey) console.warn("WARNING: AIRPP_BOOTSTRAP_API_KEY not set — running in open demo mode.");
});
