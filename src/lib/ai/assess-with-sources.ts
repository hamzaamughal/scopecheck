import "server-only";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { ASSESSMENT_MODEL, SYSTEM_PROMPT } from "./assess-request.ts";
import type { Assessment, Citation } from "../../schemas/assessment.ts";
import type { DocumentKind } from "../../types/documents.ts";

// One supporting source given to the model: a whole document ("full" mode) or a retrieved chunk.
export type SupportingSource = {
  ref: string;                 // short id the model cites, e.g. "D1" or "C3"
  documentId: string; documentTitle: string; documentKind: DocumentKind;
  page: number | null;         // known for chunks; for whole documents, derived from the quote
  text: string;
};

const SOURCES_PROMPT = `${SYSTEM_PROMPT}
You also receive supporting sources (proposals, emails, meeting notes), each with a short ref such as "D1" or "C2".
Authority:
- Only agreedScope is binding. Supporting sources are context: they can explain intent or show what was discussed,
  but they cannot by themselves add or remove work from the agreement.
- If a supporting source contradicts agreedScope (for example an email that promises work the scope excludes),
  choose needs_clarification, cite both, and ask which applies.
- A supporting source that only repeats the scope adds nothing; prefer quoting agreedScope.
Evidence: each item has "source" ("scope" for agreedScope, or a supporting ref) and an exact, contiguous "quote"
copied from that source. A definitive decision (included or extra_work) needs at least one quote from agreedScope.
`;

export const sourcedAssessmentOutputSchema = z.object({
  suggestedDecision: z.enum(["included", "extra_work", "needs_clarification"]),
  explanation: z.string().min(1).max(2000),
  evidence: z.array(z.object({ source: z.string().min(1).max(20), quote: z.string().min(1).max(1500) })).max(6),
  clarificationQuestions: z.array(z.string().min(1).max(500)).max(3),
});
type SourcedOutput = z.infer<typeof sourcedAssessmentOutputSchema>;

const PAGE_LINE = /^\[Page (\d+)\]$/gm;
function pageWithin(text: string, quote: string): number | null {
  const at = text.indexOf(quote);
  if (at < 0) return null;
  let page: number | null = null;
  for (const match of text.slice(0, at).matchAll(PAGE_LINE)) page = Number(match[1]);
  return page;
}

// Pure: checks every quote against the exact source it cites and converts to the stored shape.
// Throws on any unsupported quote, like the scope-only path.
export function toSourcedAssessment(output: SourcedOutput, scope: string, sources: SupportingSource[]): Assessment {
  const byRef = new Map(sources.map(source => [source.ref.toUpperCase(), source]));
  const citations: Citation[] = output.evidence.map(({ source, quote }) => {
    if (source.toLowerCase() === "scope") {
      if (!scope.includes(quote)) throw new Error("Assessment contains unsupported evidence");
      return { quote, binding: true, documentId: null, documentTitle: null, documentKind: null, page: null };
    }
    const found = byRef.get(source.toUpperCase());
    if (!found || !found.text.includes(quote)) throw new Error("Assessment contains unsupported evidence");
    return { quote, binding: false, documentId: found.documentId, documentTitle: found.documentTitle, documentKind: found.documentKind,
      page: found.page ?? pageWithin(found.text, quote) };
  });
  const binding = citations.filter(citation => citation.binding).map(citation => citation.quote);
  if (output.suggestedDecision !== "needs_clarification" && binding.length === 0) {
    throw new Error("A definitive assessment requires scope evidence");
  }
  if (output.suggestedDecision === "needs_clarification" && output.clarificationQuestions.length === 0) {
    throw new Error("An uncertain assessment requires clarification questions");
  }
  return { suggestedDecision: output.suggestedDecision, explanation: output.explanation, evidence: binding.slice(0, 5),
    clarificationQuestions: output.clarificationQuestions, citations };
}

// Deterministic local stand-in (never in production): quotes the best keyword-matching sentence.
function fakeOutput(input: { scope: string; title: string; description: string; sources: SupportingSource[] }): SourcedOutput {
  const words = new Set(`${input.title} ${input.description}`.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const best = (text: string) => (text.match(/[^.\n]+[.]?/g) ?? []).map(sentence => sentence.trim()).filter(Boolean)
    .map(sentence => ({ sentence, hits: (sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(word => words.has(word) || words.has(word.replace(/s$/, ""))).length }))
    .sort((a, b) => b.hits - a.hits)[0];
  const scopeHit = best(input.scope.replace(PAGE_LINE, ""));
  const sourceHits = input.sources.map(source => ({ source, hit: best(source.text.replace(PAGE_LINE, "")) })).filter(item => item.hit?.hits).sort((a, b) => b.hit!.hits - a.hit!.hits);
  const evidence = [
    ...(scopeHit?.hits ? [{ source: "scope", quote: scopeHit.sentence }] : []),
    ...(sourceHits[0] ? [{ source: sourceHits[0].source.ref, quote: sourceHits[0].hit!.sentence }] : []),
  ];
  return { suggestedDecision: "needs_clarification", explanation: "Local test assessment: compare the cited scope and supporting context.",
    evidence, clarificationQuestions: ["Which of the cited sources should apply to this request?"] };
}

export async function assessRequestWithSources(input: { scope: string; title: string; description: string; sources: SupportingSource[] }): Promise<Assessment> {
  let output: SourcedOutput;
  if (process.env.SCOPECHECK_FAKE_AI === "1" && process.env.NODE_ENV !== "production") {
    output = fakeOutput(input);
  } else {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
    const prompt = JSON.stringify({
      agreedScope: input.scope,
      request: { title: input.title, description: input.description },
      supportingSources: input.sources.map(source => ({ ref: source.ref, document: source.documentTitle, kind: source.documentKind, page: source.page, text: source.text })),
    });
    ({ output } = await generateText({
      model: openai.responses(ASSESSMENT_MODEL),
      system: SOURCES_PROMPT,
      prompt,
      output: Output.object({ schema: sourcedAssessmentOutputSchema }),
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
      maxOutputTokens: 4000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45_000),
    }));
  }
  return toSourcedAssessment(output, input.scope, input.sources);
}
