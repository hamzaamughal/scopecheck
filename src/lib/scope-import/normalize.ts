// Pure helpers shared by the browser (file import) and the server (link import, saving).
export const SCOPE_MAX_CHARS = 60_000;
export const PAGE_MARKER = /^\[Page (\d+)\]$/gm;

// Collapse noisy whitespace from PDFs/HTML while keeping paragraph breaks.
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Join per-page text with "[Page N]" lines so quotes can be traced back to a page.
export function joinPages(pages: string[]): string {
  return pages
    .map((text, index) => ({ text: normalizeText(text), page: index + 1 }))
    .filter(entry => entry.text)
    .map(entry => `[Page ${entry.page}]\n${entry.text}`)
    .join("\n\n");
}

// Page containing `quote`, from the nearest marker before it. Robust to edits made after import.
export function pageOfQuote(scope: string, quote: string): number | null {
  const at = scope.indexOf(quote);
  if (at < 0) return null;
  let page: number | null = null;
  for (const match of scope.slice(0, at).matchAll(PAGE_MARKER)) page = Number(match[1]);
  return page;
}

export function hasPageMarkers(scope: string): boolean {
  return /^\[Page \d+\]$/m.test(scope);
}

export async function contentHash(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export type ImportedScope = { text: string; label: string; pageCount?: number; sourceUrl?: string; contentHash: string };

export class ScopeImportError extends Error {
  constructor(message: string) { super(message); this.name = "ScopeImportError"; }
}

export function assertImportable(text: string, maxChars = SCOPE_MAX_CHARS) {
  if (!text) throw new ScopeImportError("No readable text was found.");
  if (text.length > maxChars) {
    throw new ScopeImportError(`This document has ${text.length.toLocaleString("en")} characters. The limit is ${maxChars.toLocaleString("en")}; ${maxChars === SCOPE_MAX_CHARS ? "paste only the scope sections instead" : "split it into smaller documents"}.`);
  }
}

// Line-level diff for "check for changes" (small inputs; LCS is fine at 60k chars ≈ a few thousand lines).
export function diffLines(before: string, after: string): { type: "same" | "added" | "removed"; text: string }[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 4_000_000) {
    return [...a.map(text => ({ type: "removed" as const, text })), ...b.map(text => ({ type: "added" as const, text }))];
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const out: { type: "same" | "added" | "removed"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({ type: "removed", text: a[i++] });
    else out.push({ type: "added", text: b[j++] });
  }
  while (i < a.length) out.push({ type: "removed", text: a[i++] });
  while (j < b.length) out.push({ type: "added", text: b[j++] });
  return out;
}
