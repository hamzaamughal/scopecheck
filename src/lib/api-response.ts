import "server-only";
import type { ApiErrorCode, ApiFailure, ApiSuccess, FieldError } from "@/types/api";
import { API_ERRORS } from "@/lib/api-errors";

export function apiSuccess<T>(data: T, status: 200 | 201 = 200) {
  const body: ApiSuccess<T> = { success: true, data };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(code: ApiErrorCode, details?: FieldError[]) {
  const { status, message } = API_ERRORS[code];
  const body: ApiFailure = { success: false, error: { code, message, ...(details?.length ? { details } : {}) } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
