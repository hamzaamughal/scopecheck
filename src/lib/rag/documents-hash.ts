// Fingerprint of a project's supporting documents (alias "p" = projects). NULL when there are none.
// Saved with each assessment; a different value later means the documents changed since.
export const DOCUMENTS_HASH_SQL = `(SELECT md5(string_agg(d.content_hash, ',' ORDER BY d.id)) FROM project_documents d WHERE d.project_id = p.id)`;
