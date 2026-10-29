// One research run: Nemotron plans, the wallet buys, Nemotron reads, code checks, Nemotron writes.
import { chat, MODELS, usage } from "./tf.mjs";
import { TOOLS, toolMenu } from "./tools.mjs";

const MAX_STEPS = Number(process.env.MAX_STEPS || 6);
const MAX_SPEND_USD = Number(process.env.MAX_SPEND_USD || 0.5);

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

export async function research({ question, reader = "a researcher", wallet, onEvent = () => {} }) {
  const run = { question, reader, startedAt: new Date().toISOString(), models: MODELS, steps: [], claims: [], events: [] };
  const emit = (type, data) => { const e = { t: Date.now(), type, ...data }; run.events.push(e); onEvent(e); };
  run.walletAddress = wallet.address;
  run.balanceBefore = await wallet.balance().catch(() => null);

  // 1. Plan (Nemotron Ultra). The tool list is closed; code checks every step.
  emit("plan:start", { model: MODELS.planner });
  const plan = await chat(MODELS.planner, [
    { role: "system", content:
      `You plan research for ${reader}. Choose up to ${MAX_STEPS} steps from these sources only:\n${toolMenu()}\n` +
      `Every step has input {query, url}: fill the one the source needs and leave the other "". ` +
      `Prefer a mix: web search for the overview, papers for evidence, news for what changed recently, Dataconomy for industry analysis. ` +
      `read_page and dataconomy_article need a real URL, so only use them with a URL you already know; otherwise search.` },
    { role: "user", content: question },
  ], { schema: PLAN_SCHEMA, maxTokens: 1500 });
  const steps = plan.json.steps.filter((s) => TOOLS[s.tool]).slice(0, MAX_STEPS);
  emit("plan:done", { steps, ms: plan.ms });

  // 2. Buy and read each source; stop before the run's spend ceiling.
  let spent = 0;
  for (const [i, s] of steps.entries()) {
    const step = { n: i + 1, tool: s.tool, input: s.input, why: s.why, seller: TOOLS[s.tool].seller, rail: TOOLS[s.tool].rail };
    run.steps.push(step);
    if (spent >= MAX_SPEND_USD) { step.skipped = "run spend ceiling reached"; emit("step:skip", { step }); continue; }
    emit("step:start", { step });
    try {
      const t0 = Date.now();
      const out = await TOOLS[s.tool].run(wallet, s.input, (payment) => { step.payment = payment; });
      step.ms = Date.now() - t0;
      step.payment = out.payment;
      spent += out.payment?.priceUsd || 0;
      step.documents = out.documents.filter((d) => d.text).map((d, j) => ({ id: `S${i + 1}.${j + 1}`, ...d }));
      emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
    } catch (e) {
      step.error = String(e.message || e).slice(0, 300);
      spent += step.payment?.priceUsd || 0;
      emit("step:error", { step });
    }
  }

  // 2b. If a Dataconomy search found articles, buy the top one in full: the publisher is paid for that read.
  const dcSearch = run.steps.find((s) => s.tool === "dataconomy_search" && s.documents?.length);
  if (dcSearch && !run.steps.some((s) => s.tool === "dataconomy_article") && spent < MAX_SPEND_USD) {
    const top = dcSearch.documents[0];
    const step = { n: run.steps.length + 1, tool: "dataconomy_article", input: { query: "", url: top.url }, why: "Read the most relevant Dataconomy article in full", seller: TOOLS.dataconomy_article.seller, rail: TOOLS.dataconomy_article.rail };
    run.steps.push(step);
    emit("step:start", { step });
    try {
      const out = await TOOLS.dataconomy_article.run(wallet, step.input, (payment) => { step.payment = payment; });
      step.payment = out.payment; spent += out.payment?.priceUsd || 0;
      step.documents = out.documents.filter((d) => d.text).map((d, j) => ({ id: `S${step.n}.${j + 1}`, ...d }));
      emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
    } catch (e) {
      step.error = String(e.message || e).slice(0, 300); spent += step.payment?.priceUsd || 0;
      emit("step:error", { step });
    }
  }

  // 3. Extract quotable claims per document (Nemotron Super). A claim counts only if its
  //    quote is found word for word in the document the wallet paid for.
  const docs = run.steps.flatMap((s) => s.documents || []);
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
      `Write a short brief for ${reader}. Use only the evidence given; cite claim ids like C3 in each point's evidence list. ` +
      `Do not compute or invent numbers; repeat numbers only as they appear in the evidence. List what the evidence does not cover under gaps.` },
    { role: "user", content: `Question: ${question}\n\nEvidence:\n` + verified.map((c) => `${c.id} (${c.publisher}): ${c.claim} | quote: "${c.quote}"`).join("\n") },
  ], { schema: BRIEF_SCHEMA, maxTokens: 2500 });
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
    paidReads: paid.length,
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
