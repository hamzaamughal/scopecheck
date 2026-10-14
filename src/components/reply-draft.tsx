"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { ApiClientError } from "@/lib/api-client";
import { getReplyDraft, generateReplyDraft } from "@/services/workflow";
import { decisionLabels } from "@/lib/request-view";
import type { useAssessmentUsage } from "@/hooks/use-assessment-usage";
import type { RequestDecision } from "@/types/request";
import type { ReplyDraftDto } from "@/types/workflow";

// AI-drafted reply to the client, written from the human decision. Editable here, copied by the user, never sent.
export default function ReplyDraft({ projectId, requestId, decision, allowance }: {
  projectId: string; requestId: string; decision: RequestDecision | null; allowance: ReturnType<typeof useAssessmentUsage>;
}) {
  const [draft, setDraft] = useState<ReplyDraftDto | null>(null);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<"friendly" | "formal">("friendly");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getReplyDraft(projectId, requestId, controller.signal)
      .then(({ draft }) => { setDraft(draft); setText(draft?.body ?? ""); if (draft) setTone(draft.tone); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load the saved reply."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, requestId]);

  async function generate() {
    if (busy.current || !decision) return;
    busy.current = true; setGenerating(true); setError("");
    try {
      const { draft } = await generateReplyDraft(projectId, requestId, tone);
      setDraft(draft); setText(draft?.body ?? "");
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.code === "NETWORK_ERROR"
        ? "Connection lost. Reopen this request to check whether a draft was saved."
        : caught instanceof Error ? caught.message : "Could not draft a reply.");
    } finally { busy.current = false; setGenerating(false); void allowance.refresh(); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("Copy failed. Select the text and copy it manually."); }
  }

  const stale = draft && decision && draft.decision !== decision;
  const exhausted = allowance.usage?.remaining === 0;
  return <section className="reply-draft" aria-label="Reply to client" aria-busy={loading || generating}>
    <div className="reply-head">
      <div><h3>Reply to the client</h3><p>A draft written from your decision. Edit it, then copy it into your email or chat.</p></div>
      <span className="sample-tag">AI draft</span>
    </div>
    {!decision ? <p className="reply-empty">Save a decision above to draft a reply.</p> : <>
      <div className="reply-controls">
        <div className="segmented" role="group" aria-label="Tone">
          {(["friendly", "formal"] as const).map(value => <button key={value} type="button" className={tone === value ? "selected" : ""} aria-pressed={tone === value} disabled={generating} onClick={() => setTone(value)}>{value === "friendly" ? "Friendly" : "Formal"}</button>)}
        </div>
        <button type="button" className="button secondary small" disabled={generating || loading || exhausted || !allowance.usage} onClick={() => void generate()}>
          {generating ? <><span className="spinner"/>Drafting…</> : <><Icon name="sparkle" size={14}/>{draft ? "Draft again" : "Draft reply"}</>}
        </button>
      </div>
      {stale && <p className="assessment-stale" role="status">This draft was written for “{decisionLabels[draft.decision]}”. Your decision is now “{decisionLabels[decision]}”. Draft again before sending.</p>}
      {loading ? <p className="reply-empty" role="status">Loading saved reply…</p> : draft || text ? <>
        <textarea className="reply-text" aria-label="Reply text" rows={9} value={text} onChange={e => setText(e.target.value)} maxLength={6000}/>
        <div className="reply-actions">
          <span className="small-muted">{draft ? `Drafted ${new Date(draft.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${draft.changeOrderNumber ? ` · includes change order #${draft.changeOrderNumber}` : ""}${text !== draft.body ? " · edited" : ""}` : ""}</span>
          <button type="button" className="button primary small" onClick={() => void copy()} disabled={!text.trim()}><Icon name={copied ? "check" : "copy"} size={14}/>{copied ? "Copied" : "Copy"}</button>
        </div>
      </> : <p className="reply-empty">No draft yet. Drafting uses one AI attempt from your daily allowance.</p>}
      {exhausted && <p className="small-muted">Daily AI limit reached. You can still edit and copy the saved draft.</p>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
