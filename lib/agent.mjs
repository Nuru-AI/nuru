// One Nuru run: the model plans, the wallet buys, the model reads, code checks, the model writes.
//
// Two planners. PLANNER=catalog (the default): the model writes a plan over a live catalog (paid steps plus code
// moves), code corrects a one-letter-off id, checks the plan against the shelf and the budget, and runs it; any
// marketplace that feeds Nuru a catalog works. PLANNER=fixed (the fallback, and what runs when the catalog cannot be
// read or the plan fails its check twice): the model picks from the closed list in tools.mjs.
import { chat, MODELS, usage, resetUsage, parseJsonObject } from "./tf.mjs";
import { TOOLS, toolMenu } from "./tools.mjs";
import { paidPost, paidPostAsync, paymentOf } from "./pay.mjs";
import { loadCatalog, SELL } from "./catalog.mjs";
import { PLAN_RULES, RESULT_SHAPES, correctPlanIds, checkPlan, itemsOf, runMove, forEachInputs } from "./planner.mjs";
import { callFree, FREE_CALLS_PER_RUN, FREE_FOR_EACH_MAX } from "./free.mjs";

const MAX_STEPS = Number(process.env.MAX_STEPS || 6);
const MAX_SPEND_USD = Number(process.env.MAX_SPEND_USD || 0.5);
const MAX_DOCS = Number(process.env.MAX_DOCS || 24);
const PLANNER = process.env.PLANNER || "catalog";
// Who writes the catalog plan (Elad, 2026-10-30, "Use Sippar's workflow-planner"): "sippar" buys Sippar's skills-guided
// workflow-planner first and falls back to Nuru's own planner; "own" uses Nuru's planner only.
const PLAN_WITH = process.env.PLAN_WITH || "sippar";
const PLAN_MAX_PRICE_USD = Number(process.env.PLAN_MAX_PRICE_USD || 0.2);
/** The longest product sheet Sippar's workflow-planner takes (its PLANNER_MAX_SHEET_CHARS). */
const SIPPAR_SHEET_MAX = 60_000;

/** What every planner is told about how Nuru reads, so a plan buys only what reaches the brief (#7065). */
export const READING_NOTES = [
  `READING: at most ${MAX_DOCS} documents are read in all, shared evenly across the steps whose items reach the answer, so a search should ask for few results (max_results 5 or fewer); more are paid for and never read.`,
  "RANKING: only sippar-web-search returns Google's own results in Google's order (position). Use it when the job asks what ranks or shows up in Google; no other search is Google's ranking.",
  "WRITTEN ANSWERS: an item that holds only answer is the product's own written summary of pages. It is never quoted as a source; plan for results that carry text, or read pages with web-content.",
].join("\n");

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

/** Which document each item became, so a code move's kept items lead back to their documents (#6408). */
const DOC_OF = new WeakMap();
/** A step's documents, numbered in place (S3.1, S3.2, ...), so the item-to-document link holds. */
const withIds = (docs, n) => docs.map((d, j) => Object.assign(d, { id: `S${n}.${j + 1}` }));

/** The documents a product's items give the reading stage: a title, a link, and the item's text fields joined. */
export function docsFrom(product, items, result, stepN) {
  const shape = RESULT_SHAPES[product.id];
  const docs = [];
  if (!shape) {
    // No recorded shape: the whole result is one document, so a quote can still be checked against it.
    // Never the shop's own URL as a source link (#7065): the document is the data itself, bought from the product.
    const text = JSON.stringify(result).slice(0, 12000);
    if (text.length > 20) docs.push({ title: product.name, url: null, text, publisher: product.name, via: product.name });
    return docs;
  }
  const kinds = shape.fields;
  // A free source's item carries one code-written `text`; that alone is the document, so nothing is read twice.
  if (product.free) {
    for (const it of items) {
      if (typeof it.text !== "string" || it.text.length < 20) continue;
      const doc = { title: String(it.title || it.name || it.company || it.firm || product.name).slice(0, 200), url: it.url || product.url, text: it.text.slice(0, 12000), publisher: product.name, date: it.date || it.published || it.filed || it.reported || it.updated };
      docs.push(doc); DOC_OF.set(it, doc);
    }
    return docs;
  }
  const wholeKeys = new Set((shape.whole ?? []).map((w) => w.split(".").pop()));
  for (const it of items) {
    // A product's own written answer (Tavily's answer, grounded search's answer) is a model's summary of pages, not a
    // page. It is kept as a document, marked generated, and never read for quotes (#7065: a brief's point on LAUNCH
    // rested on Tavily's answer alone, cited with the shop's own URL).
    const keys = Object.keys(it);
    if (wholeKeys.size && keys.length && keys.every((k) => wholeKeys.has(k))) {
      const text = keys.map((k) => String(it[k] ?? "").trim()).filter(Boolean).join(". ");
      if (text.length >= 20) { const doc = { title: `${product.name}: its own written answer`, url: null, text: text.slice(0, 12000), publisher: product.name, via: product.name, generated: true }; docs.push(doc); DOC_OF.set(it, doc); }
      continue;
    }
    const link = Object.entries(kinds).find(([f, k]) => k === "link" && typeof it[f] === "string" && it[f]);
    const textParts = Object.entries(kinds).filter(([f, k]) => (k === "text" || k === "body") && typeof it[f] === "string" && it[f].trim()).map(([f]) => it[f].trim());
    const title = it.title || it.name || it.full_name || it.job_title || it.symbol || it.prompt || product.name;
    const text = textParts.join(". ");
    if (text.length < 20) continue;
    // A paper with no link field is linked by its DOI, else its PubMed id; an item with no link has none, never the shop's.
    const url = link ? it[link[0]] : typeof it.doi === "string" && it.doi ? `https://doi.org/${it.doi}` : it.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${it.pmid}/` : null;
    const doc = { title: String(title).slice(0, 200), url, text: text.slice(0, 12000), publisher: it.source_name || it.publisher || it.subreddit || product.name, via: product.name, date: it.publishedAt || it.published_datetime_utc || it.created_at || it.date || (it.year ? String(it.year) : undefined) };
    // Only Google's own results carry Google's order (#7065: search hits were written up as "the top results").
    if (product.id === "sippar-web-search" && Number.isFinite(it.position)) doc.rank = it.position;
    // A paper that came back without its abstract is read by its title alone; the brief says so (#6408).
    if (product.id === "paper-search" && !(typeof it.abstract === "string" && it.abstract.trim())) doc.titleOnly = true;
    docs.push(doc); DOC_OF.set(it, doc);
  }
  return docs;
}

async function buy(wallet, product, input, step) {
  const r = await paidPost(wallet, product.url, input);
  // A paid call the door could not complete moved money too: it goes on the step before the error (#7065).
  const payment = paymentOf(r);
  if (payment) step.payment = payment;
  if (!r.ok) throw Object.assign(new Error(`${product.sellId}: ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`), { status: r.status, reason: r.data?.reason });
  const d0 = r.data?.data || {};
  return { result: d0.result ?? d0, payment: payment || { priceUsd: 0, tx: null, payTo: r.payTo } };
}

/** The documents read, at most `max`, taken in turns from each step (S1.1, S2.1, ..., then S1.2, S2.2, ...), so every
 *  source a plan bought is read before any one is read twice. A product's own written answer is never read (#7065: six
 *  searches gave 126 documents; the first 24 in order came from one and a half of them, so $0.20 of searches were
 *  bought and never read). Within a step, the order its plan kept holds. */
export function pickDocs(docs, max) {
  const lanes = new Map();
  for (const d of docs) {
    if (d.generated) continue;
    const k = String(d.id).split(".")[0];
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(d);
  }
  const ls = [...lanes.values()], out = [];
  for (let i = 0; out.length < max && ls.some((l) => i < l.length); i++) {
    for (const l of ls) { if (out.length >= max) break; if (i < l.length) out.push(l[i]); }
  }
  return out;
}

/** Web searches that answer the same words, each the others' plan B when its seller is not serving (#7065: Tavily was
 *  down all afternoon and the page had no other way to search). Google's own results first: the cheapest, and the
 *  only one that is Google's ranking. */
export const SEARCH_ALTERNATES = {
  "tavily-web-search": ["sippar-web-search", "grounded-search"],
  "grounded-search": ["sippar-web-search", "tavily-web-search"],
  "sippar-web-search": ["tavily-web-search", "grounded-search"],
};
/** A failure a plan B can answer: the seller is not serving (503), or failed the call (502, 504). */
export const sellerDown = (e) => [502, 503, 504].includes(e?.status);
/** The first other web search on the shelf that is not down, asked the same words; null when none is. */
export function planBFor(id, input, catalog, down) {
  if (typeof input?.query !== "string" || !input.query.trim()) return null;
  for (const alt of SEARCH_ALTERNATES[id] ?? []) {
    const p = catalog.byId[alt];
    if (p && !p.free && !down.has(alt) && p.health !== "down") return { product: p, input: { query: input.query } };
  }
  return null;
}

/** One free call, counted against the run's and the day's free-call limits. An empty answer is written into
 *  run.empty by code, so the brief reports it as what was searched, never as a fact. */
async function getFree({ run, product, input, step, allowFree }) {
  run.freeCalls = run.freeCalls || 0;
  if (run.freeCalls >= FREE_CALLS_PER_RUN) throw Object.assign(new Error("free call limit for one brief reached"), { skip: true });
  if (allowFree && !allowFree()) throw Object.assign(new Error("today's free calls for this page are used up"), { skip: true });
  run.freeCalls++;
  const result = await callFree(product.id, input);
  step.payment = { priceUsd: 0, tx: null, note: "free public data, not charged" };
  if (!result.items.length) {
    const terms = Object.entries(input).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(", ");
    (run.empty = run.empty || []).push(`${product.name.replace(/\s*\([^)]*free\)$/, "")} returned no matching records for ${terms} on ${result.readAt.slice(0, 16).replace("T", " ")} UTC. That does not mean none exist.`);
  }
  (run.credits = run.credits || []).includes(product.credit) || run.credits.push(product.credit);
  return result;
}

/** Plan over the catalog with the model, correct a one-letter-off id in code, check in code; one retry with the
 *  check's errors; null when the plan still fails. */
async function planOverCatalog({ question, reader, catalog, emit, pick }) {
  const system = `${PLAN_RULES}\n${READING_NOTES}\n\nTHE CATALOG (each product's shelf id, live price, inputs, and the fields of its items):\n${catalog.sheet}\n\nBUDGET: at most $${MAX_SPEND_USD.toFixed(2)} for the paid steps.`;
  const messages = [{ role: "system", content: system }, { role: "user", content: `Request: ${question}\nThe answer is for: ${reader}.\nWrite the plan as the one JSON object the rules ask for.` }];
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chat(MODELS.planner, messages, { json: true, maxTokens: 9000, pick });
    const { plan, corrections } = correctPlanIds(r.json, catalog.shelf);
    const check = checkPlan(plan, catalog.shelf, MAX_SPEND_USD);
    last = { plan, corrections, check, attempt, ms: r.ms, served: r.served, refusedBy: [...(last?.refusedBy || []), ...(last && !last.check.ok ? [last.served?.model] : [])] };
    emit("plan:check", { attempt, ok: check.ok, errors: check.errors, warnings: check.warnings, corrections, costUSD: check.costUSD, calls: check.calls });
    if (check.ok) return last;
    messages.push({ role: "assistant", content: JSON.stringify(r.json) }, { role: "user", content: `The plan failed the code check:\n${check.errors.map((e) => `- ${e}`).join("\n")}\nWrite a corrected plan as one JSON object and nothing else.` });
  }
  return null;
}

/** The ledger, in code, from what each step's payment says. A payment that bought nothing (the seller failed after it
 *  was paid) is in it, marked, never left out (#7065); the wallet's own change sits beside it, so a gap shows. */
export function ledgerOf(steps, balanceBefore, balanceAfter) {
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const paid = steps.filter((s) => s.payment?.tx);
  const bySeller = {};
  for (const s of paid) bySeller[s.seller] = r6((bySeller[s.seller] || 0) + s.payment.priceUsd);
  const undelivered = paid.filter((s) => s.payment.delivered === false);
  const ledger = {
    paidReads: paid.reduce((a, s) => a + (s.payment.txs?.length || s.bought || 1), 0),
    spentUsd: r6(paid.reduce((a, s) => a + s.payment.priceUsd, 0)),
    bySeller,
    receipts: paid.map((s) => ({ step: s.n, seller: s.seller, priceUsd: s.payment.priceUsd, tx: s.payment.tx, ...(s.payment.delivered === false ? { delivered: false } : {}), ...(s.payment.reusable ? { reusable: true } : {}) })),
  };
  if (undelivered.length) ledger.undeliveredUsd = r6(undelivered.reduce((a, s) => a + s.payment.priceUsd, 0));
  if (typeof balanceBefore === "number" && typeof balanceAfter === "number") ledger.walletChangeUsd = r6(balanceBefore - balanceAfter);
  return ledger;
}

/** Does the question ask where pages rank in a search engine? */
export const asksRanking = (q) => /\b(google|serps?|rank(s|ed|ing)?|top[- ]ranking|top results?|search results)\b/i.test(String(q));

/** A few words naming the job, for Sippar's skills search (3 to 80 characters). */
export function jobWords(question) {
  const words = String(question).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const job = words.slice(0, 8).join(" ").slice(0, 80).trim();
  return job.length >= 3 ? job : "web research";
}
const STOP = new Set(["what", "which", "who", "whom", "whose", "when", "where", "why", "how", "the", "and", "for", "are", "was", "were", "does", "did", "should", "would", "could", "can", "about", "this", "that", "these", "those", "with", "from", "into", "their", "there", "have", "has", "had", "its", "our", "your", "you", "they", "them", "any", "all", "current"]);

/**
 * The plan, bought from Sippar's workflow-planner (the skills-guided planner behind Sippar's plan_workflow tool): Sippar
 * searches agent skills for the job, picks and checks them, and an AntSeed model writes the plan over this catalog's
 * sheet. Bought async so a slow plan is collected, never lost; the plan is then corrected and checked here in code like
 * any other. Null when it cannot be bought, read or checked: Nuru's own planner takes over.
 */
export async function planWithSippar({ run, question, catalog, wallet, emit }) {
  // Sippar's planner takes a sheet of at most 60,000 characters; the live catalog with the free sources is longer (75,246
  // on 2026-11-07), and the plan was then skipped without a word (#7065). The sheet is sent with shorter descriptions
  // until it fits, and a skip is said, with its reason, on the page.
  const notes = `NOTES FROM NURU, THE BUYER OF THIS PLAN:\n${READING_NOTES}`;
  const fit = typeof catalog.sheetFor === "function" ? catalog.sheetFor(SIPPAR_SHEET_MAX - notes.length - 1) : catalog.sheet;
  const skip = (reason) => { run.sipparPlan = { asked: false, reason }; emit("plan:sippar-skipped", { reason }); return null; };
  if (question.trim().length < 10) return skip("the question is shorter than the 10 characters Sippar's planner needs");
  if (!fit || fit.length < 200) return skip(`the product list does not fit the ${SIPPAR_SHEET_MAX.toLocaleString("en-US")} characters Sippar's planner takes, even with short descriptions`);
  if (fit.length > SIPPAR_SHEET_MAX - notes.length - 1) return skip(`the product list is ${fit.length.toLocaleString("en-US")} characters, more than the ${SIPPAR_SHEET_MAX.toLocaleString("en-US")} Sippar's planner takes`);
  const sheet = `${notes}\n${fit}`;
  run.sipparPlan = { asked: true, sheetChars: sheet.length };
  const n = run.steps.length + 1;
  const job = jobWords(question);
  const step = { n, id: "plan", tool: "workflow-planner", input: { request: question.slice(0, 200), job }, why: "A plan for this question from Sippar's workflow planner, guided by agent skills it finds for the job", seller: "Sippar workflow planner", rail: RAIL };
  run.steps.push(step);
  emit("step:start", { step });
  // The planner is told what is left for the paid steps after its own quoted price (not after the cap, which told it
  // $0.10 of a $0.30 run when the plan costs $0.10).
  const body = { query: sheet, size: String(sheet.length), request: question.slice(0, 1000), job };
  const bodyForPrice = (price) => ({ ...body, budget: Math.max(0.05, MAX_SPEND_USD - (price || 0)).toFixed(2) });
  const t0 = Date.now();
  const r = await paidPostAsync(wallet, `${SELL}/workflow-planner`, bodyForPrice(0.1), { bodyForPrice, maxPriceUsd: PLAN_MAX_PRICE_USD, onWait: ({ seconds }) => emit("plan:wait", { seconds }) })
    .catch((e) => ({ ok: false, status: 0, data: { error: String(e.message || e) } }));
  step.ms = Date.now() - t0;
  if (r.tx || (r.priceUsd && !r.refused)) step.payment = { priceUsd: r.priceUsd || 0, tx: r.tx || null };
  const fail = (why) => { step.error = why.slice(0, 300); emit("step:error", { step }); emit("plan:sippar-failed", { reason: step.error }); return null; };
  if (!r.ok) return fail(`${r.status} ${JSON.stringify(r.data).slice(0, 240)}`);
  const d0 = r.data?.data || r.data || {};
  const result = d0.result ?? d0;
  if (d0.paymentTx && step.payment) step.payment.tx = d0.paymentTx;
  let written;
  try { written = parseJsonObject(String(result.text || "")); } catch (e) { return fail(`the plan could not be read: ${e.message}`); }
  const { plan, corrections } = correctPlanIds(written, catalog.shelf);
  const check = checkPlan(plan, catalog.shelf, Math.max(0, MAX_SPEND_USD - (step.payment?.priceUsd || 0)));
  emit("plan:check", { attempt: 1, ok: check.ok, errors: check.errors, warnings: check.warnings, corrections, costUSD: check.costUSD, calls: check.calls, by: "sippar" });
  step.items = (plan.steps || []).length;
  emit("step:done", { step });
  if (!check.ok) return fail(`the plan did not pass the check: ${check.errors.slice(0, 2).join(" ")}`);
  const skills = Array.isArray(result.skills?.used) ? result.skills.used.map((k) => ({ id: k.id, name: k.name, licence: k.licence })) : [];
  return { plan, corrections, check, attempt: 1, ms: step.ms, served: { provider: "sippar", model: result.model || "an AntSeed model", seller: result.seller || "", skills } };
}

export async function runCatalogPlan({ run, plan, catalog, wallet, emit, allowFree }) {
  const itemsByStep = new Map(), kindsByStep = new Map();
  // Web searches whose seller did not serve in this run (plan B skips them).
  const down = new Set();
  // What the plan itself cost counts toward the run's ceiling.
  let spent = run.steps.reduce((a, s) => a + (s.payment?.priceUsd || 0), 0);
  const canSpend = (p, times = 1) => spent + p.priceUSD * times <= MAX_SPEND_USD + 1e-9;
  for (const s of plan.steps) {
    const n = run.steps.length + 1;
    if (s.product) {
      const p = catalog.byId[s.product];
      const step = { n, id: s.id, tool: s.product, input: s.input ?? {}, why: s.why, seller: p.name, rail: p.free ? "free" : RAIL };
      run.steps.push(step);
      if (p.free) {
        emit("step:start", { step });
        try {
          const t0 = Date.now();
          const result = await getFree({ run, product: p, input: s.input ?? {}, step, allowFree });
          step.ms = Date.now() - t0;
          const items = itemsOf(p.id, result);
          step.items = items.length;
          step.documents = withIds(docsFrom(p, items, result, n), n);
          itemsByStep.set(s.id, items); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {});
          emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
        } catch (e) {
          if (e.skip) step.skipped = e.message; else step.error = String(e.message || e).slice(0, 300);
          itemsByStep.set(s.id, []); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {});
          emit(e.skip ? "step:skip" : "step:error", { step });
        }
        continue;
      }
      itemsByStep.set(s.id, []); kindsByStep.set(s.id, RESULT_SHAPES[p.id]?.fields ?? {});
      // One paid call: its items and documents on success; its payment counted either way. Returns the error, if any.
      const buyInto = async (prod, input, st) => {
        emit("step:start", { step: st });
        const t0 = Date.now();
        try {
          const { result, payment } = await buy(wallet, prod, input, st);
          st.ms = Date.now() - t0; st.payment = payment; spent += payment.priceUsd || 0;
          const items = itemsOf(prod.id, result);
          st.items = items.length;
          st.documents = withIds(docsFrom(prod, items, result, st.n), st.n);
          itemsByStep.set(s.id, items); kindsByStep.set(s.id, RESULT_SHAPES[prod.id]?.fields ?? {});
          emit("step:done", { step: { ...st, documents: st.documents.map(({ text, ...d }) => d) } });
          return null;
        } catch (e) {
          st.ms = Date.now() - t0; st.error = String(e.message || e).slice(0, 300); spent += st.payment?.priceUsd || 0;
          emit("step:error", { step: st });
          return e;
        }
      };
      // Plan B (#7065): a web search whose seller is not serving is asked of another web search, with the same words,
      // and the brief says so. A seller already down in this run is not asked again.
      const switchNote = (from, to, why) => { const note = `${from.name} ${why}, so ${to.name} was searched with the same words.`; (run.notes ||= []).push(note); return note; };
      let prod = p, input = s.input ?? {};
      if (down.has(prod.id)) {
        const b = planBFor(prod.id, input, catalog, down);
        if (b && canSpend(b.product)) {
          Object.assign(step, { tool: b.product.id, input: b.input, seller: b.product.name, switchedFrom: prod.id, note: switchNote(prod, b.product, "was not serving earlier in this brief") });
          prod = b.product; input = b.input;
        }
      }
      if (!canSpend(prod)) { step.skipped = "run spend ceiling reached"; emit("step:skip", { step }); continue; }
      const err = await buyInto(prod, input, step);
      if (err && sellerDown(err)) {
        down.add(prod.id);
        const b = planBFor(prod.id, input, catalog, down);
        if (b && canSpend(b.product)) {
          const alt = { n: run.steps.length + 1, id: s.id, tool: b.product.id, input: b.input, why: s.why, seller: b.product.name, rail: RAIL, switchedFrom: prod.id,
            note: switchNote(prod, b.product, `did not serve this search (${err.status}${err.reason ? `, ${err.reason}` : ""})`) };
          run.steps.push(alt);
          await buyInto(b.product, b.input, alt);
        }
      }
      continue;
    }
    // A code move. Nothing is bought, except for_each, which buys one product per item.
    const from = Array.isArray(s.from) ? s.from : [];
    const inputs = from.map((id) => itemsByStep.get(id) ?? []);
    const kinds = Object.assign({}, ...from.map((id) => kindsByStep.get(id) ?? {}));
    if (s.move === "for_each") {
      const p = catalog.byId[s.args?.product];
      const calls = forEachInputs(s, inputs.flat()).slice(0, p?.free ? FREE_FOR_EACH_MAX : Infinity);
      const step = { n, id: s.id, tool: `for each: ${s.args?.product}`, input: s.args?.input ?? {}, why: s.why, seller: p?.name ?? "", rail: p?.free ? "free" : RAIL, calls: calls.length };
      run.steps.push(step);
      emit("step:start", { step });
      const items = [], documents = [];
      let bought = 0, priceUsd = 0, txs = [];
      for (const input of calls) {
        if (!p || !canSpend(p)) break;
        const sub = {};
        try {
          if (p.free) {
            const result = await getFree({ run, product: p, input, step: sub, allowFree });
            const its = itemsOf(p.id, result);
            items.push(...its); documents.push(...docsFrom(p, its, result, n)); bought++;
            continue;
          }
          const { result, payment } = await buy(wallet, p, input, sub);
          spent += payment.priceUsd || 0; bought++; priceUsd += payment.priceUsd || 0; if (payment.tx) txs.push(payment.tx);
          const its = itemsOf(p.id, result);
          items.push(...its);
          documents.push(...docsFrom(p, its, result, n));
        } catch (e) {
          if (e.skip) { step.skipped = e.message; break; }
          step.error = String(e.message || e).slice(0, 200);
          // A call that was paid and failed still cost the wallet (#7065).
          if (!p.free && sub.payment?.tx) { spent += sub.payment.priceUsd || 0; priceUsd += sub.payment.priceUsd || 0; txs.push(sub.payment.tx); }
        }
      }
      step.bought = bought; step.items = items.length;
      if (txs.length && !p?.free) step.payment = { priceUsd: Math.round(priceUsd * 1e6) / 1e6, tx: txs[0] || null, txs, ...(txs.length > bought ? { undelivered: txs.length - bought } : {}) };
      if (bought && p?.free) step.payment = { priceUsd: 0, tx: null, note: "free public data, not charged" };
      step.documents = withIds(documents, n);
      itemsByStep.set(s.id, items); kindsByStep.set(s.id, RESULT_SHAPES[p?.id]?.fields ?? {});
      emit("step:done", { step: { ...step, documents: step.documents.map(({ text, ...d }) => d) } });
      continue;
    }
    const step = { n, id: s.id, tool: `code: ${s.move}`, input: s.args ?? {}, why: s.why, seller: "code, no charge", rail: "none" };
    run.steps.push(step);
    emit("step:start", { step });
    let items = runMove(s, inputs, kinds);
    // A filter that keeps nothing of a non-empty list keeps the list (#7065: a filter on a field only Tavily returns,
    // with Tavily down, emptied 21 bought items and the brief said "Unknown"). Reading unfiltered beats reading nothing.
    const given = inputs.flat();
    if (s.move === "filter" && given.length && !items.length) {
      items = given;
      step.note = `This filter (${String(s.args?.field)} ${String(s.args?.op)} ${JSON.stringify(s.args?.value ?? "")}) kept none of the ${given.length} items, so all ${given.length} were kept rather than read nothing.`;
    }
    step.items = items.length;
    itemsByStep.set(s.id, items); kindsByStep.set(s.id, kinds);
    emit("step:done", { step });
  }
  // WHAT IS READ (#6408): the documents of every step no later step reads. A product step read by a filter, rank or
  // top is read through what that move kept, never in full: a plan that keeps papers from 2020 on reads no 2018 paper.
  const readBy = new Set(plan.steps.flatMap((q) => (Array.isArray(q.from) ? q.from : [])));
  const read = [];
  for (const q of plan.steps) {
    if (readBy.has(q.id)) continue;
    const st = run.steps.findLast((x) => x.id === q.id);
    const docs = q.product || q.move === "for_each" ? st?.documents ?? [] : (itemsByStep.get(q.id) ?? []).map((it) => DOC_OF.get(it)).filter(Boolean);
    for (const d of docs) if (!read.includes(d)) read.push(d);
  }
  run.readDocIds = read.map((d) => d.id);
  return spent;
}

async function runFixedPlan({ run, question, reader, wallet, emit, pick }) {
  emit("plan:start", { model: MODELS.planner, mode: "fixed" });
  const plan = await chat(MODELS.planner, [
    { role: "system", content:
      `You plan research for ${reader}. Choose up to ${MAX_STEPS} steps from these sources only:\n${toolMenu()}\n` +
      `Every step has input {query, url}: fill the one the source needs and leave the other "". ` +
      `Prefer a mix: web search for the overview, papers for evidence, news for what changed recently, Dataconomy for industry analysis. ` +
      `read_page and dataconomy_article need a real URL, so only use them with a URL you already know; otherwise search.` },
    { role: "user", content: question },
  ], { schema: PLAN_SCHEMA, maxTokens: 1500, pick });
  const steps = plan.json.steps.filter((s) => TOOLS[s.tool]).slice(0, MAX_STEPS);
  run.plan = { mode: "fixed", steps };
  run.servedBy = { ...(run.servedBy || {}), planner: plan.served };
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

/** `pick`: a free model the visitor chose (checked by the server against tf.mjs freeModels()); it plans and writes. */
export async function research(args) {
  const holder = {};
  try { return await researchRun({ ...args, holder }); }
  catch (e) {
    // What a failed run had already paid, for the page's daily limit (a balance read right after can lag the payment).
    const paid = (holder.run?.steps || []).filter((s) => s.payment?.tx);
    e.spentUsd = Math.round(paid.reduce((a, s) => a + (s.payment.priceUsd || 0), 0) * 1e6) / 1e6;
    throw e;
  }
}

async function researchRun({ question, reader = "the person who asked", wallet, onEvent = () => {}, pick, holder = {}, allowFree }) {
  resetUsage();
  const run = { question, reader, startedAt: new Date().toISOString(), models: { ...MODELS, ...(pick ? { picked: pick } : {}) }, steps: [], claims: [], events: [] };
  holder.run = run;
  const emit = (type, data) => { const e = { t: Date.now(), type, ...data }; run.events.push(e); onEvent(e); };
  run.walletAddress = wallet.address;
  run.balanceBefore = await wallet.balance().catch(() => null);

  // 1. Plan. Over the live catalog when it can be read and the plan passes the code check; else the fixed list.
  let planned = null, catalog = null;
  if (PLANNER === "catalog") {
    try {
      catalog = await loadCatalog();
      emit("plan:start", { model: MODELS.planner, mode: "catalog", products: catalog.products.length, readable: catalog.readable, planner: PLAN_WITH });
      if (PLAN_WITH === "sippar") planned = await planWithSippar({ run, question, catalog, wallet, emit });
      if (!planned) planned = await planOverCatalog({ question, reader, catalog, emit, pick });
      if (planned) {
        run.plan = { mode: "catalog", summary: planned.plan.summary, ask_first: planned.plan.ask_first, answer: planned.plan.answer, steps: planned.plan.steps, check: planned.check, corrections: planned.corrections, attempts: planned.attempt };
        // Who wrote the plan that ran; an earlier plan the code check refused is named with its model.
        run.servedBy = { planner: { ...planned.served, ...(planned.refusedBy?.length ? { checkRefused: planned.refusedBy } : {}) } };
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
  if (planned) await runCatalogPlan({ run, plan: planned.plan, catalog, wallet, emit, allowFree });
  else await runFixedPlan({ run, question, reader, wallet, emit, pick });

  // 3. Extract quotable claims per document (Nemotron Super). A claim counts only if its
  //    quote is found word for word in the document the wallet paid for.
  const all = run.steps.flatMap((s) => s.documents || []);
  const docs = pickDocs(run.readDocIds ? run.readDocIds.map((id) => all.find((d) => d.id === id)).filter(Boolean) : all, MAX_DOCS);
  // What the plan's code kept stays on record; readDocIds becomes what was in fact read, so the page counts it truly.
  if (run.readDocIds) run.keptDocIds = run.readDocIds;
  run.readDocIds = docs.map((d) => d.id);
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
        run.claims.push({ id: `C${run.claims.length + 1}`, doc: d.id, url: d.url, publisher: d.publisher, via: d.via, ...(d.rank != null ? { rank: d.rank } : {}), claim: c.claim, quote: c.quote, verified: !!found });
      }
    } catch (e) {
      emit("read:error", { doc: d.id, error: String(e.message || e).slice(0, 200) });
    }
  }));
  const verified = run.claims.filter((c) => c.verified);
  emit("read:done", { claims: run.claims.length, verified: verified.length });

  // 4. Write the brief (Nemotron Ultra) from verified claims only; code drops any citation
  //    that does not resolve and any point left with no evidence.
  // A question about Google's ranking that read no Google result gets that said in code (#7065: search hits were
  // written up as "the top results for 'agent payments'", and none was in Google's top five).
  const rankGap = asksRanking(question) && !docs.some((d) => d.rank != null)
    ? "Google's own ranking was not read for this brief: any pages named come from other searches, not from Google's order." : null;
  emit("write:start", { model: MODELS.writer });
  const brief = await chat(MODELS.writer, [
    { role: "system", content:
      `Write a short brief for ${reader}: a summary under 80 words and at most 8 points, each under 35 words. Use only the evidence given; cite claim ids like C3 in each point's evidence list. ` +
      `Do not compute or invent numbers; repeat numbers only as they appear in the evidence. ` +
      `Evidence marked "a paper's title only" says what a paper is about, not what it found: never present it as a finding. ` +
      ` List what the evidence does not cover under gaps, in at most 4 short lines. ` +
      `When a source returned nothing on something, say what was searched and that it returned nothing, never that the thing does not exist: write "the search returned no matching records", never "there are no recalls", "no side effects", "it is safe" or "no filings". Put such empty results under gaps. ` +
      `Only evidence marked "Google result #N" says where a page ranks in Google; never call any other page a top result, a top-ranking page or Google's ranking.` },
    { role: "user", content: `Question: ${question}\n\nEvidence:\n` + verified.map((c) => `${c.id} (${c.publisher}${c.rank != null ? `, Google result #${c.rank}` : c.via && c.via !== c.publisher ? `, found by ${c.via}` : ""}${all.find((d) => d.id === c.doc)?.titleOnly ? ", a paper's title only" : ""}): ${c.claim} | quote: "${c.quote}"`).join("\n") +
      (rankGap ? `\n\nNo evidence above says where any page ranks in Google.` : "") +
      (run.empty?.length ? `\n\nSearches that returned nothing (report them only as searches that returned nothing):\n` + run.empty.map((e) => `- ${e}`).join("\n") : "") },
  ], { schema: BRIEF_SCHEMA, maxTokens: 6000, pick });
  const ids = new Set(verified.map((c) => c.id));
  const points = brief.json.points
    .map((p) => ({ text: p.text, evidence: p.evidence.filter((e) => ids.has(e)), dropped: p.evidence.filter((e) => !ids.has(e)) }))
    .filter((p) => p.evidence.length);
  // An empty search is always in the gaps, in code's own words, whatever the writer did with it.
  const gaps = [...(run.empty || []), ...(rankGap ? [rankGap] : []), ...(brief.json.gaps || [])].slice(0, 8);
  run.brief = { title: brief.json.title, summary: brief.json.summary, points, gaps, unsupportedPointsRemoved: brief.json.points.length - points.length };
  run.servedBy = { ...(run.servedBy || {}), writer: brief.served };
  emit("write:done", { points: points.length });

  // 5. The ledger, computed in code from what each step actually returned.
  run.nemotron = JSON.parse(JSON.stringify(usage));
  run.balanceAfter = await wallet.balance().catch(() => null);
  run.ledger = ledgerOf(run.steps, run.balanceBefore, run.balanceAfter);
  run.finishedAt = new Date().toISOString();
  emit("done", {});
  return run;
}
