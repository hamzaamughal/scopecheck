import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
import { z } from "zod";
import { caseSchema, gradeAssessment, type EvalCase } from "../evals/assessment-grader.mts";
import { assessRequest, ASSESSMENT_MODEL } from "../src/lib/ai/assess-request.ts";
import type { Assessment } from "../src/schemas/assessment.ts";

type Result = {
  caseId: string; category: string; run: number; status: "pass" | "fail" | "error";
  elapsedMs: number; failures: string[]; output?: Assessment;
  error?: { name: string; statusCode?: number };
};

async function main() {
  const { values } = parseArgs({ options: {
    "dry-run": { type: "boolean", default: false },
    runs: { type: "string", default: "1" },
    case: { type: "string" },
  } });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("Use --runs between 1 and 5.");
  const datasetText = await readFile(new URL("../evals/assessment-cases.json", import.meta.url), "utf8");
  const allCases = z.array(caseSchema).min(1).parse(JSON.parse(datasetText));
  if (new Set(allCases.map(item => item.id)).size !== allCases.length) throw new Error("Duplicate case IDs.");
  const cases = allCases.filter(item => !values.case || item.id === values.case);
  if (!cases.length) throw new Error("No matching evaluation case.");
  console.log(`${cases.length} cases × ${runs} run(s) = ${cases.length * runs} assessments; model ${ASSESSMENT_MODEL}.`);
  if (values["dry-run"]) {
    cases.forEach(item => console.log(`${item.id}: ${item.expectedDecision}`));
    console.log("Dataset validated. No API calls made.");
    return;
  }
  nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing from the environment or .env.local.");
  console.log("Live run: uses OpenAI credits with synthetic inputs only; no database access.");
  const startedAt = new Date().toISOString();
  const results: Result[] = [];
  // Sequential calls keep API load modest. Each production call already has a timeout and bounded retries.
  for (const testCase of cases) {
    for (let run = 1; run <= runs; run++) {
      const started = performance.now();
      let result: Result;
      try {
        const output = await assessRequest(testCase.input);
        const failures = gradeAssessment(testCase, output);
        result = { caseId: testCase.id, category: testCase.category, run, status: failures.length ? "fail" : "pass", elapsedMs: Math.round(performance.now() - started), failures, output };
      } catch (error) {
        // Never log provider response bodies, request headers, or credentials.
        const safeReasons = ["Assessment contains unsupported evidence", "A definitive assessment requires scope evidence", "An uncertain assessment requires clarification questions"];
        const reason = error instanceof Error && safeReasons.includes(error.message) ? error.message : "Production assessment did not return a validated result.";
        const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
        result = { caseId: testCase.id, category: testCase.category, run, status: "error", elapsedMs: Math.round(performance.now() - started), failures: [reason], error: { name: error instanceof Error ? error.name : "UnknownError", statusCode } };
      }
      results.push(result);
      console.log(`${result.status.toUpperCase()} ${testCase.id} (${run}/${runs}, ${result.elapsedMs}ms)${result.failures.length ? ` — ${result.failures.join("; ")}` : ""}`);
    }
  }
  const summary = {
    total: results.length,
    passed: results.filter(result => result.status === "pass").length,
    failed: results.filter(result => result.status === "fail").length,
    errors: results.filter(result => result.status === "error").length,
  };
  const categories = [...new Set(cases.map(item => item.category))].map(category => {
    const rows = results.filter(result => result.category === category);
    return { category, passed: rows.filter(row => row.status === "pass").length, total: rows.length };
  });
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const assessmentCode = await readFile(new URL("../src/lib/ai/assess-request.ts", import.meta.url), "utf8");
  const schemaCode = await readFile(new URL("../src/schemas/assessment.ts", import.meta.url), "utf8");
  const graderCode = await readFile(new URL("../evals/assessment-grader.mts", import.meta.url), "utf8");
  const report = {
    startedAt, finishedAt: new Date().toISOString(), model: ASSESSMENT_MODEL, runs,
    assessmentCodeHash: hash(assessmentCode), schemaHash: hash(schemaCode), datasetHash: hash(datasetText), graderHash: hash(graderCode),
    summary, categories, cases, results,
    limitation: "Synthetic regression checks, not a production accuracy estimate. Keyword checks do not establish semantic correctness. Review each answer against its rubric.",
  };
  const directory = new URL("../evals/results/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const filename = startedAt.replace(/[:.]/g, "-");
  await writeFile(new URL(`${filename}.json`, directory), JSON.stringify(report, null, 2) + "\n");
  const markdown = [
    "# ScopeCheck assessment evaluation", "", `Model: ${ASSESSMENT_MODEL}. Started: ${startedAt}.`, "",
    `Automated checks: ${summary.passed}/${summary.total} passed; ${summary.failed} failed; ${summary.errors} errors.`, "",
    report.limitation, "", "## Categories", "",
    ...categories.map(item => `- ${item.category}: ${item.passed}/${item.total}`), "",
    "## Answers for review", "",
    ...results.flatMap(result => formatResult(cases.find(item => item.id === result.caseId)!, result)),
  ].join("\n");
  await writeFile(new URL(`${filename}.md`, directory), markdown);
  console.log(`\n${summary.passed}/${summary.total} passed; ${summary.failed} failed; ${summary.errors} errors.`);
  console.log(`Report: ${fileURLToPath(new URL(`${filename}.md`, directory))}`);
  if (summary.failed || summary.errors) process.exitCode = 1;
}

function formatResult(testCase: EvalCase, result: Result) {
  return [
    `### ${testCase.id} — ${result.status.toUpperCase()} (run ${result.run})`, "",
    `Expected: ${testCase.expectedDecision}`, "", `Review rubric: ${testCase.rubric}`, "",
    "Input:", "", "```json", JSON.stringify(testCase.input, null, 2), "```", "",
    "Output:", "", "```json", JSON.stringify(result.output ?? result.error, null, 2), "```", "",
    ...result.failures.map(failure => `- ${failure}`), "",
  ];
}

main().catch(error => {
  console.error(error instanceof z.ZodError ? "Invalid evaluation dataset." : error instanceof Error ? error.message : "Evaluation setup failed.");
  process.exitCode = 1;
});
