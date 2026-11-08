// Input values a product refuses, caught before buying (Nuru-AI/sippar#7065, 2026-11-08: a tech brief planned
// max_results 5 on a search that takes 20 to 25; every search was refused and the brief came back empty). node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { shelfFrom, inputRule, inputProblem, correctPlanIds, checkPlan } from "../lib/planner.mjs";
import { refusedOptionalInput, READING_NOTES } from "../lib/agent.mjs";

// The catalog row as Sippar's sell catalog served it on 2026-11-08 (trimmed).
const tavily = {
  id: "tavily-web-search", priceUSD: 0.05, input: { query: "What is the x402 payment protocol?" },
  inputOptions: [
    { field: "topic", required: false, enum: ["general", "news", "finance"], description: "news for news articles" },
    { field: "max_results", required: false, description: "How many results: a whole number from 20 to 25. Leave it out for 20. Anything else is refused before payment." },
  ],
};
const social = { id: "social-search", priceUSD: 0.5, input: { query: "x" }, inputOptions: [{ field: "platforms", type: "array", items: { type: "string", enum: ["reddit", "youtube", "linkedin"] } }] };
const shelf = shelfFrom([tavily, social]);

test("the shelf reads a stated range and listed choices from the catalog row", () => {
  assert.deepEqual(inputRule(tavily.inputOptions[1]), { min: 20, max: 25 });
  assert.deepEqual(shelf["tavily-web-search"].rules.topic, { choices: ["general", "news", "finance"], list: false });
  assert.deepEqual(shelf["tavily-web-search"].required, ["query"]);
  assert.equal(inputProblem({ min: 20, max: 25 }, 22), null);
  assert.match(inputProblem({ min: 20, max: 25 }, 5), /20 to 25/);
  assert.match(inputProblem(shelf["social-search"].rules.platforms, ["reddit", "tiktok"]), /list of/);
  assert.equal(inputProblem({ min: 1, max: 3 }, "{{item.n}}"), null);
});

test("the 2026-11-08 tech plan: max_results 5 is left out in code, and the plan then passes", () => {
  const written = { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "x402 express middleware", max_results: 5 } },
    { id: "s2", product: "tavily-web-search", input: { query: "x402 usdc base", max_results: 5, topic: "general" } },
  ] };
  assert.equal(checkPlan(written, shelf, 1).ok, false, "the check alone refuses it");
  const { plan, corrections } = correctPlanIds(written, shelf);
  assert.deepEqual(plan.steps[0].input, { query: "x402 express middleware" });
  assert.deepEqual(plan.steps[1].input, { query: "x402 usdc base", topic: "general" });
  assert.equal(corrections.length, 2);
  assert.match(corrections[0], /max_results 5 .*left out/);
  const c = checkPlan(plan, shelf, 1);
  assert.equal(c.ok, true, c.errors.join("; "));
});

test("a required input that breaks its rule is not dropped; the check refuses the plan", () => {
  const strict = shelfFrom([{ id: "p", priceUSD: 0.01, input: { mode: "a" }, inputOptions: [{ field: "mode", required: true, enum: ["a", "b"] }] }]);
  const { plan, corrections } = correctPlanIds({ steps: [{ id: "s1", product: "p", input: { mode: "z" } }] }, strict);
  assert.deepEqual(plan.steps[0].input, { mode: "z" });
  assert.equal(corrections.length, 0);
  assert.match(checkPlan(plan, strict, 1).errors[0], /one of a, b/);
});

test("a seller's refusal of an optional input is recognised; a required one is not", () => {
  const e = { status: 400, message: `web-search: 400 {"success":false,"error":"max_results: \\"max_results\\" must be a whole number from 20 to 25","code":"E_VALIDATION"}` };
  assert.equal(refusedOptionalInput(e, tavily, { query: "q", max_results: 5 }), "max_results");
  assert.equal(refusedOptionalInput(e, tavily, { query: "q" }), null);
  assert.equal(refusedOptionalInput({ ...e, status: 502 }, tavily, { query: "q", max_results: 5 }), null);
  const q = { status: 400, message: `web-search: 400 {"success":false,"error":"query: too short"}` };
  assert.equal(refusedOptionalInput(q, tavily, { query: "q" }), null);
});

test("the planner note no longer asks for 5 results", () => {
  assert.doesNotMatch(READING_NOTES, /5 or fewer/);
  assert.match(READING_NOTES, /leave a result-count input out/);
});
