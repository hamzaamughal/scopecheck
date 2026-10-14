import { z } from "zod";

// What the model returns when only the agreed scope is supplied.
export const baseAssessmentSchema = z.object({
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

// Present only when supporting documents were used. "evidence" keeps the binding scope quotes
// (as before); "citations" lists every quote with where it came from.
export const citationSchema = z.object({
  quote: z.string().min(1).max(1500),
  binding: z.boolean(),
  documentId: z.string().uuid().nullable(),
  documentTitle: z.string().max(160).nullable(),
  documentKind: z.enum(["proposal", "email", "notes", "other"]).nullable(),
  page: z.number().int().positive().nullable(),
});
export type Citation = z.infer<typeof citationSchema>;

export const assessmentSchema = baseAssessmentSchema.extend({
  citations: z.array(citationSchema).max(8).optional(),
});

export type Assessment = z.infer<typeof assessmentSchema>;

// How supporting documents were used: all of them in full, or the top chunks from hybrid search.
export const assessmentContextSchema = z.object({
  mode: z.enum(["full", "retrieval"]),
  documentCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  search: z.enum(["hybrid", "keyword"]).nullable(),
});
export type AssessmentContext = z.infer<typeof assessmentContextSchema>;

export const savedAssessmentSchema = assessmentSchema.extend({
  id: z.string().uuid(),
  model: z.string().min(1),
  createdAt: z.string().datetime(),
  isStale: z.boolean(),
  context: assessmentContextSchema.nullable().optional(),
});

export type SavedAssessment = z.infer<typeof savedAssessmentSchema>;
