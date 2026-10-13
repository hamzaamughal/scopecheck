# Daily assessment allowance

Each signed-in account gets 10 AI assessment attempts per UTC calendar day by default, shared across its projects and requests. Set the server-only `ASSESSMENT_DAILY_LIMIT` environment variable to an integer from 1 to 10000 to change the allowance. Restart the app after changing it. Invalid values fail closed.

The counter resets at midnight UTC (05:00 Asia/Karachi). The API supplies the next reset as an ISO timestamp and the UI displays it in the viewer's local time. Existing historical assessments are not backfilled into the new counter.

## Counting policy

The assessment POST handler authenticates the user, validates the IDs, checks project ownership, and checks for the API key before reserving an attempt. PostgreSQL performs a conditional upsert keyed by user and UTC date, so concurrent requests cannot take the counter above the configured allowance. No database transaction remains open during the AI call.

Once reserved, an attempt remains counted even if generation, validation, saving, or the connection fails. This conservative policy prevents repeated failed requests from bypassing spend controls. A crash after reservation can therefore use an attempt without returning a result. The existing provider retry policy can make more than one provider call per assessment attempt; this is an application allowance, not a dollar budget or exact provider-call count.

Viewing saved assessments, loading usage, and saving human decisions do not consume attempts. Unauthorized or foreign-project requests do not consume attempts. Exhausted requests return the shared `ASSESSMENT_LIMIT_REACHED` error with HTTP 429. A database failure prevents generation instead of allowing an unmetered call.

## API and UI

`GET /api/usage` requires a session and returns the existing success envelope with `data.usage` containing `limit`, `used`, `remaining`, and `resetsAt`. The account ID comes from the session; clients cannot request another user's counter. Responses are not cached.

The review panel shows remaining attempts and reset time. Generation is disabled when usage is loading, unavailable, or exhausted; saved-assessment reload and manual decisions remain available. Usage refreshes after generation attempts, on window focus, and at the reset time. Other tabs can make the display briefly stale; the server always enforces the real counter. A stale UI receiving HTTP 429 reloads its allowance.

## Validation

Run `npm run test:usage` against the configured hosted database. It uses temporary synthetic users/projects, imports the production routes and quota code, mocks auth identity and the AI provider, and removes test records afterward. It verifies atomic concurrency, per-user isolation, prior-day counters, UTC reset timestamps, 429-before-AI behavior, failure counting, fail-closed configuration/database errors, and saved reads at the limit. No OpenAI credits are used. Run `npm run test:auth` separately to test real login and session enforcement.

This is a per-account limit. It does not prevent creating multiple accounts, and it is not a global spending cap. Email verification/recovery and deployment controls remain separate follow-up work.
