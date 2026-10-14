import "server-only";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { normalizeText } from "./normalize.ts";

const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV", "UL", "OL", "TABLE", "TR", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "DL", "DT", "DD", "FIGURE"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "FORM", "BUTTON"]);

type DomNode = { nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<DomNode> };

// Converts HTML to plain text that keeps headings, paragraphs, and list items on their own lines.
function blockText(node: DomNode, out: string[]) {
  if (node.nodeType === 3) { out.push(node.textContent ?? ""); return; }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
  const name = node.nodeName.toUpperCase();
  if (SKIP.has(name)) return;
  if (name === "BR") { out.push("\n"); return; }
  const block = BLOCKS.has(name) || name === "LI";
  if (block) out.push("\n");
  if (name === "LI") out.push("- ");
  for (const child of Array.from(node.childNodes)) blockText(child, out);
  if (block) out.push("\n");
  if (name === "TD" || name === "TH") out.push(" ");
}

export function htmlToText(html: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() ?? "";
  let article: { title?: string | null; content?: string | null } | null = null;
  try { article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse(); } catch { article = null; }
  const source = article?.content ? parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body : parseHTML(html).document.body;
  const out: string[] = [];
  if (source) blockText(source as unknown as DomNode, out);
  return { title: (article?.title || pageTitle).trim(), text: normalizeText(out.join("")).replace(/\n\n(?=- )/g, "\n") };
}
