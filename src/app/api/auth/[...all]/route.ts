import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  const trace = process.env.NODE_ENV === "development" && [
    "/api/auth/request-password-reset", "/api/auth/send-verification-email", "/api/auth/sign-up/email",
  ].includes(path);
  if (trace) console.info(`[auth-email] Request received: ${path}`);
  const response = await handlers.POST(request);
  if (trace) console.info(`[auth-email] Request completed: HTTP ${response.status}. A successful response does not guarantee an email was queued.`);
  return response;
}
