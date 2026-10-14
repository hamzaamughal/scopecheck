import "server-only";
import type { z } from "zod";
import { apiError } from "@/lib/api-response";
import type { FieldError } from "@/types/api";

export const fieldErrors = (error: z.ZodError): FieldError[] => error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message }));

// Parses a JSON body with a schema; returns either data or a ready error response.
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ data: z.output<T> } | { response: Response }> {
  let body: unknown;
  try { body = await request.json(); } catch { return { response: apiError("INVALID_JSON") }; }
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { response: apiError("VALIDATION_ERROR", fieldErrors(parsed.error)) };
}
