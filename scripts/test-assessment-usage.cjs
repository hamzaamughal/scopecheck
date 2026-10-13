/* eslint-disable @typescript-eslint/no-require-imports -- In-memory CommonJS loader for production TS route tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const originalLimit = process.env.ASSESSMENT_DAILY_LIMIT;
process.env.ASSESSMENT_DAILY_LIMIT = '3';
const users = [randomUUID(), randomUUID()];
let projectId, requestId, currentUser = users[0], aiCalls = 0;
let failAI = false, failSave = false, failReserve = false;
const cache = new Map();
const root = path.resolve(__dirname, '..');
const testDb = { query: async (sql, args) => {
 if (failSave && sql.includes('INSERT INTO assessments')) throw Error('Simulated save failure');
 if (failReserve && sql.includes('INSERT INTO assessment_usage')) throw Error('Simulated quota failure');
 return pool.query(sql, args);
}};
function load(relative) {
 const file = path.resolve(root, relative);
 if (cache.has(file)) return cache.get(file).exports;
 const mod = new Module(file, module); cache.set(file, mod); mod.filename = file; mod.paths = module.paths;
 mod.require = name => {
  if (name === 'server-only') return {};
  if (name === '@/lib/db') return { db: testDb };
  if (name === '@/lib/auth-session') return { authorizeRequest: async () => currentUser ? { user: { id: currentUser } } : { response: Response.json({success:false}, {status:401}) } };
  if (name === '@/lib/ai/assess-request') return { ASSESSMENT_MODEL: 'usage-test-mock', assessRequest: async () => {
   aiCalls++; if (failAI) throw Error('Simulated provider failure');
   return { suggestedDecision:'extra_work', explanation:'Accounts are excluded.', evidence:['User accounts are excluded.'], clarificationQuestions:[] };
  }};
  if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
  return require(name);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
 return mod.exports;
}
(async () => {
 try {
  for (const id of users) await pool.query('INSERT INTO auth_user(id,name,email,"emailVerified") VALUES($1,$2,$3,false)', [id,'Usage QA',`usage-qa-${id}@example.com`]);
  projectId = (await pool.query('INSERT INTO projects(name,scope,owner_user_id) VALUES($1,$2,$3) RETURNING id',['Usage QA','User accounts are excluded.',users[0]])).rows[0].id;
  requestId = (await pool.query('INSERT INTO requests(project_id,title,description) VALUES($1,$2,$3) RETURNING id',[projectId,'Login','Add login'])).rows[0].id;
  const usage = load('src/lib/assessment-usage.ts');
  const route = load('src/app/api/projects/[projectId]/requests/[requestId]/assessment/route.ts');
  const usageRoute = load('src/app/api/usage/route.ts');
  const ctx = () => ({params:Promise.resolve({projectId,requestId})});
  const request = new Request('http://localhost/assessment', {method:'POST'});
  const readUsage = () => usage.getAssessmentUsage(users[0]);
  let u = await readUsage(); assert.equal(u.remaining,3); assert.equal(u.used,0); assert.ok(u.resetsAt.endsWith('T00:00:00.000Z'));
  assert.ok(Date.parse(u.resetsAt) > Date.now());
  await pool.query("INSERT INTO assessment_usage(user_id,usage_day,used) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date-1,100)",[users[0]]);
  assert.equal((await readUsage()).used,0,'Previous day must not consume today');
  const reservations = await Promise.all(Array.from({length:12},()=>usage.reserveAssessment(users[0])));
  assert.equal(reservations.filter(Boolean).length,3,'Atomic reservation must stop concurrent overspend');
  assert.equal((await readUsage()).remaining,0); assert.equal((await readUsage()).used,3);
  assert.equal((await usage.getAssessmentUsage(users[1])).used,0,'Separate user allowance');
  let res = await route.POST(request,ctx()); assert.equal(res.status,429); assert.equal(aiCalls,0,'Limit checked before AI');
  assert.equal((await res.json()).error.code,'ASSESSMENT_LIMIT_REACHED');
  currentUser=users[1]; res=await route.POST(request,ctx());assert.equal(res.status,404);assert.equal((await usage.getAssessmentUsage(users[1])).used,0);
  currentUser=null;assert.equal((await usageRoute.GET(request)).status,401);assert.equal((await route.POST(request,ctx())).status,401);
  currentUser=users[0];
  await pool.query("DELETE FROM assessment_usage WHERE user_id=$1 AND usage_day=(NOW() AT TIME ZONE 'UTC')::date",[users[0]]);
  const savedKey=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  assert.equal((await route.POST(request,ctx())).status,500);assert.equal((await readUsage()).used,0);
  if(savedKey)process.env.OPENAI_API_KEY=savedKey;else process.env.OPENAI_API_KEY='mock-only';
  failReserve=true;assert.equal((await route.POST(request,ctx())).status,503);assert.equal(aiCalls,0);failReserve=false;
  failAI=true;assert.equal((await route.POST(request,ctx())).status,502);assert.equal((await readUsage()).used,1);failAI=false;
  failSave=true;assert.equal((await route.POST(request,ctx())).status,503);assert.equal((await readUsage()).used,2);failSave=false;
  res=await route.POST(request,ctx());assert.equal(res.status,201);const saved=(await res.json()).data.assessment;
  assert.equal((await readUsage()).used,3);assert.equal(aiCalls,3);
  res=await route.POST(request,ctx());assert.equal(res.status,429);assert.equal(aiCalls,3);
  res=await route.GET(request,ctx());assert.equal(res.status,200);assert.equal((await res.json()).data.assessment.id,saved.id);assert.equal((await readUsage()).used,3,'Reads do not consume usage');
  res=await usageRoute.GET(request);assert.equal((await res.json()).data.usage.remaining,0);
  process.env.ASSESSMENT_DAILY_LIMIT='invalid';assert.throws(()=>usage.dailyAssessmentLimit());
  console.log('PASS: 12 concurrent reservations stop at 3, separate users, UTC reset/previous day, 429 before AI, unauthorized/foreign access, missing key, fail-closed quota error, counted provider/save failures, saved reads at limit, invalid configuration. No provider calls.');
 } finally {
  if (originalLimit === undefined) delete process.env.ASSESSMENT_DAILY_LIMIT; else process.env.ASSESSMENT_DAILY_LIMIT = originalLimit;
  if (requestId) await pool.query('DELETE FROM assessments WHERE request_id=$1',[requestId]);
  if (projectId) {await pool.query('DELETE FROM requests WHERE project_id=$1',[projectId]); await pool.query('DELETE FROM projects WHERE id=$1 AND owner_user_id=$2',[projectId,users[0]]);}
  await pool.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [users]);
  await pool.end();
 }
})().catch(error=>{console.error(error instanceof assert.AssertionError ? error.message : 'Usage integration test failed; verify database access.');process.exitCode=1;});
