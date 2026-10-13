import { z } from "zod";

export const assessmentSchema = z.object({
  suggestedDecision: z.enum([
    "included",
    "extra_work",
    "needs_clarification",
  ]).describe("A suggestion for human review, not a final decision"),

  explanation: z.string().min(1).max(2000)
    .describe("A concise explanation grounded in the provided scope"),

  evidence: z.array(z.string().min(1).max(1500)).max(5)
    .describe("Exact quotes copied from the agreed scope; empty if none apply"),

  clarificationQuestions: z.array(z.string().min(1).max(500)).max(3)
    .describe("Questions needed to resolve uncertainty; empty if none are needed"),
});

export type Assessment = z.infer<typeof assessmentSchema>;

export const savedAssessmentSchema = assessmentSchema.extend({
  id: z.string().uuid(),
  model: z.string().min(1),
  createdAt: z.string().datetime(),
  isStale: z.boolean(),
});

export type SavedAssessment = z.infer<typeof savedAssessmentSchema>;
