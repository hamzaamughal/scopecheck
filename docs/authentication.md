# Login and project ownership

Better Auth manages email/password authentication, Google OAuth, password hashing, signed session cookies, and database-backed sessions. Auth tables use an `auth_` prefix in the existing PostgreSQL database. The app checks the session on every protected API call; project ownership is included in the SQL query for every read and write, including AI source reads and assessment persistence. Foreign project/request IDs return 404. Anonymous APIs return 401, and the workspace redirects to `/login`.

## Local setup

Set these server-only values in `.env.local`:

```dotenv
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<a generated random secret of at least 32 characters>
GOOGLE_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
RESEND_API_KEY=<Resend API key>
AUTH_EMAIL_FROM="ScopeCheck <accounts@your-verified-domain.com>"
```

The local secret and base URL have been prepared. Do not replace an existing secret casually; keep it stable across restarts. Run `npm run db:migrate` on other environments. Restart the app after changing auth environment values or applying auth schema changes.

Email/password sign-up requires a 12–128 character password. Google is enabled only when both Google environment values are present. The browser uses Better Auth's client and response contract for auth operations; the existing ScopeCheck API response envelope remains in use for project operations.

## Google setup

1. Select/create a project in Google Cloud Console and configure Google Auth Platform's branding, audience, and consent details.
2. While in testing, add the intended Google accounts as test users.
3. Create an OAuth client with application type **Web application**.
4. Add `http://localhost:3000` as an authorized JavaScript origin.
5. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
6. Set the client ID and secret in `.env.local`, restart, then use **Continue with Google**.

For deployment, use the HTTPS application URL and its matching callback. Follow the [provider setup documentation](https://better-auth.com/docs/authentication/google).

Automatic merging of accounts by email is disabled. If you created a password account first, sign in with that method and use **Your account → Connect Google**, selecting the same email. This requires control of the existing session as well as the Google account. Accounts with different emails are not linked. A Google-first account does not automatically have a password; the password-reset flow can establish a password after proving access to its mailbox.

## Existing projects

New projects always take their owner from the authenticated session, never from a submitted owner field. Legacy projects without an owner remain inaccessible; the first signup does not receive them automatically.

An operator can reserve a particular unowned project for a matching email:

```sh
node scripts/reserve-project-owner.mjs PROJECT_UUID owner@example.com
```

Only a session whose email is verified can claim a reserved project. Acme has been reserved for the email provided by the workspace owner. An unverified password signup cannot claim it merely by entering that email. Verify your password account through its email link, or sign in with the matching Google account, to establish a verified identity. If linking Google to a password account, sign out and sign in with Google afterward so the verified provider identity is reflected in the session.

## Checks and scope

`npm run test:auth` uses synthetic accounts against the running local app and configured database. Signup, verification, and recovery use the production Better Auth options with an in-memory email callback, so no emails are sent. It checks verification, password recovery, token reuse, hashing, sessions, anonymous access, foreign-ID reads/writes, cross-origin writes, and verified-only legacy claims. Temporary account/project records are removed in `finally`. By default it makes no OpenAI calls. The explicit `--live-ai` argument makes one real assessment request; never add that flag to routine CI.

Auth endpoints have database-backed rate limits, separate from per-user AI usage limits. Sessions last seven days, and sign-out revokes them. Credentialed application writes require the configured origin. OAuth token storage is encrypted. Add deployment-specific proxy/IP settings when hosting is chosen; Google end-to-end verification requires a real configured OAuth client.

## Email verification and password recovery

Configure a verified sender domain in Resend, then set RESEND_API_KEY and AUTH_EMAIL_FROM above and restart the app. Keep both values server-only. The sender address must belong to your verified domain. No additional package or database migration is needed for this module; it uses the existing auth verification table.

- Password signup sends a verification link and does not create a signed-in session. Links expire after one hour. `/verify-email` supports requesting another link. After verification, sign in normally. Existing unverified sessions cannot open the workspace or protected APIs.
- `/forgot-password` requests a reset link with a generic confirmation that does not reveal whether an account exists. Reset links expire after 30 minutes. `/reset-password` requires matching passwords of 12�128 characters and offers a new-link action for invalid or expired links. Successful reset revokes the account's sessions.
- Verification and reset email requests are limited to three per minute by the configured auth rate limiter. Password-reset submissions are limited to five per minute.
- Delivery uses the Resend REST API with HTML and plain text, a 15-second timeout, and an idempotency key. Next.js `after` schedules delivery after the response. This is not a durable queue: if delivery fails, the user can request a new link. Generic server logs point to Resend configuration and delivery logs without exposing recipients, tokens, or secrets. A successful request response does not prove delivery.

This phase was implemented without running tests, builds, browser checks, or sending test emails, at the owner's request. Delivery remains unverified until the sender is configured and the owner uses the flow.
