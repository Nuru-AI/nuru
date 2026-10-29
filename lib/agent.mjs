// One Nuru run: the model plans, the wallet buys, the model reads, code checks, the model writes.
//
// Two planners. PLANNER=catalog (the default): the model writes a plan over a live catalog (paid steps plus code
// moves), code corrects a one-letter-off id, checks the plan against the shelf and the budget, and runs it; any
// marketplace that feeds Nuru a catalog works. PLANNER=fixed (the fallback, and what runs when the catalog cannot be
// read or the plan fails its check twice): the model picks from the closed list in tools.mjs.
import { chat, MODELS, usage } from "./tf.mjs";
import { TOOLS, toolMenu } from "./tools.mjs";
import { paidPost } from "./pay.mjs";
import { loadCatalog } from "./catalog.mjs";
import { PLAN_RULES, RESULT_SHAPES, correctPlanIds, checkPlan, itemsOf, runMove, forEachInputs } from "./planner.mjs";

const MAX_STEPS = Number(process.env.MAX_STEPS || 6);
const MAX_SPEND_USD = Number(process.env.MAX_SPEND_USD || 0.5);
const MAX_DOCS = Number(process.env.MAX_DOCS || 24);
const PLANNER = process.env.PLANNER || "catalog";

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["steps"],
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["tool", "input", "why"],
        properties: {
          tool: { type: "string", enum: Object.keys(TOOLS) },
          input: {
            type: "object", additionalProperties: false, required: ["query", "url"],
            properties: { query: { type: "string" }, url: { type: "string" } },
          },
          why: { type: "string" },
        },
      },
    },
  },
};

const CLAIMS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["claim", "quote"],
        properties: { claim: { type: "string" }, quote: { type: "string" } },
      },
    },
  },
};

const BRIEF_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "summary", "points", "gaps"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
      },
    },
    gaps: { type: "array", items: { type: "string" } },
  },
};

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const RAIL = "x402, USDC on Base";

/** The documents a product's items give the reading stage: a title, a link, and the item's text fields joined. */
function docsFrom(product, items, result, stepN) {
  const shape = RESULT_SHAPES[product.id];
  const docs = [];
  if (!shape) {
    // No recorded shape: the whole result is one document, so a quote can still be checked against it.
    const text = JSON.stringify(result).slice(0, 12000);
    if (text.length > 20) docs.push({ title: product.name, url: product.url, text, publisher: product.name });
    return docs;
  }
  const kinds = shape.fields;
  for (const it of items) {
    const link = Object.entries(kinds).find(([f, k]) => k === "link" && typeof it[f] === "string" && it[f]);
    const textParts = Object.entries(kinds).filter(([f, k]) => (k === "text" || k === "body") && typeof it[f] === "string" && it[f].trim()).map(([f]) => it[f].trim());
    const title = it.title || it.name || it.full_name || it.job_title || it.symbol || it.prompt || product.name;
    const text = textParts.join(". ");
    if (text.length < 20) continue;
    docs.push({ title: String(title).slice(0, 200), url: link ? it[link[0]] : product.url, text: text.slice(0, 12000), publisher: it.source_name || it.publisher || it.subreddit || product.name, date: it.publishedAt || it.published_datetime_utc || it.created_at || it.date });
  }
  return docs;
}

async function buy(wallet, product, input, step) {
  const r = await paidPost(wallet, product.url, input);
  const d0 = r.data?.data || {};
  const payment = { priceUsd: d0.amountUSD ?? r.priceUsd, tx: d0.paymentTx || r.receipt?.transaction || null, payTo: r.payTo };
  if (payment.tx) step.payment = payment;
  if (!r.ok) throw new Error(`${product.sellId}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
  const result = d0.result ?? d0;
  return { result, payment };
}

/** Plan over the catalog with the model, correct a one-letter-off id in code, check in code; one retry with the
 *  check's errors; null when the plan still fails. */
async function planOverCatalog({ question, reader, catalog, emit }) {
  const system = `${PLAN_RULES}\n\nTHE CATALOG (each product's shelf id, live price, inputs, and the fields of its items):\n${catalog.sheet}\n\nBUDGET: at most $${MAX_SPEND_USD.toFixed(2)} for the paid steps.`;
  const messages = [{ role: "system", content: system }, { role: "user", content: `Request: ${question}\nThe answer is for: ${reader}.\nWrite the plan as the one JSON object the rules ask for.` }];
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chat(MODELS.planner, messages, { json: true, maxTokens: 9000 });
    const { plan, corrections } = correctPlanIds(r.json, catalog.shelf);
    const check = checkPlan(plan, catalog.shelf, MAX_SPEND_USD);
    last = { plan, corrections, check, attempt, ms: r.ms };
    emit("plan:check", { attempt, ok: check.ok, errors: check.errors, warnings: check.warnings, corrections, costUSD: check.costUSD, calls: check.calls });
    if (check.ok) return last;
    messages.push({ role: "assistant", content: JSON.stringify(r.json) }, { role: "user", content: `The plan failed the code check:\n${check.errors.map((e) => `- ${e}`).join("\n")}\nWrite a corrected plan as one JSON object and nothing else.` });
  }
  return null;
}

async function runCatalogPlan({ run, plan, catalog, wallet, emit }) {
  const itemsByStep = new Map(), kindsByStep = new Map();
  let spent = 0;
  const canSpend = (p, times = 1) => spent + p.priceUSD * times <= MAX_SPEND_USD + 1e-9;
  for (const s of plan.steps) {
    const n = run.steps.length + 1;
    if (s.product) {
      const p = catalog.byId[s.product];
      const step = { n, id: s.id, tool: s.product, input: s.input ?? {}, why: s.why, seller: p.name, rail: RAIL };
      run.steps.push(step);
      if (!canSpend(p)) { step.skipped = "run spend ceiling reached"; emit("step:skip", { step }); itemsByStep.set(s.id, []); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {}); continue; }
      emit("step:start", { step });
      try {
        const t0 = Date.now();
        const { result, payment } = await buy(wallet, p, s.input ?? {}, step);
        step.ms = Date.now() - t0; step.payment = payment; spent += payment.priceUsd || 0;
        const items = itemsOf(p.id, result);
        step.items = items.length;
        step.documents = docsFrom(p, items, result, n).map((d, j) => ({ id: `S${n}.${j + 1}`, ...d }));
        itemsByStep.set(s.id, items); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {});
        emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
      } catch (e) {
        step.error = String(e.message || e).slice(0, 300); spent += step.payment?.priceUsd || 0;
        itemsByStep.set(s.id, []); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {});
        emit("step:error", { step });
      }
      continue;
    }
    // A code move. Nothing is bought, except for_each, which buys one product per item.
    const from = Array.isArray(s.from) ? s.from : [];
    const inputs = from.map((id) => itemsByStep.get(id) ?? []);
    const kinds = Object.assign({}, ...from.map((id) => kindsByStep.get(id) ?? {}));
    if (s.move === "for_each") {
      const p = catalog.byId[s.args?.product];
      const calls = forEachInputs(s, inputs.flat());
      const step = { n, id: s.id, tool: `for each: ${s.args?.product}`, input: s.args?.input ?? {}, why: s.why, seller: p?.name ?? "", rail: RAIL, calls: calls.length };
      run.steps.push(step);
      emit("step:start", { step });
      const items = [], documents = [];
      let bought = 0, priceUsd = 0, txs = [];
      for (const input of calls) {
        if (!p || !canSpend(p)) break;
        try {
          const sub = {};
          const { result, payment } = await buy(wallet, p, input, sub);
          spent += payment.priceUsd || 0; bought++; priceUsd += payment.priceUsd || 0; if (payment.tx) txs.push(payment.tx);
          const its = itemsOf(p.id, result);
          items.push(...its);
          documents.push(...docsFrom(p, its, result, n));
        } catch (e) { step.error = String(e.message || e).slice(0, 200); }
      }
      step.bought = bought; step.items = items.length;
      if (bought) step.payment = { priceUsd: Math.round(priceUsd * 1e6) / 1e6, tx: txs[0] || null, txs };
      step.documents = documents.map((d, j) => ({ id: `S${n}.${j + 1}`, ...d }));
      itemsByStep.set(s.id, items); kindsByStep.set(s.id, RESULT_SHAPES[p?.id]?.fields ?? {});
      emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
      continue;
    }
    const step = { n, id: s.id, tool: `code: ${s.move}`, input: s.args ?? {}, why: s.why, seller: "code, no charge", rail: "none" };
    run.steps.push(step);
    emit("step:start", { step });
    const items = runMove(s, inputs, kinds);
    step.items = items.length;
    itemsByStep.set(s.id, items); kindsByStep.set(s.id, kinds);
    emit("step:done", { step });
  }
  return spent;
}

async function runFixedPlan({ run, question, reader, wallet, emit }) {
  emit("plan:start", { model: MODELS.planner, mode: "fixed" });
  const plan = await chat(MODELS.planner, [
    { role: "system", content:
      `You plan research for ${reader}. Choose up to ${MAX_STEPS} steps from these sources only:\n${toolMenu()}\n` +
      `Every step has input {query, url}: fill the one the source needs and leave the other "". ` +
      `Prefer a mix: web search for the overview, papers for evidence, news for what changed recently, Dataconomy for industry analysis. ` +
      `read_page and dataconomy_article need a real URL, so only use them with a URL you already know; otherwise search.` },
    { role: "user", content: question },
  ], { schema: PLAN_SCHEMA, maxTokens: 1500 });
  const steps = plan.json.steps.filter((s) => TOOLS[s.tool]).slice(0, MAX_STEPS);
  run.plan = { mode: "fixed", steps };
  emit("plan:done", { steps, ms: plan.ms, mode: "fixed" });

  let spent = 0;
  const runTool = async (tool, input, why) => {
    const step = { n: run.steps.length + 1, tool, input, why, seller: TOOLS[tool].seller, rail: TOOLS[tool].rail };
    run.steps.push(step);
    if (spent >= MAX_SPEND_USD) { step.skipped = "run spend ceiling reached"; emit("step:skip", { step }); return; }
    emit("step:start", { step });
    try {
      const t0 = Date.now();
      const out = await TOOLS[tool].run(wallet, input, (payment) => { step.payment = payment; });
      step.ms = Date.now() - t0; step.payment = out.payment; spent += out.payment?.priceUsd || 0;
      step.documents = out.documents.filter((d) => d.text).map((d, j) => ({ id: `S${step.n}.${j + 1}`, ...d }));
      emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
    } catch (e) {
      step.error = String(e.message || e).slice(0, 300); spent += step.payment?.priceUsd || 0;
      emit("step:error", { step });
    }
  };
  for (const s of steps) await runTool(s.tool, s.input, s.why);
  const dcSearch = run.steps.find((s) => s.tool === "dataconomy_search" && s.documents?.length);
  if (dcSearch && !run.steps.some((s) => s.tool === "dataconomy_article") && spent < MAX_SPEND_USD) {
    await runTool("dataconomy_article", { query: "", url: dcSearch.documents[0].url }, "Read the most relevant Dataconomy article in full");
  }
  return spent;
}

export async function research({ question, reader = "a researcher", wallet, onEvent = () => {} }) {
  const run = { question, reader, startedAt: new Date().toISOString(), models: MODELS, steps: [], claims: [], events: [] };
  const emit = (type, data) => { const e = { t: Date.now(), type, ...data }; run.events.push(e); onEvent(e); };
  run.walletAddress = wallet.address;
  run.balanceBefore = await wallet.balance().catch(() => null);

  // 1. Plan. Over the live catalog when it can be read and the plan passes the code check; else the fixed list.
  let planned = null, catalog = null;
  if (PLANNER === "catalog") {
    try {
      catalog = await loadCatalog();
      emit("plan:start", { model: MODELS.planner, mode: "catalog", products: catalog.products.length, readable: catalog.readable });
      planned = await planOverCatalog({ question, reader, catalog, emit });
      if (planned) {
        run.plan = { mode: "catalog", summary: planned.plan.summary, ask_first: planned.plan.ask_first, answer: planned.plan.answer, steps: planned.plan.steps, check: planned.check, corrections: planned.corrections, attempts: planned.attempt };
        emit("plan:done", { mode: "catalog", summary: planned.plan.summary, steps: planned.plan.steps.map((s, k) => ({ n: k + 1, id: s.id, tool: s.product || `code: ${s.move}`, input: s.product ? s.input : s.args, why: s.why, seller: s.product ? catalog.byId[s.product]?.name : "code, no charge" })), costUSD: planned.check.costUSD, calls: planned.check.calls, corrections: planned.corrections, ms: planned.ms });
      } else {
        emit("plan:refused", { reason: "the plan failed the code check twice; falling back to the fixed list" });
      }
    } catch (e) {
      emit("plan:error", { error: String(e.message || e).slice(0, 300), fallback: "fixed" });
      planned = null;
    }
  }

  // 2. Buy and read.
  if (planned) await runCatalogPlan({ run, plan: planned.plan, catalog, wallet, emit });
  else await runFixedPlan({ run, question, reader, wallet, emit });

  // 3. Extract quotable claims per document (Nemotron Super). A claim counts only if its
  //    quote is found word for word in the document the wallet paid for.
  const docs = run.steps.flatMap((s) => s.documents || []).slice(0, MAX_DOCS);
  emit("read:start", { documents: docs.length, model: MODELS.worker });
  await Promise.all(docs.map(async (d) => {
    try {
      const r = await chat(MODELS.worker, [
        { role: "system", content: "Pull up to 3 factual claims relevant to the question from the document. For each, give the claim and an exact quote copied character for character from the document that supports it. If nothing is relevant, return no claims." },
        { role: "user", content: `Question: ${question}\n\nDocument (${d.publisher}, ${d.title}):\n${d.text.slice(0, 8000)}` },
      ], { schema: CLAIMS_SCHEMA, maxTokens: 1600 });
      const body = norm(d.text);
      for (const c of r.json.claims) {
        const found = c.quote && body.includes(norm(c.quote));
        run.claims.push({ id: `C${run.claims.length + 1}`, doc: d.id, url: d.url, publisher: d.publisher, claim: c.claim, quote: c.quote, verified: !!found });
      }
    } catch (e) {
      emit("read:error", { doc: d.id, error: String(e.message || e).slice(0, 200) });
    }
  }));
  const verified = run.claims.filter((c) => c.verified);
  emit("read:done", { claims: run.claims.length, verified: verified.length });

  // 4. Write the brief (Nemotron Ultra) from verified claims only; code drops any citation
  //    that does not resolve and any point left with no evidence.
  emit("write:start", { model: MODELS.writer });
  const brief = await chat(MODELS.writer, [
    { role: "system", content:
      `Write a short brief for ${reader}: a summary under 80 words and at most 8 points, each under 35 words. Use only the evidence given; cite claim ids like C3 in each point's evidence list. ` +
      `Do not compute or invent numbers; repeat numbers only as they appear in the evidence. List what the evidence does not cover under gaps, in at most 4 short lines.` },
    { role: "user", content: `Question: ${question}\n\nEvidence:\n` + verified.map((c) => `${c.id} (${c.publisher}): ${c.claim} | quote: "${c.quote}"`).join("\n") },
  ], { schema: BRIEF_SCHEMA, maxTokens: 6000 });
  const ids = new Set(verified.map((c) => c.id));
  const points = brief.json.points
    .map((p) => ({ text: p.text, evidence: p.evidence.filter((e) => ids.has(e)), dropped: p.evidence.filter((e) => !ids.has(e)) }))
    .filter((p) => p.evidence.length);
  run.brief = { title: brief.json.title, summary: brief.json.summary, points, gaps: brief.json.gaps, unsupportedPointsRemoved: brief.json.points.length - points.length };
  emit("write:done", { points: points.length });

  // 5. The ledger, computed in code from what each step actually returned.
  const paid = run.steps.filter((s) => s.payment?.tx);
  const bySeller = {};
  for (const s of paid) bySeller[s.seller] = Math.round(((bySeller[s.seller] || 0) + s.payment.priceUsd) * 1e6) / 1e6;
  run.ledger = {
    paidReads: paid.reduce((a, s) => a + (s.bought || 1), 0),
    spentUsd: Math.round(paid.reduce((a, s) => a + s.payment.priceUsd, 0) * 1e6) / 1e6,
    bySeller,
    receipts: paid.map((s) => ({ step: s.n, seller: s.seller, priceUsd: s.payment.priceUsd, tx: s.payment.tx })),
  };
  run.nemotron = JSON.parse(JSON.stringify(usage));
  run.balanceAfter = await wallet.balance().catch(() => null);
  run.finishedAt = new Date().toISOString();
  emit("done", {});
  return run;
}
