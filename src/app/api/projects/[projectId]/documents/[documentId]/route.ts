import { z } from "zod";
import { authorizeRequest } from "@/lib/auth-session";
import { apiError, apiSuccess } from "@/lib/api-response";
import { deleteDocument, getDocumentText } from "@/lib/rag/documents-repository";
import type { DocumentTextData } from "@/types/documents";

export const runtime = "nodejs";
type Params = { params: Promise<{ projectId: string; documentId: string }> };
const paramsSchema = z.object({ projectId: z.string().uuid("Invalid project ID"), documentId: z.string().uuid("Invalid document ID") });

async function parseParams(params: Params["params"]) {
  const parsed = paramsSchema.safeParse(await params);
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const ids = await parseParams(params);
  if (!ids) return apiError("VALIDATION_ERROR", [{ field: "documentId", message: "Invalid document ID" }]);
  try {
    const document = await getDocumentText(access.user.id, ids.projectId, ids.documentId);
    return document ? apiSuccess<DocumentTextData>({ document }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to load document.");
    return apiError("INTERNAL_ERROR");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const ids = await parseParams(params);
  if (!ids) return apiError("VALIDATION_ERROR", [{ field: "documentId", message: "Invalid document ID" }]);
  try {
    return await deleteDocument(access.user.id, ids.projectId, ids.documentId) ? apiSuccess({ id: ids.documentId }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to delete document.");
    return apiError("INTERNAL_ERROR");
  }
}
