// lib/pay.mjs paidPostAsync: a slow product bought async, its payment header kept, its answer collected; never paid
// above the price allowed. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
const { paidPostAsync } = await import("../lib/pay.mjs");
const { jobWords } = await import("../lib/agent.mjs");

const offer = (usd) => new Response(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: String(Math.round(usd * 1e6)), payTo: "0xpay" }] }), { status: 402 });
// The x402 client's behaviour, as @x402/fetch does it: it sends one Request with PAYMENT-SIGNATURE set.
const wallet = { wrap: (f) => async (url, init) => { const r = new Request(url, init); r.headers.set("PAYMENT-SIGNATURE", "SIGNED-PAYLOAD"); return f(r); } };

test("bought async: the 202, then collected with the exact payment header that paid", async () => {
  const seen = [];
  const fetchImpl = async (input, init) => {
    const r = input instanceof Request ? input : new Request(input, init);
    seen.push({ url: r.url, prefer: r.headers.get("Prefer"), sig: r.headers.get("PAYMENT-SIGNATURE") });
    if (r.url.endsWith("/collect")) return seen.filter((x) => x.url.endsWith("/collect")).length < 2
      ? new Response(JSON.stringify({ status: "running" }), { status: 409 })
      : new Response(JSON.stringify({ success: true, data: { result: { text: "{\"steps\":[]}", model: "nemotron-3-ultra-free", seller: "Dark Signal" }, paymentTx: "0xtx" } }), { status: 200 });
    if (!r.headers.get("PAYMENT-SIGNATURE")) return offer(0.1);
    return new Response(JSON.stringify({ accepted: true, paymentTx: "0xtx", amountUSD: 0.1, settlementKey: "k", collect: { collectUrl: "https://door.test/sell/workflow-planner/collect" } }), { status: 202 });
  };
  const bodies = [];
  const keepBody = async (input, init) => { const r = input instanceof Request ? input : new Request(input, init); if (r.headers.get("PAYMENT-SIGNATURE") && !r.url.endsWith("/collect")) bodies.push(await r.clone().json()); return fetchImpl(r); };
  const r = await paidPostAsync(wallet, "https://door.test/sell/workflow-planner", { query: "x", budget: "0.20" }, { bodyForPrice: (p) => ({ query: "x", budget: (0.30 - p).toFixed(2) }), maxPriceUsd: 0.2, everyMs: 0, fetchImpl: keepBody, sleep: async () => {} });
  assert.equal(bodies[0].budget, "0.20", "the paid request carries the budget left after the quoted price");
  assert.equal(r.ok, true);
  assert.equal(r.collected, true);
  assert.equal(r.priceUsd, 0.1);
  assert.equal(r.tx, "0xtx");
  assert.equal(r.data.data.result.seller, "Dark Signal");
  assert.equal(seen[1].prefer, "respond-async");
  assert.ok(seen.filter((x) => x.url.endsWith("/collect")).every((x) => x.sig === "SIGNED-PAYLOAD"));
});

test("refused before paying when the price asked is over the cap", async () => {
  let paidCalls = 0;
  const fetchImpl = async (input) => { if ((input instanceof Request ? input : null)?.headers.get("PAYMENT-SIGNATURE")) paidCalls++; return offer(0.5); };
  const r = await paidPostAsync(wallet, "https://door.test/sell/workflow-planner", {}, { maxPriceUsd: 0.2, fetchImpl, sleep: async () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.equal(paidCalls, 0);
});

test("a few words naming the job, for the skills search", () => {
  assert.equal(jobWords("What should be the target audience for sippar.network?"), "target audience sippar network");
  assert.equal(jobWords("How are publishers getting paid when AI agents read their articles?"), "publishers getting paid agents read articles");
  assert.equal(jobWords("?"), "web research");
});
