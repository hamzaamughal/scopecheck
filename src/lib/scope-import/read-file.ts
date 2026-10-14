"use client";
// Browser-only: extracts text from a scope document without uploading the file anywhere.
import { assertImportable, contentHash, joinPages, normalizeText, ScopeImportError, type ImportedScope } from "./normalize.ts";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const ACCEPTED_FILES = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

async function readPdf(file: File): Promise<{ text: string; pageCount: number }> {
  // Loaded on demand so the PDF engine is not part of the main bundle.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw new ScopeImportError((error as Error)?.name === "PasswordException" ? "This PDF is password-protected. Remove the password and try again." : "This file could not be read as a PDF.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new ScopeImportError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}; upload only the scope section.`);
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      // Rebuild lines: pdf.js reports end-of-line per text run.
      pages.push(content.items.map(item => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
      page.cleanup();
    }
    const letters = pages.join("").replace(/\s/g, "").length;
    if (letters < 20 * Math.max(1, Math.min(pdf.numPages, 3))) {
      throw new ScopeImportError("This PDF has no selectable text (it may be a scan). Paste the scope text instead.");
    }
    return { text: joinPages(pages), pageCount: pdf.numPages };
  } finally { await task.destroy(); }
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return normalizeText(result.value);
  } catch { throw new ScopeImportError("This file could not be read as a Word document (.docx)."); }
}

export async function readScopeFile(file: File, maxChars?: number): Promise<ImportedScope> {
  if (file.size > MAX_FILE_BYTES) throw new ScopeImportError("This file is larger than 15 MB.");
  const name = file.name.toLowerCase();
  let text: string; let pageCount: number | undefined;
  if (name.endsWith(".pdf") || file.type === "application/pdf") ({ text, pageCount } = await readPdf(file));
  else if (name.endsWith(".docx")) text = await readDocx(file);
  else if (name.endsWith(".doc")) throw new ScopeImportError("Old .doc files are not supported. Save it as .docx or PDF and try again.");
  else if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) text = normalizeText(await file.text());
  else throw new ScopeImportError("Use a PDF, Word (.docx), TXT or Markdown file.");
  assertImportable(text, maxChars);
  return { text, label: file.name.slice(0, 300), pageCount, contentHash: await contentHash(text) };
}
