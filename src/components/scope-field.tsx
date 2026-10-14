"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui";
import { ApiClientError } from "@/lib/api-client";
import { SCOPE_MAX_CHARS } from "@/lib/scope-import/normalize";
import { ACCEPTED_FILES } from "@/lib/scope-import/read-file";
import { importLink } from "@/services/projects";
import type { ScopeSourceInput } from "@/schemas/project";
import type { ScopeSourceDto } from "@/types/project";

type Pending = { text: string; source: ScopeSourceInput; pageCount?: number; hint?: string };

export function sourceSummary(source: { kind: "file" | "link"; label: string; pageCount?: number | null }) {
  const pages = source.pageCount ? ` · ${source.pageCount} ${source.pageCount === 1 ? "page" : "pages"}` : "";
  return `${source.kind === "file" ? source.label : source.label.replace(/^https?:\/\//, "")}${pages}`;
}

// Scope textarea with "Upload file" and "Import from link". Files are read in the browser;
// nothing is uploaded. The chosen source is submitted as a hidden JSON field with the form.
export default function ScopeField({ defaultValue = "", existingSource, error, disabled }: {
  defaultValue?: string; existingSource?: ScopeSourceDto | null; error?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(defaultValue);
  const [source, setSource] = useState<ScopeSourceInput | undefined>(undefined);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState("");
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function offer(result: Pending) {
    setImportError("");
    if (text.trim()) setPending(result); // ask before replacing what is already there
    else apply(result, "replace");
  }
  function apply(result: Pending, mode: "replace" | "append") {
    setText(mode === "append" && text.trim() ? `${text.trim()}\n\n${result.text}` : result.text);
    setSource(result.source);
    setPending(null);
    setNotice(result.hint ?? `Imported from ${sourceSummary({ ...result.source, pageCount: result.pageCount })}. Review the text before saving.`);
  }

  async function readFile(file: File) {
    if (busy) return;
    setBusy(`Reading ${file.name}…`); setImportError(""); setNotice("");
    try {
      const { readScopeFile } = await import("@/lib/scope-import/read-file");
      const result = await readScopeFile(file);
      offer({ text: result.text, pageCount: result.pageCount, source: { kind: "file", label: result.label, ...(result.pageCount ? { pageCount: result.pageCount } : {}) } });
    } catch (caught) {
      setImportError(caught instanceof Error && caught.name === "ScopeImportError" ? caught.message : "This file could not be read.");
    } finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function readLink() {
    if (busy || !url.trim()) return;
    setBusy("Importing link…"); setImportError(""); setNotice("");
    try {
      const result = await importLink(url.trim());
      offer({ text: result.text, hint: result.hint, source: { kind: "link", label: result.label, sourceUrl: result.sourceUrl } });
      setLinkOpen(false); setUrl("");
    } catch (caught) {
      setImportError(caught instanceof ApiClientError ? caught.details[0]?.message ?? caught.message : "Could not import that link.");
    } finally { setBusy(""); }
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter must import the link, not submit the surrounding project form.
    if (event.key === "Enter") { event.preventDefault(); void readLink(); }
    if (event.key === "Escape") { event.preventDefault(); setLinkOpen(false); }
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    event.preventDefault();
    void readFile(file);
  }

  const over = text.length > SCOPE_MAX_CHARS;
  const shownSource = source ? { ...source, pageCount: source.pageCount ?? null } : existingSource;
  const locked = disabled || !!busy;
  return <div className="scope-field">
    <div className="scope-field-head">
      <label htmlFor="project-scope">Agreed scope <span>*</span></label>
      <div className="scope-import-actions">
        <button type="button" className="chip-button" disabled={locked} onClick={() => fileInput.current?.click()}><Icon name="upload" size={15}/>Upload file</button>
        <button type="button" className="chip-button" disabled={locked} aria-expanded={linkOpen} onClick={() => setLinkOpen(open => !open)}><Icon name="link" size={15}/>Import link</button>
      </div>
      <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); }}/>
    </div>

    {linkOpen && <div className="link-import">
      <input type="url" inputMode="url" aria-label="Public link to the scope document" placeholder="https://docs.google.com/document/d/…" value={url} disabled={locked} onChange={e => setUrl(e.target.value)} onKeyDown={onLinkKey} autoFocus/>
      <button type="button" className="button secondary" disabled={locked || !url.trim()} onClick={() => void readLink()}>{busy ? "Importing…" : "Import"}</button>
      <p className="field-hint">Google Docs shared as “Anyone with the link”, or any public web page. The text is saved as a snapshot.</p>
    </div>}

    {pending && <div className="import-confirm" role="alertdialog" aria-label="Replace existing scope?">
      <p>Replace the current scope with the text from <strong>{sourceSummary({ ...pending.source, pageCount: pending.pageCount })}</strong>?</p>
      <div><button type="button" className="button primary" onClick={() => apply(pending, "replace")}>Replace</button><button type="button" className="button secondary" onClick={() => apply(pending, "append")}>Add below</button><button type="button" className="text-button" onClick={() => setPending(null)}>Cancel</button></div>
    </div>}

    <div className={`scope-dropzone ${busy ? "busy" : ""}`} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={onDrop}>
      <textarea id="project-scope" name="scope" value={text} onChange={e => setText(e.target.value)} disabled={disabled} aria-invalid={!!error || over}
        aria-describedby={["scope-meta", error ? "scope-error" : ""].filter(Boolean).join(" ")} rows={8}
        placeholder="Paste the agreed scope, or upload the SOW / contract (PDF, Word, TXT). Include deliverables, revisions, and what is out of scope." required/>
      {busy && <div className="scope-busy" role="status"><span className="spinner"/>{busy}</div>}
    </div>
    {source && <input type="hidden" name="source" value={JSON.stringify(source)}/>}

    <div className="scope-meta" id="scope-meta">
      <span className="scope-source">{shownSource ? <><Icon name={shownSource.kind === "link" ? "link" : "file"} size={13}/>From {sourceSummary(shownSource)}</> : "Drop a PDF or Word file here to import it"}</span>
      <span className={over ? "over" : ""}>{text.length.toLocaleString("en")} / {SCOPE_MAX_CHARS.toLocaleString("en")}</span>
    </div>
    {notice && !importError && <p className="field-hint" role="status">{notice}</p>}
    {importError && <p className="form-error" role="alert">{importError}</p>}
    {error && <p className="form-error" id="scope-error" role="alert">{error}</p>}
  </div>;
}
