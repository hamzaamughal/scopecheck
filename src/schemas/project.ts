import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(100, "Project name must be 100 characters or fewer"),
  clientName: z.string().trim().max(100, "Client name must be 100 characters or fewer").optional(),
  scope: z.string().trim().min(1, "Agreed scope is required").max(15000, "Scope must be 15,000 characters or fewer"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// Edits replace all editable fields, so the same rules apply.
export const updateProjectSchema = createProjectSchema;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
