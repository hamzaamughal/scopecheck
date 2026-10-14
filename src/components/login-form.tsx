"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { authClient } from "@/lib/auth-client";
import ThemeToggle from "@/components/theme-toggle";
import { AuthIcon, GoogleLogo, Spinner } from "@/components/auth-icons";
import Link from "next/link";

const MIN_PASSWORD = 12;

// Static product preview: shows what the app does before anyone signs up.
function ProductPreview() {
  return <figure className="auth-preview" aria-label="Example of a reviewed client request">
    <div className="preview-head"><span className="preview-project">Acme website · Client request</span><span className="preview-date">Today</span></div>
    <p className="preview-title">Add a client login area</p>
    <p className="preview-request">“Could each of our clients get their own account to download files?”</p>
    <div className="preview-suggestion">
      <div className="preview-row"><span className="preview-label">AI suggestion</span><span className="badge extra"><span/>Extra work</span></div>
      <blockquote>User accounts, online payments, and ongoing maintenance are not included.</blockquote>
      <span className="preview-source">Quoted from the agreed scope</span>
    </div>
    <div className="preview-decision"><span className="preview-label">Your decision</span><div className="preview-chips"><span>Included</span><span className="chosen"><AuthIcon name="check" size={13}/>Extra work</span><span>Needs clarification</span></div></div>
  </figure>;
}

export default function LoginForm({ googleEnabled, oauthError, notice = "" }: { googleEnabled: boolean; oauthError: boolean; notice?: string }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [capsLock, setCapsLock] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState(oauthError ? "Google sign-in could not be completed. If you already have an account, sign in with your original method and connect Google from your account menu." : "");

  function switchMode(next: boolean) { setRegister(next); setError(""); setPassword(""); setShowPassword(false); }
  function trackCaps(event: KeyboardEvent<HTMLInputElement>) { setCapsLock(event.getModifierState?.("CapsLock") ?? false); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email")).trim();
    const name = String(fields.get("name") ?? "").trim();
    if (register && !name) { setError("Please enter your name."); return; }
    if (register && password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters for your password.`); return; }
    lock.current = true; setBusy("email"); setError("");
    try {
      const result = register
        ? await authClient.signUp.email({ name, email, password, callbackURL: "/login?verified=1" })
        : await authClient.signIn.email({ email, password, callbackURL: "/" });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") { window.location.replace("/verify-email"); return; }
        setError(result.error.status === 429 ? "Too many attempts. Please wait a minute and try again." : register ? "Could not create this account. Check your details, or sign in if you already have an account." : "That email and password don’t match. Try again or reset your password.");
        return;
      }
      window.location.replace(register ? "/verify-email" : "/");
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { lock.current = false; setBusy(null); }
  }

  async function google() {
    if (lock.current) return;
    lock.current = true; setBusy("google"); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/login?error=google" });
      if (result.error) throw new Error("Sign-in failed");
      // On success the browser navigates to Google; keep the busy state until it does.
    } catch { setError("Google sign-in is unavailable right now. Please use email and password."); lock.current = false; setBusy(null); }
  }

  const passwordOk = password.length >= MIN_PASSWORD;
  return <main className="auth-page">
    <header className="auth-top"><Link className="brand" href="/">scopecheck<span className="brand-dot">.</span></Link><ThemeToggle /></header>
    <div className="auth-layout">
      <section className="auth-intro">
        <span className="eyebrow">Scope checks for freelancers &amp; agencies</span>
        <h1>A little context.<br/>A clearer decision.</h1>
        <p>Save the scope you agreed on. When a client asks for something new, see whether it’s covered, with the exact line from your agreement, then make the call.</p>
        <ProductPreview />
        <ul className="auth-points">
          <li><AuthIcon name="check" size={15}/>Quotes come straight from your scope</li>
          <li><AuthIcon name="check" size={15}/>You make every final decision</li>
          <li><AuthIcon name="check" size={15}/>Private to your account</li>
        </ul>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="segmented auth-tabs" role="group" aria-label="Choose sign in or create account">
          <button type="button" disabled={!!busy} aria-pressed={!register} className={!register ? "selected" : ""} onClick={() => switchMode(false)}>Sign in</button>
          <button type="button" disabled={!!busy} aria-pressed={register} className={register ? "selected" : ""} onClick={() => switchMode(true)}>Create account</button>
        </div>
        <h2 id="auth-title">{register ? "Create your workspace" : "Welcome back"}</h2>
        <p>{register ? "It takes less than a minute." : "Sign in to pick up where you left off."}</p>

        <button type="button" className="google-button" disabled={!googleEnabled || !!busy} onClick={google}>
          {busy === "google" ? <Spinner/> : <GoogleLogo/>}
          <span>{busy === "google" ? "Redirecting to Google…" : register ? "Sign up with Google" : "Continue with Google"}</span>
        </button>
        {!googleEnabled && <p className="field-hint">Google sign-in is not configured yet.</p>}

        <div className="auth-divider" role="separator"><span>or</span></div>
        {notice && <p className="auth-message" role="status">{notice}</p>}

        <form onSubmit={submit} aria-busy={busy === "email"}>
          <fieldset disabled={!!busy} className="auth-fields">
            {register && <div className="auth-field"><label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" autoComplete="name" placeholder="Your full name" required maxLength={100}/></div>}
            <div className="auth-field"><label htmlFor="auth-email">Email</label><input id="auth-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@company.com" required maxLength={254}/></div>
            <div className="auth-field">
              <div className="label-row"><label htmlFor="auth-password">Password</label>{!register && <Link href="/forgot-password" className="inline-link">Forgot password?</Link>}</div>
              <div className="password-input">
                <input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? MIN_PASSWORD : 1} maxLength={128}
                  value={password} onChange={e => setPassword(e.target.value)} onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)}
                  aria-describedby={[register ? "password-rule" : "", capsLock ? "caps-hint" : ""].filter(Boolean).join(" ") || undefined}/>
                <button type="button" className="reveal" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}><AuthIcon name={showPassword ? "eyeOff" : "eye"} size={18}/></button>
              </div>
              {register && <p id="password-rule" className={`password-rule ${passwordOk ? "met" : ""}`}><AuthIcon name="check" size={14}/>At least {MIN_PASSWORD} characters{password && !passwordOk ? ` (${MIN_PASSWORD - password.length} more)` : ""}</p>}
              {capsLock && <p id="caps-hint" className="caps-hint" role="status">Caps Lock is on</p>}
            </div>
            {error && <p role="alert" className="form-error auth-error">{error}</p>}
            <button type="submit" className="button primary full-width auth-submit">{busy === "email" && <Spinner/>}{busy === "email" ? (register ? "Creating account…" : "Signing in…") : register ? "Create account" : "Sign in"}</button>
          </fieldset>
        </form>

        <p className="auth-switch">{register ? <>Already have an account? <button type="button" className="inline-link" disabled={!!busy} onClick={() => switchMode(false)}>Sign in</button></> : <>Didn’t get the verification email? <Link href="/verify-email" className="inline-link">Resend it</Link></>}</p>
        <p className="auth-footnote"><AuthIcon name="lock" size={13}/>Your projects are private to your account.</p>
      </section>
    </div>
  </main>;
}
