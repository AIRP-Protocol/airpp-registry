// src/lib/email.js
// Nodemailer wrapper — sends transactional email for invitations and verification
import { config } from "./config.js";

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtpHost) return null;

  const nodemailer = await import("nodemailer");
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser
      ? { user: config.smtpUser, pass: config.smtpPass }
      : undefined,
  });
  return transporter;
}

async function send({ to, subject, text, html }) {
  const t = await getTransporter();
  if (!t) {
    console.log(`[email-dev] To: ${to} | Subject: ${subject}\n${text}`);
    return;
  }
  await t.sendMail({ from: config.smtpFrom, to, subject, text, html });
}

export async function sendVerificationEmail(email, token) {
  const url = `${config.publicBaseUrl}/verify-email?token=${token}`;
  await send({
    to: email,
    subject: "Verify your AIRPP Registry email address",
    text: `Please verify your email by visiting: ${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Please <a href="${url}">verify your email address</a> to activate your AIRPP Registry account.</p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email, token) {
  const url = `${config.publicBaseUrl}/reset-password?token=${token}`;
  await send({
    to: email,
    subject: "Reset your AIRPP Registry password",
    text: `Reset your password: ${url}\n\nThis link expires in 1 hour.`,
    html: `<p>Click here to <a href="${url}">reset your password</a>. This link expires in 1 hour.</p>`,
  });
}

export async function sendInvitationEmail(email, token, organisationName, inviterName) {
  const url = `${config.publicBaseUrl}/accept-invite?token=${token}`;
  await send({
    to: email,
    subject: `You have been invited to join ${organisationName} on AIRPP Registry`,
    text: `${inviterName} has invited you to join ${organisationName} on the AIRPP Registry.\n\nAccept your invitation: ${url}\n\nThis link expires in 7 days.`,
    html: `<p><strong>${inviterName}</strong> has invited you to join <strong>${organisationName}</strong> on the AIRPP Registry.</p><p><a href="${url}">Accept your invitation</a> — this link expires in 7 days.</p>`,
  });
}
