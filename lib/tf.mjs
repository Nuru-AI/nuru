// NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible API).
const BASE = process.env.TOKEN_FACTORY_BASE_URL || "https://api.tokenfactory.nebius.com/v1";

export const MODELS = {
  planner: process.env.PLANNER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
  worker: process.env.WORKER_MODEL || "nvidia/nemotron-3-super-120b-a12b",
  writer: process.env.WRITER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
};

export const usage = { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} };

function key() {
  const k = process.env.NEBIUS_API_KEY;
  if (!k) throw new Error("NEBIUS_API_KEY is not set");
  return k;
}

export async function listModels() {
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key()}` } });
  if (!r.ok) throw new Error(`models: ${r.status} ${await r.text()}`);
  return (await r.json()).data.map((m) => m.id);
}

// One chat call. With a schema, the answer is constrained JSON and parsed here.
export async function chat(model, messages, { schema, maxTokens = 4000, temperature = 0.2 } = {}) {
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
  const started = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${model}: ${r.status} ${text.slice(0, 400)}`);
  const j = JSON.parse(text);
  const u = j.usage || {};
  usage.calls++;
  usage.inputTokens += u.prompt_tokens || 0;
  usage.outputTokens += u.completion_tokens || 0;
  const m = (usage.byModel[model] ||= { calls: 0, inputTokens: 0, outputTokens: 0 });
  m.calls++; m.inputTokens += u.prompt_tokens || 0; m.outputTokens += u.completion_tokens || 0;
  const content = j.choices?.[0]?.message?.content ?? "";
  if (!schema) return { content, ms: Date.now() - started };
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return { json: JSON.parse(cleaned), ms: Date.now() - started };
}
