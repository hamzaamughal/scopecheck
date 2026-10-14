import { authorizeRequest } from "@/lib/auth-session";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getScopeVersion, listScopeVersions } from "@/lib/workflow-repository";
import { projectIdSchema } from "@/schemas/request";
import type { ListScopeVersionsData, ScopeVersionData } from "@/types/workflow";

// GET            -> list of versions (metadata only)
// GET ?version=N -> one version including its scope text
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const access = await authorizeRequest(request);
  if (access.response) return access.response;
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError("VALIDATION_ERROR", [{ field: "projectId", message: "Invalid project ID" }]);
  const raw = new URL(request.url).searchParams.get("version");
  const version = raw === null ? null : Number(raw);
  if (version !== null && (!Number.isSafeInteger(version) || version < 1)) return apiError("VALIDATION_ERROR", [{ field: "version", message: "Invalid version" }]);
  try {
    if (version === null) {
      const versions = await listScopeVersions(access.user.id, projectId.data);
      return versions ? apiSuccess<ListScopeVersionsData>({ versions }) : apiError("NOT_FOUND");
    }
    const found = await getScopeVersion(access.user.id, projectId.data, version);
    return found ? apiSuccess<ScopeVersionData>({ version: found }) : apiError("NOT_FOUND");
  } catch {
    console.error("Failed to load scope versions.");
    return apiError("INTERNAL_ERROR");
  }
}
