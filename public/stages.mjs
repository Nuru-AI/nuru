// How a brief was made, drawn the way Sippar's MCP card draws a planned workflow (Elad 2026-11-01: "use the same ui as
// the mcp card box workflows"). Ported from the card's own views (Nuru-AI/sippar src/mcp-apps/payment-card/src
// planned.ts and trends.ts, card build 80b0da688a8d): the numbered stage list, each stage opening into its rows, each row
// a product's logo tile with its name over what it asked, and its state in words beside its mark, never by colour alone.
// The words are Nuru's own, so every line is true of a Nuru run: who planned it (Sippar's workflow planner, or Nuru's own
// planner when Sippar's plan could not be read), what was bought or called free, what code kept, what was quoted.
// Pure: it returns html from a run (a saved one, or the one being built live) and never calls anything.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** A link only to an http(s) page; anything else is drawn as text. */
const link = (url, text) => /^https?:\/\//i.test(String(url ?? "")) ? `<a class="linkish" href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : `<span>${esc(text)}</span>`;
/** A date as a person reads it: "20260708" (openFDA's own form) becomes 2026-07-08; an ISO time keeps its day. */
const day = (d) => { const s = String(d); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s.slice(0, 10); };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (n) => `$${Number(n || 0).toFixed(Number(n) > 0 && Number(n) < 0.1 ? 3 : 2)}`;

/** Each product's short name, source and site for its logo: the card's own table (catalog.ts META), plus the free
 *  public sources Nuru calls directly (lib/free.mjs). A product with no site gets the card's letter tile, never a guess. */
export const META = {
  "workflow-planner": { label: "Workflow plan", source: "Sippar workflow planner", site: "sippar.network" },
  "sippar-news-search": { label: "News", source: "Google News", site: "news.google.com" },
  "dataconomy-search": { label: "Dataconomy articles", source: "Dataconomy", site: "dataconomy.com" },
  "dataconomy-article": { label: "One Dataconomy article", source: "Dataconomy", site: "dataconomy.com" },
  "grounded-search": { label: "Answers", source: "Tavily", site: "tavily.com" },
  "tavily-web-search": { label: "Web results", source: "Tavily", site: "tavily.com" },
  "google-results": { label: "Google results", source: "Google", site: "google.com" },
  "web-content": { label: "Page text", source: "Apify", site: "apify.com" },
  "social-search": { label: "Social listening", source: "3 networks", site: "sippar.network" },
  "sippar-x-social": { label: "X posts", source: "X", site: "x.com" },
  "sippar-reddit-social": { label: "Reddit posts", source: "Reddit", site: "reddit.com" },
  "sippar-linkedin-social": { label: "LinkedIn posts", source: "LinkedIn", site: "linkedin.com" },
  "sippar-facebook-social": { label: "Facebook ads", source: "Meta Ad Library", site: "facebook.com" },
  "sippar-video-search": { label: "YouTube videos", source: "YouTube", site: "youtube.com" },
  "sippar-flight-search": { label: "Flights", source: "Google Flights", site: "google.com" },
  "sippar-hotel-search": { label: "Hotels", source: "Google Maps", site: "maps.google.com" },
  "sippar-amazon": { label: "Amazon", source: "Amazon", site: "amazon.com" },
  "sippar-job-search": { label: "Jobs", source: "Google for Jobs", site: "google.com" },
  "token-intel": { label: "Token data", source: "Nansen", site: "nansen.ai" },
  "nansen-crypto-screener": { label: "Top tokens", source: "Nansen", site: "nansen.ai" },
  "quicknode-blockchain-data": { label: "Chain data", source: "QuickNode", site: "quicknode.com" },
  "sippar-github": { label: "GitHub", source: "GitHub", site: "github.com" },
  "sippar-skills": { label: "Agent skills", source: "skills.sh", site: "skills.sh" },
  "company-intel": { label: "Company profile", source: "CompanyEnrich", site: "companyenrich.com" },
  "company-funding": { label: "Funding history", source: "SEC EDGAR", site: "sec.gov" },
  "funding-events": { label: "New raises", source: "SEC EDGAR", site: "sec.gov" },
  "paper-search": { label: "Papers", source: "Scholarly papers (open metadata)" },
  "property-intel": { label: "Roof & solar", source: "Google Solar", site: "google.com" },
  "crypto-skills": { label: "Crypto skills", source: "CryptoSkill", site: "cryptoskill.org" },
  "healthparse": { label: "Healthcare", source: "HealthParse" },
  "instagram-social": { label: "Instagram", source: "Instagram", site: "instagram.com" },
  "tiktok-social": { label: "TikTok", source: "TikTok", site: "tiktok.com" },
  "apify-actors": { label: "Apify Store", source: "Apify", site: "apify.com" },
  "image-generation": { label: "Sippar's pick", source: "Qwen or Z-Image", site: "antseed.com" },
  "ai-visibility": { label: "AI visibility", source: "AI models via AntSeed", site: "antseed.com" },
  "second-opinion": { label: "Second opinion", source: "AI models via AntSeed", site: "antseed.com" },
  "council": { label: "Model council", source: "AI models via AntSeed", site: "antseed.com" },
  "media-workflow": { label: "Media workflow", source: "AI models via AntSeed", site: "antseed.com" },
  "free-openalex-works": { label: "Scholarly works", source: "OpenAlex", site: "openalex.org" },
  "free-crossref-works": { label: "Publication records", source: "Crossref", site: "crossref.org" },
  "free-arxiv-papers": { label: "Preprints", source: "arXiv", site: "arxiv.org" },
  "free-sec-edgar-search": { label: "Company filings", source: "SEC EDGAR", site: "sec.gov" },
  "free-openfda-drug-recalls": { label: "Drug recalls", source: "openFDA", site: "fda.gov" },
  "free-usgs-earthquakes": { label: "Earthquakes", source: "USGS", site: "usgs.gov" },
  "free-nasa-power-daily": { label: "Daily weather", source: "NASA POWER", site: "nasa.gov" },
  "free-worldbank-indicator": { label: "Country indicators", source: "World Bank", site: "worldbank.org" },
  "free-gbif-species": { label: "Species names", source: "GBIF", site: "gbif.org" },
  "free-wikipedia-search": { label: "Wikipedia articles", source: "Wikipedia", site: "wikipedia.org" },
  "free-npm-packages": { label: "npm packages", source: "npm", site: "npmjs.com" },
  "free-openlibrary-books": { label: "Books", source: "Open Library", site: "openlibrary.org" },
  "free-coingecko-markets": { label: "Coin prices", source: "CoinGecko", site: "coingecko.com" },
  "free-defillama-tvl": { label: "Protocol TVL", source: "DefiLlama", site: "defillama.com" },
  // The fixed list Nuru falls back to when no catalog plan runs (lib/tools.mjs).
  web_search: { label: "Web search", source: "Tavily", site: "tavily.com" },
  read_page: { label: "Read a page", source: "Apify", site: "apify.com" },
  news: { label: "News", source: "Google News", site: "news.google.com" },
  dataconomy_search: { label: "Dataconomy articles", source: "Dataconomy", site: "dataconomy.com" },
  dataconomy_article: { label: "One Dataconomy article", source: "Dataconomy", site: "dataconomy.com" },
  papers: { label: "Papers", source: "Scholarly papers (open metadata)" },
};

/** The makers of the free chat models a visitor may pick, by the first part of the model id. A maker with no entry
 *  shows its name and first letter, never a guessed logo. */
export const MAKERS = {
  nvidia: { name: "NVIDIA", site: "nvidia.com" }, poolside: { name: "Poolside", site: "poolside.ai" },
  meta: { name: "Meta", site: "meta.ai" }, "meta-llama": { name: "Meta", site: "meta.ai" }, qwen: { name: "Qwen", site: "qwen.ai" },
  deepseek: { name: "DeepSeek", site: "deepseek.com" }, mistralai: { name: "Mistral", site: "mistral.ai" }, google: { name: "Google", site: "gemini.google.com" },
  openai: { name: "OpenAI", site: "openai.com" }, "z-ai": { name: "Z.ai", site: "z.ai" }, moonshotai: { name: "Moonshot", site: "moonshot.ai" },
};
export function makerOf(id) {
  const k = String(id || "").split("/")[0].toLowerCase();
  return MAKERS[k] ?? { name: k ? k[0].toUpperCase() + k.slice(1) : "Model" };
}
export const makerLogo = (maker) => logoHtml({ label: maker.name, source: maker.name, site: maker.site });

/** A product's label, source and site: the step's own words from the catalog when the run kept them, else the table,
 *  else the seller's name. */
export function metaOf(id, step = {}) {
  const own = META[id] ?? {};
  return { label: step.label || own.label || step.seller || id, source: step.source || own.source || "", site: own.site };
}

/** The card's logo tile: the site's icon, with the first letter underneath for when no icon comes back. */
export function logoHtml(m) {
  const letter = esc((m.source || m.label).replace(/[^A-Za-z0-9]/g, "")[0]?.toUpperCase() ?? "?");
  // The logo engine's own copy (public/logos.js, built by scripts/build-logos.py) first; else the site's icon, live.
  const own = m.site ? globalThis.NURU_LOGOS?.[m.site] : undefined;
  const img = own && /^data:image\/png;base64,/.test(own)
    ? `<img src="${own}" alt="" width="20" height="20" decoding="async" data-fallback>`
    : m.site && /^[a-z0-9.-]+$/i.test(m.site)
    ? `<img src="https://icons.duckduckgo.com/ip3/${esc(m.site)}.ico" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer" data-fallback>`
    : "";
  return `<span class="ico plogo ${img ? "" : "failed"}" aria-hidden="true">${img}<span class="ico-l">${letter}</span></span>`;
}
const letterTile = (name) => `<span class="ico plogo failed" aria-hidden="true"><span class="ico-l">${esc(String(name).replace(/[^A-Za-z0-9]/g, "")[0]?.toUpperCase() ?? "?")}</span></span>`;

const svg = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const STAGE_CHIP = {
  planned: (n) => `<span class="wf-num" role="img" aria-label="Step ${n}, waiting">${n}</span>`,
  running: (n) => `<span class="wf-num busy" role="img" aria-label="Step ${n}, running"><span class="wf-spin" aria-hidden="true"></span></span>`,
  done: (n) => `<span class="wf-num ok" role="img" aria-label="Step ${n}, done">${svg('<path d="M3.5 8.5l3 3 6-7"/>')}</span>`,
  warn: (n) => `<span class="wf-num warn" role="img" aria-label="Step ${n}, needs a look">${svg('<path d="M8 3.5v5.5"/><path d="M8 12.2v.3"/>')}</span>`,
};
/** One stage: its number or mark, its title, who did it, what came of it; open, the rows inside. (trends.ts stageHtml) */
function stageHtml(x, open) {
  const id = `wf-s${x.n}`;
  return `<li class="wf-stage st-${x.st} ${open ? "open" : ""}" ${x.st === "running" ? `aria-current="step"` : ""}>${STAGE_CHIP[x.st](x.n)}
    <button class="wf-shead" data-wfstage="${x.n}" aria-expanded="${open}" aria-controls="${id}">
      <span class="wf-stitle">${esc(x.title)}</span><span class="wf-who">${esc(x.who)}</span>
      <span class="wf-sout">${esc(x.out)}</span></button>
    ${open ? `<div class="wf-sbody" id="${id}">${x.body()}</div>` : ""}</li>`;
}

const MOVE_WORDS = { merge: "Put together", dedupe: "Drop repeats", filter: "Keep matches", rank: "Rank", top: "Keep the top", for_each: "For each" };
/** A code move's args, in words a person reads ("year at least 2020", "by citedBy, highest first"). */
export function moveWords(move, a = {}) {
  const op = { ">=": "at least", "<=": "at most", "==": "is", "!=": "is not", contains: "contains", not_contains: "does not contain" };
  switch (move) {
    case "filter": return `${a.field} ${op[a.op] ?? a.op} ${typeof a.value === "string" ? `“${a.value}”` : a.value}`;
    case "rank": return `by ${a.by}, ${a.order === "asc" ? "lowest" : "highest"} first`;
    case "top": return `the first ${a.n}`;
    case "dedupe": return `by ${a.by}`;
    case "for_each": return `${metaOf(a.product).label}, up to ${a.max}`;
    default: return "";
  }
}

const isPlanStep = (s) => s.tool === "workflow-planner";
const isMove = (s) => String(s.tool || "").startsWith("code:");
const productId = (s) => String(s.tool || "").replace(/^for each:\s*/, "");
const asked = (s) => String(s.input?.query ?? s.input?.url ?? s.input?.ids ?? s.input?.protocol ?? s.input?.request ?? (s.input && Object.keys(s.input).length ? Object.values(s.input).join(", ") : "")).slice(0, 160);

/** A bought or free step's state beside its mark (trends.ts chip): price paid, free, no result, or not run. */
function chip(s, live) {
  if (live) return `<span class="wf-st busy"><span class="wf-spin" aria-hidden="true"></span>Working</span>`;
  if (s.skipped) return `<span class="wf-st muted"><span aria-hidden="true">✕</span> Not run</span>`;
  if (s.error && !s.payment?.tx) return `<span class="wf-st warn"><span aria-hidden="true">!</span> No result</span>`;
  if (s.error) return `<span class="wf-st warn"><span aria-hidden="true">!</span> ${esc(usd(s.payment.priceUsd))}, no result</span>`;
  if (s.payment?.tx) return `<span class="wf-st ok"><span aria-hidden="true">✓</span> ${esc(usd(s.payment.priceUsd))}</span>`;
  if (s.rail === "free" || s.payment?.note) return `<span class="wf-st ok"><span aria-hidden="true">✓</span> Free</span>`;
  return `<span class="wf-st muted">Waiting</span>`;
}
const stOfSteps = (xs, live) => !xs.length ? (live ? "planned" : "done")
  : xs.some((x) => x.n === live) ? "running"
  : xs.some((x) => x.error && !x.skipped) ? "warn" : "done";

/** A step's row: its logo, its name over what it asked, its state; one with documents opens into them. */
function stepRow(s, ui, liveN) {
  const id = productId(s), m = metaOf(id, s);
  const what = s.error ? s.error : s.skipped ? s.skipped : asked(s);
  // Since #6408 a run keeps which documents were read (what the plan's code steps kept); an older run read them all.
  const k = s.documents?.length && ui.readSet ? s.documents.filter((d) => ui.readSet.has(d.id)).length : s.documents?.length ?? 0;
  const n = s.documents?.length ? (k === s.documents.length ? ` · ${k} read` : ` · ${s.documents.length} found, ${k} read`) : typeof s.items === "number" ? ` · ${s.items} items` : "";
  const inner = `${logoHtml(m)}<span class="pt-main"><span class="pt-name">${esc(m.label)}${s.tool?.startsWith("for each:") ? " (for each)" : ""}</span><span class="pt-src">${esc(m.source)}${esc(n)}</span><span class="pt-src wf-said">${esc(what)}</span></span>${chip(s, liveN === s.n)}`;
  if (!s.documents?.length) return `<li class="wf-row lg">${inner}</li>`;
  const open = ui.row === s.n;
  return `<li class="wf-step st-done ${open ? "open" : ""}"><button class="wf-row lg" data-wfopen="${s.n}" aria-expanded="${open}">${inner}</button>${open
    ? `<div class="wf-body wf-open"><ol class="wf-list wf-items">${s.documents.slice(0, 8).map((d) => `<li>${link(d.url, String(d.title || d.url).slice(0, 140))}${d.date ? ` <span class="wf-nums">${esc(day(d.date))}</span>` : ""}</li>`).join("")}</ol>${s.documents.length > 8 ? `<p class="hint">${s.documents.length - 8} more read.</p>` : ""}</div>` : ""}</li>`;
}

/**
 * The five stages of a Nuru run: write the plan, buy the data, sort it in code, read the sources, write the brief.
 * `ui.phase` is where a live run is ("plan", "buy", "read", "write"); a saved run is "done". `who` names a served model
 * (the page's own byline words, so the two never disagree).
 */
export function stages(run, ui = {}, who = (s) => s?.model ?? "") {
  const phase = ui.phase ?? "done";
  ui = { ...ui, readSet: run.readDocIds ? new Set(run.readDocIds) : null };
  const at = ["plan", "buy", "read", "write", "done"].indexOf(phase);
  const st = (i, warn) => (at > i ? (warn ? "warn" : "done") : at === i ? "running" : "planned");
  const steps = run.steps ?? [];
  const planBuy = steps.find(isPlanStep);
  const plan = run.plan;
  const by = run.servedBy?.planner;
  const sipparPlanned = by?.provider === "sippar";

  // 1. The plan: Sippar's workflow planner first; Nuru's own planner when Sippar's plan could not be read or bought.
  const writtenBy = by?.model ? `, written by ${who(by)}${by.seller ? ` at ${by.seller}` : ""}` : "";
  const planWho = !plan && phase === "plan" ? "Sippar's workflow planner" : sipparPlanned
    ? `Sippar's workflow planner${writtenBy}`
    : plan ? `Nuru's own planner${writtenBy}` : "Nuru's fixed list of sources";
  const planFailed = planBuy && planBuy.error;
  const s1 = { n: 1, title: "Write the plan", who: planWho, st: st(0, !plan || !!planFailed),
    out: plan ? `${plural(plan.steps.length, "step")}${planFailed ? `. Sippar's plan cost ${usd(planBuy.payment?.priceUsd)} and could not be used, so Nuru's own planner wrote this one` : planBuy?.payment?.priceUsd ? `; the plan cost ${usd(planBuy.payment.priceUsd)}` : ", planned free"}` : phase === "plan" ? "Writing" : "No plan; Nuru read its fixed list",
    body: () => [
      planBuy ? `<ul class="wf-rows">${stepRow({ ...planBuy, input: {}, error: planFailed ? `${planBuy.error}. Nuru's own planner wrote the plan instead.` : "" , documents: [] }, ui, ui.live)}</ul>` : "",
      sipparPlanned && by.skills?.length ? `<p class="hint">Guided by the skill${by.skills.length > 1 ? "s" : ""} ${by.skills.map((k) => esc(k.name || k.id)).join(" and ")}.</p>` : "",
      plan?.summary ? `<p>${esc(plan.summary)}</p>` : "",
      plan?.ask_first?.length ? `<h3 class="wf-h">What the plan assumed</h3><ul class="wf-list">${plan.ask_first.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "",
      plan ? `<h3 class="wf-h">Steps</h3><ul class="wf-rows">${plan.steps.map((q) => {
        if (q.product) { const m = metaOf(q.product); return `<li class="wf-row lg">${logoHtml(m)}<span class="pt-main"><span class="pt-name">${esc(m.label)}</span><span class="pt-src">${esc(m.source)}</span><span class="pt-src wf-said">${esc(q.why || asked(q))}</span></span><span></span></li>`; }
        const name = MOVE_WORDS[q.move] ?? q.move;
        return `<li class="wf-row lg">${letterTile(name)}<span class="pt-main"><span class="pt-name">${esc(name)}</span><span class="pt-src">${esc(moveWords(q.move, q.args))}</span><span class="pt-src wf-said">${esc(q.why || "Done in code, no model.")}</span></span><span></span></li>`;
      }).join("")}</ul>` : "",
      plan?.check ? `<p class="hint">Nuru's check: ${plan.check.ok ? `passed, ${plan.check.calls} calls at ${esc(usd(plan.check.costUSD))} by live prices` : "refused"}.${plan.corrections?.length ? ` ${esc(plan.corrections.join(" "))}` : ""}</p>` : "",
      !plan && phase === "plan" ? `<p class="hint">Sippar's workflow planner writes a plan over Sippar's products and the free public sources. Nuru checks it in code before anything is bought.</p>` : "",
    ].join("") };

  // 2. The data: every purchase and every free call, in the order they ran.
  const bought = steps.filter((s) => !isPlanStep(s) && !isMove(s));
  const paid = bought.reduce((a, s) => a + (s.payment?.tx ? s.payment.priceUsd || 0 : 0), 0);
  const back = bought.filter((s) => !s.error && !s.skipped && (s.payment || s.items !== undefined)).length;
  const sources = [...new Set(bought.map((s) => metaOf(productId(s), s).source).filter(Boolean))];
  const s2 = { n: 2, title: "Buy the data", who: sources.join(", ") || "Sippar's products and free public sources", st: at < 1 ? "planned" : at === 1 ? "running" : stOfSteps(bought),
    out: bought.length ? `${back} of ${bought.length} back, ${usd(paid)} paid` : at <= 1 ? "Waiting" : "Nothing bought",
    body: () => bought.length ? `<ul class="wf-rows">${bought.map((s) => stepRow(s, ui, ui.live)).join("")}</ul>` : `<p class="hint">Runs once the plan passes the check.</p>` };

  // 3. The moves, done in code: what each kept.
  const moves = steps.filter(isMove);
  const s3 = { n: 3, title: "Sort it in code", who: "Nuru's code, no model", st: !moves.length ? (at >= 2 ? "done" : "planned") : moves.every((s) => typeof s.items === "number") ? "done" : "running",
    out: moves.length ? `${moves.length} ${moves.length === 1 ? "step" : "steps"}` : at >= 2 ? "None" : "Waiting",
    body: () => moves.length ? `<ul class="wf-rows">${moves.map((s) => { const mv = String(s.tool).replace(/^code:\s*/, ""), name = MOVE_WORDS[mv] ?? mv;
      return `<li class="wf-row lg">${letterTile(name)}<span class="pt-main"><span class="pt-name">${esc(name)}</span><span class="pt-src">${esc(moveWords(mv, s.input))}</span>${s.why ? `<span class="pt-src wf-said">${esc(s.why)}</span>` : ""}</span>${typeof s.items === "number" ? `<span class="wf-st ok"><span aria-hidden="true">✓</span> ${s.items} kept</span>` : `<span class="wf-st muted">Waiting</span>`}</li>`; }).join("")}</ul>` : `<p class="hint">This plan sorts nothing in code.</p>` };

  // 4. The reading: quotes pulled from each source, kept only when found word for word in what was bought.
  const claims = run.claims ?? [];
  const verified = claims.filter((c) => c.verified);
  const s4 = { n: 4, title: "Read the sources", who: run.models?.worker ? who({ model: run.models.worker }) : "a model", st: st(2, phase === "done" && !verified.length),
    out: at < 2 ? "Waiting" : at === 2 ? "Reading" : phase !== "done" ? "Read; the quotes show with the brief" : `${verified.length} of ${plural(claims.length, "quote")} found word for word`,
    body: () => verified.length ? `<ol class="wf-list">${verified.slice(0, 8).map((c) => `<li><q>${esc(String(c.quote).slice(0, 220))}</q> ${link(c.url, c.publisher || "source")}</li>`).join("")}</ol>${verified.length > 8 ? `<p class="hint">${verified.length - 8} more quotes.</p>` : ""}`
      : `<p class="hint">${at < 3 ? "Quotes show once the sources are read." : "No quote was found word for word in a bought source."}</p>` };

  // 5. The brief, beside these steps.
  const b = run.brief;
  const s5 = { n: 5, title: "Write the brief", who: run.servedBy?.writer ? who(run.servedBy.writer) : "a model", st: at < 3 ? "planned" : at === 3 ? "running" : b ? "done" : "warn",
    out: b ? `${b.points.length} points, ${b.gaps?.length ?? 0} gaps` : at === 3 ? "Writing" : "Waiting",
    body: () => b ? `<p class="hint">The brief is shown with these steps. A point stays only when the quote it cites was found word for word in a bought source${b.unsupportedPointsRemoved ? `; ${b.unsupportedPointsRemoved} point${b.unsupportedPointsRemoved > 1 ? "s were" : " was"} removed for that` : ""}.</p>` : `<p class="hint">Written from the quotes alone.</p>` };
  return [s1, s2, s3, s4, s5];
}

/** Which stage is open: the person's choice, else the one working now, else the data. */
export function openStage(list, ui) {
  if (ui.stage !== undefined) return ui.stage;
  return list.find((x) => x.st === "running")?.n ?? 2;
}

/** The whole list, in the card's frame. */
/** A finished brief's whole making in one line: who planned it, what was bought, what it cost and how many quotes
 *  were found word for word. The same numbers the stages and "Who was paid" show. */
export function summaryLine(run) {
  const steps = run.steps ?? [];
  const bought = steps.filter((s) => !isPlanStep(s) && !isMove(s));
  const paidN = bought.filter((s) => s.payment?.tx).length, freeN = bought.filter((s) => !s.payment?.tx && (s.rail === "free" || s.payment?.note)).length;
  const total = steps.reduce((a, s) => a + (s.payment?.tx ? s.payment.priceUsd || 0 : 0), 0);
  const by = run.servedBy?.planner;
  // Short on purpose (Elad 2026-11-01: "clean the page so there won't be so much text"); the steps hold the detail.
  const planned = by?.provider === "sippar" ? "Sippar's planner" : run.plan ? "Nuru's planner" : "Fixed list";
  const sources = [paidN ? `${paidN} bought` : "", freeN ? `${freeN} free` : ""].filter(Boolean).join(", ") || "no source read";
  const verified = (run.claims ?? []).filter((c) => c.verified).length;
  return [planned, sources, usd(total), `${plural(verified, "quote")} checked`].join(" · ");
}

export function stagesHtml(run, ui = {}, who) {
  // A finished brief shows its making as one line that opens to the steps; a live one shows the steps as they run.
  if (ui.collapsed) return `<button type="button" class="wf-sumline" data-wfall aria-expanded="false" aria-controls="wf-flow"><span>${esc(summaryLine(run))}</span><span class="wf-more-l">Show the steps</span></button>`;
  const list = stages(run, ui, who);
  const open = openStage(list, ui);
  return `${ui.phase === "done" ? `<button type="button" class="wf-sumline open" data-wfall aria-expanded="true" aria-controls="wf-flow"><span>${esc(summaryLine(run))}</span><span class="wf-more-l">Hide the steps</span></button>` : ""}<ol class="wf-flow" id="wf-flow" aria-label="How this brief was made">${list.map((x) => stageHtml(x, x.n === open)).join("")}</ol>`;
}

/** A logo that does not come back, or comes back as the icon service's tiny placeholder, shows its letter (results.ts). */
export function wireLogos(scope) {
  scope.querySelectorAll("img[data-fallback]").forEach((img) => {
    const box = () => img.closest(".ico, .cite-ico");
    const fail = () => box()?.classList.add("failed");
    const loaded = () => { if (img.naturalWidth > 0 && img.naturalWidth < 12) fail(); box()?.classList.add("loaded"); };
    if (img.complete) { if (img.naturalWidth === 0) fail(); else loaded(); return; }
    img.addEventListener("error", fail, { once: true });
    img.addEventListener("load", loaded, { once: true });
  });
}
