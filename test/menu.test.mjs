// What Nuru can read (public/menu.mjs), over the planner's own shelf. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuHtml, topicOf } from "../public/menu.mjs";
import { sourcesOf } from "../lib/catalog.mjs";
import { FREE_SOURCES, freeRow } from "../lib/free.mjs";

const paid = [
  { id: "paper-search", name: "Paper search", shortName: "Papers", source: "Crossref · arXiv · PubMed", topic: "search", priceUSD: 0.08, summary: "Scholarly paper records." },
  { id: "grounded-search", name: "Grounded web search", shortName: "Answers", source: "Tavily", topic: "search", priceUSD: 0.05 },
  { id: "council", name: "Model council", topic: "models", priceUSD: 0.7, priceFrom: true },
];
const sources = sourcesOf({ products: [...paid, ...FREE_SOURCES.map(freeRow)] });

test("every source sits under a topic a reader looks in", () => {
  assert.equal(topicOf({ id: "paper-search", topic: "search" }), "research");
  assert.equal(topicOf({ id: "free-openfda-drug-recalls", topic: "health" }), "health");
  assert.equal(topicOf({ id: "x", topic: "workflows" }), "models");
  assert.equal(topicOf({ id: "x", topic: "something-new" }), "more");
});

test("the menu counts paid and free, opens one topic, and prices each row", () => {
  const html = menuHtml(sources, { topic: "research" });
  assert.match(html, /data-kind="all" aria-checked="true"[^>]*>All <span class="n">17</);
  assert.match(html, /data-kind="paid"[^>]*>Paid <span class="n">3</);
  assert.match(html, /data-kind="free"[^>]*>Free <span class="n">14</);
  assert.match(html, /data-topic="research" aria-selected="true"/);
  assert.match(html, /Scholarly works/);
  assert.match(html, /wf-st ok">Free</);
  assert.match(html, /\$0\.080</);
  assert.doesNotMatch(html, /Answers/, "a closed topic's rows are not drawn");
});

test("free rows come first in a topic, then the cheapest paid", () => {
  const html = menuHtml(sources, { topic: "research" });
  assert.ok(html.indexOf("Scholarly works") < html.indexOf(">Papers<"), "free before paid");
});

test("the switch shows only paid or only free sources, and their topics", () => {
  const free = menuHtml(sources, { kind: "free", topic: "research" });
  assert.match(free, /data-kind="free" aria-checked="true"/);
  assert.match(free, /Scholarly works/);
  assert.doesNotMatch(free, /\$0\.080|>Papers</, "no paid row under Free");
  const paidOnly = menuHtml(sources, { kind: "paid", topic: "research" });
  assert.match(paidOnly, />Papers</);
  assert.doesNotMatch(paidOnly, /wf-st ok">Free</, "no free row under Paid");
  assert.doesNotMatch(paidOnly, /data-topic="health"/, "a topic with only free sources is not offered under Paid");
});

test("a source priced per request says so", () => {
  assert.match(menuHtml(sources, { topic: "models" }), /\$0\.70 and up/);
});

test("an empty list says the list could not be read, never an empty menu", () => {
  assert.match(menuHtml([]), /could not be read/);
});

test("nothing from the catalog is drawn unescaped", () => {
  const html = menuHtml([{ id: "evil", name: "<img src=x onerror=alert(1)>", topic: "search", priceUSD: 0.01, summary: "<script>x</script>" }], {});
  assert.doesNotMatch(html, /<img src=x|<script>/);
});


test("six topics up front, the rest behind More topics; the open topic always shows", () => {
  const many = sourcesOf({ products: ["search","social","news","company","crypto","health","data","reference","travel"].map((topic, i) => ({ id: `p${i}`, name: `P${i}`, topic, priceUSD: 0.01 })) });
  const html = menuHtml(many, {});
  assert.equal((html.match(/role="tab"/g) || []).length, 6);
  assert.match(html, /More topics \(3\)/);
  assert.equal((menuHtml(many, { all: true }).match(/role="tab"/g) || []).length, 9);
  assert.match(menuHtml(many, { topic: "travel" }), /data-topic="travel" aria-selected="true"/, "a chosen later topic still shows");
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) || []).length, 1, "one Tab stop for the topic row");
  assert.equal((html.match(/role="radio"[^>]*tabindex="0"/g) || []).length, 1, "one Tab stop for the switch");
});

test("each topic chip carries its icon once the icon file has loaded, and only words before", async () => {
  assert.doesNotMatch(menuHtml(sources, { topic: "research" }), /<svg class="i"/, "no icon file, no icon");
  await import("../public/icons.js");
  const html = menuHtml(sources, { topic: "research" });
  assert.match(html, /data-topic="research"[^>]*><svg class="i"[^>]*aria-hidden="true">/);
  for (const [, , ic] of (await import("../public/menu.mjs")).TOPICS) assert.ok(globalThis.NURU_ICONS[ic], `icon ${ic} is in icons.js`);
});

test("social platforms read as the connector presents them, by name and what each reads, whatever the catalog says", () => {
  const social = sourcesOf({ products: [
    { id: "sippar-facebook-social", name: "Facebook Social Media (Meta Ad Library and page posts)", topic: "social", priceUSD: 0.02 },
    { id: "instagram-social", name: "Instagram Social Media", shortName: "Instagram", source: "Instagram", topic: "social", priceUSD: 0.02 },
  ] });
  const html = menuHtml(social, { topic: "social" });
  assert.match(html, />Facebook<\/span><span class="pt-src">Posts, reels, reviews, events, comments and ads</);
  assert.match(html, />Instagram<\/span><span class="pt-src">Posts, reels, profiles, hashtags and comments</);
  assert.doesNotMatch(html, /Facebook ads|Meta Ad Library/);
});
