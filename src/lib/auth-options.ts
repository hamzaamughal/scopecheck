import type { BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";
import type { AuthEmail } from "./auth-email.ts";

export function createAuthOptions(database: Pool, deliverEmail: (message: AuthEmail) => Promise<void> = async () => { throw new Error("Auth email sender is not configured"); }) {
  return {
    appName: "ScopeCheck",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database,
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session", expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    account: { modelName: "auth_account", encryptOAuthTokens: true, accountLinking: { disableImplicitLinking: true } },
    verification: { modelName: "auth_verification" },
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: true, autoSignIn: false,
      resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => deliverEmail({ to: user.email, url, kind: "reset" }),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, expiresIn: 3600, autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => deliverEmail({ to: user.email, url, kind: "verify" }),
    },
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const },
    } : {},
    // Vercel overwrites these headers with the real client IP, so they cannot be spoofed there.
    // Elsewhere, keep Better Auth's default (single-value x-forwarded-for only).
    ...(process.env.VERCEL ? { advanced: { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"] } } } : {}),
    rateLimit: { enabled: true, storage: "database", modelName: "auth_rate_limit", window: 60, max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 }, "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 } } },
  } satisfies BetterAuthOptions;
}
