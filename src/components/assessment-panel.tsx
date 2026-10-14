import type { useAssessmentUsage } from "@/hooks/use-assessment-usage";
import type { AssessmentState } from "@/hooks/use-assessments";
import { decisionLabels } from "@/lib/request-view";
import { pageOfQuote } from "@/lib/scope-import/normalize";

export default function AssessmentPanel({ scope, state, onGenerate, onLoad, allowance }: { scope: string; allowance: ReturnType<typeof useAssessmentUsage>; state?: AssessmentState; onGenerate: () => void; onLoad: () => void }) {
  const assessment = state?.assessment;
  const loading = state?.loading ?? true;
  const exhausted = allowance.usage?.remaining === 0;
  const generationBlocked = !allowance.usage || exhausted || !!allowance.error;
  return <section className="assessment" aria-label="Scope assessment" aria-busy={loading}>
    <div className="assessment-heading"><span>Scope assessment</span><span className="sample-tag">AI suggestion</span></div>
    {assessment ? <>
      {assessment.isStale && <p className="assessment-stale" role="status">The scope or request has changed since this assessment. Assess again before using this suggestion.</p>}
      <p className="assessment-caption">Saved <time dateTime={assessment.createdAt}>{new Date(assessment.createdAt).toLocaleString()}</time></p>
      <span className={`badge ${assessment.suggestedDecision === "included" ? "included" : assessment.suggestedDecision === "extra_work" ? "extra" : "clarify"}`}><span/>{decisionLabels[assessment.suggestedDecision]}</span>
      <p>{assessment.explanation}</p>
      <div className="evidence-label">FROM THE AGREED SCOPE</div>
      {assessment.evidence.length ? assessment.evidence.map((quote, index) => { const page = pageOfQuote(scope, quote); return <blockquote key={index}>{quote}{page !== null && <cite className="quote-page">Page {page}</cite>}</blockquote>; }) : <p>No supporting scope quote was identified.</p>}
      {assessment.clarificationQuestions.length > 0 && <div className="assessment-questions"><h3>Questions to clarify</h3><ul>{assessment.clarificationQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
    </> : <div className="ai-empty"><p>A second opinion on this request.</p><span>Check it against your agreed scope for a suggestion and supporting quotes.</span></div>}
    <div className="assessment-allowance" aria-live="polite">
      {allowance.usage ? <><strong>{allowance.usage.remaining} of {allowance.usage.limit} assessment attempts remaining</strong><span>Resets {new Date(allowance.usage.resetsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (your local time).</span></> : <span>Loading your allowance…</span>}
      {exhausted && <p>Daily limit reached. Saved assessments and manual decisions are still available.</p>}
      {allowance.error && <p role="alert">{allowance.error}</p>}
      {(allowance.error || exhausted) && <button type="button" className="text-button" onClick={() => void allowance.refresh()}>Refresh allowance</button>}
    </div>
    <div className="assessment-actions"><button type="button" className="button secondary" disabled={loading || (!state?.retryLoad && generationBlocked)} onClick={state?.retryLoad ? onLoad : onGenerate}>{loading ? state?.generating ? "Assessing request…" : "Loading assessment…" : state?.retryLoad ? "Reload saved assessment" : exhausted ? "Daily limit reached" : state?.error ? "Try assessment again" : assessment ? "Assess again" : "Assess request"}</button></div>
    {loading && <p role="status">{state?.generating ? "Comparing the request with your scope. This may take a moment." : "Getting your saved assessment."}</p>}
    {state?.error && <div className="form-error" role="alert">{state.error}{assessment && " Your previous suggestion is still shown."}</div>}
    <p className="assessment-caption">Review the evidence before saving your own decision below. Successful assessments are saved automatically. Attempts count once processing starts, including failed attempts.</p>
  </section>;
}
