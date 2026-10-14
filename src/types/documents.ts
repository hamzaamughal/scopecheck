import type { DOCUMENT_KINDS } from "@/schemas/documents";

export type DocumentKind = typeof DOCUMENT_KINDS[number];

export type ProjectDocumentDto = {
  id: string;
  kind: DocumentKind;
  title: string;
  label: string | null;
  sourceUrl: string | null;
  pageCount: number | null;
  chars: number;
  chunkCount: number;
  // ready: semantic + keyword search. keyword_only: embeddings unavailable. pending: being indexed.
  indexStatus: "pending" | "ready" | "keyword_only";
  createdAt: string;
};

export type ListDocumentsData = { documents: ProjectDocumentDto[] };
export type DocumentData = { document: ProjectDocumentDto };
export type DocumentTextData = { document: ProjectDocumentDto & { text: string } };
