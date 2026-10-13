import { z } from "zod";

export const projectIdSchema = z.string().uuid("Invalid project ID");

export const createRequestSchema = z.object({
  title: z.string().trim().min(1, "Request title is required").max(120),
  description: z.string().trim().min(1, "Client request is required").max(10000),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const updateDecisionSchema = z.object({
  decision: z.enum(["included", "extra_work", "needs_clarification"]),
  decisionNote: z.string().trim().max(2000, "Decision note must be 2,000 characters or fewer").optional(),
});

export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;

export const updateRequestContentSchema = createRequestSchema;
export type UpdateRequestContentInput = z.infer<typeof updateRequestContentSchema>;
