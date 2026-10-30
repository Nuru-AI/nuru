// NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible API).
const BASE = process.env.TOKEN_FACTORY_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
// A model call that never returns must not hold the run (or the page) forever.
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

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
export async function chat(model, messages, { schema, json = false, maxTokens = 4000, temperature = 0.2 } = {}) {
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
  else if (json) body.response_format = { type: "json_object" };
  const started = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
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
  if (!schema && !json) return { content, ms: Date.now() - started };
  return { json: parseJsonObject(content), ms: Date.now() - started };
}

// A reasoning model sometimes writes its thoughts before the JSON object it was asked for, or wraps it in a code
// fence. Take the outermost {...} and nothing else.
export function parseJsonObject(content) {
  const noThink = String(content).replace(/<think>[\s\S]*?<\/think>/gi, "");
  const cleaned = noThink.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error(`no JSON object in the answer: ${cleaned.slice(0, 80)}`);
  return JSON.parse(cleaned.slice(a, b + 1));
}
