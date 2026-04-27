export const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  bootstrapApiKey: process.env.AIRPP_BOOTSTRAP_API_KEY || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8787",

  // JWT auth
  jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret-replace-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",

  // Email (for invitations and verification)
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "noreply@registry.airpp.dev",

  // GitHub OAuth
  githubClientId: process.env.GITHUB_CLIENT_ID || "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",

  // Rate limiting
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 60),
  rateLimitValidateMax: Number(process.env.RATE_LIMIT_VALIDATE_MAX || 20),

  // Manifest storage
  maxManifestBytes: Number(process.env.MAX_MANIFEST_BYTES || 512_000),
};

export function isLocalDemoMode() {
  return !config.bootstrapApiKey || config.nodeEnv === "development";
}

export function isDatabaseRequired() {
  return config.nodeEnv === "production" && !config.databaseUrl;
}
