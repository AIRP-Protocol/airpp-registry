// src/routes/auth.js
// Registration, login, email verification, password reset, GitHub OAuth, org invite flows
import express from "express";
import { nanoid } from "nanoid";
import {
  hashPassword, verifyPassword, signJwt, requireJwt,
  generateApiKey, generateSecureToken, auditContext
} from "../lib/auth.js";
import { sendVerificationEmail, sendPasswordResetEmail, sendInvitationEmail } from "../lib/email.js";
import { config } from "../lib/config.js";
import { authLimiter } from "../lib/rateLimit.js";

export function createAuthRouter(store) {
  const router = express.Router();

  // ─── Register ──────────────────────────────────────────────────────────

  router.post("/register", authLimiter, async (req, res) => {
    const { email, password, display_name, organisation_name } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "email_and_password_required" });
    if (password.length < 10) return res.status(400).json({ ok: false, error: "password_too_short", message: "Password must be at least 10 characters." });

    const existing = await store.getUserByEmail(email);
    if (existing) return res.status(409).json({ ok: false, error: "email_already_registered" });

    let org = null;
    if (organisation_name) {
      org = await store.createOrganisation({ name: organisation_name });
    }

    const password_hash = await hashPassword(password);
    const email_verify_token = generateSecureToken();
    const user = await store.createUser({
      email, display_name: display_name || email.split("@")[0],
      password_hash, organisation_id: org?.id || null,
      role: org ? "admin" : "member",
      email_verify_token
    });

    await sendVerificationEmail(email, email_verify_token).catch(() => {});
    await store.logAuditEvent({ event_type: "user_registered", target_type: "user", target_id: user.id, event_json: { email }, ...auditContext(req) });

    return res.status(201).json({ ok: true, message: "Account created. Please verify your email.", user_id: user.id });
  });

  // ─── Email verification ────────────────────────────────────────────────

  router.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ ok: false, error: "token_required" });

    const user = await store.getUserByEmailVerifyToken(token);
    if (!user) return res.status(404).json({ ok: false, error: "invalid_or_expired_token" });

    await store.updateUser(user.id, { email_verified: true, email_verify_token: null });
    return res.json({ ok: true, message: "Email verified. You may now sign in." });
  });

  // ─── Login ────────────────────────────────────────────────────────────

  router.post("/login", authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "email_and_password_required" });

    const user = await store.getUserByEmail(email);
    if (!user || !user.password_hash) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    if (!user.email_verified) return res.status(403).json({ ok: false, error: "email_not_verified", message: "Please verify your email before signing in." });

    await store.updateUser(user.id, { last_login: new Date().toISOString() });
    await store.logAuditEvent({ event_type: "user_login", target_type: "user", target_id: user.id, ...auditContext(req) });

    const token = signJwt({ user_id: user.id, email: user.email, role: user.role, organisation_id: user.organisation_id });
    return res.json({ ok: true, token, user: safeUser(user) });
  });

  // ─── Password reset ────────────────────────────────────────────────────

  router.post("/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "email_required" });

    const user = await store.getUserByEmail(email);
    if (user) {
      const reset_token = generateSecureToken();
      const reset_token_expires = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour
      await store.updateUser(user.id, { reset_token, reset_token_expires });
      await sendPasswordResetEmail(email, reset_token).catch(() => {});
    }

    // Always respond the same way to prevent email enumeration
    return res.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
  });

  router.post("/reset-password", authLimiter, async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ ok: false, error: "token_and_password_required" });
    if (password.length < 10) return res.status(400).json({ ok: false, error: "password_too_short" });

    const user = await store.getUserByResetToken(token);
    if (!user) return res.status(404).json({ ok: false, error: "invalid_or_expired_token" });

    const password_hash = await hashPassword(password);
    await store.updateUser(user.id, { password_hash, reset_token: null, reset_token_expires: null });
    await store.logAuditEvent({ event_type: "password_reset", target_type: "user", target_id: user.id, ...auditContext(req) });

    return res.json({ ok: true, message: "Password updated. You may now sign in." });
  });

  // ─── Current user ──────────────────────────────────────────────────────

  router.get("/me", requireJwt, async (req, res) => {
    const user = await store.getUserById(req.user.user_id);
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
    return res.json({ ok: true, user: safeUser(user) });
  });

  // ─── API key management ────────────────────────────────────────────────

  router.post("/api-keys", requireJwt, async (req, res) => {
    if (!req.user.organisation_id) {
      return res.status(400).json({ ok: false, error: "organisation_required", message: "You must belong to an organisation to create API keys." });
    }
    const { name, scopes = ["validate", "read"], description = null } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const { raw, keyHash } = generateApiKey();
    const key = await store.createApiKey({
      organisation_id: req.user.organisation_id,
      user_id: req.user.user_id,
      key_hash: keyHash,
      name, scopes, description
    });

    await store.logAuditEvent({ event_type: "api_key_created", target_type: "api_key", target_id: key.id, event_json: { name, scopes }, ...auditContext(req) });
    return res.status(201).json({ ok: true, key: { ...key, raw_key: raw }, message: "Store this key securely — it will not be shown again." });
  });

  router.get("/api-keys", requireJwt, async (req, res) => {
    if (!req.user.organisation_id) return res.json({ ok: true, api_keys: [] });
    const keys = await store.listApiKeys(req.user.organisation_id);
    return res.json({ ok: true, api_keys: keys });
  });

  router.delete("/api-keys/:id", requireJwt, async (req, res) => {
    if (!req.user.organisation_id) return res.status(403).json({ ok: false, error: "forbidden" });
    const key = await store.revokeApiKey(req.params.id, req.user.organisation_id);
    if (!key) return res.status(404).json({ ok: false, error: "key_not_found" });
    await store.logAuditEvent({ event_type: "api_key_revoked", target_type: "api_key", target_id: req.params.id, ...auditContext(req) });
    return res.json({ ok: true, message: "API key revoked." });
  });

  // ─── Invitations ───────────────────────────────────────────────────────

  router.post("/invite", requireJwt, async (req, res) => {
    if (!req.user.organisation_id) return res.status(403).json({ ok: false, error: "organisation_required" });
    const { email, role = "member" } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: "email_required" });

    const org = await store.getOrganisation(req.user.organisation_id);
    const inviter = await store.getUserById(req.user.user_id);
    const token = generateSecureToken();
    const expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString(); // 7 days

    const invitation = await store.createInvitation({
      organisation_id: req.user.organisation_id,
      invited_email: email,
      invited_by: req.user.user_id,
      role, token, expires_at
    });

    await sendInvitationEmail(email, token, org?.name || "your organisation", inviter?.display_name || "A team member").catch(() => {});
    await store.logAuditEvent({ event_type: "invitation_sent", target_type: "invitation", target_id: invitation.id, event_json: { email }, ...auditContext(req) });

    return res.status(201).json({ ok: true, invitation_id: invitation.id, message: "Invitation sent." });
  });

  router.post("/accept-invite", async (req, res) => {
    const { token, password, display_name } = req.body || {};
    if (!token || !password) return res.status(400).json({ ok: false, error: "token_and_password_required" });
    if (password.length < 10) return res.status(400).json({ ok: false, error: "password_too_short" });

    const invitation = await store.getInvitation(token);
    if (!invitation || invitation.accepted_at) return res.status(404).json({ ok: false, error: "invalid_or_expired_invitation" });
    if (new Date(invitation.expires_at) < new Date()) return res.status(410).json({ ok: false, error: "invitation_expired" });

    const existing = await store.getUserByEmail(invitation.invited_email);
    if (existing) return res.status(409).json({ ok: false, error: "email_already_registered" });

    const password_hash = await hashPassword(password);
    const user = await store.createUser({
      email: invitation.invited_email,
      display_name: display_name || invitation.invited_email.split("@")[0],
      password_hash,
      organisation_id: invitation.organisation_id,
      role: invitation.role,
      email_verified: true // invitation link validates email implicitly
    });

    await store.acceptInvitation(token);
    const jwtToken = signJwt({ user_id: user.id, email: user.email, role: user.role, organisation_id: user.organisation_id });
    return res.status(201).json({ ok: true, token: jwtToken, user: safeUser(user) });
  });

  // ─── GitHub OAuth ──────────────────────────────────────────────────────

  router.get("/github", (req, res) => {
    if (!config.githubClientId) return res.status(501).json({ ok: false, error: "github_oauth_not_configured" });
    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: `${config.publicBaseUrl}/api/v1/auth/github/callback`,
      scope: "user:email read:user"
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get("/github/callback", authLimiter, async (req, res) => {
    const { code } = req.query;
    if (!code || !config.githubClientId) return res.status(400).json({ ok: false, error: "missing_code_or_config" });

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: config.githubClientId, client_secret: config.githubClientSecret, code })
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) return res.status(401).json({ ok: false, error: tokenData.error });

      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" }
      });
      const ghUser = await userRes.json();

      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" }
      });
      const emails = await emailRes.json();
      const primaryEmail = (Array.isArray(emails) ? emails.find(e => e.primary && e.verified)?.email : null) || ghUser.email;

      let user = await store.getUserByGithubId(ghUser.id);
      if (!user && primaryEmail) user = await store.getUserByEmail(primaryEmail);

      if (user) {
        await store.updateUser(user.id, { github_id: String(ghUser.id), github_username: ghUser.login, last_login: new Date().toISOString() });
      } else {
        user = await store.createUser({
          email: primaryEmail || `github_${ghUser.id}@noemail.local`,
          display_name: ghUser.name || ghUser.login,
          github_id: String(ghUser.id),
          github_username: ghUser.login,
          email_verified: Boolean(primaryEmail)
        });
      }

      await store.logAuditEvent({ event_type: "github_login", target_type: "user", target_id: user.id, ...auditContext(req) });
      const jwtToken = signJwt({ user_id: user.id, email: user.email, role: user.role, organisation_id: user.organisation_id });
      res.redirect(`${config.publicBaseUrl}/?token=${jwtToken}&github=1`);
    } catch (err) {
      res.status(500).json({ ok: false, error: "github_oauth_failed", message: err.message });
    }
  });

  return router;
}

function safeUser(user) {
  const { password_hash, email_verify_token, reset_token, reset_token_expires, ...safe } = user;
  return safe;
}
