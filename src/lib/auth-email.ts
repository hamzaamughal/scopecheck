import "server-only";
import { createHash } from "node:crypto";

export class AuthEmailDeliveryError extends Error {}

export type AuthEmail = { to: string; url: string; kind: "verify" | "reset" };

export async function sendAuthEmail({ to, url, kind }: AuthEmail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new AuthEmailDeliveryError("Missing RESEND_API_KEY or AUTH_EMAIL_FROM. Set both and restart the app.");
  const link = new URL(url);
  if (!process.env.BETTER_AUTH_URL || link.origin !== new URL(process.env.BETTER_AUTH_URL).origin) {
    throw new AuthEmailDeliveryError("Authentication link origin does not match BETTER_AUTH_URL.");
  }
  const title = kind === "verify" ? "Verify your ScopeCheck email" : "Reset your ScopeCheck password";
  const description = kind === "verify" ? "Verify your email address to open your workspace." : "Choose a new password for your account. This will sign out your existing sessions.";
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      "Idempotency-Key": createHash("sha256").update(`${kind}:${to}:${url}`).digest("hex") },
    body: JSON.stringify({ from, to: [to], subject: title,
      text: `${description}\n\n${url}\n\nThis link expires in ${kind === "verify" ? "1 hour" : "30 minutes"}. If you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#292735"><h1 style="font-size:24px">${title}</h1><p>${description}</p><p><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;background:#6150ce;color:white;border-radius:8px;text-decoration:none">${kind === "verify" ? "Verify email" : "Reset password"}</a></p><p>This link expires in ${kind === "verify" ? "1 hour" : "30 minutes"}.</p><p>If you did not request this, you can ignore this email.</p></div>` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const hint = response.status === 401 ? "Check the replacement Resend API key."
      : response.status === 403 ? "Check Resend key permissions, sender domain, and whether the recipient matches the Resend account email."
      : response.status === 429 ? "Resend rate or sending quota reached."
      : "Check the request in Resend Logs.";
    throw new AuthEmailDeliveryError(`Resend rejected the email (HTTP ${response.status}). ${hint}`);
  }
  if (process.env.NODE_ENV === "development") console.info(`[auth-email] ${kind}: accepted by Resend; inbox delivery is not yet confirmed.`);
}
