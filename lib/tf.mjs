// NVIDIA Nemotron for Nuru's own model calls (OpenAI-compatible APIs), from the first provider that answers.
//
// Providers, in order; one without the key it needs is skipped. The playground runs free first (Elad, 2026-10-30: free
// Nemotron for users as a trial of the service): Ultra calls (plan, write) try BlockRun's free Ultra first, and Super calls
// (reading each source) try Nebius Token Factory first, since BlockRun has no free Super. NEMOTRON_PROVIDERS sets the
// Ultra order (default "blockrun,tokenfactory,openrouter"), NEMOTRON_PROVIDERS_SUPER the Super order (default
// "tokenfactory,openrouter,blockrun").
//   tokenfactory  Nebius Token Factory, paid, needs NEBIUS_API_KEY.
//   blockrun      BlockRun's free NVIDIA Nemotron 3 Ultra, no account and no key (blockrun.ai/api/v1).
//   openrouter    OpenRouter's free Nemotron (":free" ids), needs OPENROUTER_API_KEY.
// With no key at all, Nuru runs on BlockRun's free Nemotron. A provider that errors, times out, or answers from a model
// that is not Nemotron (BlockRun silently swaps a retired free id for another live model) is passed over for the next.
// The free routes run on NVIDIA's own hosted endpoint; NVIDIA's API Trial Terms govern it.
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 180000);

export const MODELS = {
  planner: process.env.PLANNER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
  worker: process.env.WORKER_MODEL || "nvidia/nemotron-3-super-120b-a12b",
  writer: process.env.WRITER_MODEL || "nvidia/Nemotron-3-Ultra-550b-a55b",
};

const isUltra = (m) => /ultra/i.test(m);
/** Each provider: where it is, the key it needs, and its own id for a Nuru model (Ultra or Super). */
export const PROVIDERS = {
  tokenfactory: {
    base: () => process.env.TOKEN_FACTORY_BASE_URL || "https://api.tokenfactory.nebius.com/v1",
    key: () => process.env.NEBIUS_API_KEY,
    needsKey: true,
    id: (m) => m,
    schema: true,
  },
  blockrun: {
    base: () => process.env.BLOCKRUN_BASE_URL || "https://blockrun.ai/api/v1",
    key: () => undefined,
    needsKey: false,
    // BlockRun's free tier has Nemotron 3 Ultra but no Super: Super's calls go to Ultra there.
    id: () => "nvidia/nemotron-3-ultra-550b",
    schema: false,
  },
  openrouter: {
    base: () => process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    key: () => process.env.OPENROUTER_API_KEY,
    needsKey: true,
    id: (m) => (isUltra(m) ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "nvidia/nemotron-3-super-120b-a12b:free"),
    schema: false,
  },
};

/** The providers to try for this model, in order: the configured list, less any that needs a key it does not have. */
export function providerOrder(model = MODELS.planner, env = process.env) {
  const list = isUltra(model) ? env.NEMOTRON_PROVIDERS || "blockrun,tokenfactory,openrouter" : env.NEMOTRON_PROVIDERS_SUPER || "tokenfactory,openrouter,blockrun";
  const names = String(list).split(",").map((s) => s.trim()).filter((s) => PROVIDERS[s]);
  return names.filter((n) => !PROVIDERS[n].needsKey || PROVIDERS[n].key());
}

export const usage = { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {}, byProvider: {} };

export async function listModels() {
  const p = PROVIDERS[providerOrder(MODELS.planner)[0]];
  const r = await fetch(`${p.base()}/models`, { headers: p.key() ? { Authorization: `Bearer ${p.key()}` } : {} });
  if (!r.ok) throw new Error(`models: ${r.status} ${await r.text()}`);
  return (await r.json()).data.map((m) => m.id);
}

// One chat call, from the first provider that answers. With a schema, the answer is constrained JSON where the provider
// supports it, and parsed here either way.
export async function chat(model, messages, { schema, json = false, maxTokens = 4000, temperature = 0.2 } = {}) {
  const order = providerOrder(model);
  if (!order.length) throw new Error("no Nemotron provider: set NEMOTRON_PROVIDERS to include blockrun, or set NEBIUS_API_KEY or OPENROUTER_API_KEY");
  const failures = [];
  for (const name of order) {
    const p = PROVIDERS[name], id = p.id(model);
    const body = { model: id, messages, max_tokens: maxTokens, temperature };
    // Only Token Factory is sent a response format; the free routes are asked in the prompt and parsed here.
    if (schema && p.schema) body.response_format = { type: "json_schema", json_schema: { name: "out", strict: true, schema } };
    else if (json && p.schema) body.response_format = { type: "json_object" };
    const started = Date.now();
    let text;
    try {
      const r = await fetch(`${p.base()}/chat/completions`, {
        method: "POST",
        headers: { ...(p.key() ? { Authorization: `Bearer ${p.key()}` } : {}), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      text = await r.text();
      if (!r.ok) { failures.push(`${name} ${id}: ${r.status} ${text.slice(0, 160)}`); continue; }
    } catch (e) {
      failures.push(`${name} ${id}: ${e?.name || e}`);
      continue;
    }
    let j;
    try { j = JSON.parse(text); } catch { failures.push(`${name} ${id}: an answer that is not JSON`); continue; }
    // The model that actually answered must be a Nemotron (BlockRun redirects a retired free id to another model).
    if (typeof j.model === "string" && j.model && !/nemotron/i.test(j.model)) { failures.push(`${name} ${id}: answered by ${j.model}, not Nemotron`); continue; }
    const u = j.usage || {};
    usage.calls++;
    usage.inputTokens += u.prompt_tokens || 0;
    usage.outputTokens += u.completion_tokens || 0;
    const m = (usage.byModel[model] ||= { calls: 0, inputTokens: 0, outputTokens: 0 });
    m.calls++; m.inputTokens += u.prompt_tokens || 0; m.outputTokens += u.completion_tokens || 0;
    const pv = (usage.byProvider[name] ||= { calls: 0, models: [] });
    pv.calls++; if (!pv.models.includes(j.model || id)) pv.models.push(j.model || id);
    const content = j.choices?.[0]?.message?.content ?? "";
    const served = { provider: name, model: j.model || id };
    if (!schema && !json) return { content, ms: Date.now() - started, served };
    return { json: parseJsonObject(content), ms: Date.now() - started, served };
  }
  throw new Error(`${model}: no Nemotron provider answered (${failures.join("; ")})`);
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
