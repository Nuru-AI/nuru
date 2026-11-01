// The free public sources: each adapter against a real recorded answer, and the limits around them. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FREE_SOURCES, FREE_SHAPES, freeSources, freeRow, callFree } from "../lib/free.mjs";
import { checkPlan, shelfFrom, itemsOf, plannerSheet } from "../lib/planner.mjs";
import { limits } from "../lib/limits.mjs";

const fx = (f) => readFileSync(new URL(`./fixtures/free/${f}`, import.meta.url), "utf8");
// Each source, the answer recorded from it on 2026-11-01, and the input that answer was asked with.
const RECORDED = {
  "free-openalex-works": ["openalex.json", { query: "agent payments", limit: 3 }],
  "free-crossref-works": ["crossref.json", { query: "agent payments", limit: 3 }],
  "free-arxiv-papers": ["arxiv.xml", { query: "agent payments", limit: 3 }],
  "free-sec-edgar-search": ["sec.json", { query: "stablecoin", limit: 3 }],
  "free-openfda-drug-recalls": ["openfda.json", { query: "metformin", limit: 3 }],
  "free-usgs-earthquakes": ["usgs.json", { days: 7, minmagnitude: 5, limit: 3 }],
  "free-nasa-power-daily": ["nasapower.json", { latitude: 32.08, longitude: 34.78, start: "20261001", end: "20261003" }],
  "free-worldbank-indicator": ["worldbank.json", { country: "IL", indicator: "NY.GDP.MKTP.CD", limit: 3 }],
  "free-gbif-species": ["gbif.json", { query: "quercus", limit: 3 }],
  "free-wikipedia-search": ["wikipedia.json", { query: "stablecoin", limit: 3 }],
  "free-npm-packages": ["npm.json", { query: "x402", limit: 3 }],
  "free-openlibrary-books": ["openlibrary.json", { query: "agents", limit: 3 }],
  "free-coingecko-markets": ["coingecko.json", { ids: "bitcoin,ethereum" }],
  "free-defillama-tvl": ["defillama.json", { protocol: "aave" }],
};
const fakeFetch = (body, status = 200) => async () => new Response(body, { status });

test("the 14 free sources are the ones whose terms were read, each with a shape and a recorded answer", () => {
  assert.equal(FREE_SOURCES.length, 14);
  for (const s of FREE_SOURCES) {
    assert.ok(FREE_SHAPES[s.id], `${s.id} has a shape`);
    assert.ok(RECORDED[s.id], `${s.id} has a recorded answer`);
    assert.ok(s.credit, `${s.id} carries its credit line`);
    assert.doesNotMatch(s.description, /[<>"'&|;]/, `${s.id}: the sell door's filter would strip a character from its description`);
  }
  for (const banned of ["open-meteo", "hacker", "hn-"]) assert.ok(!FREE_SOURCES.some((s) => s.id.includes(banned)), `${banned} stays out (Elad 2026-11-01)`);
});

for (const [id, [file, input]] of Object.entries(RECORDED)) {
  test(`${id}: the recorded answer gives items with every declared field, and code writes each item's text`, async () => {
    const r = await callFree(id, input, { fetchImpl: fakeFetch(fx(file)) });
    assert.ok(r.items.length >= 1, "at least one item");
    const items = itemsOf(id, r);
    assert.equal(items.length, r.items.length);
    for (const f of Object.keys(FREE_SHAPES[id].fields)) assert.ok(items.some((it) => it[f] !== undefined && it[f] !== ""), `${id} returns ${f}`);
    for (const it of items) {
      assert.ok(typeof it.text === "string" && it.text.length >= 20, "a sentence to quote");
      assert.match(String(it.url), /^https:\/\//, "an https link");
      assert.doesNotMatch(JSON.stringify(it), /[\w.+-]+@[\w-]+\.[\w.]+/, "no email addresses");
    }
  });
}

test("a number in an item's text is the source's own number", async () => {
  const r = await callFree("free-coingecko-markets", { ids: "bitcoin,ethereum" }, { fetchImpl: fakeFetch(fx("coingecko.json")) });
  const raw = JSON.parse(fx("coingecko.json"));
  for (const [i, c] of raw.entries()) assert.ok(r.items[i].text.includes(String(c.current_price)), "price as returned");
  const w = await callFree("free-worldbank-indicator", { country: "IL", indicator: "NY.GDP.MKTP.CD" }, { fetchImpl: fakeFetch(fx("worldbank.json")) });
  assert.ok(w.items[0].text.includes(String(JSON.parse(fx("worldbank.json"))[1][0].value)));
});

test("openFDA's no-match answer (404) is an empty result, not an error", async () => {
  const r = await callFree("free-openfda-drug-recalls", { query: "zzzqqqnotadrug" }, { fetchImpl: fakeFetch(fx("openfda_empty.json"), 404) });
  assert.deepEqual(r.items, []);
  assert.match(r.readAt, /^\d{4}-\d\d-\d\dT/);
});

test("another error status is an error", async () => {
  await assert.rejects(callFree("free-gbif-species", { query: "x" }, { fetchImpl: fakeFetch("{}", 503) }), /503/);
});

test("an answer over the byte cap is refused, never read as broken JSON", async () => {
  const big = JSON.stringify({ results: Array.from({ length: 40000 }, (_, i) => ({ scientificName: `name ${i} ${"x".repeat(20)}` })) });
  await assert.rejects(callFree("free-gbif-species", { query: "x" }, { fetchImpl: fakeFetch(big) }), /over \d+ bytes/);
});

test("inputs outside what a source accepts are refused before any call", async () => {
  const never = async () => { throw new Error("called"); };
  await assert.rejects(callFree("free-worldbank-indicator", { country: "Israel!", indicator: "GDP" }, { fetchImpl: never }), /country code/);
  await assert.rejects(callFree("free-defillama-tvl", { protocol: "../protocols" }, { fetchImpl: never }), /slug/);
  await assert.rejects(callFree("free-coingecko-markets", { ids: "" }, { fetchImpl: never }), /coin ids/);
  await assert.rejects(callFree("free-nasa-power-daily", { latitude: 1, longitude: 2, start: "2026-10-01", end: "x" }, { fetchImpl: never }), /YYYYMMDD/);
});

test("DefiLlama is called only on its one-protocol TVL endpoint, never the full protocol list", () => {
  const s = FREE_SOURCES.find((x) => x.id === "free-defillama-tvl");
  assert.equal(s.url({ protocol: "aave" }), "https://api.llama.fi/tvl/aave");
});

test("free sources are off unless switched on, and SEC stays off without a contact email", () => {
  assert.deepEqual(freeSources({ on: false, hasEmail: true }), []);
  const noEmail = freeSources({ on: true, hasEmail: false }).map((s) => s.id);
  assert.equal(noEmail.length, 13);
  assert.ok(!noEmail.includes("free-sec-edgar-search"));
  assert.equal(freeSources({ on: true, hasEmail: true }).length, 14);
});

test("a plan with free steps costs only its paid steps, and the budget still binds the paid ones", () => {
  const products = [
    { id: "grounded-search", priceUSD: 0.05, input: { query: "x" }, inputOptions: [] },
    ...FREE_SOURCES.map(freeRow),
  ];
  const shelf = shelfFrom(products);
  const plan = { steps: [
    { id: "s1", product: "free-openfda-drug-recalls", input: { query: "metformin" } },
    { id: "s2", product: "free-wikipedia-search", input: { query: "metformin" } },
    { id: "s3", product: "grounded-search", input: { query: "metformin recall" } },
    { id: "s4", move: "merge", from: ["s1", "s2"] },
    { id: "s5", move: "filter", from: ["s4"], args: { field: "text", op: "contains", value: "recall" } },
  ] };
  const ok = checkPlan(plan, shelf, 0.1);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(ok.costUSD, 0.05);
  assert.equal(checkPlan(plan, shelf, 0.04).ok, false);
});

test("the planner's sheet lists each free source at $0 with the fields it returns", () => {
  const sheet = plannerSheet(FREE_SOURCES.map(freeRow));
  for (const s of FREE_SOURCES) assert.match(sheet, new RegExp(`- ${s.id}: .*\\$0 a call`));
  assert.ok(sheet.length < 12_000, `the free rows add ${sheet.length} characters to the sheet`);
});

test("the day's free calls are counted across visitors and stop at the limit", () => {
  const L = limits(mkdtempSync(join(tmpdir(), "nuru-")));
  const now = new Date("2026-12-01T10:00:00Z");
  let n = 0;
  while (L.freeCall(now) && n < 1000) n++;
  assert.equal(n, Number(process.env.FREE_CALLS_PER_DAY || 300));
  assert.equal(L.freeCall(new Date("2026-12-02T00:00:01Z")), true, "a new UTC day starts a new count");
});

test("a free-only plan runs through Nuru's step runner: nothing charged, empty searches written as gaps, the per-run cap holds", async () => {
  const { runCatalogPlan } = await import("../lib/agent.mjs");
  const rows = FREE_SOURCES.map(freeRow);
  const catalog = { byId: Object.fromEntries(rows.map((r) => [r.id, r])) };
  const answers = { "api.fda.gov": [fx("openfda_empty.json"), 404], "en.wikipedia.org": [fx("wikipedia.json"), 200] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { const [b, s] = answers[new URL(url).host]; return new Response(b, { status: s }); };
  try {
    const run = { steps: [] };
    const plan = { steps: [
      { id: "s1", product: "free-openfda-drug-recalls", input: { query: "zzzqqqnotadrug" } },
      { id: "s2", product: "free-wikipedia-search", input: { query: "stablecoin" } },
    ] };
    const wallet = { address: "0x0" };
    const spent = await runCatalogPlan({ run, plan, catalog, wallet, emit: () => {} });
    assert.equal(spent, 0);
    assert.equal(run.steps.length, 2);
    assert.ok(run.steps.every((s) => s.rail === "free" && s.payment?.priceUsd === 0 && !s.payment.tx));
    assert.equal(run.steps[0].items, 0);
    assert.match(run.empty[0], /^FDA drug recall reports returned no matching records for query "zzzqqqnotadrug" on .* UTC\. That does not mean none exist\.$/);
    assert.ok(run.steps[1].documents.length >= 1, "Wikipedia items become documents to quote");
    assert.deepEqual(run.credits, ["Data provided by the U.S. Food and Drug Administration (open.fda.gov)", "Wikipedia, CC BY-SA 4.0"]);
    // The day's free calls run out: the step is skipped, not failed, and nothing is called.
    const run2 = { steps: [] };
    await runCatalogPlan({ run: run2, plan: { steps: [plan.steps[1]] }, catalog, wallet, emit: () => {}, allowFree: () => false });
    assert.match(run2.steps[0].skipped, /free calls for this page are used up/);
  } finally { globalThis.fetch = realFetch; }
});

test("what is read is what the plan's code kept: a filtered-out item's document is never read (#6408)", async () => {
  const { runCatalogPlan } = await import("../lib/agent.mjs");
  const rows = FREE_SOURCES.map(freeRow);
  const catalog = { byId: Object.fromEntries(rows.map((r) => [r.id, r])) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(fx("wikipedia.json"), { status: 200 });
  try {
    const run = { steps: [] };
    const plan = { steps: [
      { id: "s1", product: "free-wikipedia-search", input: { query: "stablecoin" } },
      { id: "s2", move: "filter", from: ["s1"], args: { field: "title", op: "==", value: "Stablecoin" } },
    ] };
    await runCatalogPlan({ run, plan, catalog, wallet: { address: "0x0" }, emit: () => {} });
    const docs = run.steps[0].documents;
    assert.ok(docs.length >= 2, "the search found several articles");
    assert.equal(run.steps[1].items, 1);
    assert.deepEqual(run.readDocIds, [docs.find((d) => d.title === "Stablecoin").id], "only the article the filter kept is read");
    // A plan with no code move reads every document its steps returned, as before.
    const run2 = { steps: [] };
    await runCatalogPlan({ run: run2, plan: { steps: [plan.steps[0]] }, catalog, wallet: { address: "0x0" }, emit: () => {} });
    assert.equal(run2.readDocIds.length, run2.steps[0].documents.length);
  } finally { globalThis.fetch = realFetch; }
});
