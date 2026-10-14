// Pure, deterministic chunking for supporting documents. Shared by the server and offline tests.
//
// - Never crosses a "[Page N]" marker, so every chunk has one page.
// - Splits on paragraphs, packs them up to TARGET_CHARS, and splits long paragraphs by sentence.
// - Tracks the nearest heading so a chunk like "Not included: logins" keeps its section name.
// - Carries a short trailing paragraph into the next chunk (overlap) so a clause cut at a boundary
//   is still findable from either side.

export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_MAX_CHARS = 2000;
const OVERLAP_MAX_CHARS = 300;

export type Chunk = { ordinal: number; page: number | null; heading: string | null; text: string };

const PAGE_LINE = /^\[Page (\d+)\]$/;

export function isHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 80 || /[.,;]$/.test(text)) return false;
  if (/^(#{1,6}\s|\d+(\.\d+)*[.)]?\s+\S)/.test(text)) return true; // "## Scope", "5. Exclusions", "2.1 Pages"
  if (/:$/.test(text)) return true;                                   // "Not included:"
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();     // "OUT OF SCOPE"
}

function splitLong(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_MAX_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) ?? [paragraph];
  const out: string[] = []; let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_TARGET_CHARS) { out.push(current.trim()); current = ""; }
    if (sentence.length > CHUNK_MAX_CHARS) {
      for (let i = 0; i < sentence.length; i += CHUNK_MAX_CHARS) out.push(sentence.slice(i, i + CHUNK_MAX_CHARS).trim());
      continue;
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

type Block = { page: number | null; heading: string | null; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let page: number | null = null; let heading: string | null = null; let buffer: string[] = [];
  const flush = () => {
    const paragraph = buffer.join("\n").trim(); buffer = [];
    if (paragraph) for (const part of splitLong(paragraph)) out.push({ page, heading, text: part });
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const marker = PAGE_LINE.exec(line);
    if (marker) { flush(); page = Number(marker[1]); continue; }
    if (!line) { flush(); continue; }
    if (isHeading(line)) { flush(); heading = line.replace(/^#+\s*/, "").replace(/:$/, "").slice(0, 200); out.push({ page, heading, text: line }); continue; }
    buffer.push(line);
  }
  flush();
  return out;
}

export function chunkDocument(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Block[] = [];
  let carried = 0; // leading blocks repeated from the previous chunk (overlap)
  const size = () => current.reduce((sum, block) => sum + block.text.length + 2, 0);
  const emit = () => {
    if (current.length > carried) {
      const body = current.find(block => !isHeading(block.text)) ?? current[0];
      chunks.push({ ordinal: chunks.length, page: current[0].page, heading: body.heading, text: current.map(block => block.text).join("\n\n") });
      const last = current[current.length - 1];
      const overlap = current.length > 1 && last.text.length <= OVERLAP_MAX_CHARS && !isHeading(last.text);
      current = overlap ? [last] : []; carried = current.length;
    } else { current = []; carried = 0; }
  };
  for (const block of blocks(text)) {
    if (current.length && current[0].page !== block.page) { current = current.slice(carried); carried = 0; emit(); current = []; carried = 0; }
    if (current.length > carried && size() + block.text.length > CHUNK_TARGET_CHARS) emit();
    current.push(block);
  }
  emit();
  return chunks;
}
