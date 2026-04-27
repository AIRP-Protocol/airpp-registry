// src/lib/rateLimit.js
// Express-rate-limit configurations for public and write endpoints
import rateLimit from "express-rate-limit";
import { config } from "./config.js";

export const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate_limited", message: "Too many requests. Please slow down." },
});

export const validateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitValidateMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate_limited", message: "Validation rate limit exceeded." },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate_limited", message: "Too many authentication attempts." },
});
