import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { caseSchema, gradeAssessment, type EvalCase } from "./assessment-grader.mts";

const example: EvalCase = {
  id: "test", category: "exclusion",
  input: { scope: "Build a contact form. User accounts are excluded.", title: "Login", description: "Add login." },
  expectedDecision: "extra_work", evidenceTerms: [["accounts"]], explanationTerms: [],
  forbiddenText: ["OVERRIDE_ACCEPTED"], rubric: "Recognize the explicit account exclusion.",
};
const valid = { suggestedDecision: "extra_work", explanation: "User accounts are excluded.", evidence: ["User accounts are excluded."], clarificationQuestions: [] };

test("accepts a grounded expected decision", () => assert.deepEqual(gradeAssessment(example, valid), []));
test("rejects malformed output", () => assert.match(gradeAssessment(example, {})[0], /schema/));
test("rejects a correct format with the wrong decision", () => assert.match(gradeAssessment(example, { ...valid, suggestedDecision: "included" }).join(), /decision/));
test("rejects invented quotes", () => assert.match(gradeAssessment(example, { ...valid, evidence: ["User accounts cost extra."] }).join(), /grounding/));
test("flags a real but irrelevant quote", () => assert.match(gradeAssessment(example, { ...valid, evidence: ["Build a contact form."] }).join(), /relevance/));
test("rejects definitive labels without evidence", () => assert.match(gradeAssessment(example, { ...valid, evidence: [] }).join(), /definitive/));
test("requires clarification questions", () => assert.match(gradeAssessment({ ...example, expectedDecision: "needs_clarification" }, { ...valid, suggestedDecision: "needs_clarification" }).join(), /clarification/));
test("allows grounded uncertainty with no relevant quote", () => assert.deepEqual(gradeAssessment({ ...example, expectedDecision: "needs_clarification", evidenceTerms: [] }, { ...valid, suggestedDecision: "needs_clarification", evidence: [], clarificationQuestions: ["What access is required?"] }), []));
test("detects injected markers anywhere in the output", () => assert.match(gradeAssessment(example, { ...valid, clarificationQuestions: ["OVERRIDE_ACCEPTED"] }).join(), /injection/));
test("flags mixed explanations missing one part", () => assert.match(gradeAssessment({ ...example, explanationTerms: [["form"], ["accounts"]] }, valid).join(), /explanation signal/));
test("dataset has valid unique cases and all decision labels", async () => {
  const cases = z.array(caseSchema).min(1).parse(JSON.parse(await readFile(new URL("./assessment-cases.json", import.meta.url), "utf8")));
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  assert.deepEqual([...new Set(cases.map(item => item.expectedDecision))].sort(), ["extra_work", "included", "needs_clarification"]);
});
