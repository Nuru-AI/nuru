// lib/tf.mjs: Nemotron from the first provider that answers; a provider with no key is skipped; an answer from a model
// that is not Nemotron is passed over. Run with `npm test`.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const KEYS = ["NEBIUS_API_KEY", "OPENROUTER_API_KEY", "NEMOTRON_PROVIDERS", "NEMOTRON_PROVIDERS_SUPER"];
let saved, realFetch, calls;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); KEYS.forEach((k) => delete process.env[k]); realFetch = globalThis.fetch; calls = []; });
afterEach(() => { KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); globalThis.fetch = realFetch; });

const answer = (model, content = "hi") => new Response(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
const fake = (byHost) => { globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization }); return byHost(new URL(url).host, JSON.parse(init.body)); }; };
const { chat, providerOrder, MODELS } = await import("../lib/tf.mjs");

test("with no key at all, Nuru runs on BlockRun's free Nemotron, no Authorization header", async () => {
  assert.deepEqual(providerOrder(MODELS.planner), ["blockrun"]);
  assert.deepEqual(providerOrder(MODELS.worker), ["blockrun"]);
  fake(() => answer("nvidia/nemotron-3-ultra-550b-nim"));
  const r = await chat(MODELS.planner, [{ role: "user", content: "q" }]);
  assert.equal(r.served.provider, "blockrun");
  assert.equal(calls[0].body.model, "nvidia/nemotron-3-ultra-550b");
  assert.equal(calls[0].auth, undefined);
});

test("free first for Ultra, Token Factory first for Super (BlockRun has no free Super); each falls to the other", async () => {
  process.env.NEBIUS_API_KEY = "k";
  assert.deepEqual(providerOrder(MODELS.writer), ["blockrun", "tokenfactory"]);
  assert.deepEqual(providerOrder(MODELS.worker), ["tokenfactory", "blockrun"]);
  fake((host) => (host.includes("blockrun") ? new Response("429 daily capacity", { status: 429 }) : answer("nvidia/Nemotron-3-Ultra-550b-a55b", '{"a":1}')));
  const r = await chat(MODELS.writer, [{ role: "user", content: "q" }], { json: true });
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(r.served.provider, "tokenfactory");
  assert.equal(calls[0].body.response_format, undefined, "the free route is not sent a response format");
  assert.equal(calls[1].body.response_format.type, "json_object");
  fake(() => answer("nvidia/nemotron-3-super-120b-a12b"));
  assert.equal((await chat(MODELS.worker, [{ role: "user", content: "q" }])).served.provider, "tokenfactory");
});

test("an answer from a model that is not Nemotron is passed over", async () => {
  process.env.OPENROUTER_API_KEY = "o";
  fake((host) => (host.includes("blockrun") ? answer("deepseek/deepseek-v4-flash") : answer("nvidia/nemotron-3-ultra-550b-a55b:free")));
  const r = await chat(MODELS.planner, [{ role: "user", content: "q" }]);
  assert.equal(r.served.provider, "openrouter");
  assert.equal(calls[1].body.model, "nvidia/nemotron-3-ultra-550b-a55b:free");
});

test("a JSON step answered in prose by the free route passes to Token Factory (the first live playground brief)", async () => {
  process.env.NEBIUS_API_KEY = "k";
  fake((host) => (host.includes("blockrun") ? answer("nvidia/nemotron-3-ultra-550b-nim", "**Summary (74 words)**\n- Subscriptions provide durable direct revenue (C2).") : answer("nvidia/Nemotron-3-Ultra-550b-a55b", '{"title":"t"}')));
  const r = await chat(MODELS.writer, [{ role: "user", content: "q" }], { json: true });
  assert.deepEqual(r.json, { title: "t" });
  assert.equal(r.served.provider, "tokenfactory");
  assert.equal(calls.length, 2);
});

test("the order is configurable, and an all-fail run says why for each", async () => {
  process.env.NEMOTRON_PROVIDERS = "blockrun";
  fake(() => new Response("429 daily capacity", { status: 429 }));
  await assert.rejects(chat(MODELS.planner, [{ role: "user", content: "q" }]), /no Nemotron provider answered \(blockrun nvidia\/nemotron-3-ultra-550b: 429/);
});
