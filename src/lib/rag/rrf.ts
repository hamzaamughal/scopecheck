// Reciprocal rank fusion: merges ranked lists without comparing their raw scores
// (ts_rank and cosine distance are on different scales). score(id) = Σ 1 / (k + rank).
export const RRF_K = 60;

export function reciprocalRankFusion(lists: string[][], limit: number, k = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// Builds an OR full-text query from free text: "Could clients get their own account?" should match
// a chunk that mentions "accounts" even though most words are absent. Returns null when nothing is searchable.
export function orQueryTerms(text: string): string[] {
  const words = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/);
  return [...new Set(words.filter(word => word.length >= 3 && word.length <= 40))].slice(0, 40);
}
