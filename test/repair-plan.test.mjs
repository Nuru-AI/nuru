// Paid Sippar plans mended in code instead of thrown away (2026-11-08: 6 of 16 paid plans on the page were lost,
// $0.60; these cover the two the check refused). node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, repairPlan, RESULT_SHAPES } from "../lib/planner.mjs";

const shelf = {
  "tavily-web-search": { priceUSD: 0.05, inputs: ["query", "max_results"] },
  "crypto-skills": { priceUSD: 0.02, inputs: ["query"] },
  "web-content": { priceUSD: 0.0035, inputs: ["url"] },
  "grounded-search": { priceUSD: 0.05, inputs: ["query"] },
};
test("the fixture products are what the page records (tavily shaped, crypto-skills not)", () => {
  assert.ok(RESULT_SHAPES["tavily-web-search"]?.fields?.url, "tavily returns url");
  assert.equal(RESULT_SHAPES["crypto-skills"], undefined);
});

test("a merge of a recorded and an unrecorded source passes with a warning; the moves read the recorded fields", () => {
  const plan = { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "x402 express" } },
    { id: "s2", product: "crypto-skills", input: { query: "x402 express" } },
    { id: "s3", move: "merge", from: ["s1", "s2"], args: {} },
    { id: "s4", move: "dedupe", from: ["s3"], args: { by: "url" } },
    { id: "s5", move: "top", from: ["s4"], args: { n: 5 } },
    { id: "s6", move: "for_each", from: ["s5"], args: { product: "web-content", input: { url: "{{item.url}}" }, max: 3 } },
  ] };
  const c = checkPlan(plan, shelf, 0.3);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.ok(c.warnings.some((w) => /crypto-skills have no recorded fields/.test(w)), c.warnings.join(" "));
});

test("a merge of only unrecorded sources is still refused", () => {
  const c = checkPlan({ steps: [
    { id: "s1", product: "crypto-skills", input: { query: "a" } },
    { id: "s2", move: "dedupe", from: ["s1"], args: { by: "url" } },
  ] }, shelf, 1);
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /no recorded result/);
});

test("a plain step with an {{item.…}} input and one from becomes a for_each, at most 3 calls", () => {
  const written = { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "x402" } },
    { id: "s2", product: "web-content", from: ["s1"], input: { url: "{{item.url}}" }, why: "read them" },
  ] };
  assert.equal(checkPlan(written, shelf, 0.3).ok, false, "refused as written");
  const { plan, corrections } = repairPlan(written, shelf, 0.3);
  assert.deepEqual(plan.steps[1], { id: "s2", why: "read them", move: "for_each", from: ["s1"], args: { product: "web-content", input: { url: "{{item.url}}" }, max: 3 } });
  assert.match(corrections[0], /run as a for_each over it, at most 3 calls/);
  assert.equal(checkPlan(plan, shelf, 0.3).ok, true);
});

test("a plan over budget has its for_each count lowered until it fits ($0.22 against $0.20, as on 2026-11-04)", () => {
  const written = { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "a" } },
    { id: "s2", product: "grounded-search", input: { query: "a" } },
    { id: "s3", move: "for_each", from: ["s1"], args: { product: "web-content", input: { url: "{{item.url}}" }, max: 35 } },
  ] };
  assert.ok(checkPlan(written, shelf, 0.2).costUSD > 0.2);
  const { plan, corrections } = repairPlan(written, shelf, 0.2);
  const c = checkPlan(plan, shelf, 0.2);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.equal(plan.steps[2].args.max, 28);
  assert.match(corrections.at(-1), /max 35 lowered to 28/);
});

test("a plan the repair cannot bring under budget is left for the check to refuse", () => {
  const written = { steps: [{ id: "s1", product: "tavily-web-search", input: { query: "a" } }, { id: "s2", product: "grounded-search", input: { query: "b" } }] };
  const { plan, corrections } = repairPlan(written, shelf, 0.05);
  assert.equal(corrections.length, 0);
  assert.equal(checkPlan(plan, shelf, 0.05).ok, false);
});
