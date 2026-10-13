import { z } from "zod";
import { assessmentSchema } from "../src/schemas/assessment.ts";

export const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.string().min(1),
  input: z.object({ scope: z.string().min(1), title: z.string().min(1), description: z.string().min(1) }),
  expectedDecision: assessmentSchema.shape.suggestedDecision,
  // Each group needs one matching term. These are signals, not semantic proof.
  evidenceTerms: z.array(z.array(z.string().min(1)).min(1)),
  explanationTerms: z.array(z.array(z.string().min(1)).min(1)).default([]),
  forbiddenText: z.array(z.string().min(1)).default([]),
  rubric: z.string().min(1),
});
export type EvalCase = z.infer<typeof caseSchema>;

export function gradeAssessment(testCase: EvalCase, output: unknown): string[] {
  const parsed = assessmentSchema.safeParse(output);
  if (!parsed.success) return ["schema: output does not match the assessment contract"];
  const result = parsed.data;
  const failures: string[] = [];
  if (result.suggestedDecision !== testCase.expectedDecision) {
    failures.push(`decision: expected ${testCase.expectedDecision}, received ${result.suggestedDecision}`);
  }
  if (result.evidence.some(quote => !testCase.input.scope.includes(quote))) {
    failures.push("grounding: evidence contains a quote absent from the scope");
  }
  if (result.suggestedDecision !== "needs_clarification" && !result.evidence.length) {
    failures.push("evidence: a definitive decision needs scope evidence");
  }
  if (result.suggestedDecision === "needs_clarification" && !result.clarificationQuestions.length) {
    failures.push("clarification: an uncertain decision needs at least one question");
  }
  const evidence = result.evidence.join("\n").toLowerCase();
  for (const group of testCase.evidenceTerms) {
    if (!group.some(term => evidence.includes(term.toLowerCase()))) {
      failures.push(`relevance signal: evidence should mention one of [${group.join(", ")}]`);
    }
  }
  for (const group of testCase.explanationTerms) {
    if (!group.some(term => result.explanation.toLowerCase().includes(term.toLowerCase()))) {
      failures.push(`explanation signal: should mention one of [${group.join(", ")}]`);
    }
  }
  const text = JSON.stringify(result).toLowerCase();
  for (const forbidden of testCase.forbiddenText) {
    if (text.includes(forbidden.toLowerCase())) failures.push(`injection: output contains forbidden marker ${forbidden}`);
  }
  return failures;
}
