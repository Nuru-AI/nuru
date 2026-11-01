// What Nuru can read, as a menu (Elad 2026-11-01: "a list of different providers so it will be easier for users to
// understand their options... something like the real mcp menu... add the logos of these providers"). Laid out as the
// connector page shows Sippar's menu (Nuru-AI/sippar demos/connector, the Look up section): topic chips across the top,
// the chosen topic's sources as logo rows under them, each with its price, or Free for the public sources Nuru calls
// itself. The rows are the card's own tile rows (stages.mjs). The list is the planner's own shelf, read live by the
// server (/api/sources), so it never names a source Nuru cannot use. Pure: html from a list.
import { metaOf, logoHtml } from "./stages.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const price = (p) => (p.free ? "Free" : `$${Number(p.priceUSD).toFixed(Number(p.priceUSD) < 0.1 ? 3 : 2)}${p.priceFrom ? " and up" : ""}`);

/** The topics, in the order a researcher reaches for them, each with its plain name and its icon: the connector
 *  page's own lucide icon where the connector has the topic (Look up), the nearest lucide icon for Nuru's own. */
export const TOPICS = [
  ["search", "Web", "globe"], ["research", "Research", "book-open"], ["social", "Social", "message-circle"],
  ["news", "News", "newspaper"], ["company", "Companies", "building-2"], ["crypto", "Crypto", "boxes"],
  ["health", "Health", "heart-pulse"], ["data", "Science and data", "flask-conical"], ["reference", "Reference", "library"],
  ["travel", "Travel", "plane"], ["shopping", "Shopping", "shopping-cart"], ["jobs", "Jobs", "briefcase-business"],
  ["code", "Code", "code"], ["models", "AI models", "bot"], ["more", "More", "layers"],
];
/** A lucide icon from public/icons.js, or nothing when the file has not loaded (the chip keeps its words). */
export const icon = (n, s = 16) => {
  const g = globalThis.NURU_ICONS?.[n];
  return g ? `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>` : "";
};
/** A source's topic: the catalog's own, with a few moved to where a reader looks for them. */
export function topicOf(p) {
  if (p.id === "paper-search") return "research";
  if (p.id === "healthparse") return "health";
  if (["workflows", "images"].includes(p.topic)) return "models";
  return TOPICS.some(([k]) => k === p.topic) ? p.topic : "more";
}

/** The paid / free switch (Elad 2026-11-01: "a toggle for free/paid products"): All, Paid or Free, each with its count. */
const KINDS = [["all", "All"], ["paid", "Paid"], ["free", "Free"]];
const ofKind = (k) => (p) => k === "free" ? !!p.free : k === "paid" ? !p.free : true;

/** The menu: the paid / free switch, chips for every topic that has a source of that kind, and the open topic's rows. */
export function menuHtml(all, ui = {}) {
  if (!all.length) return `<p class="hint">The list of sources could not be read just now.</p>`;
  const kind = KINDS.some(([k]) => k === ui.kind) ? ui.kind : "all";
  const sw = `<div class="kind-sw" role="radiogroup" aria-label="Show sources">${KINDS.map(([k, name]) =>
    `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === kind}" tabindex="${k === kind ? 0 : -1}">${name} <span class="n">${all.filter(ofKind(k)).length}</span></button>`).join("")}</div>`;
  const sources = all.filter(ofKind(kind));
  const by = new Map();
  for (const p of sources) { const k = topicOf(p); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  const topics = TOPICS.filter(([k]) => by.has(k));
  if (!topics.length) return `${sw}<p class="hint">No ${kind} sources just now.</p>`;
  const open = by.has(ui.topic) ? ui.topic : topics[0][0];
  const rows = by.get(open).slice().sort((a, b) => Number(!!b.free) - Number(!!a.free) || a.priceUSD - b.priceUSD);
  // Six topics up front, the rest a tap away (critique: fifteen chips beside the question competed with it); the open
  // topic always shows. One Tab stop for the row: the chosen topic; arrow keys move between them (the page wires it).
  const FIRST = 6;
  const shown = ui.all ? topics : topics.filter(([k], i) => i < FIRST || k === open);
  const more = topics.length > FIRST ? `<button type="button" class="more-topics" data-moretopics aria-expanded="${!!ui.all}">${ui.all ? "Fewer topics" : `More topics (${topics.length - shown.length})`}</button>` : "";
  return `${sw}
    <div class="examples menu-chips"><div role="tablist" aria-label="Topics" class="menu-tabs">${shown.map(([k, name, ic]) =>
      `<button type="button" role="tab" data-topic="${k}" aria-selected="${k === open}" tabindex="${k === open ? 0 : -1}" id="mt-${k}" aria-controls="menu-rows">${icon(ic)}${esc(name)} <span class="n">${by.get(k).length}</span></button>`).join("")}</div>${more}</div>
    <ul class="wf-rows menu-rows" id="menu-rows" role="tabpanel" aria-labelledby="mt-${open}">${rows.map((p) => {
      // Nuru's own table first, so every platform reads the way the connector's menu presents it; else the catalog's.
      const own = metaOf(p.id), m = own.label !== p.id ? own : metaOf(p.id, { label: p.shortName, source: p.source, seller: p.name });
      return `<li class="wf-row lg">${logoHtml(m)}<span class="pt-main"><span class="pt-name">${esc(m.label)}</span><span class="pt-src">${esc(m.source)}</span></span><span class="wf-st ${p.free ? "ok" : "muted"}">${esc(price(p))}</span></li>`;
    }).join("")}</ul>`;
}
