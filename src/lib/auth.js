// src/lib/auth.js
// Authentication: bootstrap key, scoped API keys, JWT session tokens
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config, isLocalDemoMode } from "./config.js";

// ─── Bootstrap key (legacy, write-endpoint guard) ─────────────────────────

export function requireApiKey(req, res, next) {
  if (isLocalDemoMode()) return next();

  // Accept either a scoped API key (Bearer airpp_...) or bootstrap key
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "unauthorised", message: "Missing Bearer token." });
  }

  // If store is available on req, try scoped key lookup — otherwise fall back to bootstrap
  if (req.store && req.store.pool) {
    return requireScopedKey(req, res, next, token);
  }

  if (token === config.bootstrapApiKey) return next();
  return res.status(401).json({ ok: false, error: "unauthorised", message: "Invalid API key." });
}

async function requireScopedKey(req, res, next, token) {
  try {
    const keyRecord = await req.store.verifyApiKey(token);
    if (!keyRecord) {
      // Fall back to bootstrap key
      if (token === config.bootstrapApiKey) return next();
      return res.status(401).json({ ok: false, error: "unauthorised", message: "Invalid or revoked API key." });
    }
    req.apiKey = keyRecord;
    req.organisationId = keyRecord.organisation_id;
    return next();
  } catch (err) {
    return res.status(500).json({ ok: false, error: "auth_error", message: err.message });
  }
}

// ─── JWT session tokens ────────────────────────────────────────────────────

export function signJwt(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyJwt(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export function requireJwt(req, res, next) {
  if (isLocalDemoMode()) {
    req.user = { user_id: "dev-user", role: "admin", organisation_id: null };
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "unauthorised" });

  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ ok: false, error: "token_expired_or_invalid" });

  req.user = payload;
  return next();
}

export function requireJwtOrApiKey(req, res, next) {
  if (isLocalDemoMode()) {
    req.user = { user_id: "dev-user", role: "admin", organisation_id: null };
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "unauthorised" });

  // Try JWT first
  const jwtPayload = verifyJwt(token);
  if (jwtPayload) {
    req.user = jwtPayload;
    return next();
  }

  // Fall through to scoped API key
  return requireScopedKey(req, res, next, token);
}

// ─── Password utilities ────────────────────────────────────────────────────

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ─── Scoped API key generation ─────────────────────────────────────────────

export function generateApiKey() {
  const raw = `airpp_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, keyHash };
}

export function hashApiKey(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ─── Token utilities ───────────────────────────────────────────────────────

export function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function extractBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

// ─── Audit log helper ─────────────────────────────────────────────────────

export function auditContext(req) {
  return {
    ip_address: req.ip || req.headers["x-forwarded-for"] || null,
    user_agent: req.headers["user-agent"] || null,
    actor_user_id: req.user?.user_id || null,
    api_key_id: req.apiKey?.id || null,
    organisation_id: req.organisationId || req.user?.organisation_id || null,
  };
}
