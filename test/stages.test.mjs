// How a brief was made, in the card's frame (public/stages.mjs), over two real saved runs. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { stages, stagesHtml, metaOf, moveWords } from "../public/stages.mjs";

const run = (id) => JSON.parse(readFileSync(new URL(`./fixtures/saved-briefs/${id}.json`, import.meta.url), "utf8"));
// Sippar planned it; a free FDA source and a paid paper search were read (2026-11-01, free sources' first live brief).
const fda = run("2026-11-01T10-51-02-123Z");
// Sippar's plan came back empty and Nuru's own planner took over; a paper search, then a filter, a rank and a top.
const pubmed = run("2026-11-01T12-07-45-142Z");
const who = (s) => s?.model ?? "";

test("five stages, in the card's order", () => {
  assert.deepEqual(stages(fda, {}, who).map((x) => x.title), ["Write the plan", "Buy the data", "Sort it in code", "Read the sources", "Write the brief"]);
});

test("a plan Sippar wrote names Sippar's workflow planner; one Nuru wrote after Sippar's failed says so, with a mark", () => {
  const [a] = stages(fda, {}, who), [b] = stages(pubmed, {}, who);
  assert.match(a.who, /^Sippar's workflow planner, written by /);
  assert.equal(a.st, "done");
  assert.match(b.who, /^Nuru's own planner, written by /);
  assert.equal(b.st, "warn");
  assert.match(b.out, /Sippar's plan could not be used, so Nuru's own planner wrote this one/);
});

test("the data stage counts what came back and what was paid, from the run's own steps", () => {
  const [, d] = stages(fda, {}, who);
  assert.match(d.out, /^2 of 2 back, \$0\.080 paid$/);
  const html = d.body();
  assert.match(html, /Drug recalls/);
  assert.match(html, /✓<\/span> Free/, "a free source reads Free, never a price");
  assert.match(html, /✓<\/span> \$0\.080/);
  assert.match(html, /icons\.duckduckgo\.com\/ip3\/fda\.gov\.ico/, "the source's own site icon, as the card draws it");
});

test("code moves say what they kept, in words", () => {
  const [, , s] = stages(pubmed, {}, who);
  assert.equal(s.out, "3 steps");
  const html = s.body();
  assert.match(html, /Keep matches/);
  assert.match(html, /year at least 2020/);
  assert.match(html, /16 kept/);
  assert.equal(moveWords("rank", { by: "citedBy", order: "desc" }), "by citedBy, highest first");
});

test("the reading counts quotes found word for word; the brief stage counts points and gaps", () => {
  const [, , , r, w] = stages(pubmed, {}, who);
  assert.equal(r.out, "3 of 3 quotes found word for word");
  assert.match(stages({ ...pubmed, claims: [{ verified: true }] }, {}, who)[3].out, /^1 of 1 quote found/, "one quote, not one quotes");
  assert.equal(w.out, `${pubmed.brief.points.length} points, ${pubmed.brief.gaps.length} gaps`);
});

test("a live run: the stage at work is running, later ones wait, nothing claims to be done early", () => {
  const live = { steps: [{ n: 1, id: "plan", tool: "workflow-planner", input: {} }], servedBy: {} };
  const xs = stages(live, { phase: "plan" }, who);
  assert.deepEqual(xs.map((x) => x.st), ["running", "planned", "planned", "planned", "planned"]);
  const buying = stages({ ...pubmed, brief: undefined, claims: [] }, { phase: "buy", live: 2 }, who);
  assert.equal(buying[0].st, "warn");
  assert.equal(buying[1].st, "running");
  assert.equal(buying[3].out, "Waiting");
  const writing = stages({ ...pubmed, brief: undefined, claims: [] }, { phase: "write" }, who);
  assert.equal(writing[3].out, "Read; the quotes show with the brief", "a live run never shows 0 of 0 quotes as done");
  assert.match(stages({ ...pubmed, plan: { ...pubmed.plan, steps: pubmed.plan.steps.slice(0, 1) } }, {}, who)[0].out, /^1 step, /, "one step, not one steps");
});

test("one stage opens at a time: the visitor's choice, else the data", () => {
  assert.equal((stagesHtml(fda, {}, who).match(/class="wf-sbody"/g) || []).length, 1);
  assert.match(stagesHtml(fda, {}, who), /data-wfstage="2" aria-expanded="true"/);
  assert.match(stagesHtml(fda, { stage: 4 }, who), /data-wfstage="4" aria-expanded="true"/);
  assert.equal((stagesHtml(fda, { stage: null }, who).match(/class="wf-sbody"/g) || []).length, 0);
});

test("a row with documents opens into them, each a link", () => {
  const html = stagesHtml(fda, { row: 2 }, who);
  assert.match(html, /data-wfopen="2" aria-expanded="true"/);
  assert.match(html, /<a class="linkish" href="https:\/\/www\.accessdata\.fda\.gov/);
  assert.match(html, /<span class="wf-nums">2026-07-08<\/span>/, "openFDA's 20260708 read as a date");
});

test("names come from the card's table, then the run, never invented", () => {
  assert.deepEqual(metaOf("free-wikipedia-search"), { label: "Wikipedia articles", source: "Wikipedia", site: "wikipedia.org" });
  assert.equal(metaOf("paper-search").site, undefined, "no site, so the letter tile");
  assert.equal(metaOf("something-new", { seller: "A seller" }).label, "A seller");
});

test("nothing a source returned is drawn unescaped", () => {
  const evil = { steps: [{ n: 1, tool: "free-wikipedia-search", input: { query: "<img src=x onerror=alert(1)>" }, rail: "free", payment: { priceUsd: 0, note: "free" }, items: 1,
    documents: [{ title: "<script>x</script>", url: "javascript:alert(1)" }] }], claims: [], plan: undefined };
  const html = stagesHtml(evil, { row: 1 }, who);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.doesNotMatch(html, /href="javascript:/i, "only http(s) links are drawn as links");
});

test("a source's row says how many of its documents were read when the plan's code kept fewer (#6408)", () => {
  const ids = pubmed.steps[1].documents.slice(0, 10).map((d) => d.id);
  const html = stagesHtml({ ...pubmed, readDocIds: ids }, {}, who);
  assert.match(html, /20 found, 10 read/);
  assert.match(stagesHtml(pubmed, {}, who), /· 20 read/, "an older run, from before the read list, read them all");
});
