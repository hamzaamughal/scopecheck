import type { ApiErrorCode, ApiResponse, FieldError } from "@/types/api";

export class ApiClientError extends Error {
  constructor(message: string, public code: ApiErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE", public details: FieldError[] = []) {
    super(message);
    this.name = "ApiClientError";
  }
}

// Reuse the API envelope and leave each screen responsible for its loading state.
export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: "no-store" });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiClientError("Connection lost. Check your connection and try again.", "NETWORK_ERROR");
  }
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.replace("/login");
    throw new ApiClientError("Your session has ended. Please sign in again.", "UNAUTHORIZED");
  }
  let body: ApiResponse<T>;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError("The server returned an unexpected response. Please try again.", "INVALID_RESPONSE");
  }
  if (!body || typeof body.success !== "boolean") {
    throw new ApiClientError("The server returned an unexpected response. Please try again.", "INVALID_RESPONSE");
  }
  if (!body.success && body.error.code === "EMAIL_NOT_VERIFIED" && typeof window !== "undefined") window.location.replace("/verify-email");
  if (!body.success) throw new ApiClientError(body.error.message, body.error.code, body.error.details);
  if (!response.ok) throw new ApiClientError("The request could not be completed. Please try again.", "INVALID_RESPONSE");
  return body.data;
}
