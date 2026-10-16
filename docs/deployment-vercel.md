# Deploying ScopeCheck to Vercel

Production URL: `https://scopecheck.hamzaabubakar.dev`

Work through the steps in order. Never paste secret values into chat, commits, or screenshots.

## 1. Before the first deploy (on your machine)

```powershell
npm install                # picks up @vercel/functions; commit the updated package-lock.json
npm run lint
npm run build:webpack
npm run db:verify          # must report "No drift"
npm run db:migrate         # records 001 as baseline on the existing database
```

Migrations are run manually from your machine, never during the Vercel build: every preview build would otherwise touch the production database.

## 2. Create the Vercel project

1. Push the repo to GitHub (check `.env.local` is not committed: `git status` should not list it).
2. Vercel → Add New → Project → import the repo. Framework: Next.js (auto-detected).
3. Build command: leave the default (`next build`). If the build fails in the Turbopack step, set it to `npm run build:webpack`.
4. Node.js version (Settings → Build and Deployment): 22.x or 24.x.

## 3. Environment variables (Settings → Environment Variables)

Add every variable with the **Production** environment only. Preview deployments then have no database or secrets and cannot touch production data. Their login will not work, which is expected.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Production connection string. Use `sslmode=verify-full`. If your provider offers a pooled ("pooler") connection string, use that one. |
| `BETTER_AUTH_URL` | `https://scopecheck.hamzaabubakar.dev` (no trailing slash) |
| `BETTER_AUTH_SECRET` | Same value as your current `.env.local`, because production uses the same database. Linked Google tokens in that database are encrypted with it. Do not regenerate it. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud (step 5) |
| `RESEND_API_KEY` | A **new** key (step 6) |
| `AUTH_EMAIL_FROM` | `ScopeCheck <noreply@scopecheck.hamzaabubakar.dev>` |
| `OPENAI_API_KEY` | Your key. Set a monthly spend limit in the OpenAI dashboard too. |
| `ASSESSMENT_DAILY_LIMIT` | Optional, default 10 |
| `RAG_DAILY_EMBEDDING_TOKENS` | Optional, default 500000 (per user per day; ≈ $0.01 with text-embedding-3-small) |
| `ADMIN_EMAILS` | Your email(s), comma-separated. Only these accounts can open `/admin` (usage stats). |
| `STATS_EXCLUDE_EMAILS` | Optional. Extra emails or `@domains` to leave out of `/admin` stats (e.g. friends' test accounts). |
| `RAG_EMBEDDINGS` | Optional. `off` = keyword search only for supporting documents |

Changing a variable needs a redeploy (Deployments → ⋯ → Redeploy).

## 4. Domain

1. Vercel project → Settings → Domains → add `scopecheck.hamzaabubakar.dev`.
2. Add the DNS record Vercel shows (normally a `CNAME` for `scopecheck`) wherever `hamzaabubakar.dev` DNS is managed. If that domain already uses Vercel DNS, this is automatic.
3. Wait for the green "Valid Configuration" check. HTTPS is issued automatically.

## 5. Google sign-in (Google Cloud Console → APIs & Services → Credentials → your OAuth client)

- Authorized JavaScript origin: `https://scopecheck.hamzaabubakar.dev`
- Authorized redirect URI: `https://scopecheck.hamzaabubakar.dev/api/auth/callback/google`
- Keep the localhost entries for development.
- OAuth consent screen: set publishing status to **In production**. While it is "Testing", only listed test users can sign in. ScopeCheck only asks for basic profile and email.

## 6. Email (Resend)

1. Resend → Domains → add `scopecheck.hamzaabubakar.dev`, then add the DNS records it shows (SPF/DKIM, and MX for bounces) at your DNS provider. Wait until it shows **Verified**.
2. Rotate the key: create a new API key (sending access only), put it in Vercel, then **delete the old key** that was pasted in chat earlier. Update `.env.local` with the new key as well.

Until the domain is verified, verification and reset emails only reach your own Resend account address.

## 7. Deploy and smoke check (no paid AI calls)

1. Deploy (push to the production branch or click Redeploy).
2. Open the site: the login page loads and the response has `X-Frame-Options: DENY`.
3. Create a password account with a second email address you own → the verification email arrives from `noreply@scopecheck.hamzaabubakar.dev` → verify → sign in.
4. Sign in with Google using your own account; also try Connect Google from the account menu.
5. Create a project and a request, save a decision, edit both, delete the request. Do **not** click "Assess request" unless you decide to spend one AI call.
6. Delete the test account from the account menu.
7. Vercel → Logs: there should be no errors and no `[auth-email]` failures.

## 8. Before sharing it publicly

- Database backups: confirm your Postgres provider keeps automatic backups or point-in-time restore, and how long it keeps them.
- Error visibility: Vercel Logs for now. Add alerting later if real users arrive.
- Local development currently uses the production database. After launch, create a separate development database or branch, point `.env.local` at it, and run `npm run db:migrate` there. A fresh database now builds correctly from the migrations.

## Migration 008 (supporting documents)

Migration 008 runs `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`. Neon (and Vercel Postgres) support pgvector. Run `npm run db:migrate`, then `npm run db:verify`, before deploying code that uses it.

## Production behaviour notes

- The rate limit uses Vercel's client-IP headers (`x-vercel-forwarded-for`), which Vercel sets itself and clients cannot spoof. This is enabled only when `VERCEL` is set.
- The database pool is closed cleanly between requests on Vercel (`attachDatabasePool`) with a 5-second idle timeout.
- AI assessments abort after 45 seconds, well inside Vercel's 300-second default function limit.
- Auth emails are sent after the response with Next.js `after()`, which Vercel supports. This is not a durable queue: if Resend is down, that email is lost and the user can request it again.
