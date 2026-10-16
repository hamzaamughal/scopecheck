# ScopeCheck

A focused workspace for reviewing client requests against an agreed project scope.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000.

## Current milestone: persisted projects, requests, decisions, and AI assessments

- Project cards, search, and a needs-review filter
- Project creation with scope and optional client name
- Project detail views for requests and the agreed scope
- Request creation and manual review
- On-demand AI suggestions with explanations, scope quotes, and clarification questions
- Persisted decision selection and notes
- Edit and delete projects and requests; delete your account
- Responsive desktop and mobile layouts, dialogs, and empty states

Projects load from GET /api/projects and are saved through POST /api/projects into PostgreSQL. Set DATABASE_URL in .env.local before running. Requests load and save through /api/projects/[projectId]/requests. Decisions and notes persist through PATCH /api/projects/[projectId]/requests/[requestId]. AI assessment uses POST /api/projects/[projectId]/requests/[requestId]/assessment; set OPENAI_API_KEY on the server. Email/password and Google authentication are integrated with per-user project ownership. See [authentication setup](docs/authentication.md). Google requires OAuth credentials. Email verification and password recovery use Resend; configure RESEND_API_KEY and AUTH_EMAIL_FROM before using password signup.

## Source map

- `src/app/page.tsx`: page entry point
- `src/components/workspace.tsx`: workspace screens and local interactions
- `src/lib/demo-data.ts`: legacy UI fixture types (sample projects are no longer loaded)
- `src/app/globals.css`: design system and responsive styles
- `src/app/layout.tsx`: page metadata and root layout

Geist is used for interface text and headings, and Geist Mono for small labels. Both variable fonts are self-hosted in public/fonts with their SIL Open Font License, so builds do not need external font downloads.

## Checks

```sh
npm run lint
npm run build
```

Assessment quality checks are available: `npm run test:evals` runs offline grader tests; `npm run eval:assessments` runs the 15-case live suite using OPENAI_API_KEY. See [evals/README.md](evals/README.md) for dry runs, repeated runs, and report interpretation. Live runs use API credits and never access the database.

Login and ownership are implemented. Daily AI usage limits are implemented (10 attempts per user by default). See [assessment usage](docs/assessment-usage.md) for counting policy, configuration, and tests. Email verification and password recovery are implemented. Next: configure email delivery, then deployment preparation.

Assessment UI uses a typed service and a reusable panel. Opening a request loads its latest saved assessment through GET /api/projects/[projectId]/requests/[requestId]/assessment, without calling OpenAI. POST generates and saves a new assessment before returning success (201). GET returns assessment: null for an existing request with no assessment, or 404 for a missing/mismatched request. Generating a suggestion never selects or saves a human decision.

Every successful generation adds an assessments row with its output, model, creation time, and exact scope/title/description snapshots. The UI shows the latest completed result (created_at DESC, id DESC); older results stay in the database. Snapshot comparison flags stale results, including input changes while generation is running. Human decision edits do not make an assessment stale. No database transaction is held during the AI call.

Failed generation or persistence preserves the previous result. A save/network failure offers a read-only reload first, because the save may already have completed. Switching requests keeps responses associated with the correct request. Duplicate-click protection is local to the browser; concurrent tabs can still generate separate assessments.

## Deployment

Production runs on Vercel at https://scopecheck.hamzaabubakar.dev. See [Deploying to Vercel](docs/deployment-vercel.md).

## Database setup

Requires PostgreSQL 13+. Copy `.env.example` to `.env.local` and set DATABASE_URL.

- `npm run db:migrate` applies pending files in `db/migrations` in one transaction (advisory-locked, tracked in schema_migrations). On an empty database it creates the full schema, starting with the `001_initial.sql` baseline.
- Databases created before the baseline existed already have projects/requests: the runner records `001_initial.sql` as applied without executing it. If only one of the two tables exists, it stops.
- `npm run db:verify` is read-only: it builds every migration in a temporary schema, compares the result with the live schema, and rolls back. Run it before deploying; any reported drift means a fresh database would differ from production. Exit code 1 on drift.

Keep database credentials server-only. Failed reassessments preserve the previous suggestion.


Project API integration: src/lib/api-client.ts handles response envelopes; src/services/projects.ts defines list/create calls; src/lib/project-view.ts maps saved records to presentation values. Loading, retry, field errors, and in-flight duplicate submit protection are included. This does not provide server-side idempotency.


Request API integration: src/services/requests.ts provides typed list/create calls and src/lib/request-view.ts maps API decisions and timestamps to display values. The small initial workspace loads requests for each project in parallel; larger workspaces should use paginated requests and server-side summary counts.


Decision updates use a shared row mapper, typed service, and an isolated form. The UI requires explicit selection and only updates saved state after a successful response. Blank/omitted notes clear the previous note; concurrent updates currently use last-write-wins semantics.



## Editing and deleting

- `PATCH /api/projects/[projectId]` updates name, client name, and scope. `DELETE` removes the project with its requests and assessments in one transaction.
- `PATCH /api/projects/[projectId]/requests/[requestId]` accepts either `{ decision, decisionNote }` or `{ title, description }` (mixed bodies are rejected). Editing wording keeps the human decision. `DELETE` removes the request and its assessments.
- Editing scope or wording does not delete old AI results: they are kept and shown as outdated through their saved snapshots.
- `DELETE /api/account` with `{ confirmEmail }` removes the user, sessions, linked logins, usage rows, and all owned projects/requests/assessments in one transaction. It requires a session created within the last 24 hours; older sessions get `REAUTH_REQUIRED`.
- Deletes lock the affected rows first, so a concurrent assessment save or request creation waits and then fails cleanly instead of leaving orphaned rows.
- `npm run test:edit` covers these flows against a local app (zero AI calls, no email). Like `test:auth`, it needs `npm run dev` running and DATABASE_URL.

## Importing a scope

- **Files** (PDF, .docx, .txt, .md): read in the browser with pdf.js / mammoth. The file is never uploaded; only the extracted text is saved. PDF text keeps `[Page N]` markers so quoted evidence shows its page. Scanned (image-only) PDFs are rejected with a clear message.
- **Links** (`POST /api/scope-import/link`): Google Docs shared "Anyone with the link" (fetched via the plain-text export) or any public web page. The fetch blocks private/reserved addresses on the address actually connected to, re-checks every redirect, allows ports 80/443 only, and caps time (10 s) and size (2 MB). 30 link imports per user per day.
- The source is stored in `scope_sources` (migration 006). Links are snapshots; "Check for changes" shows a line diff and can apply the new version.
- Scope limit: 60,000 characters. `npm run test:import` runs the offline tests.

## Change orders, scope history, client replies, and the decision log

- **Scope history** (`scope_versions`, migration 007): every saved change to a project's scope becomes a numbered version (created, edited, imported, updated from link, or change order accepted). The Agreed scope tab has a History view that compares any version with the current scope.
- **Change orders** (`/api/projects/[projectId]/change-orders`): proposed extra work with optional hours, price, and currency, numbered per project. Accepting one appends a `[Change order #N · accepted YYYY-MM-DD]` block to the scope in the same transaction and records a new version, so earlier AI assessments show as outdated. Accepted orders cannot be edited or deleted; proposed and rejected ones can be deleted. A request marked "Extra work" offers to create one prefilled from the request.
- **Client reply drafts** (`/api/projects/[projectId]/replies`): after a human decision, AI drafts a short reply in a friendly or formal tone, using the decision note, the latest assessment, and any linked change order. It shares the daily AI allowance with assessments. Drafts are checked before saving: every number in a draft must already appear in the project data (no invented prices, hours, or dates), and internal markers are rejected. Drafts are saved; a draft written for an earlier decision is flagged. Nothing is ever sent.
- **Decision log** (`/projects/[projectId]/report`): a printable report of requests, decisions, notes, AI evidence with page numbers, change orders with accepted totals, scope history, and the current scope. "Save as PDF" uses the browser's print dialog, so the PDF keeps selectable text.
- Tests: `npm run test:workflow` (offline) and `npm run test:edit` (API; add `-- --fake-ai` only against a local dev server started with `SCOPECHECK_FAKE_AI=1`, which is ignored in production builds).

## Supporting documents and retrieval (RAG)

A project can hold up to 10 supporting documents (proposal, email thread, meeting notes, other; up to 200,000 characters each) next to the agreed scope. They are imported the same way as the scope (PDF/Word read in the browser, or a public link) and only their text is stored.

**Design rule: the agreed scope is binding, documents are context.** The scope is always sent to the model in full; retrieval only ever applies to the supporting documents, so a missed chunk can never hide an exclusion clause. If a document contradicts the scope (an email promising excluded work), the model must answer "Needs clarification" and cite both.

How an assessment is built (`src/lib/rag/assessment-context.ts`):

1. **No documents** → the original scope-only path, unchanged.
2. **Scope + documents ≤ 100,000 characters** (≈ 25k tokens) → everything in full. Nothing to miss, so no retrieval.
3. **Larger** → hybrid retrieval over the documents, top 8 chunks:
   - Chunking (`chunk.ts`): paragraph-packed chunks of ~1,200 characters that never cross a `[Page N]` marker, keep the nearest section heading, split long paragraphs by sentence, and repeat a short trailing paragraph as overlap.
   - Keyword search: Postgres full-text (`tsvector` generated column, GIN index), OR-query of the request's terms, ranked by `ts_rank_cd`.
   - Semantic search: `text-embedding-3-small` vectors in pgvector (`vector(1536)`, HNSW cosine index).
   - Fusion: reciprocal rank fusion (k = 60), so the two scores never need calibrating against each other.

Every quote the model returns names its source (`scope` or a chunk ref) and is checked **verbatim against that exact source**; one unsupported quote rejects the whole answer. A definitive decision still needs at least one quote from the agreed scope. The UI tags each quote as **Binding** (agreed scope) or **Context** (document title, page). Assessments store a fingerprint of the documents, so adding or deleting a document marks earlier assessments outdated.

Failure modes are graceful: if embeddings are unavailable (no key, provider error, or the per-user daily budget `RAG_DAILY_EMBEDDING_TOKENS`, default 500k), a document is saved as keyword-searchable and re-embedded on a later assessment. `RAG_EMBEDDINGS=off` disables embeddings entirely.

Checks:

- `npm run test:rag`: offline unit tests (chunking, fusion, routing, quote-to-source validation).
- `npm run test:documents`: API integration test against a local dev server started with `SCOPECHECK_FAKE_AI=1` (deterministic local embeddings and model stand-in; no OpenAI calls). It covers CRUD, ownership, CSRF, limits, both context modes, staleness, and cascades.
- `npm run eval:retrieval`: retrieval eval (20 client requests → expected document section) using the production chunker and search SQL in a temporary schema that is rolled back. It reports recall@1/3/5/8 and MRR for keyword-only, vector-only, and hybrid. It runs offline by default. `-- --live` uses real embeddings (well under $0.001).

Known limits: one query embedding per retrieval-mode assessment, counted under the assessment allowance; HNSW is filtered per project after the index scan, which is fine at this scale (pgvector ≥ 0.8 iterative scans would be the next step at large scale).

## Usage tracking

- **Visitors:** Vercel Web Analytics (`<Analytics/>` in `src/app/layout.tsx`). Enable it in Vercel → Project → Analytics. It shows page views, unique visitors, countries, and referrers, uses no cookies, and needs no consent banner.
- **Sign-ups and usage:** `/admin` is an owner-only page listing real users, sign-ups per day (last 30 days), how far each person got (verified → project → request → AI check → decision), and today's AI usage. Set `ADMIN_EMAILS` (comma-separated) to the emails allowed to open it; anyone else gets a 404. Admin, test (`@example.com`, QA prefixes), and demo accounts are left out of the numbers. Add more with `STATS_EXCLUDE_EMAILS` (exact emails or `@domain`). The page is read-only.
