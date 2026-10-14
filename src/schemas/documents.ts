import { z } from "zod";

export const DOCUMENT_MAX_CHARS = 200_000;
export const DOCUMENT_KINDS = ["proposal", "email", "notes", "other"] as const;

export const documentInputSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().min(1, "Give the document a name").max(160, "Name must be 160 characters or fewer"),
  text: z.string().trim().min(1, "The document has no text").max(DOCUMENT_MAX_CHARS, `Documents must be ${DOCUMENT_MAX_CHARS.toLocaleString("en")} characters or fewer`),
  label: z.string().trim().min(1).max(300).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  pageCount: z.number().int().positive().max(10_000).optional(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;
