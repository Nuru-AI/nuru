// Nuru's planner: a plan is paid steps over a catalog plus code moves between them. Everything here is code, so a
// plan is checked and run without any model judging it, and no move ever writes a sentence or a number a model made
// up. The model (Nemotron on Token Factory in this repository) only writes the plan.
//
// Ported by its author from the planner module that Sippar's payment card and MCP server share. The result shapes
// below were each read from a real recorded result of the product named; a product with no recorded shape is still
// buyable as a step, but no move may read its fields until one is recorded. Never write a field from a description.

/** Where a product's items are in its result, and the fields each item carries (by the catalog's shelf id). */
import { FREE_SHAPES } from "./free.mjs";

export const RESULT_SHAPES = {
  "sippar-video-search": { paths: ["videos"], single: ["video"], fields: { title: "text", url: "link", channel: "text", channelUrl: "link", views: "number", durationSeconds: "number", published: "ago", kind: "text", publishedAt: "date", comments: "number", genre: "text", paidPromotion: "flag" } },
  "tavily-web-search": { paths: ["response.results"], whole: ["response.answer"], fields: { url: "link", title: "text", content: "text", score: "number", answer: "body" } },
  "grounded-search": { paths: ["citations"], whole: ["answer"], fields: { title: "text", url: "link", answer: "body" } },
  "social-search": { paths: ["citations"], fields: { platform: "text", url: "link", title: "text" } },
  "sippar-x-social": { paths: ["response.tweets"], fields: { url: "link", text: "text", created_at: "date", lang: "text", is_reply: "flag", engagement_rate: "number" } },
  "sippar-reddit-social": { paths: ["posts"], fields: { title: "text", url: "link", subreddit: "text", author: "text", publishedAt: "date", score: "number", numComments: "number" } },
  "sippar-linkedin-social": { paths: ["posts"], fields: { url: "link", publishedAt: "date", inShort: "text" } },
  "sippar-facebook-social": { paths: ["response.data.ads", "response.data.posts"], fields: { url: "link", isActive: "flag", startedAt: "date", text: "text", createdAt: "date", authorDisplayName: "text", reactionCount: "number", commentCount: "number" } },
  "sippar-amazon": { paths: ["response.organic"], fields: { asin: "text", title: "text", url: "link", price_gross: "number", currency: "text", rating: "number", reviews_count: "number", is_prime: "flag", is_sponsored: "flag", best_seller: "flag", sales_volume: "text" } },
  "sippar-flight-search": { paths: ["response.best_flights", "response.other_flights"], fields: { price: "number", total_duration: "number", type: "text" } },
  "sippar-hotel-search": { paths: ["response.data"], fields: { name: "text", hotel_stars: "number", rating: "number", review_count: "number", hotel_price_for_dates: "money", full_address: "text", place_link: "link", website: "link" } },
  "sippar-job-search": { paths: ["response.data.jobs"], fields: { job_title: "text", employer_name: "text", employer_website: "link", job_publisher: "text", job_employment_type: "text", job_apply_link: "link", job_is_remote: "flag", job_posted_at_datetime_utc: "date", job_location: "text", job_min_salary: "number", job_max_salary: "number", job_salary_period: "text", job_country: "text" } },
  "sippar-news-search": { paths: ["response.data.news", "response.data"], fields: { title: "text", link: "link", snippet: "text", published_datetime_utc: "date", source_name: "text", source_url: "link" } },
  "dataconomy-search": { paths: ["articles"], fields: { title: "text", author: "text", publishedAt: "date", link: "link", excerpt: "text" } },
  "sippar-github": { paths: ["response.results"], fields: { full_name: "text", description: "text", language: "text", stargazers_count: "number", forks_count: "number", pushed_at: "date", homepage: "link", title: "text", html_url: "link", state: "text", comments_count: "number", created_at: "date" } },
  "sippar-skills": { paths: ["skillsshMatches"], fields: { id: "text", source: "text", name: "text", installs: "number", description: "text" } },
  "nansen-crypto-screener": { paths: ["tokens"], fields: { rank: "number", symbol: "text", network: "text", address: "text", priceUsd: "number", fdvUsd: "number", liquidityUsd: "number", volumeUsd: "number", netflowUsd: "number", tokenAgeDays: "number", changePct: "number" } },
  // Two readers answer: Exa's form (content.results) and, since Sippar put its Apify reader first, one page whole
  // (content.final_url and content.outputs.markdown), as Sippar's planner records it (test/fixtures/paid/web-content-apify.json).
  // Without the second, every page read on 2026-11-07 19:36 UTC came back as nothing (Nuru-AI/sippar#7065).
  "web-content": { paths: ["content.results"], whole: ["content.final_url", "content.outputs.markdown"], fields: { title: "text", url: "link", text: "body", final_url: "link", markdown: "body" } },
  // Google's own first page (storefront id google-results), as Sippar's planner records it (Nuru-AI/sippar planner.ts,
  // read from a live buy on 2026-11-04; test/fixtures/paid/google-results.json). The only search here that is Google's
  // ranking (#7065), and the cheapest web search on the shelf.
  "sippar-web-search": { paths: ["response.results"], fields: { position: "number", url: "link", title: "text", description: "text", date: "text" } },
  // Recorded from the paid result of the live brief 2026-11-01T10-51-02-123Z (test/fixtures/paid/paper-search.json).
  // Only the fields the recorded answer carries (#6408): abstract, venue and citedBy were null on all 10 rows, as
  // Sippar's own shape declares them (Nuru-AI/sippar#6393). A plan cannot rank by a field that never comes back.
  "paper-search": { paths: ["results"], fields: { title: "text", year: "number", doi: "text", pmid: "text" } },
  "3d-model-search": { paths: ["models"], fields: { title: "text", url: "link", creator: "text", license: "text", downloadable: "flag", views: "number", likes: "number", publishedAt: "date" } },
  "ai-visibility": { paths: ["answers"], fields: { prompt: "text", model: "text", seller: "text", mentioned: "flag", position: "number", domainCited: "flag" } },
  "audience-profile": { paths: ["people"], fields: { age: "number", sex: "text", occupation: "text", city: "text", state: "text", education: "text", persona: "text" } },
  // Free public sources Nuru calls directly (lib/free.mjs); each shape recorded from a real answer in test/fixtures/free.
  ...FREE_SHAPES,
};

const at = (o, path) => path.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
const obj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

/** A result's items, in the shape's order: every list path that holds a list, then every single path that holds an
 *  object, then one item of the `whole` fields that are there. A product with no shape has no items a move can read. */
export function itemsOf(productId, result) {
  const shape = RESULT_SHAPES[productId];
  if (!shape) return [];
  return [
    ...shape.paths.flatMap((p) => { const v = at(result, p); return Array.isArray(v) ? v.filter(obj) : []; }),
    ...(shape.single ?? []).flatMap((p) => { const v = at(result, p); return obj(v) ? [v] : []; }),
    ...wholeItem(shape, result),
  ];
}
function wholeItem(shape, result) {
  const it = Object.fromEntries((shape.whole ?? []).map((p) => [p.split(".").pop(), at(result, p)]).filter(([, v]) => v != null && v !== ""));
  return Object.keys(it).length ? [it] : [];
}

/** A field's value as a number, when it has one: a number, a "$88" price, or a date or age as hours before `now`. */
export function numberOf(v, kind, now = Date.now()) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  if (kind === "money") { const m = /-?\d[\d,]*(\.\d+)?/.exec(v); return m ? Number(m[0].replace(/,/g, "")) : undefined; }
  if (kind === "ago") return agoHours(v);
  if (kind === "date") { const t = Date.parse(v); return Number.isFinite(t) ? (now - t) / 3_600_000 : undefined; }
  return undefined;
}
const UNIT_HOURS = { second: 1 / 3600, minute: 1 / 60, hour: 1, day: 24, week: 168, month: 730, year: 8760 };
export function agoHours(s) {
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(s);
  return m ? Number(m[1]) * UNIT_HOURS[m[2].toLowerCase()] : undefined;
}

export const MOVES = ["merge", "dedupe", "filter", "rank", "top", "for_each"];
export const FILTER_OPS = [">=", "<=", "==", "!=", "contains", "not_contains"];

export function computedOf(by) {
  const m = /^\s*(per_hour|ratio)\(\s*([\w]+)\s*,\s*([\w]+)\s*\)\s*$/.exec(by);
  return m ? { fn: m[1], a: m[2], b: m[3] } : undefined;
}
const TEMPLATE = /\{\{\s*item\.([\w]+)\s*\}\}/g;
const templateFields = (input) => [...JSON.stringify(input ?? {}).matchAll(TEMPLATE)].map((m) => m[1]);
const NUMERIC = ["number", "money", "date", "ago"];

/** Levenshtein distance: the fewest single-character edits that turn `a` into `b`. */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** The one shelf id within edit distance 1 of an id that is not on the shelf (case ignored); undefined otherwise. */
export function nearestShelfId(written, shelf) {
  if (typeof written !== "string" || !written || shelf[written]) return undefined;
  const w = written.trim().toLowerCase();
  const near = Object.keys(shelf).filter((id) => editDistance(w, id.toLowerCase()) <= 1);
  return near.length === 1 ? near[0] : undefined;
}

/** The plan with every one-letter-off product id read as the shelf id it is one edit from, and a note per step. */
export function correctPlanIds(plan, shelf) {
  const corrections = [];
  const steps = (Array.isArray(plan?.steps) ? plan.steps : []).map((s) => {
    const sid = typeof s?.id === "string" && s.id ? s.id : "?";
    if (s.product !== undefined) {
      const to = nearestShelfId(s.product, shelf);
      if (!to) return s;
      corrections.push(`${sid}: the planner wrote "${String(s.product)}"; read as ${to}.`);
      return { ...s, product: to };
    }
    if (s.move === "for_each" && s.args && typeof s.args === "object" && "product" in s.args) {
      const to = nearestShelfId(s.args.product, shelf);
      if (!to) return s;
      corrections.push(`${sid}: the planner wrote "${String(s.args.product)}"; read as ${to}.`);
      return { ...s, args: { ...s.args, product: to } };
    }
    return s;
  }).map((s) => {
    const sid = typeof s?.id === "string" && s.id ? s.id : "?";
    const fix = (pid, input, label) => {
      const r = fixInputs(input, shelf[pid]);
      if (r.dropped.length) corrections.push(`${sid}${label}: ${pid} refuses ${r.dropped.join("; ")}; left out, so its default applies.`);
      return r.input;
    };
    if (s?.product !== undefined) {
      const out = { ...s, input: fix(s.product, s.input, "") };
      if (s.fallback && typeof s.fallback === "object") out.fallback = fix(s.product, s.fallback, " fallback");
      return out;
    }
    if (s?.move === "for_each" && s.args && typeof s.args === "object") return { ...s, args: { ...s.args, input: fix(s.args.product, s.args.input, "") } };
    return s;
  });
  return { plan: { ...plan, steps }, corrections };
}

/** The most calls a step turned into for_each by repairPlan makes. */
export const REPAIRED_FOR_EACH_MAX = 3;

/**
 * Mend in code what a planner commonly gets wrong, instead of throwing a paid plan away (2026-11-08: of 16 paid Sippar
 * plans on the page, one was refused for a {{item.…}} input on a plain step, one for costing $0.22 against $0.20):
 * - a product step with an {{item.…}} input and a "from" becomes a for_each over that step, at most 3 calls;
 * - a plan over budget has its for_each counts lowered, the costliest first, until it fits (never below 1).
 * What cannot be mended is left for the check to refuse.
 */
export function repairPlan(plan, shelf, budgetUSD) {
  const corrections = [];
  let steps = (Array.isArray(plan?.steps) ? plan.steps : []).map((s) => {
    if (!s?.product || !s.input || typeof s.input !== "object" || !templateFields(s.input).length) return s;
    const from = Array.isArray(s.from) ? s.from : typeof s.from === "string" ? [s.from] : [];
    if (from.length !== 1) return s;
    corrections.push(`${s.id}: ${s.product} reads {{item.…}} from ${from[0]}; run as a for_each over it, at most ${REPAIRED_FOR_EACH_MAX} calls.`);
    const { product, input, fallback, ...rest } = s;
    return { ...rest, move: "for_each", from, args: { product, input, max: REPAIRED_FOR_EACH_MAX } };
  });
  let out = { ...plan, steps };
  for (let guard = 0; guard < 200; guard++) {
    const c = checkPlan(out, shelf, budgetUSD);
    if (c.costUSD <= budgetUSD + 1e-9) break;
    const cost = (s) => (shelf[s.args?.product]?.priceUSD ?? 0) * (s.args?.max ?? 0);
    const cut = out.steps.filter((s) => s.move === "for_each" && Number.isInteger(s.args?.max) && s.args.max > 1).sort((a, b) => cost(b) - cost(a))[0];
    if (!cut) break;
    out = { ...out, steps: out.steps.map((s) => (s === cut ? { ...s, args: { ...s.args, max: s.args.max - 1 } } : s)) };
  }
  const before = new Map(steps.filter((s) => s.move === "for_each").map((s) => [s.id, s.args?.max]));
  for (const s of out.steps) if (s.move === "for_each" && before.get(s.id) !== s.args?.max) corrections.push(`${s.id}: for_each max ${before.get(s.id)} lowered to ${s.args.max} to fit the $${budgetUSD.toFixed(2)} budget.`);
  return { plan: out, corrections };
}

/**
 * Check a plan in code before anything is bought: shelf products only, only the inputs each product lists (with values
 * inside the choices or range the catalog states), only the
 * six moves, steps that read earlier steps, fields the source step really returns, and the cost at live prices
 * against the budget. An error refuses the plan; a warning is shown with it.
 */
export function checkPlan(plan, shelf, budgetUSD) {
  const errors = [], warnings = [];
  let cost = 0, calls = 0;
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return { ok: false, errors: ["The plan has no steps."], warnings, costUSD: 0, calls: 0 };
  const out = new Map();
  const product = (sid, pid, input, templated) => {
    const p = typeof pid === "string" ? shelf[pid] : undefined;
    if (!p) { errors.push(`${sid}: "${String(pid)}" is not a product on the shelf.`); return undefined; }
    if (p.health === "down") warnings.push(`${sid}: ${pid} is shut right now.`);
    if (p.priceFrom) warnings.push(`${sid}: ${pid} is priced per call by a quote; its price here is the least it costs.`);
    const inp = input && typeof input === "object" ? input : {};
    const unknown = Object.keys(inp).filter((k) => !p.inputs.includes(k));
    if (unknown.length) errors.push(`${sid}: ${pid} takes no input ${unknown.map((k) => `"${k}"`).join(", ")}; it takes ${p.inputs.join(", ")}.`);
    for (const [k, v] of Object.entries(inp)) { const why = inputProblem(p.rules?.[k], v); if (why) errors.push(`${sid}: ${pid} input "${k}" ${why}.`); }
    if (!templated && templateFields(inp).length) errors.push(`${sid}: {{item.…}} is only for a for_each input.`);
    return p;
  };
  const fieldOf = (sid, src, f, want) => {
    if (typeof f !== "string" || !f) { errors.push(`${sid}: names no field.`); return; }
    if (!src.fields) { errors.push(`${sid}: reads "${f}", but ${src.from} has no recorded result, so no move may read its fields.`); return; }
    const k = src.fields[f];
    if (!k) { errors.push(`${sid}: ${src.from} returns no field "${f}"; it returns ${Object.keys(src.fields).join(", ")}.`); return; }
    const unshaped = [...new Set((src.parts ?? []).filter((x) => !x.fields).map((x) => x.from))];
    if (unshaped.length) warnings.push(`${sid}: items from ${unshaped.join(", ")} have no recorded fields; they pass "${f}" only if they carry it.`);
    if (want && !want.includes(k)) errors.push(`${sid}: "${f}" is ${k}, not ${want.join(" or ")}.`);
    return k;
  };
  for (const s of steps) {
    const sid = typeof s?.id === "string" && s.id ? s.id : "?";
    if (out.has(sid)) errors.push(`${sid}: two steps share this id.`);
    if (s.product) {
      const p = product(sid, s.product, s.input, false);
      if (p) { cost += p.priceUSD; calls += 1; }
      // A second input is bought only when the first is empty, but the check counts it, so the budget always covers it.
      if (s.fallback !== undefined) {
        if (!s.fallback || typeof s.fallback !== "object" || Array.isArray(s.fallback)) errors.push(`${sid}: fallback must be an input object.`);
        else { const f = product(`${sid} fallback`, s.product, s.fallback, false); if (f) { cost += f.priceUSD; calls += 1; } }
      }
      out.set(sid, { fields: RESULT_SHAPES[s.product]?.fields ?? null, from: s.product, parts: [{ from: s.product, fields: RESULT_SHAPES[s.product]?.fields ?? null }] });
      continue;
    }
    if (!s.move || !MOVES.includes(s.move)) { errors.push(`${sid}: "${String(s.move ?? "")}" is not one of the moves (${MOVES.join(", ")}).`); out.set(sid, { fields: null, from: sid }); continue; }
    const refs = Array.isArray(s.from) ? s.from : [];
    if (!refs.length) errors.push(`${sid}: a move needs the steps it reads in "from".`);
    const srcs = refs.map((r) => { const o = out.get(r); if (!o) errors.push(`${sid}: reads ${r}, which is not an earlier step.`); return o; }).filter(Boolean);
    // A merge keeps the fields its recorded sources return. A source with no recorded result adds items whose fields are
    // unknown: the moves pass over them safely (a filter drops an item without the field, dedupe and rank keep it last,
    // for_each skips it), so they are a warning, not a refusal (2026-11-08: a paid Sippar plan merged crypto-skills and
    // package-search-for-npm results into Tavily's and was thrown away). Only a merge of sources none of which is recorded has no fields.
    const known = srcs.filter((x) => x.fields);
    const merged = { fields: known.length ? Object.assign({}, ...known.map((x) => x.fields)) : null, from: srcs.map((x) => x.from).join(" + ") || sid, parts: srcs.flatMap((x) => x.parts ?? []) };
    if (s.move !== "merge" && refs.length > 1) errors.push(`${sid}: ${s.move} reads one step; merge them first.`);
    const a = s.args ?? {};
    switch (s.move) {
      case "dedupe": fieldOf(sid, merged, a.by); break;
      case "filter": {
        const op = String(a.op ?? "");
        if (!FILTER_OPS.includes(op)) { errors.push(`${sid}: filter "${op}" is not one of ${FILTER_OPS.join(", ")}.`); break; }
        fieldOf(sid, merged, a.field, op === "contains" || op === "not_contains" ? ["text", "link", "body"] : op === "==" || op === "!=" ? undefined : NUMERIC);
        // A filter on a field only some merged sources return drops every item of the others (#7065, as Sippar's #6506).
        const lacking = [...new Set((merged.parts ?? []).filter((x) => x.fields && !(a.field in x.fields)).map((x) => x.from))];
        if (merged.fields && lacking.length) warnings.push(`${sid}: filter on "${a.field}" drops every item from ${lacking.join(", ")}, which ${lacking.length > 1 ? "do" : "does"} not return it.`);
        break;
      }
      case "rank": {
        const by = String(a.by ?? ""), c = computedOf(by);
        if (c) { fieldOf(sid, merged, c.a, ["number"]); fieldOf(sid, merged, c.b, c.fn === "per_hour" ? ["date", "ago"] : ["number"]); }
        else if (/\(/.test(by)) errors.push(`${sid}: rank by "${by}" is neither a field nor per_hour(count, age) or ratio(a, b).`);
        else fieldOf(sid, merged, by, NUMERIC);
        break;
      }
      case "top": if (!Number.isInteger(a.n) || a.n < 1) errors.push(`${sid}: top needs a whole number n.`); break;
      case "for_each": {
        const max = a.max;
        if (!Number.isInteger(max) || max < 1) errors.push(`${sid}: for_each needs a whole number max.`);
        const p = product(sid, a.product, a.input, true);
        for (const f of templateFields(a.input)) fieldOf(sid, merged, f);
        if (!templateFields(a.input).length) errors.push(`${sid}: a for_each input names no {{item.<field>}}, so every call would be the same.`);
        if (p && Number.isInteger(max)) { cost += p.priceUSD * max; calls += max; }
        out.set(sid, { fields: RESULT_SHAPES[String(a.product)]?.fields ?? null, from: String(a.product), parts: [{ from: String(a.product), fields: RESULT_SHAPES[String(a.product)]?.fields ?? null }] });
        continue;
      }
    }
    out.set(sid, merged);
  }
  const costUSD = Number(cost.toFixed(4));
  if (costUSD > budgetUSD + 1e-9) errors.push(`It costs $${costUSD.toFixed(2)} at live prices, more than the $${budgetUSD.toFixed(2)} budget.`);
  if (typeof plan.est_total_usd === "number" && Math.abs(plan.est_total_usd - costUSD) > 0.011) warnings.push(`The plan said $${plan.est_total_usd}; live prices say $${costUSD.toFixed(2)}.`);
  return { ok: !errors.length, errors, warnings, costUSD, calls };
}

/** One code move over items already bought. Pure. */
export function runMove(step, inputs, kinds, now = Date.now()) {
  const a = step.args ?? {};
  const items = inputs.flat();
  const num = (it, f) => numberOf(it[f], kinds[f], now);
  switch (step.move) {
    case "merge": return items;
    case "dedupe": {
      const seen = new Set(), f = String(a.by);
      return items.filter((it) => { const k = JSON.stringify(it[f] ?? null); if (it[f] == null || !seen.has(k)) { seen.add(k); return true; } return false; });
    }
    case "filter": {
      const f = String(a.field), op = String(a.op), v = a.value;
      return items.filter((it) => {
        if (op === "contains" || op === "not_contains") {
          const has = String(it[f] ?? "").toLowerCase().includes(String(v ?? "").toLowerCase());
          return op === "contains" ? has : !has;
        }
        if (op === "==" || op === "!=") return (String(it[f]) === String(v)) === (op === "==");
        const x = num(it, f), y = typeof v === "number" ? v : numberOf(v, kinds[f] === "money" ? "money" : "number", now);
        if (x === undefined || y === undefined) return false;
        return op === ">=" ? x >= y : x <= y;
      });
    }
    case "rank": {
      const by = String(a.by), c = computedOf(by), desc = a.order !== "asc";
      const score = (it) => {
        if (!c) return num(it, by);
        const x = num(it, c.a), y = num(it, c.b);
        if (x === undefined || y === undefined) return undefined;
        return c.fn === "per_hour" ? x / Math.max(1, y) : y === 0 ? undefined : x / y;
      };
      const scored = items.map((it, i) => ({ it, i, s: score(it) }));
      return scored.sort((p, q) => (p.s === undefined ? 1 : 0) - (q.s === undefined ? 1 : 0) || (p.s !== undefined && q.s !== undefined ? (desc ? q.s - p.s : p.s - q.s) : 0) || p.i - q.i).map((x) => x.it);
    }
    case "top": return items.slice(0, Math.max(0, Number(a.n) || 0));
    default: return items;
  }
}

/** A for_each step's calls: one input per item, at most `max`, each {{item.field}} filled from the item. */
export function forEachInputs(step, items) {
  return forEachCalls(step, items).map((c) => c.input);
}
/** The same calls, each with the item it was filled from (so a page read from a Google result keeps its place). */
export function forEachCalls(step, items) {
  const a = step.args ?? {}, max = Math.max(0, Number(a.max) || 0), tpl = a.input ?? {};
  const out = [];
  for (const it of items) {
    if (out.length >= max) break;
    let missing = false;
    const fill = (v) => typeof v === "string"
      ? v.replace(TEMPLATE, (_m, f) => { const x = it[f]; if (x == null || x === "") missing = true; return String(x ?? ""); })
      : v;
    const input = Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v)]));
    if (!missing) out.push({ input, item: it });
  }
  return out;
}

/** The product list a planner reads: each product's price, what it does, its inputs, and the fields of its items.
 *  `descChars` and `optChars` cap each description and each option's words (a shorter sheet for a planner that takes
 *  fewer characters, #7065). */
export function plannerSheet(products, { descChars = 600, optChars = 220 } = {}) {
  return products.map((p) => {
    const shape = RESULT_SHAPES[p.id];
    return [
      `- ${p.id}: ${p.name}. $${p.priceUSD} a call${p.priceFrom ? " (at least; quoted per call)" : ""}. ${String(p.description || "").replace(/\s+/g, " ").slice(0, descChars)}`,
      `  example input: ${JSON.stringify(p.input ?? {})}`,
      ...(p.inputOptions ?? []).map((o) => `  option ${o.field}${o.required ? " (required)" : ""}: ${String(o.description || "").replace(/\s+/g, " ").slice(0, optChars)}`),
      shape
        ? `  returns items with: ${Object.entries(shape.fields).map(([f, k]) => `${f} (${k})`).join(", ")}${shape.whole?.length ? `; the last item holds only ${shape.whole.map((w) => w.split(".").pop()).join(", ")}, the product's own written answer` : ""}`
        : "  returns: no recorded result yet, so a move may not read its fields (buy it as a step only)",
    ].join("\n");
  }).join("\n");
}

/** The shelf the checker reads, from the same catalog rows as the sheet. */
export function shelfFrom(products) {
  return Object.fromEntries(products.map((p) => [p.id, {
    priceUSD: p.priceUSD, health: p.health, priceFrom: p.priceFrom,
    inputs: [...new Set([...Object.keys(p.input ?? {}), ...(p.inputOptions ?? []).map((o) => o.field)])],
    required: requiredInputs(p),
    rules: Object.fromEntries((p.inputOptions ?? []).map((o) => [o.field, inputRule(o)]).filter(([, r]) => r)),
  }]));
}

/** The inputs a product cannot go without: those in its example input and those its options mark required. */
export function requiredInputs(p) {
  return [...new Set([...Object.keys(p?.input ?? {}), ...(p?.inputOptions ?? []).filter((o) => o.required).map((o) => o.field)])];
}

/** What values an input option takes, from the catalog row: its listed choices, or a range its words state
 *  ("a whole number from 20 to 25", as Sippar's web-search says). Null when the row states neither. */
export function inputRule(o) {
  const choices = Array.isArray(o?.enum) ? o.enum : Array.isArray(o?.items?.enum) ? o.items.enum : null;
  const m = /whole number from (\d+) to (\d+)/i.exec(String(o?.description || ""));
  if (!choices && !m) return null;
  return { ...(choices ? { choices, list: o?.type === "array" } : {}), ...(m ? { min: Number(m[1]), max: Number(m[2]) } : {}) };
}

/** Why a value breaks its input rule, or null when it does not. A {{item.…}} value is filled later and not judged. */
export function inputProblem(rule, value) {
  if (!rule || (typeof value === "string" && /\{\{\s*item\./.test(value))) return null;
  if (rule.min !== undefined && !(Number.isInteger(value) && value >= rule.min && value <= rule.max)) return `must be a whole number from ${rule.min} to ${rule.max}`;
  if (rule.choices) {
    const vals = rule.list ? (Array.isArray(value) ? value : [value]) : [value];
    const bad = vals.filter((v) => !rule.choices.includes(v));
    if (bad.length) return `must be ${rule.list ? "a list of" : "one of"} ${rule.choices.join(", ")}`;
  }
  return null;
}

/** An input object with each optional input that breaks its rule left out (the product's default then applies), and
 *  what was left out. Sippar's web-search refused max_results 5 before payment on every search of a tech brief
 *  (Nuru-AI/sippar#7065, 2026-11-08): the plan passed because only input names were checked. */
export function fixInputs(input, prod) {
  if (!prod || !input || typeof input !== "object" || Array.isArray(input)) return { input, dropped: [] };
  const out = { ...input }, dropped = [];
  for (const [k, v] of Object.entries(input)) {
    const why = inputProblem(prod.rules?.[k], v);
    if (why && !(prod.required ?? []).includes(k)) { delete out[k]; dropped.push(`${k} ${JSON.stringify(v)} (${why})`); }
  }
  return { input: out, dropped };
}

/** The rules the planning model gets, the same closed list of moves the checker enforces. */
export const PLAN_RULES = [
  "You plan a job for an agent. The agent buys live data and services per call from a catalog; a plan is a list of paid calls to catalog products plus simple steps done by code between them. Code checks and runs the plan; the agent's own model writes the final answer from the data.",
  "STEPS BETWEEN PAID CALLS ARE CODE, NEVER A MODEL. Use only these moves, and in their args only fields the source step returns (each product lists them under \"returns items with\"; a product with no recorded result may be bought as a step, but no move may read its fields):",
  "- merge: join the items of earlier steps into one list. args: {}\n- dedupe: drop repeats. args: {\"by\": \"<field>\"}\n- filter: keep items whose field passes a test. args: {\"field\": \"<field>\", \"op\": \">=\" | \"<=\" | \"==\" | \"!=\" | \"contains\" | \"not_contains\", \"value\": <value>}. A number test on a date or ago field compares hours old (\"<=\", 168 is the last week); on a money field it reads the price.\n- rank: sort by a number field, or by one computed number. args: {\"by\": \"<field>\" | \"per_hour(<number field>, <date or ago field>)\" | \"ratio(<number field>, <number field>)\", \"order\": \"desc\" | \"asc\"}\n- top: keep the first n. args: {\"n\": <whole number>}\n- for_each: buy one product once per item of an earlier step. args: {\"product\": \"<id>\", \"input\": {\"<field>\": \"{{item.<field>}}\"}, \"max\": <whole number>}",
  "Products whose id starts with free- cost nothing: public data Nuru calls directly. Use one when it answers part of the job, alongside paid products, never instead of what the job needs. At most a few free calls in a plan.",
  "Use a product's example input as the shape of its input; keyword searches want two to four keywords, not sentences. Prefer products whose items the final answer can quote (text, body, snippet, excerpt fields).",
  "Answer with ONE JSON object and nothing else (no code fence, no text before or after), in this shape:",
  "{\"summary\":\"one line\",\"ask_first\":[\"anything the plan assumed that the person should confirm\"],\"steps\":[{\"id\":\"s1\",\"product\":\"<id>\",\"input\":{},\"why\":\"...\"},{\"id\":\"s2\",\"move\":\"<move>\",\"from\":[\"s1\"],\"args\":{},\"why\":\"...\"}],\"est_total_usd\":0.0,\"answer\":\"what the agent's model writes from the data, and what it must not claim\"}",
  "Step ids are s1, s2, ... in order; a step reads only steps before it. Keep each \"why\" to one short sentence. At most 12 steps.",
].join("\n");

/** Description caps, longest first, for a sheet that must fit a character limit. */
export const SHEET_CUTS = [[600, 220], [400, 160], [300, 120], [240, 100], [160, 80], [100, 60]];
/** The fullest sheet of these products that fits `max` characters, or null when even the shortest does not. */
export function sheetWithin(products, max) {
  for (const [descChars, optChars] of SHEET_CUTS) {
    const sheet = plannerSheet(products, { descChars, optChars });
    if (sheet.length <= max) return sheet;
  }
  return null;
}
