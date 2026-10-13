import "server-only";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-response";

export async function getCurrentUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  // Only a verified identity can claim an explicitly reserved legacy project.
  if (session.user.emailVerified) {
    await db.query(
      `UPDATE projects SET owner_user_id = $1, legacy_owner_email = NULL
       WHERE owner_user_id IS NULL AND legacy_owner_email = $2`,
      [session.user.id, session.user.email.toLowerCase()],
    );
  }
  return { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: session.user.emailVerified, sessionCreatedAt: new Date(session.session.createdAt) };
}

export async function authorizeRequest(request: Request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = process.env.BETTER_AUTH_URL;
    if (!origin || !expected || origin !== new URL(expected).origin) return { response: apiError("FORBIDDEN") } as const;
  }
  try {
    const user = await getCurrentUser(request.headers);
    if (user && !user.emailVerified) return { response: apiError("EMAIL_NOT_VERIFIED") } as const;
    return user ? { user } as const : { response: apiError("UNAUTHORIZED") } as const;
  } catch {
    console.error("Could not verify the current session.");
    return { response: apiError("DATABASE_UNAVAILABLE") } as const;
  }
}
