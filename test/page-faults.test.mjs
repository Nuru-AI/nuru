// The page's faults found on 2026-11-07 (Nuru-AI/sippar#7065), one test or more each, over recorded answers and today's
// live catalog. No network: every seller and model is faked. node --test
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { itemsOf, checkPlan, sheetWithin } from "../lib/planner.mjs";
import { docsFrom, pickDocs, runCatalogPlan, ledgerOf, planWithSippar, asksRanking, planBFor } from "../lib/agent.mjs";
import { paymentOf } from "../lib/pay.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { freeSources } from "../lib/free.mjs";

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const google = fx("paid/google-results.json"), tavily = fx("paid/web-search.json"), grounded = fx("paid/grounded-search.json");
const catalogBody = readFileSync(new URL("./fixtures/catalog-2026-11-07.json", import.meta.url), "utf8");
const catalog = await loadCatalog({ fetchImpl: async () => new Response(catalogBody), free: freeSources({ on: true, hasEmail: true }) });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const offer = (usd) => json({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: String(Math.round(usd * 1e6)), payTo: "0xpay" }] }, 402);
const delivered = (result, tx, usd) => json({ success: true, data: { result, paymentTx: tx, amountUSD: usd } });
const breaker = () => json({ success: false, error: "Web Search (Tavily) is not serving right now", reason: "breaker_open", paid: false, paymentReusable: true, retryAfterSeconds: 815 }, 503);
// T1's first Tavily step, 2026-11-07 15:37 UTC: paid, then the seller failed.
const paidThenFailed = () => json({ success: false, error: "The upstream provider failed to complete your paid request. Your payment is recorded (tx 0x73ea).", paid: true, paymentReusable: false, paymentTx: "0x73ea" }, 502);

// Each sell door, by its last path part: what the probe gets and what the paid call gets.
let doors, calls, realFetch;
const sellId = (url) => String(url).split("/").pop();
beforeEach(() => {
  calls = []; realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const id = sellId(url); calls.push({ id, paid: false }); return doors[id].probe(); };
});
afterEach(() => { globalThis.fetch = realFetch; });
const wallet = { paidFetch: async (url) => { const id = sellId(url); calls.push({ id, paid: true }); return doors[id].paid(); } };
const run0 = () => ({ steps: [], events: [] });

/* 1. Sippar's planner was skipped when the sheet grew past its 60,000 characters. */
test("fault 1: today's catalog with the free sources is over 60,000 characters, and the sheet cut for Sippar fits", () => {
  assert.ok(catalog.sheet.length > 60_000, `full sheet ${catalog.sheet.length}`);
  const cut = catalog.sheetFor(60_000);
  assert.ok(cut && cut.length <= 60_000, `cut sheet ${cut?.length}`);
  assert.ok(cut.includes("- sippar-web-search:") && cut.includes("- tavily-web-search:"), "no product is dropped, only words");
  assert.equal(sheetWithin(catalog.products, 1000), null, "a limit no sheet fits gives none");
});

test("fault 1: Sippar's planner is asked with a sheet it takes, told how Nuru reads, and the run says it asked", async () => {
  let sent;
  const plan = { summary: "s", steps: [{ id: "s1", product: "sippar-web-search", input: { query: "agent payments" }, why: "Google's order" }] };
  globalThis.fetch = async (input, init) => {
    const r = input instanceof Request ? input : new Request(input, init);
    if (!r.headers.get("PAYMENT-SIGNATURE")) return offer(0.1);
    sent = await r.clone().json();
    return delivered({ text: JSON.stringify(plan), model: "nemotron-3-ultra-free", seller: "Dark Signal" }, "0xplan", 0.1);
  };
  const signer = { wrap: (f) => async (url, init) => { const r = new Request(url, init); r.headers.set("PAYMENT-SIGNATURE", "SIGNED"); return f(r); } };
  const run = run0(), events = [];
  const got = await planWithSippar({ run, question: "SEO content gap analysis for the keyword agent payments", catalog, wallet: signer, emit: (type, d) => events.push({ type, ...d }) });
  assert.ok(sent.query.length <= 60_000 && Number(sent.size) >= sent.query.length, `${sent.query.length} characters, size ${sent.size}`);
  assert.match(sent.query, /^NOTES FROM NURU/);
  assert.match(sent.query, /only sippar-web-search returns Google's own results/);
  assert.equal(got.served.provider, "sippar");
  assert.equal(run.sipparPlan.asked, true);
  assert.equal(run.steps[0].payment.tx, "0xplan");
});

test("fault 1: when Sippar's planner is not asked, the run and the page say why", async () => {
  globalThis.fetch = async () => assert.fail("nothing is bought");
  const run = run0(), events = [];
  assert.equal(await planWithSippar({ run, question: "short", catalog, wallet: {}, emit: (type, d) => events.push({ type, ...d }) }), null);
  assert.equal(run.sipparPlan.asked, false);
  assert.match(run.sipparPlan.reason, /10 characters/);
  assert.equal(events[0].type, "plan:sippar-skipped");
});

/* 2, 8. A filter on a field only Tavily returns, with Tavily down: T3 of 2026-11-07, then Google searched instead. */
test("faults 2 and 8: Tavily not serving is searched on Google with the same words; the emptied filter keeps the list", async () => {
  doors = {
    "web-search": { probe: breaker, paid: breaker },
    "google-results": { probe: () => offer(0.0025), paid: () => delivered(google, "0xg", 0.0025) },
    "grounded-search": { probe: () => offer(0.05), paid: () => delivered(grounded, "0xgr", 0.05) },
  };
  const plan = { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "x402 Express middleware", max_results: 10 }, why: "code" },
    { id: "s2", product: "grounded-search", input: { query: "x402 Express USDC Base" }, why: "overview" },
    { id: "s3", product: "tavily-web-search", input: { query: "x402 USDC Base guide" }, why: "guides" },
    { id: "s4", move: "merge", from: ["s1", "s2", "s3"], args: {}, why: "all" },
    { id: "s5", move: "filter", from: ["s4"], args: { field: "content", op: "contains", value: "express" }, why: "Express only" },
  ] };
  const check = checkPlan(plan, catalog.shelf, 0.3);
  assert.ok(check.ok, check.errors.join(" "));
  assert.ok(check.warnings.some((w) => /filter on "content" drops every item from grounded-search/.test(w)), check.warnings.join(" "));

  const run = run0();
  await runCatalogPlan({ run, plan, catalog, wallet, emit: () => {} });
  const [s1, s1b, s2, s3, , s5] = run.steps;
  assert.match(s1.error, /503/);
  assert.equal(s1.payment, undefined, "the refusal moved no money");
  assert.deepEqual([s1b.id, s1b.tool, s1b.switchedFrom, s1b.input.query], ["s1", "sippar-web-search", "tavily-web-search", "x402 Express middleware"]);
  assert.ok(s1b.items > 0 && s1b.documents.every((d) => d.rank >= 1), "Google's results, each with its place");
  assert.equal(s2.tool, "grounded-search");
  assert.equal(s3.tool, "sippar-web-search", "a seller down earlier in the run is not asked again");
  assert.match(s3.note, /was not serving earlier in this brief/);
  assert.equal(calls.filter((c) => c.id === "web-search").length, 2, "Tavily is asked once (probe and call), never for s3");
  assert.equal(run.notes.length, 2);
  assert.match(run.notes[0], /^Web Search \(Tavily\) did not serve this search \(503, breaker_open\), so .* was searched with the same words\.$/);
  assert.ok(s5.items > 0, "the filter kept the list instead of nothing");
  assert.match(s5.note, /kept none of the \d+ items, so all \d+ were kept/);
  assert.ok(run.readDocIds.length > 0, "documents reach the reading stage");
});

test("fault 2: a filter that keeps nothing of nothing stays empty (no data is supply, not the filter)", async () => {
  doors = { "web-search": { probe: breaker, paid: breaker }, "google-results": { probe: breaker, paid: breaker }, "grounded-search": { probe: breaker, paid: breaker } };
  const run = run0();
  await runCatalogPlan({ run, plan: { steps: [
    { id: "s1", product: "tavily-web-search", input: { query: "q" } },
    { id: "s2", move: "filter", from: ["s1"], args: { field: "url", op: "contains", value: "http" } },
  ] }, catalog, wallet, emit: () => {} });
  const f = run.steps.find((s) => s.id === "s2");
  assert.equal(f.items, 0);
  assert.equal(f.note, undefined);
});

/* 4. The ledger was short of the wallet: a paid call that failed was never recorded. */
test("fault 4: a payment the seller failed after is in the ledger, marked, and the ledger matches the wallet", async () => {
  doors = {
    "web-search": { probe: () => offer(0.05), paid: paidThenFailed },
    "google-results": { probe: () => offer(0.0025), paid: () => delivered(google, "0xg", 0.0025) },
  };
  const run = run0();
  const spent = await runCatalogPlan({ run, plan: { steps: [{ id: "s1", product: "tavily-web-search", input: { query: "pre-seed fintech accelerators" } }] }, catalog, wallet, emit: () => {} });
  assert.equal(Math.round(spent * 1e6) / 1e6, 0.0525);
  assert.deepEqual(run.steps[0].payment, { priceUsd: 0.05, tx: "0x73ea", payTo: "0xpay", delivered: false });
  const L = ledgerOf(run.steps, 0.94, 0.8875);
  assert.equal(L.spentUsd, 0.0525);
  assert.equal(L.undeliveredUsd, 0.05);
  assert.equal(L.walletChangeUsd, L.spentUsd, "the ledger and the wallet agree");
  assert.equal(L.receipts[0].delivered, false);
});

test("fault 4: paymentOf reads a success, a paid failure and a refusal", () => {
  assert.deepEqual(paymentOf({ ok: true, data: { data: { paymentTx: "0xa", amountUSD: 0.01 } }, payTo: "0xp" }), { priceUsd: 0.01, tx: "0xa", payTo: "0xp" });
  assert.deepEqual(paymentOf({ ok: false, priceUsd: 0.05, data: { paid: true, paymentReusable: true, paymentTx: "0x79" } }), { priceUsd: 0.05, tx: "0x79", payTo: undefined, delivered: false, reusable: true });
  assert.equal(paymentOf({ ok: false, data: { paid: false, reason: "breaker_open" } }), null);
});

/* 5. Tavily's own written answer was cited as a source, with the shop's URL. */
test("fault 5: a search's own written answer is kept marked, never with the shop's URL, and never read for quotes", () => {
  const product = catalog.byId["tavily-web-search"];
  const docs = docsFrom(product, itemsOf("tavily-web-search", tavily), tavily, 1).map((d, j) => ({ ...d, id: `S1.${j + 1}` }));
  const answer = docs.filter((d) => d.generated);
  assert.equal(answer.length, 1);
  assert.equal(answer[0].url, null);
  assert.ok(docs.every((d) => !String(d.url).includes("/api/sippar/sell")), "no document links to the shop");
  assert.ok(pickDocs(docs, 50).every((d) => !d.generated));
  // grounded-search: each citation is a page (its title and link); the written answer is kept marked and not read.
  const g = docsFrom(catalog.byId["grounded-search"], itemsOf("grounded-search", grounded), grounded, 2).map((d, j) => ({ ...d, id: `S2.${j + 1}` }));
  assert.deepEqual(g.map((d) => !!d.generated), [...grounded.citations.map(() => false), true]);
  assert.ok(g.filter((d) => !d.generated).every((d) => /^https?:\/\//.test(d.url)));
  assert.equal(pickDocs(g, 24).length, grounded.citations.length);
});

/* 7. Six searches gave 126 documents and only the first 24 in order were read. */
test("fault 7: the documents read are spread over every step that delivered", () => {
  const docs = [];
  for (let n = 1; n <= 6; n++) for (let j = 1; j <= 21; j++) docs.push({ id: `S${n}.${j}`, generated: j === 21 });
  const read = pickDocs(docs, 24);
  assert.equal(read.length, 24);
  for (let n = 1; n <= 6; n++) assert.equal(read.filter((d) => d.id.startsWith(`S${n}.`)).length, 4, `step ${n}`);
  assert.deepEqual(read.slice(0, 7).map((d) => d.id), ["S1.1", "S2.1", "S3.1", "S4.1", "S5.1", "S6.1", "S1.2"]);
});

/* 3. Search hits were written up as Google's top results. */
test("fault 3: Google's results are readable, each with its place; a ranking question is recognised", () => {
  const items = itemsOf("sippar-web-search", google);
  assert.equal(items.length, google.response.results.length);
  const docs = docsFrom(catalog.byId["sippar-web-search"], items, google, 1);
  assert.deepEqual(docs.map((d) => d.rank), items.filter((it) => `${it.title}. ${it.description}`.length >= 20).map((it) => it.position));
  assert.ok(docs.every((d) => /^https:\/\//.test(d.url)));
  assert.ok(asksRanking("what do the pages that currently rank top in Google for this keyword cover"));
  assert.ok(!asksRanking("Which accelerators best fit a pre-seed fintech startup?"));
  const plan = { steps: [{ id: "s1", product: "sippar-web-search", input: { query: "agent payments" } }, { id: "s2", move: "rank", from: ["s1"], args: { by: "position", order: "asc" } }, { id: "s3", move: "top", from: ["s2"], args: { n: 5 } }] };
  assert.ok(checkPlan(plan, catalog.shelf, 0.3).ok);
});

test("fault 8: plan B asks the same words only, of a search that is not down", () => {
  const down = new Set(["sippar-web-search"]);
  const b = planBFor("tavily-web-search", { query: "q", max_results: 20, topic: "news" }, catalog, down);
  assert.deepEqual([b.product.id, b.input], ["grounded-search", { query: "q" }]);
  assert.equal(planBFor("tavily-web-search", { url: "x" }, catalog, new Set()), null, "no words, no plan B");
  assert.equal(planBFor("paper-search", { query: "q" }, catalog, new Set()), null, "only web searches stand in for each other");
});

/* Found by the check brief after the deploy (2026-11-07 19:36 UTC): five paid page reads gave nothing. */
test("a page read whole by Sippar's Apify reader is a page: its text and its own link", () => {
  const page = fx("paid/web-content-apify.json");
  const items = itemsOf("web-content", page);
  assert.equal(items.length, 1);
  const docs = docsFrom(catalog.byId["web-content"], items, page, 3);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].generated, undefined, "a page is not a written summary");
  assert.match(docs[0].url, /^https:\/\//);
  assert.ok(docs[0].text.length > 200);
});

test("when the step reading a search delivers nothing, the search itself is read", async () => {
  doors = {
    "google-results": { probe: () => offer(0.0025), paid: () => delivered(google, "0xg", 0.0025) },
    "web-content": { probe: () => offer(0.0035), paid: () => delivered({ content: { results: [] } }, "0xw", 0.0035) },
  };
  const run = run0();
  await runCatalogPlan({ run, plan: { steps: [
    { id: "s1", product: "sippar-web-search", input: { query: "agent payments" } },
    { id: "s2", move: "for_each", from: ["s1"], args: { product: "web-content", input: { url: "{{item.url}}" }, max: 3 } },
  ] }, catalog, wallet, emit: () => {} });
  assert.equal(run.steps.find((s) => s.id === "s2").items, 0);
  assert.ok(run.readDocIds.length > 0 && run.readDocIds.every((id) => id.startsWith("S1.")), run.readDocIds.join(" "));
});
