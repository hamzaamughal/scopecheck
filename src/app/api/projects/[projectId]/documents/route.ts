import { authorizeRequest } from "@/lib/auth-session";
import { apiError, apiSuccess } from "@/lib/api-response";
import { parseBody } from "@/lib/route-helpers";
import { createDocument, indexDocument, listDocuments } from "@/lib/rag/documents-repository";
import { contentHash } from "@/lib/scope-import/normalize";
import { documentInputSchema } from "@/schemas/documents";
import { projectIdSchema } from "@/schemas/request";
import type { DocumentData, ListDocumentsData } from "@/types/documents";

export const runtime = "nodejs";
type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  try {
    const documents = await listDocuments(access.user.id, projectId.data);
    return documents ? apiSuccess<ListDocumentsData>({ documents }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to list documents.");
    return apiError("INTERNAL_ERROR");
  }
}

// Saves a supporting document (text only, extracted in the browser or from a public link),
// splits it into chunks, then embeds the chunks. Embedding failure leaves it keyword-searchable.
export async function POST(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  const parsed = await parseBody(request, documentInputSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const created = await createDocument(access.user.id, projectId.data, { ...parsed.data, contentHash: await contentHash(parsed.data.text) });
    if (created.status === "not_found") return apiError("NOT_FOUND");
    if (created.status === "limit") return apiError("DOCUMENT_LIMIT_REACHED");
    await indexDocument(access.user.id, created.id);
    const document = (await listDocuments(access.user.id, projectId.data))?.find(item => item.id === created.id);
    return document ? apiSuccess<DocumentData>({ document }, 201) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to save document.");
    return apiError("INTERNAL_ERROR");
  }
}
