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
const pool = new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const capturedEmails = [];
const fixtureAuth = betterAuth(createAuthOptions(pool, async message => { capturedEmails.push(message); }));
async function localAuth(path, body) {
 return fixtureAuth.handler(new Request(base+'/api/auth'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
}
const emails = [0,1].map(()=>`scopecheck-qa-${randomUUID()}@example.com`);
const password = randomBytes(24).toString('base64url');
const userIds = [];
const projectIds = [];
async function call(path, method='GET', cookie='', body, customOrigin=origin) {
 return fetch(base+path,{method,redirect:'manual',headers:{Origin:customOrigin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
}
async function status(response, expected, label) { assert.equal(response.status, expected, `${label}: expected ${expected}, got ${response.status}`); }
try {
 await status(await call('/api/projects'),401,'Anonymous project list');
 await status(await call('/api/db-check'),401,'Anonymous DB check');
 const landing=await call('/');assert.equal(landing.status,307);assert.ok(landing.headers.get('location')?.includes('/login'));
 const cookies=[];
 for (let i=0;i<2;i++){
  const res=await localAuth('/sign-up/email',{name:`QA ${i}`,email:emails[i],password});
  await status(res,200,'Signup');const data=await res.json();userIds.push(data.user.id);
  assert.equal(data.token, null);
  await status(await call('/api/auth/sign-in/email','POST','',{email:emails[i],password}),403,'Unverified sign-in denied');
  const verification=capturedEmails.find(message=>message.to===emails[i] && message.kind==='verify');
  assert.ok(verification,'Verification callback invoked');
  await status(await fixtureAuth.handler(new Request(verification.url)),302,'Verify email token');
  assert.equal((await pool.query('SELECT "emailVerified" FROM auth_user WHERE id=$1',[data.user.id])).rows[0].emailVerified,true);
  const login=await call('/api/auth/sign-in/email','POST','',{email:emails[i],password});
  await status(login,200,'Verified sign-in');
  const setCookies=login.headers.getSetCookie();assert.ok(setCookies.some(value=>/httponly/i.test(value)));assert.ok(setCookies.some(value=>/samesite=lax/i.test(value)));
  cookies.push(setCookies.map(value=>value.split(';')[0]).join('; '));
 }
 const [a,b]=cookies;
 const hash=(await pool.query('SELECT password FROM auth_account WHERE "userId"=$1 AND "providerId"=$2',[userIds[0],'credential'])).rows[0].password;
 assert.notEqual(hash,password);assert.ok(hash.length>50);
 await status(await call('/api/auth/sign-in/email','POST','',{email:emails[0],password:'wrong-password-123'}),401,'Wrong password');
 let res=await call('/api/projects','POST',a,{name:'QA private project',scope:'User accounts are excluded.',owner_user_id:userIds[1]});await status(res,201,'Create project');
 const project=(await res.json()).data.project;projectIds.push(project.id);
 assert.equal((await pool.query('SELECT owner_user_id FROM projects WHERE id=$1',[project.id])).rows[0].owner_user_id,userIds[0]);
 const listedA=(await (await call('/api/projects','GET',a)).json()).data.projects;assert.ok(listedA.some(p=>p.id===project.id));
 const listedB=(await (await call('/api/projects','GET',b)).json()).data.projects;assert.ok(!listedB.some(p=>p.id===project.id));
 const path=`/api/projects/${project.id}/requests`;
 await status(await call(path,'GET',b),404,'Cross-user request list');
 await status(await call(path,'POST',b,{title:'Attack',description:'Forbidden'}),404,'Cross-user create');
 await status(await call(path,'POST',a,{title:'Login',description:'Client login'}),201,'Owner create request');
 const requests=(await (await call(path,'GET',a)).json()).data.requests;const id=requests[0].id;
 await status(await call(`${path}/${id}`,'PATCH',b,{decision:'included'}),404,'Cross-user decision');
 await status(await call(`${path}/${id}/assessment`,'GET',b),404,'Cross-user saved assessment');
 await status(await call(`${path}/${id}/assessment`,'POST',b),404,'Cross-user AI generation');
 await status(await call(`${path}/${id}`,'PATCH',a,{decision:'extra_work',decisionNote:'Private note'}),200,'Owner decision');
 assert.equal((await (await call(`${path}/${id}/assessment`,'GET',a)).json()).data.assessment,null);
 await status(await call('/api/projects','POST',a,{name:'CSRF',scope:'No'},'https://other.example'),403,'Cross-origin write');
 // Reserved legacy records cannot be claimed by an unverified matching email.
 const legacy=(await pool.query('INSERT INTO projects(name,scope,legacy_owner_email) VALUES($1,$2,$3) RETURNING id',['QA reserved','Reserved test scope',emails[0]])).rows[0].id;projectIds.push(legacy);
 await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1',[userIds[0]]);
 await status(await call('/api/projects','GET',a),403,'Unverified session denied');
 assert.equal((await pool.query('SELECT owner_user_id FROM projects WHERE id=$1',[legacy])).rows[0].owner_user_id,null);
 // Simulate provider-verified identity only for this synthetic account.
 await pool.query('UPDATE auth_user SET "emailVerified"=true WHERE id=$1',[userIds[0]]);
 const claimed=(await (await call('/api/projects','GET',a)).json()).data.projects;assert.ok(claimed.some(p=>p.id===legacy));
 await status(await call('/api/projects','POST',a,{name:'',scope:''}),400,'Invalid project');
 await status(await call(path,'POST',a,{title:'',description:''}),400,'Invalid request');
 await status(await call(`${path}/${id}`,'PATCH',a,{decision:'invalid'}),400,'Invalid decision');
 if (process.argv.includes('--live-ai')) {
  // Exactly one generation request; production provider retries are disabled.
  const ai=await call(`${path}/${id}/assessment`,'POST',a);
  await status(ai,201,'Single live AI assessment');
  const saved=(await (await call(`${path}/${id}/assessment`,'GET',a)).json()).data.assessment;
  assert.ok(saved,'AI assessment persisted');
  const unchanged=(await (await call(path,'GET',a)).json()).data.requests.find(r=>r.id===id);
  assert.equal(unchanged.decision,'extra_work');
  console.log('PASS: one live AI generation and saved assessment reload.');
 }
 const beforeReset=capturedEmails.length;
 await status(await localAuth('/request-password-reset',{email:emails[0],redirectTo:'/reset-password'}),200,'Request password reset');
 const reset=capturedEmails.slice(beforeReset).find(message=>message.kind==='reset');assert.ok(reset);
 const token=new URL(reset.url).pathname.split('/').at(-1);
 const newPassword=randomBytes(24).toString('base64url');
 await status(await localAuth('/reset-password',{token,newPassword}),200,'Reset password');
 await status(await call('/api/projects','GET',a),401,'Reset revokes sessions');
 await status(await localAuth('/reset-password',{token,newPassword}),400,'Reset token cannot be reused');
 await status(await call('/api/auth/sign-in/email','POST','',{email:emails[0],password}),401,'Old password denied');
 const resetLogin=await call('/api/auth/sign-in/email','POST','',{email:emails[0],password:newPassword});await status(resetLogin,200,'New password accepted');
 const newCookie=resetLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 await status(await call('/api/auth/sign-out','POST',newCookie,{}),200,'Sign out');
 console.log('PASS: verification, reset, token reuse rejection, old-password rejection, reset session revocation. No emails sent.');
 await status(await call('/api/projects','GET',a),401,'Revoked session');
 const signedIn=await call('/api/auth/sign-in/email','POST','',{email:emails[0],password:newPassword});await status(signedIn,200,'Sign back in');
 await pool.query('UPDATE auth_session SET "expiresAt"=NOW()-interval \'1 hour\' WHERE "userId"=$1',[userIds[1]]);
 await status(await call('/api/projects','GET',b),401,'Expired session');
 console.log('PASS: signup, password hashing, wrong password, session cookies, login, logout/revocation, expiry, anonymous denial, ownership, foreign-ID denial, CSRF, verified-only legacy claim. Live AI runs only with --live-ai.');
} finally {
 // Delete only synthetic records created by this test, even after partial failure.
 const ids=(await pool.query('SELECT id FROM auth_user WHERE email=ANY($1::text[])',[emails])).rows.map(row=>row.id);
 await pool.query('DELETE FROM assessments WHERE request_id IN (SELECT r.id FROM requests r JOIN projects p ON p.id=r.project_id WHERE p.owner_user_id=ANY($1::text[]) OR p.id=ANY($2::uuid[]))',[ids,projectIds]);
 await pool.query('DELETE FROM requests WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id=ANY($1::text[]) OR id=ANY($2::uuid[]))',[ids,projectIds]);
 await pool.query('DELETE FROM projects WHERE owner_user_id=ANY($1::text[]) OR id=ANY($2::uuid[])',[ids,projectIds]);
 await pool.query('DELETE FROM auth_user WHERE id=ANY($1::text[])',[ids]);
 await pool.end();
}
