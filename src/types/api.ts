import type { API_ERRORS } from "@/lib/api-errors";

export type ApiErrorCode = keyof typeof API_ERRORS;

export type FieldError = { field: string; message: string };
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: { code: ApiErrorCode; message: string; details?: FieldError[] };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
