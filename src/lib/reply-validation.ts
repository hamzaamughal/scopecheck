// Pure checks for AI-drafted client replies (no server-only imports, so it is testable offline).

const NUMBER = /\d+(?:[.,]\d+)*/g;
const normalizeNumber = (token: string) => token.replace(/,/g, "").replace(/\.0+$/, "");

// Every number in the reply must already appear in the material it was written from.
// This stops the model from inventing prices, hours, dates, or counts.
export function unsupportedNumbers(body: string, sources: string[]): string[] {
  const allowed = new Set(sources.join("\n").match(NUMBER)?.map(normalizeNumber) ?? []);
  return [...new Set((body.match(NUMBER) ?? []).map(normalizeNumber))].filter(token => !allowed.has(token));
}

export function validateReplyDraft(body: string, sources: string[]): string | null {
  const text = body.trim();
  if (!text) return "The draft was empty.";
  if (/\[(Page \d+|Change order #\d+[^\]]*)\]/.test(text)) return "The draft copied internal markers.";
  const invented = unsupportedNumbers(text, sources);
  if (invented.length) return `The draft mentioned numbers that are not in your project (${invented.slice(0, 3).join(", ")}).`;
  return null;
}
