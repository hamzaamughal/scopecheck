"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, Modal } from "@/components/ui";
import { ApiClientError } from "@/lib/api-client";
import { ACCEPTED_FILES } from "@/lib/scope-import/read-file";
import { DOCUMENT_KINDS, DOCUMENT_MAX_CHARS, documentInputSchema } from "@/schemas/documents";
import { importLink } from "@/services/projects";
import { createDocument, deleteDocument, getDocument, listDocuments } from "@/services/documents";
import type { DocumentKind, ProjectDocumentDto } from "@/types/documents";
import type { FieldError } from "@/types/api";
import { KIND_LABEL } from "@/lib/rag/kind-labels";

const STATUS_LABEL = { ready: "Searchable", keyword_only: "Keyword search only", pending: "Indexing…" } as const;

type Imported = { text: string; label?: string; sourceUrl?: string; pageCount?: number };

function AddDocumentForm({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: (doc: ProjectDocumentDto) => void }) {
  const [kind, setKind] = useState<DocumentKind>("email");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imported, setImported] = useState<Imported | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldError = (field: string) => errors.find(item => item.field === field)?.message;

  function applyImport(result: Imported, name: string) {
    setImported(result); setText(result.text);
    if (!title.trim()) setTitle(name.replace(/\.(pdf|docx|txt|md)$/i, "").slice(0, 160));
  }
  async function readFile(file: File) {
    setBusy(`Reading ${file.name}…`); setError("");
    try {
      const { readScopeFile } = await import("@/lib/scope-import/read-file");
      const result = await readScopeFile(file, DOCUMENT_MAX_CHARS);
      applyImport({ text: result.text, label: result.label, pageCount: result.pageCount }, file.name);
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "ScopeImportError" ? caught.message : "This file could not be read.");
    } finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function readLink() {
    if (!url.trim()) return;
    setBusy("Importing link…"); setError("");
    try {
      const result = await importLink(url.trim(), undefined, undefined, "document");
      applyImport({ text: result.text, label: result.label, sourceUrl: result.sourceUrl }, result.title || result.label);
      setLinkOpen(false); setUrl("");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.details[0]?.message ?? caught.message : "Could not import that link.");
    } finally { setBusy(""); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const fromImport = imported && imported.text === text;
    const parsed = documentInputSchema.safeParse({ kind, title, text,
      ...(fromImport ? { label: imported.label, sourceUrl: imported.sourceUrl, pageCount: imported.pageCount } : {}) });
    setErrors([]); setError("");
    if (!parsed.success) { setErrors(parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }))); return; }
    setBusy("Saving and indexing…");
    try {
      const { document } = await createDocument(projectId, parsed.data);
      onSaved(document);
    } catch (caught) {
      if (caught instanceof ApiClientError) setErrors(caught.details);
      setError(caught instanceof Error ? caught.message : "Could not save the document.");
    } finally { setBusy(""); }
  }

  return <Modal title="Add a supporting document" subtitle="Proposals, email threads, or meeting notes. ScopeCheck searches them for context when it assesses a request. They never override the agreed scope." busy={!!busy} onClose={onClose}>
    <form onSubmit={submit} aria-busy={!!busy}><fieldset disabled={!!busy} className="project-fields">
      <label htmlFor="doc-kind">Type</label>
      <select id="doc-kind" value={kind} onChange={e => setKind(e.target.value as DocumentKind)}>{DOCUMENT_KINDS.map(value => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}</select>
      <label htmlFor="doc-title">Name <span>*</span></label>
      <input id="doc-title" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="e.g. Kickoff call notes" aria-invalid={!!fieldError("title")}/>
      {fieldError("title") && <p className="form-error" role="alert">{fieldError("title")}</p>}
      <div className="scope-field-head">
        <label htmlFor="doc-text">Text <span>*</span></label>
        <div className="scope-import-actions">
          <button type="button" className="chip-button" onClick={() => fileInput.current?.click()}><Icon name="upload" size={15}/>Upload file</button>
          <button type="button" className="chip-button" aria-expanded={linkOpen} onClick={() => setLinkOpen(open => !open)}><Icon name="link" size={15}/>Import link</button>
        </div>
        <input ref={fileInput} type="file" accept={ACCEPTED_FILES} hidden onChange={e => { const file = e.target.files?.[0]; if (file) void readFile(file); }}/>
      </div>
      {linkOpen && <div className="link-import">
        <input type="url" inputMode="url" aria-label="Public link to the document" placeholder="https://docs.google.com/document/d/…" value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void readLink(); } }} autoFocus/>
        <button type="button" className="button secondary" disabled={!url.trim()} onClick={() => void readLink()}>Import</button>
      </div>}
      <textarea id="doc-text" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste an email thread or notes, or upload a PDF / Word file." aria-invalid={!!fieldError("text")}/>
      <div className="scope-meta"><span className="scope-source">{imported && imported.text === text ? <><Icon name={imported.sourceUrl ? "link" : "file"} size={13}/>From {imported.label}</> : "Only the text is saved, never the file."}</span>
        <span className={text.length > DOCUMENT_MAX_CHARS ? "over" : ""}>{text.length.toLocaleString("en")} / {DOCUMENT_MAX_CHARS.toLocaleString("en")}</span></div>
      {fieldError("text") && <p className="form-error" role="alert">{fieldError("text")}</p>}
      {busy && <p className="field-hint" role="status"><span className="spinner"/> {busy}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">{busy ? "Saving…" : "Add document"}</button></div>
    </fieldset></form>
  </Modal>;
}

// Supporting documents for a project (shown under the agreed scope).
export default function DocumentsPanel({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const [documents, setDocuments] = useState<ProjectDocumentDto[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ProjectDocumentDto | null>(null);
  const [viewing, setViewing] = useState<(ProjectDocumentDto & { text?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listDocuments(projectId, controller.signal)
      .then(({ documents }) => { setDocuments(documents); setLoadError(""); })
      .catch(caught => { if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "Could not load documents."); });
    return () => controller.abort();
  }, [projectId, attempt]);

  async function open(doc: ProjectDocumentDto) {
    setViewing(doc);
    try { const { document } = await getDocument(projectId, doc.id); setViewing(document); }
    catch { setViewing({ ...doc, text: "Could not load this document." }); }
  }
  async function remove() {
    if (!confirm || busy) return;
    setBusy(true); setError("");
    try {
      await deleteDocument(projectId, confirm.id);
      setDocuments(list => list?.filter(item => item.id !== confirm.id) ?? null); setConfirm(null); onChanged?.();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete the document."); }
    finally { setBusy(false); }
  }

  const full = (documents?.length ?? 0) >= 10;
  return <section className="documents-panel" aria-label="Supporting documents">
    <div className="co-header">
      <div><h2>Supporting documents</h2><p>Proposals, emails, and notes add context to each AI check. The agreed scope above is always the binding reference.</p></div>
      <button type="button" className="button secondary small" disabled={full || documents === null} onClick={() => setAdding(true)}><Icon name="plus" size={14}/>Add document</button>
    </div>
    {loadError ? <div className="reply-empty" role="alert">{loadError} <button type="button" className="text-button inline" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : documents === null ? <p className="reply-empty" role="status">Loading documents…</p>
      : documents.length === 0 ? <p className="reply-empty">No supporting documents yet. Add the proposal or the email thread where the work was discussed.</p>
      : <ul className="doc-list">{documents.map(doc => <li key={doc.id} className="doc-row">
        <span className="doc-icon"><Icon name={doc.sourceUrl ? "link" : "file"} size={16}/></span>
        <button type="button" className="doc-main" onClick={() => void open(doc)}>
          <strong>{doc.title}</strong>
          <span>{KIND_LABEL[doc.kind]} · {doc.pageCount ? `${doc.pageCount} pages · ` : ""}{doc.chars.toLocaleString("en")} characters · {doc.chunkCount} {doc.chunkCount === 1 ? "section" : "sections"}</span>
        </button>
        <span className={`doc-status ${doc.indexStatus}`} title={doc.indexStatus === "keyword_only" ? "Semantic search was unavailable when this was saved. Keyword search still works; it is retried on the next AI check." : "Keyword and semantic search"}>{STATUS_LABEL[doc.indexStatus]}</span>
        <button type="button" className="icon-button" aria-label={`Delete ${doc.title}`} onClick={() => setConfirm(doc)}><Icon name="trash" size={16}/></button>
      </li>)}</ul>}
    {full && <p className="small-muted">Limit reached: 10 documents per project.</p>}

    {adding && <AddDocumentForm projectId={projectId} onClose={() => setAdding(false)} onSaved={doc => { setDocuments(list => [...(list ?? []), doc]); setAdding(false); onChanged?.(); }}/>}
    {confirm && <Modal title={`Delete “${confirm.title}”?`} subtitle="It is removed from future AI checks. Earlier assessments that used it will show as outdated." busy={busy} onClose={() => setConfirm(null)}>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete"}</button></div>
    </Modal>}
    {viewing && <Modal title={viewing.title} subtitle={`${KIND_LABEL[viewing.kind]}${viewing.label ? ` · ${viewing.label}` : ""}`} onClose={() => setViewing(null)}>
      <div className="history-full"><div className="scope-copy">{viewing.text ?? "Loading…"}</div></div>
    </Modal>}
  </section>;
}
