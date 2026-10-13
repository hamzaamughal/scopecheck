import { authorizeRequest } from "@/lib/auth-session";
import { withTransaction } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/api-response";
import { deleteAccountSchema } from "@/schemas/account";

// Destructive actions require a recent sign-in, so a stolen week-old session cannot erase an account.
const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

export async function DELETE(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_JSON"); }
  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  }
  if (parsed.data.confirmEmail.toLowerCase() !== access.user.email.toLowerCase()) {
    return apiError("VALIDATION_ERROR", [{ field: "confirmEmail", message: "This does not match your account email." }]);
  }
  if (Date.now() - access.user.sessionCreatedAt.getTime() > FRESH_SESSION_MS) return apiError("REAUTH_REQUIRED");

  const userId = access.user.id;
  try {
    await withTransaction(async client => {
      // Locking the user row blocks concurrent project creation (its FK check waits on this row).
      await client.query("SELECT id FROM auth_user WHERE id = $1 FOR UPDATE", [userId]);
      await client.query(
        `DELETE FROM assessments WHERE request_id IN
           (SELECT r.id FROM requests r JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = $1)`, [userId]);
      await client.query("DELETE FROM requests WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id = $1)", [userId]);
      await client.query("DELETE FROM projects WHERE owner_user_id = $1", [userId]);
      // Sessions, linked accounts, and usage rows cascade from auth_user.
      await client.query("DELETE FROM auth_user WHERE id = $1", [userId]);
    });
    return apiSuccess({ deleted: true });
  } catch {
    console.error("Failed to delete account.");
    return apiError("INTERNAL_ERROR");
  }
}
