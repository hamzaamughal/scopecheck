"use client";
import { useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { ApiClientError } from "@/lib/api-client";
import { deleteAccountSchema } from "@/schemas/account";
import { deleteAccount } from "@/services/account";
import { Icon, Modal } from "@/components/ui";

export default function AccountMenu({ user, googleEnabled }: { user: { name: string; email: string }; googleEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);

  async function signOut() {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      window.location.replace("/login");
    } catch { setError("Could not sign out. Please try again."); setBusy(false); }
  }
  async function connectGoogle() {
    setBusy(true); setError("");
    try {
      const result = await authClient.linkSocial({ provider: "google", callbackURL: "/" });
      if (result.error) throw new Error("Link failed");
    } catch { setError("Could not connect Google. It may already be connected."); setBusy(false); }
  }
  function openDelete() {
    // The dialog renders outside <details>, so close the popover first.
    if (menu.current) menu.current.open = false;
    setDeleteError(""); setConfirming(true);
  }
  async function submitDelete(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const parsed = deleteAccountSchema.safeParse({ confirmEmail: new FormData(e.currentTarget).get("confirmEmail") });
    if (!parsed.success) { setDeleteError(parsed.error.issues[0].message); return; }
    if (parsed.data.confirmEmail.toLowerCase() !== user.email.toLowerCase()) { setDeleteError("This does not match your account email."); return; }
    setBusy(true); setDeleteError("");
    try {
      await deleteAccount(parsed.data);
      window.location.replace("/login");
    } catch (error) {
      setDeleteError(error instanceof ApiClientError && error.code === "NETWORK_ERROR"
        ? "Connection lost. Refresh to check whether your account was deleted before trying again."
        : error instanceof Error ? error.message : "Could not delete your account. Please try again.");
      setBusy(false);
    }
  }

  return <>
    <details className="account-menu" ref={menu}><summary aria-label="Your account"><span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span></summary><div className="account-popover"><strong>{user.name}</strong><p>{user.email}</p>{googleEnabled && <button type="button" className="button secondary full-width" disabled={busy} onClick={connectGoogle}>Connect Google</button>}<button type="button" className="button secondary full-width" disabled={busy} onClick={signOut}>{busy ? "Please wait…" : "Sign out"}</button><button type="button" className="danger-link" disabled={busy} onClick={openDelete}>Delete account</button>{error && <p className="form-error" role="alert">{error}</p>}</div></details>
    {confirming && <Modal title="Delete your account?" subtitle="All your projects, requests, decisions, and saved AI suggestions will be permanently deleted, and you will be signed out everywhere." busy={busy} onClose={() => setConfirming(false)}>
      <form onSubmit={submitDelete} aria-busy={busy}><fieldset disabled={busy} className="project-fields">
        <label htmlFor="confirm-email">Type <strong>{user.email}</strong> to confirm</label>
        <input id="confirm-email" name="confirmEmail" type="email" autoComplete="off" required maxLength={320} aria-invalid={!!deleteError}/>
        <p className="field-hint">This cannot be undone.</p>
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setConfirming(false)}>Cancel</button><button type="submit" className="button danger"><Icon name="trash" size={16}/>{busy ? "Deleting…" : "Delete account"}</button></div>
      </fieldset></form>
    </Modal>}
  </>;
}
