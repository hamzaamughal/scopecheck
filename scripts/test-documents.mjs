// Integration test for supporting documents and RAG-backed assessments.
// Needs the local app running with SCOPECHECK_FAKE_AI=1 (deterministic stand-ins for embeddings and the
// assessment model) and DATABASE_URL. Makes zero OpenAI calls and sends no email.
//   SCOPECHECK_FAKE_AI=1 npm run dev   then   npm run test:documents
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { createAuthOptions } from '../src/lib/auth-options.ts';

nextEnv.loadEnvConfig(fileURLToPath(new URL('../', import.meta.url)));
const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
const origin = new URL(base).origin;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Run this integration test against a local app only.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const captured = [];
const fixtureAuth = betterAuth(createAuthOptions(pool, async message => { captured.push(message); }));
const emails = [0, 1].map(() => `scopecheck-qa-${randomUUID()}@example.com`);
const password = randomBytes(24).toString('base64url');

const localAuth = (path, body) => fixtureAuth.handler(new Request(`${base}/api/auth${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const call = (path, method = 'GET', cookie = '', body, customOrigin = origin) => fetch(base + path, {
  method, redirect: 'manual', signal: AbortSignal.timeout(90000),
  headers: { Origin: customOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function expect(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const count = async (sql, params) => Number((await pool.query(sql, params)).rows[0].count);

async function signUp(email) {
  const res = await localAuth('/sign-up/email', { name: 'QA user', email, password });
  const { user } = await expect(res, 200, 'Signup');
  const verification = captured.find(m => m.to === email && m.kind === 'verify');
  assert.equal((await fixtureAuth.handler(new Request(verification.url))).status, 302, 'Verify email');
  const login = await call('/api/auth/sign-in/email', 'POST', '', { email, password });
  await expect(login.clone(), 200, 'Sign in');
  return { id: user.id, cookie: login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
}

// Filler paragraphs that never mention logins, so the needle must be found by search.
const filler = topic => Array.from({ length: 450 }, (_, i) =>
  `${topic} update ${i}: reviewed typography, image crops, colour contrast and page speed for section ${i}. Next steps agreed with the design team.`).join('\n\n');
const SCOPE = '[Page 1]\nNorthwind website: five marketing pages and a contact form.\n\n[Page 2]\n5. Exclusions\nUser accounts, online payments, and ongoing maintenance are not included.';
const NEEDLE = 'The client asked whether each customer could get a login to a private portal; we agreed to quote it separately after launch.';

try {
  const [a, b] = [await signUp(emails[0]), await signUp(emails[1])];
  const { data: { project } } = await expect(await call('/api/projects', 'POST', a.cookie, { name: 'QA RAG', clientName: 'Northwind', scope: SCOPE }), 201, 'Create project');
  const docs = `/api/projects/${project.id}/documents`;

  // --- Documents CRUD, validation, isolation ---
  const email = { kind: 'email', title: 'Kickoff email thread', text: `Hi team,\n\nThanks for the call.\n\n${NEEDLE}\n\nBest, Dana` };
  const { data: { document: small } } = await expect(await call(docs, 'POST', a.cookie, email), 201, 'Add document');
  assert.equal(small.indexStatus, 'ready', 'indexed with (fake) embeddings');
  assert.ok(small.chunkCount >= 1);
  assert.equal(await count('SELECT count(*) FROM document_chunks WHERE document_id = $1 AND embedding IS NOT NULL', [small.id]), small.chunkCount, 'every chunk embedded');
  await expect(await call(docs, 'POST', a.cookie, { ...email, kind: 'invoice' }), 400, 'Invalid kind');
  await expect(await call(docs, 'POST', a.cookie, { ...email, text: 'x'.repeat(200_001) }), 400, 'Document over 200k');
  await expect(await call(docs, 'POST', a.cookie, email, 'https://other.example'), 403, 'Cross-origin add');
  await expect(await call(docs, 'GET', b.cookie), 404, 'Other user cannot list');
  await expect(await call(docs, 'POST', b.cookie, email), 404, 'Other user cannot add');
  await expect(await call(`${docs}/${small.id}`, 'GET', b.cookie), 404, 'Other user cannot read');
  await expect(await call(`${docs}/${small.id}`, 'DELETE', b.cookie), 404, 'Other user cannot delete');
  await expect(await call(`${docs}/not-a-uuid`, 'GET', a.cookie), 400, 'Invalid document id');
  const read = await expect(await call(`${docs}/${small.id}`, 'GET', a.cookie), 200, 'Owner reads document');
  assert.ok(read.data.document.text.includes(NEEDLE));
  assert.equal((await expect(await call(docs, 'GET', a.cookie), 200, 'List')).data.documents.length, 1);

  // --- Assessment, full-context mode (scope + small document fit) ---
  const { data: { request } } = await expect(await call(`/api/projects/${project.id}/requests`, 'POST', a.cookie,
    { title: 'Client login portal', description: 'Could each customer get user accounts with a login to a private portal?' }), 201, 'Create request');
  const assessPath = `/api/projects/${project.id}/requests/${request.id}/assessment`;
  const full = (await expect(await call(assessPath, 'POST', a.cookie), 201, 'Assess (full context)')).data.assessment;
  assert.equal(full.context.mode, 'full');
  assert.equal(full.context.documentCount, 1);
  assert.ok(full.citations.some(c => !c.binding && c.documentTitle === 'Kickoff email thread' && NEEDLE.includes(c.quote)), 'cites the email as context');
  assert.equal(full.isStale, false);

  // --- Retrieval mode: two long documents push the total over the full-context budget ---
  const long1 = await expect(await call(docs, 'POST', a.cookie, { kind: 'notes', title: 'Design review notes', text: filler('Design') }), 201, 'Add long notes');
  const long2 = await expect(await call(docs, 'POST', a.cookie, { kind: 'proposal', title: 'Proposal v2',
    text: `${filler('Proposal')}\n\n[Page 9]\nPortal\n${NEEDLE}` }), 201, 'Add long proposal');
  assert.ok(long2.data.document.chunkCount > 10);
  const stale = (await expect(await call(assessPath, 'GET', a.cookie), 200, 'Reload assessment')).data.assessment;
  assert.equal(stale.isStale, true, 'adding documents marks the earlier assessment outdated');

  const rag = (await expect(await call(assessPath, 'POST', a.cookie), 201, 'Assess (retrieval)')).data.assessment;
  assert.equal(rag.context.mode, 'retrieval');
  assert.equal(rag.context.search, 'hybrid');
  assert.ok(rag.context.chunkCount > 0 && rag.context.chunkCount <= 8);
  const contextCitation = rag.citations.find(c => !c.binding);
  assert.ok(contextCitation && NEEDLE.includes(contextCitation.quote), 'retrieved the needle chunk');
  if (contextCitation.documentTitle === 'Proposal v2') assert.equal(contextCitation.page, 9, 'page carried from the chunk');
  assert.ok(rag.citations.some(c => c.binding), 'binding quote from the agreed scope');
  assert.ok(await count("SELECT count(*) FROM assessments WHERE request_id = $1 AND documents_hash IS NOT NULL AND context->>'mode' = 'retrieval'", [request.id]) === 1);
  assert.ok(await count('SELECT count(*) FROM embedding_usage WHERE user_id = $1 AND tokens > 0', [a.id]) === 1, 'embedding budget recorded');

  // --- Delete, limit, cascades ---
  await expect(await call(`${docs}/${long1.data.document.id}`, 'DELETE', a.cookie), 200, 'Delete document');
  assert.equal(await count('SELECT count(*) FROM document_chunks WHERE document_id = $1', [long1.data.document.id]), 0, 'chunks removed with document');
  assert.equal((await expect(await call(assessPath, 'GET', a.cookie), 200, 'Reload')).data.assessment.isStale, true, 'deleting a document marks it outdated');
  for (let i = 0; i < 8; i++) await expect(await call(docs, 'POST', a.cookie, { kind: 'other', title: `Note ${i}`, text: `Short note ${i}.` }), 201, `Fill ${i}`);
  await expect(await call(docs, 'POST', a.cookie, { kind: 'other', title: 'One too many', text: 'x' }), 409, 'Eleventh document');
  await expect(await call(`/api/projects/${project.id}`, 'DELETE', a.cookie), 200, 'Delete project');
  assert.equal(await count('SELECT count(*) FROM project_documents WHERE project_id = $1', [project.id]), 0, 'documents removed with project');
  assert.equal(await count('SELECT count(*) FROM document_chunks WHERE project_id = $1', [project.id]), 0, 'chunks removed with project');
  console.log('PASS: documents CRUD + isolation, full-context and hybrid-retrieval assessments, source-checked citations, staleness, limits, cascades. No AI calls.');
} finally {
  const ids = (await pool.query('SELECT id FROM auth_user WHERE email = ANY($1::text[])', [emails])).rows.map(r => r.id);
  await pool.query('DELETE FROM assessments WHERE request_id IN (SELECT r.id FROM requests r JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = ANY($1::text[]))', [ids]);
  await pool.query('DELETE FROM requests WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id = ANY($1::text[]))', [ids]);
  await pool.query('DELETE FROM projects WHERE owner_user_id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [ids]);
  await pool.end();
}
