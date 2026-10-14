// Pure routing decision for an assessment (unit-tested).
// Up to FULL_CONTEXT_CHARS (agreed scope + all documents, ≈ 25k tokens) everything is sent in full, so
// retrieval cannot miss anything. Above it, documents are searched and only the top chunks are sent.
// The agreed scope itself is always sent in full.
export const FULL_CONTEXT_CHARS = 100_000;
export const RETRIEVED_CHUNKS = 8;

export type ContextPlan = { mode: "scope_only" | "full" | "retrieval"; documentCount: number; totalChars: number };

export function planContext(scopeChars: number, documentChars: number[]): ContextPlan {
  const totalChars = scopeChars + documentChars.reduce((sum, n) => sum + n, 0);
  if (!documentChars.length) return { mode: "scope_only", documentCount: 0, totalChars };
  return { mode: totalChars <= FULL_CONTEXT_CHARS ? "full" : "retrieval", documentCount: documentChars.length, totalChars };
}
