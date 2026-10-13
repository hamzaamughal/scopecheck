"use client";
import { useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import AuthFlowShell from "@/components/auth-flow-shell";

export default function AuthEmailRequest({ kind, initialEmail = "" }: { kind: "verify" | "reset"; initialEmail?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const lock = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    lock.current = true; setBusy(true); setError(""); setSent(false);
    try {
      const result = kind === "verify"
        ? await authClient.sendVerificationEmail({ email, callbackURL: "/login?verified=1" })
        : await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      if (result.error) { setError(result.error.status === 429 ? "Too many requests. Please wait a minute before trying again." : "Could not request an email. Please try again later."); return; }
      setSent(true);
    } catch { setError("Could not connect. Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <AuthFlowShell title={kind === "verify" ? "Check your inbox." : "Forgot your password?"} description={kind === "verify" ? "Open your verification email to confirm your address. You can request a new link below." : "Enter your email and we’ll help you choose a new password."}>
    <form onSubmit={submit} aria-busy={busy}><fieldset className="project-fields" disabled={busy}><label htmlFor="recovery-email">Email address</label><input id="recovery-email" name="email" type="email" autoComplete="email" defaultValue={initialEmail} maxLength={254} required />
      {error && <p className="form-error" role="alert">{error}</p>}
      {sent && <p className="auth-message" role="status">If this address is eligible, an email will arrive shortly. Check your spam folder too.</p>}
      <button className="button primary full-width auth-submit" type="submit">{busy ? "Requesting…" : kind === "verify" ? "Resend verification email" : "Send reset link"}</button>
    </fieldset></form>
  </AuthFlowShell>;
}
