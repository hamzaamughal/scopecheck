import type { useAssessmentUsage } from "@/hooks/use-assessment-usage";
import type { AssessmentState } from "@/hooks/use-assessments";
import { decisionLabels } from "@/lib/request-view";
import { pageOfQuote } from "@/lib/scope-import/normalize";
import { Icon } from "@/components/ui";

export default function AssessmentPanel({ scope, state, onGenerate, onLoad, allowance }: { scope: string; allowance: ReturnType<typeof useAssessmentUsage>; state?: AssessmentState; onGenerate: () => void; onLoad: () => void }) {
  const assessment = state?.assessment;
  const loading = state?.loading ?? true;
  const exhausted = allowance.usage?.remaining === 0;
  const generationBlocked = !allowance.usage || exhausted || !!allowance.error;
  return <section className="assessment" aria-label="Scope assessment" aria-busy={loading}>
    <div className="assessment-heading"><span>Scope assessment</span><span className="sample-tag">AI suggestion</span></div>
    {assessment ? <>
      {assessment.isStale && <p className="assessment-stale" role="status">The scope, request, or supporting documents changed since this assessment. Assess again before using this suggestion.</p>}
      <p className="assessment-caption">Saved <time dateTime={assessment.createdAt}>{new Date(assessment.createdAt).toLocaleString()}</time></p>
      <span className={`badge ${assessment.suggestedDecision === "included" ? "included" : assessment.suggestedDecision === "extra_work" ? "extra" : "clarify"}`}><span/>{decisionLabels[assessment.suggestedDecision]}</span>
      <p>{assessment.explanation}</p>
      {assessment.citations ? <>
        <div className="evidence-label">EVIDENCE</div>
        {assessment.citations.length ? assessment.citations.map((citation, index) => {
          const page = citation.binding ? pageOfQuote(scope, citation.quote) : citation.page;
          return <blockquote key={index} className={citation.binding ? "" : "context-quote"}>{citation.quote}
            <cite className="citation-source"><span className={`citation-tag ${citation.binding ? "binding" : "context"}`}>{citation.binding ? "Binding" : "Context"}</span>
              {citation.binding ? "Agreed scope" : citation.documentTitle}{page != null && ` · Page ${page}`}</cite></blockquote>;
        }) : <p>No supporting quote was identified.</p>}
      </> : <>
        <div className="evidence-label">FROM THE AGREED SCOPE</div>
        {assessment.evidence.length ? assessment.evidence.map((quote, index) => { const page = pageOfQuote(scope, quote); return <blockquote key={index}>{quote}{page !== null && <cite className="quote-page">Page {page}</cite>}</blockquote>; }) : <p>No supporting scope quote was identified.</p>}
      </>}
      {assessment.context && <p className="context-note"><Icon name="file" size={13}/>{assessment.context.mode === "full"
        ? `Checked the agreed scope and ${assessment.context.documentCount} supporting ${assessment.context.documentCount === 1 ? "document" : "documents"} in full.`
        : `Checked the agreed scope in full and the ${assessment.context.chunkCount} most relevant sections from ${assessment.context.documentCount} documents (${assessment.context.search === "hybrid" ? "keyword + semantic search" : "keyword search"}).`}</p>}
      {assessment.clarificationQuestions.length > 0 && <div className="assessment-questions"><h3>Questions to clarify</h3><ul>{assessment.clarificationQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
    </> : <div className="ai-empty"><p>A second opinion on this request.</p><span>Check it against your agreed scope for a suggestion and supporting quotes.</span></div>}
    <div className="assessment-allowance" aria-live="polite">
      {allowance.usage ? <><strong>{allowance.usage.remaining} of {allowance.usage.limit} AI attempts left today</strong><span>Resets {new Date(allowance.usage.resetsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (your local time).</span></> : <span>Loading your allowance…</span>}
      {exhausted && <p>Daily limit reached. Saved assessments and manual decisions are still available.</p>}
      {allowance.error && <p role="alert">{allowance.error}</p>}
      {(allowance.error || exhausted) && <button type="button" className="text-button" onClick={() => void allowance.refresh()}>Refresh allowance</button>}
    </div>
    <div className="assessment-actions"><button type="button" className="button secondary" disabled={loading || (!state?.retryLoad && generationBlocked)} onClick={state?.retryLoad ? onLoad : onGenerate}>{loading ? state?.generating ? "Assessing request…" : "Loading assessment…" : state?.retryLoad ? "Reload saved assessment" : exhausted ? "Daily limit reached" : state?.error ? "Try assessment again" : assessment ? "Assess again" : "Assess request"}</button></div>
    {loading && <p role="status">{state?.generating ? "Comparing the request with your scope. This may take a moment." : "Getting your saved assessment."}</p>}
    {state?.error && <div className="form-error" role="alert">{state.error}{assessment && " Your previous suggestion is still shown."}</div>}
    <p className="assessment-caption">Review the evidence before saving your own decision below. Successful assessments are saved automatically. Assessments and reply drafts share the daily allowance; an attempt counts once processing starts, even if it fails.</p>
  </section>;
}
