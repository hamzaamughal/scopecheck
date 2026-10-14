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
