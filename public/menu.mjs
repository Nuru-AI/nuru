// What Nuru can read, as a menu (Elad 2026-11-01: "a list of different providers so it will be easier for users to
// understand their options... something like the real mcp menu... add the logos of these providers"). Laid out as the
// connector page shows Sippar's menu (Nuru-AI/sippar demos/connector, the Look up section): topic chips across the top,
// the chosen topic's sources as logo rows under them, each with its price, or Free for the public sources Nuru calls
// itself. The rows are the card's own tile rows (stages.mjs). The list is the planner's own shelf, read live by the
// server (/api/sources), so it never names a source Nuru cannot use. Pure: html from a list.
import { metaOf, logoHtml } from "./stages.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const price = (p) => (p.free ? "Free" : `$${Number(p.priceUSD).toFixed(Number(p.priceUSD) < 0.1 ? 3 : 2)}${p.priceFrom ? " and up" : ""}`);

/** The topics, in the order a researcher reaches for them, each with its plain name. */
export const TOPICS = [
  ["search", "Web"], ["research", "Research"], ["social", "Social"], ["news", "News"], ["company", "Companies"],
  ["crypto", "Crypto"], ["health", "Health"], ["data", "Science and data"], ["reference", "Reference"],
  ["travel", "Travel"], ["shopping", "Shopping"], ["jobs", "Jobs"], ["code", "Code"], ["models", "AI models"], ["more", "More"],
];
/** A source's topic: the catalog's own, with a few moved to where a reader looks for them. */
export function topicOf(p) {
  if (p.id === "paper-search") return "research";
  if (p.id === "healthparse") return "health";
  if (["workflows", "images"].includes(p.topic)) return "models";
  return TOPICS.some(([k]) => k === p.topic) ? p.topic : "more";
}

/** The menu: chips for every topic that has a source, the open topic's rows, and a count of paid and free. */
export function menuHtml(sources, ui = {}) {
  const by = new Map();
  for (const p of sources) { const k = topicOf(p); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  const topics = TOPICS.filter(([k]) => by.has(k));
  if (!topics.length) return `<p class="hint">The list of sources could not be read just now.</p>`;
  const open = by.has(ui.topic) ? ui.topic : topics[0][0];
  const free = sources.filter((p) => p.free).length;
  const rows = by.get(open).slice().sort((a, b) => Number(!!b.free) - Number(!!a.free) || a.priceUSD - b.priceUSD);
  // Six topics up front, the rest a tap away (critique: fifteen chips beside the question competed with it); the open
  // topic always shows. One Tab stop for the row: the chosen topic; arrow keys move between them (the page wires it).
  const FIRST = 6;
  const shown = ui.all ? topics : topics.filter(([k], i) => i < FIRST || k === open);
  const more = topics.length > FIRST ? `<button type="button" class="more-topics" data-moretopics aria-expanded="${!!ui.all}">${ui.all ? "Fewer topics" : `More topics (${topics.length - shown.length})`}</button>` : "";
  return `<p class="menu-count">${sources.length - free} paid through Sippar · ${free} free</p>
    <div class="examples menu-chips"><div role="tablist" aria-label="Topics" class="menu-tabs">${shown.map(([k, name]) =>
      `<button type="button" role="tab" data-topic="${k}" aria-selected="${k === open}" tabindex="${k === open ? 0 : -1}" id="mt-${k}" aria-controls="menu-rows">${esc(name)} <span class="n">${by.get(k).length}</span></button>`).join("")}</div>${more}</div>
    <ul class="wf-rows menu-rows" id="menu-rows" role="tabpanel" aria-labelledby="mt-${open}">${rows.map((p) => {
      const m = metaOf(p.id, { label: p.shortName, source: p.source, seller: p.name });
      return `<li class="wf-row lg">${logoHtml(m)}<span class="pt-main"><span class="pt-name">${esc(m.label)}</span><span class="pt-src">${esc(m.source)}</span></span><span class="wf-st ${p.free ? "ok" : "muted"}">${esc(price(p))}</span></li>`;
    }).join("")}</ul>`;
}
