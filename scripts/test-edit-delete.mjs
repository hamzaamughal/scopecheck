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
  await pool.query('INSERT INTO assessment_usage (user_id, usage_day, used) VALUES ($1, CURRENT_DATE, 1)', [a.id]);
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
    ['SELECT count(*) FROM assessment_usage WHERE user_id = $1', 'usage'],
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
