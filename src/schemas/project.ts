import { z } from "zod";
import { SCOPE_MAX_CHARS } from "../lib/scope-import/normalize.ts";

// Where the scope text came from. The server computes the content hash from the saved scope.
export const scopeSourceSchema = z.object({
  kind: z.enum(["file", "link"]),
  label: z.string().trim().min(1).max(300),
  sourceUrl: z.string().url().max(2048).optional(),
  pageCount: z.number().int().positive().max(10_000).optional(),
}).refine(source => (source.kind === "link") === Boolean(source.sourceUrl), { message: "Links need a URL; files must not have one", path: ["sourceUrl"] });

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(100, "Project name must be 100 characters or fewer"),
  clientName: z.string().trim().max(100, "Client name must be 100 characters or fewer").optional(),
  scope: z.string().trim().min(1, "Agreed scope is required").max(SCOPE_MAX_CHARS, `Scope must be ${SCOPE_MAX_CHARS.toLocaleString("en")} characters or fewer`),
  // undefined: keep the current source (edits); null: clear it; object: record a new import.
  source: scopeSourceSchema.nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ScopeSourceInput = z.infer<typeof scopeSourceSchema>;

// Edits replace all editable fields, so the same rules apply.
export const updateProjectSchema = createProjectSchema;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const importLinkSchema = z.object({
  url: z.string().trim().min(1, "Paste a link").max(2048, "This link is too long"),
  projectId: z.string().uuid().optional(),
});
