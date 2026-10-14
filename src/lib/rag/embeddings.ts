import "server-only";
import { createHash } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const FAKE_EMBEDDING_MODEL = "fake-hashed-bow";

// Local tests and demos must never spend money: a deterministic bag-of-words vector (hashed, L2-normalised).
// It is lexical, not semantic, but exercises the same SQL, indexes, and fusion as real embeddings.
const fakeEnabled = () => process.env.SCOPECHECK_FAKE_AI === "1" && process.env.NODE_ENV !== "production";

export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(word => word.length > 2);
  for (const word of words) {
    const stem = word.replace(/(ing|ed|es|s)$/, "");
    const hash = createHash("sha256").update(stem).digest();
    vector[hash.readUInt32BE(0) % EMBEDDING_DIMENSIONS] += hash[4] & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map(value => value / norm);
}

export function embeddingsAvailable() {
  if (process.env.RAG_EMBEDDINGS === "off") return false;
  return fakeEnabled() || Boolean(process.env.OPENAI_API_KEY);
}

export function activeEmbeddingModel() {
  return fakeEnabled() ? FAKE_EMBEDDING_MODEL : EMBEDDING_MODEL;
}

// Rough token estimate for budgeting before the call (≈ 4 characters per token).
export const estimateTokens = (texts: string[]) => Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4);

export async function embedTexts(texts: string[], timeoutMs = 20_000): Promise<{ vectors: number[][]; model: string; tokens: number }> {
  if (!texts.length) return { vectors: [], model: activeEmbeddingModel(), tokens: 0 };
  if (fakeEnabled()) return { vectors: texts.map(fakeEmbedding), model: FAKE_EMBEDDING_MODEL, tokens: estimateTokens(texts) };
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  const { embeddings, usage } = await embedMany({
    model: openai.embedding(EMBEDDING_MODEL),
    values: texts,
    maxParallelCalls: 2,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  if (embeddings.some(vector => vector.length !== EMBEDDING_DIMENSIONS)) throw new Error("Unexpected embedding size");
  return { vectors: embeddings, model: EMBEDDING_MODEL, tokens: usage?.tokens ?? estimateTokens(texts) };
}

// pgvector text format: "[0.1,0.2,...]"
export const toVectorLiteral = (vector: number[]) => `[${vector.map(value => Number(value.toFixed(7))).join(",")}]`;
