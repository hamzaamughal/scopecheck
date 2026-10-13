"use client";

import { useRef, useState, type FormEvent } from "react";
import { ApiClientError } from "@/lib/api-client";
import type { Request, Decision } from "@/lib/demo-data";
import { updateDecision } from "@/services/requests";
import { updateDecisionSchema } from "@/schemas/request";
import type { RequestDecision, RequestDto } from "@/types/request";

const values: Record<Decision, RequestDecision> = { Included: "included", "Extra work": "extra_work", "Needs clarification": "needs_clarification" };

export default function DecisionForm({ projectId, request, onSaved }: { projectId: string; request: Request; onSaved: (request: RequestDto) => void }) {
  const [decision, setDecision] = useState<RequestDecision | "">(request.decision ? values[request.decision] : "");
  const [note, setNote] = useState(request.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const parsed = updateDecisionSchema.safeParse({ decision, decisionNote: note });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(" ")); return; }
    inFlight.current = true; setSaving(true); setError("");
    try {
      const { request: saved } = await updateDecision(projectId, request.id, parsed.data);
      setNote(saved.decisionNote || "");
      onSaved(saved);
    } catch (error) {
      setError(error instanceof ApiClientError && error.code === "NETWORK_ERROR"
        ? "Connection lost while saving. Refresh to check whether the decision was saved before trying again."
        : error instanceof Error ? error.message : "Could not save the decision. Please try again.");
    } finally { inFlight.current = false; setSaving(false); }
  }

  return <form className="decision-form" onSubmit={submit} aria-busy={saving}>
    <h3>Your decision</h3><p>Record your decision and the context behind it.</p>
    <fieldset className="project-fields" disabled={saving}>
      <label htmlFor="decision">How should this request be handled?</label>
      <select id="decision" required value={decision} onChange={e => setDecision(e.target.value as RequestDecision | "")}>
        <option value="" disabled>Select a decision</option>
        <option value="included">Included</option><option value="extra_work">Extra work</option><option value="needs_clarification">Needs clarification</option>
      </select>
      <label htmlFor="decision-note">Decision note <span>(optional)</span></label>
      <textarea id="decision-note" rows={3} placeholder="Add context for your decision..." value={note} onChange={e => setNote(e.target.value)} maxLength={2000}/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={!decision}>{saving ? "Saving decision…" : request.decision ? "Update decision" : "Save decision"}</button>
    </fieldset>
  </form>;
}
