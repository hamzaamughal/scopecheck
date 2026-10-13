# Flow review — 2026-10-05

## Completed checks

- All 11 offline assessment grading tests passed without provider calls.
- Authentication/API checks passed: signup with captured verification email, verification token, unverified sign-in rejection, password hashing, wrong-password rejection, cookies, login/logout, expiration, password reset, old-password rejection, reset token reuse rejection, and session revocation.
- Workspace API checks passed: project/request creation, saved manual decisions, validation errors, anonymous denial, project ownership, foreign-ID denial, cross-origin write rejection, and verified-only reserved project claims.
- Usage integration checks passed: 12 concurrent reservations stop at 3, per-user allowances, UTC rollover, quota rejection before generation, database/provider/save failures, and reading saved results at quota. AI was mocked for these checks.
- Browser checks passed: login, dark default, theme persistence, project/request creation, saved decision after reload, search, 390px viewport width, logout, and invalid reset-link screen.
- Additional browser checks passed: retry after a failed workspace load, exhausted quota blocking AI while manual decisions remain usable, mismatched reset passwords, successful reset, and login with the new password.
- Exactly one live OpenAI assessment request passed, with saved-result reload and preservation of the human decision. Automatic provider retries are now disabled. No live evaluation suite was run.
- ESLint passed. Production compilation and TypeScript passed with `next build --webpack`.

## Limits and follow-up

- Google account selection/consent and account linking were not exercised with a real Google identity.
- Emails were captured in memory for auth tests; no verification/reset email was sent by this review. The owner had previously confirmed Resend delivery.
- Default Turbopack production builds hit a Windows child-process access-denied error in this environment. `npm run build:webpack` is available as the successfully checked fallback.
- Better Auth reports a shared rate-limit bucket when the local runtime supplies no trusted client IP. Configure trusted proxy/IP handling for the chosen hosting environment before public launch.
- Test fixtures use temporary accounts/projects and clean up their records. Existing user projects were not edited.

## Repeating checks

Run `npm run test:auth` against the local server for free authentication/API coverage. Only explicitly adding `-- --live-ai` makes a paid assessment call. `npm run test:usage` mocks AI, and `npm run test:evals` runs offline grading checks.

`scripts/test-browser-flows.mjs` needs Playwright and an installed Edge browser. Set PLAYWRIGHT_MODULE to an available Playwright package path if it is not installed locally, then run it with Node's `--experimental-strip-types --conditions=react-server` flags. Browser generation requests are blocked to prevent accidental OpenAI spending.
