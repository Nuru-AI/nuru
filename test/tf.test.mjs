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
const { chat, providerOrder, MODELS, freeModels, sameModel, usage, resetUsage, DEFAULT_FREE_MODEL } = await import("../lib/tf.mjs");

test("the free models: BlockRun's $0 chat models that are available, the default first", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "cohere/north-mini-code", name: "North Mini Code", owned_by: "cohere", pricing: { input: 0, output: 0 }, categories: ["chat", "coding"] },
    { id: "openai/gpt-x", name: "Paid", pricing: { input: 1, output: 2 }, categories: ["chat"] },
    { id: "nvidia/off", name: "Off", pricing: { input: 0, output: 0 }, categories: ["chat"], available: false },
    { id: "nvidia/embed", name: "Embed", pricing: { input: 0, output: 0 }, categories: ["embedding"] },
    { id: DEFAULT_FREE_MODEL, name: "NVIDIA Nemotron 3 Ultra", owned_by: "nvidia", pricing: { input: 0, output: 0 }, categories: ["chat", "reasoning"] },
  ] }), { status: 200 });
  const list = await freeModels(Date.now() + 99 * 60_000);
  assert.deepEqual(list.map((m) => m.id), [DEFAULT_FREE_MODEL, "cohere/north-mini-code"]);
  assert.ok(sameModel("nvidia/nemotron-3-ultra-550b-nim", DEFAULT_FREE_MODEL) && !sameModel("deepseek/deepseek-v4-flash", "cohere/north-mini-code"));
});

test("a picked free model is tried first; it answers, and the run counts it under its own id", async () => {
  resetUsage();
  fake(() => answer("cohere/north-mini-code", '{"title":"t"}'));
  const r = await chat(MODELS.writer, [{ role: "user", content: "q" }], { json: true, pick: "cohere/north-mini-code" });
  assert.deepEqual(r.served, { provider: "blockrun", model: "cohere/north-mini-code" });
  assert.equal(calls[0].body.model, "cohere/north-mini-code");
  assert.deepEqual(Object.keys(usage.byModel), ["cohere/north-mini-code"]);
});

test("a picked model that fails or is swapped for another passes to the default Nemotron route", async () => {
  process.env.NEBIUS_API_KEY = "k";
  fake((host, body) => (body.model === "cohere/north-mini-code" ? answer("deepseek/deepseek-v4-flash", '{"a":1}') : answer("nvidia/nemotron-3-ultra-550b-nim", '{"a":2}')));
  const r = await chat(MODELS.planner, [{ role: "user", content: "q" }], { json: true, pick: "cohere/north-mini-code" });
  assert.deepEqual(r.json, { a: 2 });
  assert.equal(r.served.model, "nvidia/nemotron-3-ultra-550b-nim");
  assert.deepEqual(calls.map((c) => c.body.model), ["cohere/north-mini-code", "nvidia/nemotron-3-ultra-550b"]);
});

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
  await assert.rejects(chat(MODELS.planner, [{ role: "user", content: "q" }]), /no provider answered \(blockrun nvidia\/nemotron-3-ultra-550b: 429/);
});

test("an answer after the model's reasoning: the outer object closing last, not a sample in the reasoning", async () => {
  const { parseJsonObject } = await import("../lib/tf.mjs");
  const think = 'Here is a thinking process: the user wants {a title}. I will write {"title":"x"} soon.\n\n{"title":"Payroll","points":[{"text":"a","evidence":["C1"]}]}';
  assert.deepEqual(parseJsonObject(think), { title: "Payroll", points: [{ text: "a", evidence: ["C1"] }] });
  assert.deepEqual(parseJsonObject('thinking {x}\n```json\n{"steps":[{"id":"s1"}]}\n```\nDone.'), { steps: [{ id: "s1" }] });
  assert.throws(() => parseJsonObject("**Summary** no json here {not json}"), /no JSON object/);
});

test("the answer names who answered and who was passed over, for the page's 'took over' line", async () => {
  process.env.NEBIUS_API_KEY = "k";
  fake((host, body) => (body.model === "poolside/laguna-xs-2.1" ? answer("poolside/laguna-xs-2.1", "**Brief** not JSON") : answer("nvidia/Nemotron-3-Ultra-550b-a55b", '{"title":"t"}')));
  process.env.NEMOTRON_PROVIDERS = "tokenfactory";
  const r = await chat(MODELS.writer, [{ role: "user", content: "q" }], { json: true, pick: "poolside/laguna-xs-2.1" });
  assert.equal(r.served.provider, "tokenfactory");
  assert.match(r.served.passedOver[0], /^blockrun poolside\/laguna-xs-2\.1: no JSON object/);
});

test("valid JSON in the wrong shape passes to the next provider; the free route is told the shape", async () => {
  const { schemaMismatch } = await import("../lib/tf.mjs");
  const BRIEF = { type: "object", required: ["title", "points"], properties: { title: { type: "string" }, points: { type: "array", items: { type: "object", required: ["text", "evidence"], properties: { text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } } } } } };
  assert.equal(schemaMismatch({ title: "t", points: [{ text: "a", evidence: ["C1"] }] }, BRIEF), null);
  assert.match(schemaMismatch({ title: "t", points: [{ text: "a" }] }, BRIEF), /no "evidence"/);
  assert.match(schemaMismatch({ brief: {} }, BRIEF), /no "title"/);
  process.env.NEBIUS_API_KEY = "k";
  process.env.NEMOTRON_PROVIDERS = "tokenfactory";
  fake((host, body) => (body.model === "poolside/laguna-xs-2.1" ? answer("poolside/laguna-xs-2.1", '{"title":"t","points":[{"text":"a"}]}') : answer("nvidia/Nemotron-3-Ultra-550b-a55b", '{"title":"t","points":[{"text":"a","evidence":["C1"]}]}')));
  const r = await chat(MODELS.writer, [{ role: "user", content: "q" }], { schema: BRIEF, pick: "poolside/laguna-xs-2.1" });
  assert.equal(r.served.provider, "tokenfactory");
  assert.match(r.served.passedOver[0], /wrong shape .*no "evidence"/);
  assert.match(calls[0].body.messages.at(-1).content, /matching this JSON Schema/);
  assert.equal(calls[1].body.messages.at(-1).content, "q", "Token Factory gets the schema as a response format, not in the prompt");
});
