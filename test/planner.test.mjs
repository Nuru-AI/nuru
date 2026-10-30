// The plan check: what code refuses before a cent is spent. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, correctPlanIds, runMove, forEachInputs, itemsOf } from "../lib/planner.mjs";

const shelf = {
  "grounded-search": { priceUSD: 0.05, inputs: ["query"] },
  "sippar-reddit-social": { priceUSD: 0.03, inputs: ["query", "limit"] },
  "web-content": { priceUSD: 0.0035, inputs: ["url"] },
};

test("a plan inside the shelf and the budget passes, priced at live prices", () => {
  const plan = { steps: [
    { id: "s1", product: "grounded-search", input: { query: "nebius gpu cloud" } },
    { id: "s2", product: "sippar-reddit-social", input: { query: "nebius" } },
    { id: "s3", move: "merge", from: ["s1", "s2"] },
    { id: "s4", move: "dedupe", from: ["s3"], args: { by: "url" } },
  ] };
  const c = checkPlan(plan, shelf, 0.5);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.equal(c.costUSD, 0.08);
  assert.equal(c.calls, 2);
});

test("a product that is not on the shelf is refused", () => {
  const c = checkPlan({ steps: [{ id: "s1", product: "made-up-search", input: { query: "x" } }] }, shelf, 1);
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /not a product on the shelf/);
});

test("an input the product does not take is refused", () => {
  const c = checkPlan({ steps: [{ id: "s1", product: "grounded-search", input: { prompt: "x" } }] }, shelf, 1);
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /takes no input "prompt"/);
});

test("a plan over budget is refused", () => {
  const plan = { steps: [{ id: "s1", product: "grounded-search", input: { query: "a" } }, { id: "s2", product: "grounded-search", input: { query: "b" } }] };
  const c = checkPlan(plan, shelf, 0.06);
  assert.equal(c.ok, false);
  assert.match(c.errors.at(-1), /more than the \$0\.06 budget/);
});

test("a move that reads a field the product never returns is refused", () => {
  const plan = { steps: [{ id: "s1", product: "sippar-reddit-social", input: { query: "x" } }, { id: "s2", move: "rank", from: ["s1"], args: { by: "likes" } }] };
  const c = checkPlan(plan, shelf, 1);
  assert.equal(c.ok, false);
  assert.match(c.errors[0], /returns no field "likes"/);
});

test("for_each is priced at its maximum number of calls", () => {
  const plan = { steps: [
    { id: "s1", product: "grounded-search", input: { query: "x" } },
    { id: "s2", move: "for_each", from: ["s1"], args: { product: "web-content", input: { url: "{{item.url}}" }, max: 4 } },
  ] };
  const c = checkPlan(plan, shelf, 1);
  assert.equal(c.ok, true, c.errors.join("; "));
  assert.equal(c.calls, 5);
  assert.equal(c.costUSD, 0.064);
});

test("a product id one letter off the shelf is read as the shelf id, and the run says so", () => {
  const { plan, corrections } = correctPlanIds({ steps: [{ id: "s1", product: "grounded-serch", input: {} }] }, shelf);
  assert.equal(plan.steps[0].product, "grounded-search");
  assert.match(corrections[0], /read as grounded-search/);
});

test("moves are code: filter, rank and top over bought items", () => {
  const items = [{ title: "a", score: 5 }, { title: "b", score: 50 }, { title: "c", score: 20 }];
  const kinds = { title: "text", score: "number" };
  const kept = runMove({ move: "filter", args: { field: "score", op: ">=", value: 10 } }, [items], kinds);
  const ranked = runMove({ move: "rank", args: { by: "score" } }, [kept], kinds);
  assert.deepEqual(runMove({ move: "top", args: { n: 1 } }, [ranked], kinds).map((i) => i.title), ["b"]);
});

test("for_each fills each input from an item and stops at max", () => {
  const calls = forEachInputs({ args: { input: { url: "{{item.url}}" }, max: 2 } }, [{ url: "u1" }, { url: "" }, { url: "u2" }, { url: "u3" }]);
  assert.deepEqual(calls, [{ url: "u1" }, { url: "u2" }]);
});

test("items are read from a product's recorded result shape", () => {
  const items = itemsOf("grounded-search", { answer: "text", citations: [{ title: "t", url: "https://dataconomy.com/x" }] });
  assert.equal(items.length, 2);
  assert.equal(items[0].url, "https://dataconomy.com/x");
});
