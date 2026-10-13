"use client";

import { useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import ThemeToggle from "@/components/theme-toggle";
import Link from "next/link";

export default function LoginForm({ googleEnabled, oauthError, notice = "" }: { googleEnabled: boolean; oauthError: boolean; notice?: string }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState(oauthError ? "Google sign-in could not be completed. If you already have an account, sign in with your original method and connect Google from your account menu." : "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")).trim();
    const password = String(fields.get("password"));
    const name = String(fields.get("name") ?? "").trim();
    if (register && !name) { setError("Please enter your name."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = register
        ? await authClient.signUp.email({ name, email, password, callbackURL: "/login?verified=1" })
        : await authClient.signIn.email({ email, password, callbackURL: "/" });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") { window.location.replace("/verify-email"); return; }
        setError(result.error.status === 429 ? "Too many attempts. Please wait a minute and try again." : register ? "Could not create this account. Check your details, or sign in if you already have an account." : "Could not sign in. Check your email and password and try again.");
        return;
      }
      window.location.replace(register ? "/verify-email" : "/");
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function google() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/login?error=google" });
      if (result.error) throw new Error("Sign-in failed");
    } catch { setError("Google sign-in is unavailable. Please try email and password."); lock.current = false; setBusy(false); }
  }

  return <main className="auth-page">
    <div className="auth-top"><Link className="brand" href="/">scopecheck<span className="brand-dot">.</span></Link><ThemeToggle /></div>
    <div className="auth-layout">
      <section className="auth-intro"><span className="eyebrow">CLEAR SCOPE. BETTER CONVERSATIONS.</span><h1>A little context.<br/>A clearer decision.</h1><p>Your agreements, client requests, and decisions—together in your own workspace.</p><div className="auth-preview"><span className="badge included"><span/>A clear starting point</span><h2>Keep every request in perspective.</h2><p>Review the scope. Check the evidence. Make the call.</p></div></section>
      <section className="auth-card" aria-labelledby="auth-title"><div className="segmented auth-tabs"><button type="button" disabled={busy} aria-pressed={!register} className={!register ? "selected" : ""} onClick={() => { setRegister(false); setError(""); }}>Sign in</button><button type="button" disabled={busy} aria-pressed={register} className={register ? "selected" : ""} onClick={() => { setRegister(true); setError(""); }}>Create account</button></div><h2 id="auth-title">{register ? "Your next project starts here." : "Welcome back."}</h2><p>{register ? "Create your personal ScopeCheck workspace." : "Pick up where you left off."}</p>
        <button type="button" className="button secondary full-width google-button" disabled={!googleEnabled || busy} onClick={google}><span aria-hidden="true">G</span>Continue with Google</button>
        {!googleEnabled && <p className="field-hint">Google sign-in will be available soon.</p>}
        <div className="auth-divider"><span>or use your email</span></div>
        {notice && <p className="auth-message" role="status">{notice}</p>}
        <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy} className="project-fields">
          {register && <><label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" autoComplete="name" required maxLength={100} /></>}
          <label htmlFor="auth-email">Email address</label><input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} />
          <label htmlFor="auth-password">Password</label><input id="auth-password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 12 : 1} maxLength={128} aria-describedby={register ? "password-hint" : undefined}/>
          {register && <p id="password-hint" className="field-hint">Use at least 12 characters. A memorable passphrase works well.</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="submit" className="button primary full-width auth-submit">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
        </fieldset></form><div className="auth-help-links"><Link href="/forgot-password">Forgot password?</Link><Link href="/verify-email">Verify email</Link></div><p className="auth-footnote">Your workspace is private to your account.</p>
      </section>
    </div>
  </main>;
}
