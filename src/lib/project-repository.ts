import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import type { ScopeSourceInput } from "@/schemas/project";
import type { ProjectDto } from "@/types/project";

// One SELECT shape for every project response, including where its scope came from.
const PROJECT_COLUMNS = `p.id, p.name, p.client_name AS "clientName", p.scope,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  s.kind AS "sourceKind", s.label AS "sourceLabel", s.source_url AS "sourceUrl", s.page_count AS "pageCount",
  s.imported_at AS "importedAt", s.last_checked_at AS "lastCheckedAt",
  (s.content_hash IS DISTINCT FROM encode(sha256(convert_to(p.scope, 'UTF8')), 'hex')) AS "editedSinceImport"`;
const PROJECT_FROM = `FROM projects p LEFT JOIN scope_sources s ON s.project_id = p.id`;

type ProjectRow = {
  id: string; name: string; clientName: string | null; scope: string; createdAt: Date; updatedAt: Date;
  sourceKind: "file" | "link" | null; sourceLabel: string | null; sourceUrl: string | null; pageCount: number | null;
  importedAt: Date | null; lastCheckedAt: Date | null; editedSinceImport: boolean;
};

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id, name: row.name, clientName: row.clientName, scope: row.scope,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    source: row.sourceKind && row.sourceLabel && row.importedAt ? {
      kind: row.sourceKind, label: row.sourceLabel, sourceUrl: row.sourceUrl, pageCount: row.pageCount,
      importedAt: row.importedAt.toISOString(), lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      editedSinceImport: row.editedSinceImport,
    } : null,
  };
}

export async function listProjects(userId: string) {
  const result = await db.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.owner_user_id = $1 ORDER BY p.created_at DESC, p.id DESC`, [userId]);
  return result.rows.map(toProjectDto);
}

export async function getProject(client: PoolClient, userId: string, projectId: string) {
  const result = await client.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} ${PROJECT_FROM} WHERE p.id = $1 AND p.owner_user_id = $2`, [projectId, userId]);
  return result.rows[0] ? toProjectDto(result.rows[0]) : undefined;
}

// Records (or clears) the import source. The hash is computed from the saved scope, never trusted from the client.
export async function saveScopeSource(client: PoolClient, projectId: string, source: ScopeSourceInput | null | undefined) {
  if (source === undefined) return;
  if (source === null) { await client.query("DELETE FROM scope_sources WHERE project_id = $1", [projectId]); return; }
  await client.query(
    `INSERT INTO scope_sources (project_id, kind, label, source_url, page_count, content_hash, imported_at, last_checked_at)
     SELECT p.id, $2, $3, $4, $5, encode(sha256(convert_to(p.scope, 'UTF8')), 'hex'), NOW(), CASE WHEN $2 = 'link' THEN NOW() END
     FROM projects p WHERE p.id = $1
     ON CONFLICT (project_id) DO UPDATE SET kind = EXCLUDED.kind, label = EXCLUDED.label, source_url = EXCLUDED.source_url,
       page_count = EXCLUDED.page_count, content_hash = EXCLUDED.content_hash, imported_at = EXCLUDED.imported_at,
       last_checked_at = EXCLUDED.last_checked_at`,
    [projectId, source.kind, source.label, source.sourceUrl ?? null, source.pageCount ?? null],
  );
}
