// Paid products' recorded shapes, against the real answers they were recorded from. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { itemsOf, checkPlan } from "../lib/planner.mjs";
import { docsFrom } from "../lib/agent.mjs";

const paper = JSON.parse(readFileSync(new URL("./fixtures/paid/paper-search.json", import.meta.url), "utf8"));
const product = { id: "paper-search", name: "Paper search", url: "https://sippar.network/api/sippar/sell/paper-search" };

test("paper-search: the paid answer of brief 2026-11-01T10-51-02-123Z gives its 10 papers as items (#12)", () => {
  const items = itemsOf("paper-search", paper);
  assert.equal(items.length, 10);
  assert.equal(items[7].title, "Metformin improves healthspan and lifespan in mice.");
  assert.equal(items[7].year, 2013);
});

test("paper-search: each paper becomes a document to quote, linked by DOI, never by the shop's URL", () => {
  const docs = docsFrom(product, itemsOf("paper-search", paper), paper, 3);
  assert.ok(docs.length >= 9, `${docs.length} documents`); // "Longevity." alone is too short to quote
  assert.ok(docs.every((d) => d.url.startsWith("https://doi.org/") || d.url.startsWith("https://pubmed.ncbi.nlm.nih.gov/")));
  assert.ok(docs.some((d) => d.text.includes("Metformin improves healthspan and lifespan in mice")));
});

test("paper-search: a plan may now filter and rank its papers by their fields", () => {
  const shelf = { "paper-search": { priceUSD: 0.08, inputs: ["query", "sources", "rows"] } };
  const plan = { steps: [
    { id: "s1", product: "paper-search", input: { query: "metformin longevity" } },
    { id: "s2", move: "filter", from: ["s1"], args: { field: "year", op: ">=", value: 2020 } },
    { id: "s3", move: "rank", from: ["s2"], args: { by: "year" } },
  ] };
  const c = checkPlan(plan, shelf, 0.2);
  assert.equal(c.ok, true, c.errors.join("; "));
});

test("paper-search: a paper without its abstract is read as its title only, and marked so (#6408)", () => {
  const docs = docsFrom(product, itemsOf("paper-search", paper), paper, 3);
  assert.ok(docs.every((d) => d.titleOnly === true), "no row in the recording carried an abstract");
  const withAbstract = { results: [{ ...paper.results[0], abstract: "A long abstract that the paper's authors wrote." }] };
  assert.equal(docsFrom(product, itemsOf("paper-search", withAbstract), withAbstract, 3)[0].titleOnly, undefined);
});

test("paper-search declares only the fields the recorded answer carries (#6408)", async () => {
  const { RESULT_SHAPES } = await import("../lib/planner.mjs");
  assert.deepEqual(Object.keys(RESULT_SHAPES["paper-search"].fields), ["title", "year", "doi", "pmid"]);
});
