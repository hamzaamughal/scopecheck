import { z } from "zod";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "PKR", "INR", "AED"] as const;

const money = z.union([z.number(), z.string().trim()])
  .transform(value => (value === "" ? undefined : Number(value)))
  .pipe(z.number().min(0, "Must be 0 or more").max(10_000_000, "Too large").optional());

export const changeOrderInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160, "Title must be 160 characters or fewer"),
  description: z.string().trim().min(1, "Describe the extra work").max(5000, "Description must be 5,000 characters or fewer"),
  hours: money.optional().refine(value => value === undefined || value <= 100_000, "Too many hours"),
  amount: money.optional(),
  currency: z.enum(CURRENCIES).default("USD"),
  requestId: z.string().uuid().optional(),
});
export type ChangeOrderInput = z.input<typeof changeOrderInputSchema>;

export const changeOrderActionSchema = z.object({ action: z.enum(["accept", "reject"]) });

export const replyDraftInputSchema = z.object({
  requestId: z.string().uuid("Invalid request ID"),
  tone: z.enum(["friendly", "formal"]).default("friendly"),
});

// What the model must return. Validated again against the inputs after generation.
export const replyDraftSchema = z.object({
  body: z.string().min(1).max(6000).describe("The reply text the freelancer can send, without a subject line"),
});
