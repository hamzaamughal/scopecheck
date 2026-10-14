import { authorizeRequest } from "@/lib/auth-session";
import { apiError, apiSuccess } from "@/lib/api-response";
import { db } from "@/lib/db";
import { reserveLinkImport } from "@/lib/import-usage";
import { importLinkSchema } from "@/schemas/project";
import { prepareLinkUrl } from "@/lib/scope-import/link-url";
import { safeFetchText } from "@/lib/scope-import/safe-fetch";
import { htmlToText } from "@/lib/scope-import/html-to-text";
import { assertImportable, contentHash, normalizeText, ScopeImportError } from "@/lib/scope-import/normalize";
import type { ImportLinkData } from "@/types/project";
import { DOCUMENT_MAX_CHARS } from "@/schemas/documents";

// Fetches a public link and returns its text as a preview. Nothing is saved here;
// the user reviews the text and saves it through the normal project endpoints.
export async function POST(request: Request) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_JSON"); }
  const parsed = importLinkSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));

  let prepared;
  try { prepared = prepareLinkUrl(parsed.data.url); }
  catch (error) { return apiError("VALIDATION_ERROR", [{ field: "url", message: error instanceof ScopeImportError ? error.message : "Invalid link" }]); }

  try {
    if (parsed.data.projectId) {
      // Re-checking a saved project's link: confirm ownership before any outbound request.
      const owned = await db.query("SELECT 1 FROM projects WHERE id = $1 AND owner_user_id = $2", [parsed.data.projectId, access.user.id]);
      if (!owned.rowCount) return apiError("NOT_FOUND");
    }
    if (!(await reserveLinkImport(access.user.id))) return apiError("IMPORT_LIMIT_REACHED");
  } catch {
    console.error("Failed to prepare link import.");
    return apiError("INTERNAL_ERROR");
  }

  try {
    const page = await safeFetchText(prepared.fetchUrl);
    const { title, text } = page.contentType.startsWith("text/plain") ? { title: "", text: normalizeText(page.body) } : htmlToText(page.body);
    if (prepared.hint && text.length < 300) throw new ScopeImportError(prepared.hint);
    assertImportable(text, parsed.data.purpose === "document" ? DOCUMENT_MAX_CHARS : undefined);
    if (parsed.data.projectId) {
      await db.query("UPDATE scope_sources SET last_checked_at = NOW() WHERE project_id = $1", [parsed.data.projectId]);
    }
    return apiSuccess<ImportLinkData>({
      text, title, label: (title || prepared.displayUrl).slice(0, 300), sourceUrl: prepared.displayUrl, finalUrl: page.finalUrl,
      contentHash: await contentHash(text), fetchedAt: new Date().toISOString(), ...(prepared.hint ? { hint: prepared.hint } : {}),
    });
  } catch (error) {
    if (error instanceof ScopeImportError) {
      const message = prepared.hint && error.message.startsWith("No readable text") ? prepared.hint : error.message;
      return apiError("IMPORT_FAILED", [{ field: "url", message }]);
    }
    console.error("Link import failed unexpectedly.");
    return apiError("IMPORT_FAILED", [{ field: "url", message: "Could not import that link." }]);
  }
}
