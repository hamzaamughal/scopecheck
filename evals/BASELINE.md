# Initial quality baseline — 2026-10-03

Model: `gpt-5.4-mini`, using the production assessment function with low reasoning effort and its existing output validation.

| Run | Automated passes | Failed checks | Generation/validation errors |
| --- | ---: | ---: | ---: |
| Original prompt, 15 cases once | 13/15 | 2 | 0 |
| First prompt candidate, 15 cases twice | 14/30 | 3 | 13 |
| Final prompt, 15 cases once | 15/15 | 0 | 0 |

The first candidate was rejected. A separate single-case diagnostic confirmed an unsupported-evidence validation error; the original candidate report records generic error classes, so it does not establish that all 13 errors had that cause.

## Findings and changes

- The original prompt treated “another revision” as proof that the revision allowance was used up. The final prompt explicitly requires known usage before making that inference.
- The original prompt accepted a login inclusion despite an account exclusion. The final prompt distinguishes unresolved contradictions from clearly stated exceptions.
- The first candidate regressed on quote validation and mixed requests. The final prompt gives a concrete example of an invalid shortened quote and requires clarification when a single request combines included and excluded work. Exact quote validation remains strict.

## Review of the final answers

Assistant review of all 15 returned answers found the expected classification and relevant supporting evidence or a justified empty evidence list. The unknown-revision answer asks how many rounds have been used; the conflicting-scope answer quotes both terms; the mixed-request answer distinguishes the form from login. None of the tested injection markers were returned. No invented prices, timelines, completed revision counts, or claims of saved human decisions were observed.

Minor observations: some evidence quotes include more context than necessary, and the excluded-login answer asks whether to handle the work as a separate change request despite a definitive label. These do not fail the current contract. Questions about overriding exclusions remain suggestions for human review, not authorization to do so.

This is assistant review, not an independent human/domain-expert evaluation. The final prompt has one complete passing run. Earlier repeated trials exposed variability; this is not a claim of 100% accuracy, repeatability, or general resistance to prompt injection. The prompt was improved using these cases, so they are a regression suite rather than a held-out benchmark. Add fresh representative cases and human review before relying on the scores for release decisions.

## Local run records

Full input/output JSON and Markdown reports are generated under the Git-ignored `evals/results/` directory:

- Original: `2026-10-03T16-31-42-200Z`
- Rejected candidate: `2026-10-03T16-33-39-140Z`
- Single-case diagnostic: `2026-10-03T16-35-33-563Z`
- Final: `2026-10-03T16-36-17-182Z`

Each JSON report records hashes of the assessment code, schema, dataset, and grader for that run. Offline grader tests: 11 passed. Final lint and production build (including TypeScript checks) passed.
