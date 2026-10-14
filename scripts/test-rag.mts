// Offline tests for the RAG pieces: chunking, rank fusion, routing, and quote-to-source validation.
// No AI calls, no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_MAX_CHARS, chunkDocument, isHeading } from "../src/lib/rag/chunk.ts";
import { orQueryTerms, reciprocalRankFusion } from "../src/lib/rag/rrf.ts";
import { FULL_CONTEXT_CHARS, planContext } from "../src/lib/rag/plan.ts";
import { toSourcedAssessment, type SupportingSource } from "../src/lib/ai/assess-with-sources.ts";
import { joinPages } from "../src/lib/scope-import/normalize.ts";

test("chunks never cross page markers and keep their page", () => {
  const text = joinPages(["Intro paragraph about the project.\n\nTimeline is six weeks.", "5. Exclusions\nUser accounts are not included.", "Contacts and sign-off."]);
  const chunks = chunkDocument(text);
  assert.deepEqual(chunks.map(c => c.page), [1, 2, 3]);
  assert.ok(chunks.every(c => !/\[Page \d+\]/.test(c.text)), "markers are not part of chunk text");
  const exclusions = chunks.find(c => c.text.includes("User accounts"))!;
  assert.equal(exclusions.heading, "5. Exclusions");
  assert.deepEqual(chunks.map(c => c.ordinal), [0, 1, 2]);
});

test("long documents are split near the target size, with no chunk over the max", () => {
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${"The client asked about the scope of the work. ".repeat(6)}`);
  const chunks = chunkDocument(paragraphs.join("\n\n"));
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(c => c.text.length <= CHUNK_MAX_CHARS + 400), "within max + overlap");
  // Every paragraph is somewhere in the output.
  for (let i = 0; i < 40; i++) assert.ok(chunks.some(c => c.text.includes(`Paragraph ${i}:`)), `paragraph ${i} kept`);
});

test("a single huge paragraph is split by sentence", () => {
  const chunks = chunkDocument("Sentence about payments. ".repeat(400));
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every(c => c.text.length <= CHUNK_MAX_CHARS));
});

test("short trailing paragraphs overlap into the next chunk", () => {
  const big = "Detailed description of deliverables and assumptions. ".repeat(18);
  const chunks = chunkDocument([big, "Logins are out of scope.", big].join("\n\n"));
  const holders = chunks.filter(c => c.text.includes("Logins are out of scope."));
  assert.equal(holders.length, 2, "repeated at the start of the next chunk");
});

test("heading detection", () => {
  for (const line of ["5. Exclusions", "## Scope", "OUT OF SCOPE", "Not included:", "2.1 Pages"]) assert.ok(isHeading(line), line);
  for (const line of ["The site has five pages.", "", "a".repeat(100), "We will deliver, test, and launch."]) assert.ok(!isHeading(line), line);
});

test("reciprocal rank fusion rewards items found by both searches", () => {
  const fused = reciprocalRankFusion([["a", "b", "c"], ["c", "d", "a"]], 3);
  assert.deepEqual(fused.map(item => item.id), ["a", "c", "b"]);
  assert.ok(fused[0].score > fused[2].score);
  assert.deepEqual(reciprocalRankFusion([[], []], 5), []);
  assert.deepEqual(reciprocalRankFusion([["x"], []], 5).map(item => item.id), ["x"]);
});

test("query terms are lowercased, deduplicated, and stripped of punctuation", () => {
  assert.deepEqual(orQueryTerms("Could clients get their OWN account? Account!"), ["could", "clients", "get", "their", "own", "account"]);
  assert.deepEqual(orQueryTerms("a to ?"), []);
});

test("routing: scope only, full context, retrieval", () => {
  assert.equal(planContext(5000, []).mode, "scope_only");
  assert.equal(planContext(5000, [10_000, 20_000]).mode, "full");
  assert.equal(planContext(50_000, [FULL_CONTEXT_CHARS]).mode, "retrieval");
  assert.equal(planContext(1, [FULL_CONTEXT_CHARS - 1]).mode, "full");
});

const scope = "[Page 1]\nFive marketing pages.\n\n[Page 2]\nUser accounts, online payments, and ongoing maintenance are not included.";
const sources: SupportingSource[] = [
  { ref: "C1", documentId: "11111111-1111-4111-8111-111111111111", documentTitle: "Kickoff email", documentKind: "email", page: null,
    text: "From the client: we may want a client portal later.\n\n[Page 2]\nWe agreed to discuss logins after launch." },
];

test("quotes are validated against the exact source they cite", () => {
  const result = toSourcedAssessment({
    suggestedDecision: "extra_work", explanation: "Accounts are excluded.", clarificationQuestions: [],
    evidence: [{ source: "scope", quote: "User accounts, online payments, and ongoing maintenance are not included." },
      { source: "c1", quote: "We agreed to discuss logins after launch." }],
  }, scope, sources);
  assert.deepEqual(result.evidence, ["User accounts, online payments, and ongoing maintenance are not included."]);
  assert.equal(result.citations?.length, 2);
  assert.equal(result.citations?.[0].binding, true);
  assert.deepEqual({ ...result.citations![1] }, { quote: "We agreed to discuss logins after launch.", binding: false,
    documentId: sources[0].documentId, documentTitle: "Kickoff email", documentKind: "email", page: 2 });
});

test("a quote attributed to the wrong source is rejected", () => {
  assert.throws(() => toSourcedAssessment({ suggestedDecision: "needs_clarification", explanation: "x", clarificationQuestions: ["Which?"],
    evidence: [{ source: "scope", quote: "We agreed to discuss logins after launch." }] }, scope, sources), /unsupported evidence/);
  assert.throws(() => toSourcedAssessment({ suggestedDecision: "needs_clarification", explanation: "x", clarificationQuestions: ["Which?"],
    evidence: [{ source: "C9", quote: "Five marketing pages." }] }, scope, sources), /unsupported evidence/);
});

test("a definitive decision needs a binding (scope) quote; context alone is not enough", () => {
  assert.throws(() => toSourcedAssessment({ suggestedDecision: "included", explanation: "The email says so.", clarificationQuestions: [],
    evidence: [{ source: "C1", quote: "we may want a client portal later." }] }, scope, sources), /requires scope evidence/);
});
