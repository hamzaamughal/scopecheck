import { ScopeImportError } from "./normalize.ts";

// Validates a user-supplied link and rewrites known document hosts to a plain-text export.
export function prepareLinkUrl(input: string): { fetchUrl: URL; displayUrl: string; hint?: string } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ScopeImportError("Enter a full link starting with https://"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ScopeImportError("Only http and https links are supported.");
  if (url.username || url.password) throw new ScopeImportError("Links with a username or password are not supported.");
  if (url.port && url.port !== "443" && url.port !== "80") throw new ScopeImportError("Links on custom ports are not supported.");
  const displayUrl = url.toString();

  const host = url.hostname.toLowerCase();
  const doc = host === "docs.google.com" && url.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/);
  if (doc) return { fetchUrl: new URL(`https://docs.google.com/document/d/${doc[1]}/export?format=txt`), displayUrl };
  if (host === "docs.google.com" || host === "drive.google.com") {
    throw new ScopeImportError("Only Google Docs documents are supported. For Sheets, Slides or Drive files, download a PDF and upload it.");
  }
  if (host.endsWith("notion.site") || host.endsWith("notion.so")) {
    return { fetchUrl: url, displayUrl, hint: "Notion pages load their content with JavaScript, so a link may import little text. If that happens, export the page as PDF or Markdown and upload it." };
  }
  return { fetchUrl: url, displayUrl };
}
