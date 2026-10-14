// Integration test for project/request edit + delete and account deletion.
// Needs the local app running (npm run dev) and DATABASE_URL. Makes zero OpenAI calls and sends no email.
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
  method, redirect: 'manual', signal: AbortSignal.timeout(60000),
  headers: { Origin: customOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function expect(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const count = async (sql, params) => Number((await pool.query(sql, params)).rows[0].count);
const addAssessment = requestId => pool.query(
  `INSERT INTO assessments (request_id, model, scope_snapshot, title_snapshot, description_snapshot, output)
   VALUES ($1, 'test-fixture', 's', 't', 'd', '{"suggestedDecision":"included","explanation":"x","evidence":[],"clarificationQuestions":[]}')`, [requestId]);

async function signUp(email) {
  const res = await localAuth('/sign-up/email', { name: 'QA user', email, password });
  const { user } = await expect(res, 200, 'Signup');
  const verification = captured.find(m => m.to === email && m.kind === 'verify');
  assert.ok(verification, 'Verification callback invoked');
  assert.equal((await fixtureAuth.handler(new Request(verification.url))).status, 302, 'Verify email');
  const login = await call('/api/auth/sign-in/email', 'POST', '', { email, password });
  await expect(login.clone(), 200, 'Sign in');
  return { id: user.id, cookie: login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
}

try {
  const [a, b] = [await signUp(emails[0]), await signUp(emails[1])];

  // Project edit
  const { data: { project } } = await expect(await call('/api/projects', 'POST', a.cookie, { name: 'QA edit', clientName: 'Acme', scope: 'Five pages.' }), 201, 'Create project');
  const projectPath = `/api/projects/${project.id}`;
  const edited = await expect(await call(projectPath, 'PATCH', a.cookie, { name: 'QA edited', clientName: '', scope: 'Six pages.' }), 200, 'Owner edits project');
  assert.equal(edited.data.project.name, 'QA edited');
  assert.equal(edited.data.project.clientName, null);
  assert.equal(edited.data.project.scope, 'Six pages.');
  await expect(await call(projectPath, 'PATCH', b.cookie, { name: 'Attack', scope: 'x' }), 404, 'Cross-user project edit');
  await expect(await call(projectPath, 'PATCH', a.cookie, { name: '', scope: '' }), 400, 'Invalid project edit');
  await expect(await call(projectPath, 'PATCH', a.cookie, { name: 'x', scope: 'y' }, 'https://other.example'), 403, 'Cross-origin project edit');
  await expect(await call('/api/projects/not-a-uuid', 'PATCH', a.cookie, { name: 'x', scope: 'y' }), 400, 'Invalid project ID');

  // Scope import sources
  const srcBody = { name: 'QA import', scope: '[Page 1]\nFive pages.\n\n[Page 2]\nUser accounts are excluded.', source: { kind: 'file', label: 'sow.pdf', pageCount: 2 } };
  const { data: { project: imported } } = await expect(await call('/api/projects', 'POST', a.cookie, srcBody), 201, 'Create project with file source');
  assert.equal(imported.source.label, 'sow.pdf'); assert.equal(imported.source.pageCount, 2); assert.equal(imported.source.editedSinceImport, false);
  await expect(await call('/api/projects', 'POST', a.cookie, { ...srcBody, source: { kind: 'link', label: 'x' } }), 400, 'Link source without URL');
  await expect(await call('/api/projects', 'POST', a.cookie, { ...srcBody, scope: 'x'.repeat(60001) }), 400, 'Scope over 60k');
  assert.ok(!(await expect(await call('/api/projects', 'GET', b.cookie), 200, 'B list')).data.projects.some(p => p.id === imported.id));
  const keptSrc = await expect(await call(`/api/projects/${imported.id}`, 'PATCH', a.cookie, { name: 'QA import', scope: srcBody.scope + '\nEdited.' }), 200, 'Edit keeps source');
  assert.equal(keptSrc.data.project.source.label, 'sow.pdf'); assert.equal(keptSrc.data.project.source.editedSinceImport, true);
  const cleared = await expect(await call(`/api/projects/${imported.id}`, 'PATCH', a.cookie, { name: 'QA import', scope: 'Plain.', source: null }), 200, 'Clear source');
  assert.equal(cleared.data.project.source, null);
  await expect(await call(`/api/projects/${imported.id}`, 'PATCH', a.cookie, { name: 'QA import', scope: 'Linked.', source: { kind: 'link', label: 'Doc', sourceUrl: 'https://example.com/sow' } }), 200, 'Set link source');
  await expect(await call(`/api/projects/${imported.id}`, 'PATCH', b.cookie, { name: 'x', scope: 'y', source: null }), 404, 'Cross-user source edit');
  const linkPath = '/api/scope-import/link';
  await expect(await call(linkPath, 'POST', '', { url: 'https://example.com' }), 401, 'Anonymous link import');
  await expect(await call(linkPath, 'POST', a.cookie, { url: 'https://example.com' }, 'https://other.example'), 403, 'Cross-origin link import');
  await expect(await call(linkPath, 'POST', a.cookie, { url: 'ftp://example.com' }), 400, 'Unsupported scheme');
  await expect(await call(linkPath, 'POST', b.cookie, { url: 'https://example.com', projectId: imported.id }), 404, 'Re-check foreign project link');
  const blocked = await expect(await call(linkPath, 'POST', a.cookie, { url: 'http://169.254.169.254/latest/meta-data/' }), 422, 'Metadata address blocked');
  assert.match(blocked.error.details[0].message, /private or local address/);
  let limited = false;
  for (let i = 0; i < 31 && !limited; i++) limited = (await call(linkPath, 'POST', a.cookie, { url: 'http://127.0.0.1/' })).status === 429;
  assert.ok(limited, 'Link imports are limited per day');
  await expect(await call(`/api/projects/${imported.id}`, 'DELETE', a.cookie), 200, 'Delete imported project');
  assert.equal(await count('SELECT count(*) FROM scope_sources WHERE project_id = $1', [imported.id]), 0, 'Source removed with project');
  console.log('PASS: scope sources (save, keep, clear, validation, ownership) and link import (auth, CSRF, SSRF block, daily limit, cascade).');

  // Scope versions, change orders, reply drafts
  {
    const { data: { project: wp } } = await expect(await call('/api/projects', 'POST', a.cookie, { name: 'QA workflow', clientName: 'Sam', scope: 'Five pages. User accounts are excluded.' }), 201, 'Create workflow project');
    const P = `/api/projects/${wp.id}`;
    let versions = (await expect(await call(`${P}/scope-versions`, 'GET', a.cookie), 200, 'List versions')).data.versions;
    assert.deepEqual(versions.map(v => [v.version, v.reason]), [[1, 'initial']]);
    await expect(await call(P, 'PATCH', a.cookie, { name: 'QA workflow', clientName: 'Sam', scope: 'Six pages. User accounts are excluded.' }), 200, 'Edit scope');
    await expect(await call(P, 'PATCH', a.cookie, { name: 'QA workflow renamed', clientName: 'Sam', scope: 'Six pages. User accounts are excluded.' }), 200, 'Rename only');
    versions = (await expect(await call(`${P}/scope-versions`, 'GET', a.cookie), 200, 'List versions')).data.versions;
    assert.deepEqual(versions.map(v => [v.version, v.reason]), [[2, 'edit'], [1, 'initial']], 'Rename does not create a version');
    assert.equal((await expect(await call(`${P}/scope-versions?version=1`, 'GET', a.cookie), 200, 'Get v1')).data.version.scope, 'Five pages. User accounts are excluded.');
    await expect(await call(`${P}/scope-versions?version=abc`, 'GET', a.cookie), 400, 'Invalid version');
    await expect(await call(`${P}/scope-versions`, 'GET', b.cookie), 404, 'Cross-user versions');

    const { data: { request: wr } } = await expect(await call(`${P}/requests`, 'POST', a.cookie, { title: 'Client login', description: 'Can clients log in?' }), 201, 'Create request');
    const R = `${P}/replies`;
    assert.equal((await expect(await call(`${R}?requestId=${wr.id}`, 'GET', a.cookie), 200, 'No draft yet')).data.draft, null);
    await expect(await call(R, 'POST', a.cookie, { requestId: wr.id }), 409, 'Reply needs a decision');
    await expect(await call(R, 'POST', b.cookie, { requestId: wr.id }), 404, 'Cross-user reply');
    await expect(await call(`${R}?requestId=${wr.id}`, 'GET', b.cookie), 404, 'Cross-user reply read');
    await expect(await call(R, 'POST', a.cookie, { requestId: 'nope' }), 400, 'Invalid reply input');

    const CO = `${P}/change-orders`;
    const first = (await expect(await call(CO, 'POST', a.cookie, { title: 'Client login', description: 'Accounts for clients.', hours: 6, amount: 450, currency: 'USD', requestId: wr.id }), 201, 'Create CO')).data.changeOrder;
    assert.deepEqual([first.number, first.amountCents, first.hours, first.status, first.requestId], [1, 45000, 6, 'proposed', wr.id]);
    const second = (await expect(await call(CO, 'POST', a.cookie, { title: 'Blog', description: 'Blog section.' }), 201, 'Create CO 2')).data.changeOrder;
    assert.equal(second.number, 2);
    await expect(await call(CO, 'POST', a.cookie, { title: 'x', description: 'y', amount: -1 }), 400, 'Negative amount');
    await expect(await call(CO, 'POST', a.cookie, { title: 'x', description: 'y', requestId: imported.id }), 404, 'Request from another project');
    await expect(await call(CO, 'POST', b.cookie, { title: 'x', description: 'y' }), 404, 'Cross-user CO create');
    await expect(await call(CO, 'GET', b.cookie), 404, 'Cross-user CO list');
    await expect(await call(`${CO}/${first.id}`, 'PATCH', b.cookie, { action: 'accept' }), 404, 'Cross-user accept');
    await expect(await call(`${CO}/${first.id}`, 'PATCH', a.cookie, { title: 'Client login area', description: 'Accounts for clients.', hours: '6', amount: '450', currency: 'USD' }), 200, 'Edit proposed CO');
    const accepted = (await expect(await call(`${CO}/${first.id}`, 'PATCH', a.cookie, { action: 'accept' }), 200, 'Accept CO')).data;
    assert.equal(accepted.changeOrder.status, 'accepted');
    assert.match(accepted.project.scope, /\[Change order #1 · accepted \d{4}-\d{2}-\d{2}\]\nClient login area\nAccounts for clients\.\nEstimate: 6 hours · USD 450\.00$/);
    versions = (await expect(await call(`${P}/scope-versions`, 'GET', a.cookie), 200, 'Versions after accept')).data.versions;
    assert.deepEqual([versions[0].version, versions[0].reason, versions[0].changeOrderNumber], [3, 'change_order', 1]);
    await expect(await call(`${CO}/${first.id}`, 'PATCH', a.cookie, { action: 'accept' }), 409, 'Accept twice');
    await expect(await call(`${CO}/${first.id}`, 'PATCH', a.cookie, { action: 'reject' }), 409, 'Reject accepted');
    await expect(await call(`${CO}/${first.id}`, 'DELETE', a.cookie), 409, 'Delete accepted');
    assert.equal((await expect(await call(`${CO}/${second.id}`, 'PATCH', a.cookie, { action: 'reject' }), 200, 'Reject CO')).data.changeOrder.status, 'rejected');
    await expect(await call(`${CO}/${second.id}`, 'DELETE', a.cookie), 200, 'Delete rejected CO');

    // Accepting must not push the scope past the limit; the order stays proposed.
    const { data: { project: big } } = await expect(await call('/api/projects', 'POST', a.cookie, { name: 'QA big', scope: 'x'.repeat(59990) }), 201, 'Large scope');
    const bigOrder = (await expect(await call(`/api/projects/${big.id}/change-orders`, 'POST', a.cookie, { title: 'More', description: 'y'.repeat(100) }), 201, 'CO on large scope')).data.changeOrder;
    await expect(await call(`/api/projects/${big.id}/change-orders/${bigOrder.id}`, 'PATCH', a.cookie, { action: 'accept' }), 422, 'Scope too long');
    assert.equal((await expect(await call(`/api/projects/${big.id}/change-orders`, 'GET', a.cookie), 200, 'List')).data.changeOrders[0].status, 'proposed');
    await expect(await call(`/api/projects/${big.id}`, 'DELETE', a.cookie), 200, 'Delete large project');

    await expect(await call(`${P}/requests/${wr.id}`, 'PATCH', a.cookie, { decision: 'extra_work', decisionNote: 'Outside scope' }), 200, 'Decide');
    if (process.argv.includes('--fake-ai')) {
      // Only with a dev server started with SCOPECHECK_FAKE_AI=1 (never spends credits).
      const draft = (await expect(await call(R, 'POST', a.cookie, { requestId: wr.id, tone: 'formal' }), 201, 'Draft reply')).data.draft;
      assert.match(draft.body, /Hi Sam/); assert.match(draft.body, /change order #1/); assert.equal(draft.tone, 'formal'); assert.equal(draft.isStale, false);
      await expect(await call(`${P}/requests/${wr.id}`, 'PATCH', a.cookie, { decision: 'included' }), 200, 'Change decision');
      assert.equal((await expect(await call(`${R}?requestId=${wr.id}`, 'GET', a.cookie), 200, 'Stale draft')).data.draft.isStale, true);
      console.log('PASS: reply drafts (fake AI): generation, change order mention, stale after decision change.');
    }
    await expect(await call(`${P}/requests/${wr.id}`, 'DELETE', a.cookie), 200, 'Delete request with CO');
    assert.equal(await count('SELECT count(*) FROM change_orders WHERE id = $1 AND request_id IS NULL', [first.id]), 1, 'CO kept, request link cleared');
    await expect(await call(P, 'DELETE', a.cookie), 200, 'Delete workflow project');
    for (const table of ['change_orders', 'scope_versions']) assert.equal(await count(`SELECT count(*) FROM ${table} WHERE project_id = $1`, [wp.id]), 0, `${table} removed`);
    console.log('PASS: scope versions, change orders (numbering, edit, accept into scope, reject, delete rules, limits, ownership), reply-draft guards, cascades.');
  }

  // Request edit keeps the human decision
  const reqPath = `${projectPath}/requests`;
  const { data: { request } } = await expect(await call(reqPath, 'POST', a.cookie, { title: 'Login', description: 'Client login' }), 201, 'Create request');
  const one = `${reqPath}/${request.id}`;
  await expect(await call(one, 'PATCH', a.cookie, { decision: 'extra_work', decisionNote: 'Out of scope' }), 200, 'Save decision');
  const reworded = await expect(await call(one, 'PATCH', a.cookie, { title: 'Client login', description: 'Clients sign in to view files' }), 200, 'Owner edits request');
  assert.equal(reworded.data.request.title, 'Client login');
  assert.equal(reworded.data.request.decision, 'extra_work', 'Decision kept after edit');
  await expect(await call(one, 'PATCH', a.cookie, { decision: 'included', title: 'Mixed' }), 400, 'Mixed PATCH body');
  await expect(await call(one, 'PATCH', a.cookie, {}), 400, 'Empty PATCH body');
  await expect(await call(one, 'PATCH', a.cookie, { title: '', description: 'x' }), 400, 'Invalid request edit');
  await expect(await call(one, 'PATCH', b.cookie, { title: 'Attack', description: 'x' }), 404, 'Cross-user request edit');

  // Request delete removes its assessments
  await addAssessment(request.id);
  await expect(await call(one, 'DELETE', b.cookie), 404, 'Cross-user request delete');
  await expect(await call(one, 'DELETE', a.cookie, undefined, 'https://other.example'), 403, 'Cross-origin request delete');
  await expect(await call(one, 'DELETE', a.cookie), 200, 'Owner deletes request');
  assert.equal(await count('SELECT count(*) FROM requests WHERE id = $1', [request.id]), 0);
  assert.equal(await count('SELECT count(*) FROM assessments WHERE request_id = $1', [request.id]), 0);
  await expect(await call(one, 'DELETE', a.cookie), 404, 'Repeat request delete');

  // Project delete removes requests and assessments
  for (const title of ['R1', 'R2']) {
    const { data } = await expect(await call(reqPath, 'POST', a.cookie, { title, description: 'x' }), 201, 'Create request');
    await addAssessment(data.request.id);
  }
  await expect(await call(projectPath, 'DELETE', b.cookie), 404, 'Cross-user project delete');
  await expect(await call(projectPath, 'DELETE', a.cookie), 200, 'Owner deletes project');
  assert.equal(await count('SELECT count(*) FROM projects WHERE id = $1', [project.id]), 0);
  assert.equal(await count('SELECT count(*) FROM requests WHERE project_id = $1', [project.id]), 0);
  await expect(await call(projectPath, 'DELETE', a.cookie), 404, 'Repeat project delete');
  console.log('PASS: project/request edit, decision kept, validation, ownership, CSRF, cascading deletes.');

  // Account delete
  const { data: { project: kept } } = await expect(await call('/api/projects', 'POST', a.cookie, { name: 'QA account', scope: 'x' }), 201, 'Create project');
  const { data: { request: keptRequest } } = await expect(await call(`/api/projects/${kept.id}/requests`, 'POST', a.cookie, { title: 'R', description: 'x' }), 201, 'Create request');
  await addAssessment(keptRequest.id);
  await pool.query('INSERT INTO assessment_usage (user_id, usage_day, used) VALUES ($1, CURRENT_DATE, 1) ON CONFLICT DO NOTHING', [a.id]);
  await expect(await call('/api/account', 'DELETE', b.cookie, { confirmEmail: emails[0] }), 400, 'Wrong confirmation email');
  await expect(await call('/api/account', 'DELETE', a.cookie, { confirmEmail: emails[0] }, 'https://other.example'), 403, 'Cross-origin account delete');
  await pool.query(`UPDATE auth_session SET "createdAt" = NOW() - interval '2 days' WHERE "userId" = $1`, [a.id]);
  const stale = await expect(await call('/api/account', 'DELETE', a.cookie, { confirmEmail: emails[0] }), 403, 'Old session must re-authenticate');
  assert.equal(stale.error.code, 'REAUTH_REQUIRED');
  await pool.query(`UPDATE auth_session SET "createdAt" = NOW() WHERE "userId" = $1`, [a.id]);
  await expect(await call('/api/account', 'DELETE', a.cookie, { confirmEmail: emails[0].toUpperCase() }), 200, 'Delete account');
  for (const [sql, label] of [
    ['SELECT count(*) FROM auth_user WHERE id = $1', 'user'], ['SELECT count(*) FROM auth_session WHERE "userId" = $1', 'sessions'],
    ['SELECT count(*) FROM auth_account WHERE "userId" = $1', 'accounts'], ['SELECT count(*) FROM projects WHERE owner_user_id = $1', 'projects'],
    ['SELECT count(*) FROM assessment_usage WHERE user_id = $1', 'usage'], ['SELECT count(*) FROM import_usage WHERE user_id = $1', 'import usage'],
  ]) assert.equal(await count(sql, [a.id]), 0, `Account ${label} removed`);
  assert.equal(await count('SELECT count(*) FROM assessments WHERE request_id = $1', [keptRequest.id]), 0, 'Account assessments removed');
  await expect(await call('/api/projects', 'GET', a.cookie), 401, 'Deleted account session rejected');
  await expect(await call('/api/projects', 'GET', b.cookie), 200, 'Other user unaffected');
  console.log('PASS: account deletion (confirmation, fresh-session check, full data removal, other users unaffected). No AI calls, no emails.');
} finally {
  // Remove only synthetic records from this run, even after a partial failure.
  const ids = (await pool.query('SELECT id FROM auth_user WHERE email = ANY($1::text[])', [emails])).rows.map(r => r.id);
  await pool.query('DELETE FROM assessments WHERE request_id IN (SELECT r.id FROM requests r JOIN projects p ON p.id = r.project_id WHERE p.owner_user_id = ANY($1::text[]))', [ids]);
  await pool.query('DELETE FROM requests WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id = ANY($1::text[]))', [ids]);
  await pool.query('DELETE FROM projects WHERE owner_user_id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM auth_user WHERE id = ANY($1::text[])', [ids]);
  await pool.end();
}
