# Assessment quality checks

This is a small, synthetic regression suite for ScopeCheck's current scope-review policy. It invokes the production `assessRequest` function directly, including its schema and evidence validation. There is no copied prompt, database access, or hosted evaluation service.

## Run

Use Node 22.18+ (Node 24 is also supported), with dependencies installed.

```sh
# Offline: verify the grader and dataset
npm run test:evals
npm run eval:assessments -- --dry-run

# Live: one assessment per case, using OPENAI_API_KEY from .env.local
npm run eval:assessments

# Repeat each case to look for variation, or investigate a single case
npm run eval:assessments -- --runs 3
npm run eval:assessments -- --case mixed-form-and-login
```

Live runs use OpenAI API credits. The default runs 15 assessments sequentially. `--runs` accepts 1–5; the production function may retry a transient provider failure once. No API key is required for offline checks. The `react-server` condition allows the CLI to import the existing server-only module; the app's client-import protection remains in place.

## What is checked

- Expected decision for explicit inclusions, exclusions, numeric boundaries, exceptions, and ambiguous or conflicting scope.
- Mixed requests: clarification plus evidence and explanation covering both parts.
- Exact scope quotes, with case-specific terms to catch obviously irrelevant evidence.
- Clarification questions when the result is uncertain.
- Instruction attacks in request descriptions, titles, and scope text: expected decision plus absence of an injected marker.
- A Roman Urdu request for a deliverable named in an English scope.

`assessment-cases.json` contains inputs, expected labels, evidence terms, and a review rubric. These labels are initial, assistant-authored expectations based on the current product policy, not a domain-expert-labeled benchmark. Review them when the business policy changes. Do not relax an expectation just to make a failing answer pass.

The grader's offline tests deliberately feed it incorrect answers: valid JSON with the wrong decision, invented quotes, true but irrelevant quotes, missing questions, and injected markers. This checks that the evaluation can detect regressions.

## Read the results

Each live run writes timestamped Markdown and JSON files to `evals/results/` (ignored by Git). Reports include all inputs and returned outputs, case failures, model, timestamps, latency, and hashes of the assessment code, schema, dataset, and grader. A run exits with code 1 if any case fails or errors. Provider errors are recorded by class/status only, without response bodies or credentials.

An error means the production function did not return a validated assessment; it is counted separately from a returned answer that fails a quality check. Do not interpret errors as successful decisions. A default single run does not measure consistency; use repeated runs when investigating variation or approving a prompt/model change.

Before accepting a change, review the full answers against each rubric:

1. Does the explanation correctly apply the agreement, including exclusions and exceptions?
2. Do the quotes actually support the decision, beyond merely occurring in the scope?
3. Are clarification questions relevant and answerable?
4. Are invented prices, timelines, revision histories, approvals, or completed actions absent?
5. For mixed requests, does the explanation distinguish the included and excluded portions?

Keyword checks are imperfect signals: they can miss semantic errors and flag valid alternative wording. The injection checks cover only these attacks; absence of a marker alone is not proof of resistance. Passing this synthetic suite is not a production accuracy estimate or a substitute for human review. Add anonymized, representative cases from real failures as the app is used.

Method follows [OpenAI's evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices): use task-specific criteria, typical/edge/adversarial inputs, and calibrate automated checks with human judgment.
