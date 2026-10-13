import "server-only";
import { betterAuth } from "better-auth";
import { db } from "@/lib/db";
import { createAuthOptions } from "@/lib/auth-options";
import { after } from "next/server";
import { sendAuthEmail, AuthEmailDeliveryError } from "@/lib/auth-email";

export const auth = betterAuth(createAuthOptions(db, async message => {
  if (process.env.NODE_ENV === "development") console.info(`[auth-email] ${message.kind}: queued for sending.`);
  // Keep provider latency out of account-existence responses; Next keeps delivery alive.
  after(async () => {
    try { await sendAuthEmail(message); }
    catch (error) {
      // Only our own fixed diagnostics are safe to log; never log raw provider errors or links.
      console.error("[auth-email]", error instanceof AuthEmailDeliveryError ? error.message
        : "Email delivery failed before completion. Check server internet access, timeout, and BETTER_AUTH_URL formatting.");
    }
  });
}));
