"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import AuthFlowShell from "@/components/auth-flow-shell";

export default function ResetPasswordForm({ token, invalid }: { token?: string; invalid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(invalid || !token);
  const lock = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !token) return;
    const fields = new FormData(event.currentTarget);
    const newPassword = String(fields.get("password"));
    if (newPassword !== fields.get("confirm")) { setError("The passwords don’t match."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await authClient.resetPassword({ token, newPassword });
      if (result.error) {
        if (result.error.code === "INVALID_TOKEN") setExpired(true);
        setError(result.error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Could not reset your password. The link may have expired or already been used.");
        return;
      }
      window.location.replace("/login?reset=1");
    } catch { setError("Could not connect. Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <AuthFlowShell title="Choose a new password." description="Use a new passphrase with at least 12 characters. You’ll sign in again afterward.">
    {expired ? <div className="auth-message" role="alert"><p>This reset link is missing, expired, or already used.</p><Link href="/forgot-password" className="text-button">Request a new reset link</Link></div> : <form onSubmit={submit} aria-busy={busy}><fieldset className="project-fields" disabled={busy}>
      <label htmlFor="new-password">New password</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="button primary full-width auth-submit">{busy ? "Saving password…" : "Save new password"}</button>
    </fieldset></form>}
  </AuthFlowShell>;
}
