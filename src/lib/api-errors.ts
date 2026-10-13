// Single source of truth for public error codes, HTTP statuses, and messages.
export const API_ERRORS = {
  UNAUTHORIZED: { status: 401, message: "Your session has ended. Please sign in again." },
  EMAIL_NOT_VERIFIED: { status: 403, message: "Verify your email address to open your workspace." },
  FORBIDDEN: { status: 403, message: "This request is not allowed." },
  INVALID_JSON: { status: 400, message: "Request body must contain valid JSON." },
  VALIDATION_ERROR: { status: 400, message: "Please check the submitted fields." },
  REAUTH_REQUIRED: { status: 403, message: "For your security, sign out and sign in again, then delete your account." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Please try again." },
  DATABASE_UNAVAILABLE: { status: 503, message: "Could not connect to the database." },
  ASSESSMENT_FAILED: { status: 502, message: "Could not generate a valid assessment. Please try again." },
  ASSESSMENT_LIMIT_REACHED: { status: 429, message: "Your daily assessment allowance is used up. Try again after it resets. You can still review saved assessments and save decisions." },
  ASSESSMENT_SAVE_FAILED: { status: 503, message: "Could not confirm the assessment was saved. Reload the saved assessment before generating another." },
} as const satisfies Record<string, { status: number; message: string }>;
