// Offline tests for change-order text and reply-draft safety checks. No AI calls, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOrderAddendum, formatMoney } from "../src/lib/change-order-text.ts";
import { unsupportedNumbers, validateReplyDraft } from "../src/lib/reply-validation.ts";
import { changeOrderInputSchema } from "../src/schemas/workflow.ts";
import { pageOfQuote } from "../src/lib/scope-import/normalize.ts";

test("change order addendum and money", () => {
  assert.equal(formatMoney(45000, "USD"), "USD 450.00");
  const text = changeOrderAddendum({ number: 3, title: "Client login", description: "Accounts for up to 50 clients.", hours: 6, amountCents: 45000, currency: "USD" }, new Date("2026-10-14T10:00:00Z"));
  assert.equal(text, "[Change order #3 · accepted 2026-10-14]\nClient login\nAccounts for up to 50 clients.\nEstimate: 6 hours · USD 450.00");
  assert.ok(!changeOrderAddendum({ number: 1, title: "T", description: "D", hours: null, amountCents: null, currency: "EUR" }, new Date()).includes("Estimate"));
});

test("addendum does not disturb page lookup for earlier quotes", () => {
  const scope = "[Page 1]\nFive pages.\n\n[Page 2]\nUser accounts are excluded.\n\n" + changeOrderAddendum({ number: 1, title: "Login", description: "Client accounts.", hours: null, amountCents: null, currency: "USD" }, new Date());
  assert.equal(pageOfQuote(scope, "User accounts are excluded."), 2);
});

test("change order input parsing", () => {
  const parsed = changeOrderInputSchema.parse({ title: " Login ", description: "Accounts", hours: "6.5", amount: "", currency: "EUR" });
  assert.deepEqual([parsed.title, parsed.hours, parsed.amount, parsed.currency], ["Login", 6.5, undefined, "EUR"]);
  assert.equal(changeOrderInputSchema.safeParse({ title: "x", description: "y", amount: "-5" }).success, false);
  assert.equal(changeOrderInputSchema.safeParse({ title: "x", description: "y", currency: "XYZ" }).success, false);
  assert.equal(changeOrderInputSchema.parse({ title: "x", description: "y" }).currency, "USD");
});

test("reply drafts may only use numbers from the project", () => {
  const sources = ["Two rounds of revisions. 5 pages.", "Change order #3 Estimate: 6 hours · USD 450.00"];
  assert.deepEqual(unsupportedNumbers("Change order #3 is 6 hours, USD 450.00 total.", sources), []);
  assert.deepEqual(unsupportedNumbers("That will cost $1,200 and take 2 weeks.", sources), ["1200", "2"]);
  assert.equal(validateReplyDraft("Hi Sam,\n\nThe estimate is USD 450.00.\n\nBest,\nHamza", sources), null);
  assert.match(validateReplyDraft("Delivered by 2026-11-01.", sources) ?? "", /numbers that are not in your project/);
  assert.match(validateReplyDraft("See [Page 2] of the scope.", sources) ?? "", /internal markers/);
  assert.match(validateReplyDraft("   ", sources) ?? "", /empty/);
});
