// Nuru-AI/sippar#7589, 2026-11-13: a brief failed at the writing step after $0.22 of sources (BlockRun's free Nemotron
// answered 429 "Free model capacity exhausted" and Token Factory failed too), the failure kept the visitor's run and left
// no record, and a research question's plan picked no free source. No network: models and catalog are faked. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeWithFallback } from "../lib/agent.mjs";
import { MODELS } from "../lib/tf.mjs";
import { freeNote } from "../lib/planner.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { freeSources, freeRow, FREE_SOURCES } from "../lib/free.mjs";
import { limits } from "../lib/limits.mjs";

const msgs = [{ role: "user", content: "write" }];
const capacity = (m) => new Error(`${m}: no provider answered (blockrun nvidia/nemotron-3-ultra-550b: 429 {"error":{"message":"Free model capacity exhausted"}}; tokenfactory ${m}: TimeoutError)`);
const ok = (provider) => ({ json: { title: "t", summary: "s", points: [], gaps: [] }, served: { provider, model: "m" } });

test("the writer model answers: one call, nothing else asked", async () => {
  const asked = [];
  const r = await writeWithFallback(msgs, { maxTokens: 9000, pick: "cohere/x" }, { chatImpl: async (m, _, o) => { asked.push([m, o.pick]); return ok("blockrun"); } });
  assert.deepEqual(asked, [[MODELS.writer, "cohere/x"]]);
  assert.equal(r.served.fellBack, undefined);
});

test("the writer model fails on every route: Nemotron Super writes it (Token Factory first), and the brief says what failed", async () => {
  const asked = [], events = [];
  const r = await writeWithFallback(msgs, { maxTokens: 9000, pick: "cohere/x" }, {
    onFallback: (e) => events.push(e),
    chatImpl: async (m, _, o) => { asked.push([m, o.pick]); if (m === MODELS.writer) throw capacity(m); return ok("tokenfactory"); },
  });
  // The visitor's pick goes only to the first try; Super is asked on its own route order.
  assert.deepEqual(asked, [[MODELS.writer, "cohere/x"], [MODELS.worker, undefined]]);
  assert.equal(r.served.provider, "tokenfactory");
  assert.match(r.served.fellBack[0], /429 .*Free model capacity exhausted.*tokenfactory/);
  assert.equal(events[0].next, "Nemotron 3 Super");
});

test("a free route out of capacity (429) gets one more try of the writer model after a wait, when all else failed", async () => {
  const asked = [], waits = [];
  let n = 0;
  const r = await writeWithFallback(msgs, { maxTokens: 9000 }, {
    sleep: async (ms) => { waits.push(ms); }, waitMs: 20_000,
    chatImpl: async (m) => { asked.push(m); if (++n < 3) throw capacity(m); return ok("blockrun"); },
  });
  assert.deepEqual(asked, [MODELS.writer, MODELS.worker, MODELS.writer]);
  assert.deepEqual(waits, [20_000]);
  assert.equal(r.served.fellBack.length, 2);
});

test("every route failing: the error keeps each route's own reason, in full, and a failure with no 429 is not retried", async () => {
  const waits = [];
  await assert.rejects(
    writeWithFallback(msgs, {}, { sleep: async (ms) => waits.push(ms), chatImpl: async (m) => { throw new Error(`${m}: no provider answered (tokenfactory ${m}: 500 upstream error)`); } }),
    (e) => /no route wrote the brief: \(1\) nvidia\/Nemotron-3-Ultra.*500 upstream error\) \(2\) nvidia\/nemotron-3-super.*500 upstream error/.test(e.message),
  );
  assert.deepEqual(waits, []);
});

test("Sippar's own free rows are left off Nuru's sheet when Nuru's own free sources are on; kept when they are off", async () => {
  const body = JSON.stringify({ success: true, data: { products: [
    { id: "web-search", name: "Web Search", priceUSD: 0.05, description: "d", input: { query: "q" }, inputOptions: [] },
    { id: "free-arxiv", name: "Preprint search (arXiv), free", priceUSD: 0, free: true, antseedModels: [{ id: "arxiv-search" }], description: "d", input: { query: "q" }, inputOptions: [] },
  ] } });
  const fetchImpl = async () => new Response(body);
  const on = await loadCatalog({ fetchImpl, free: freeSources({ on: true, hasEmail: true }) });
  assert.equal(on.byId["arxiv-search"], undefined);
  assert.equal(on.free, 14);
  assert.ok(on.byId["web-search"] && on.byId["free-arxiv-papers"]);
  const off = await loadCatalog({ fetchImpl, free: [] });
  assert.ok(off.byId["arxiv-search"]);
});

test("the free-sources note names each free source by topic, and is empty with none", () => {
  const note = freeNote(FREE_SOURCES.map(freeRow));
  assert.match(note, /^FREE SOURCES: /);
  for (const s of FREE_SOURCES) assert.match(note, new RegExp(s.id));
  assert.match(note, /research: free-openalex-works, free-crossref-works, free-arxiv-papers/);
  assert.equal(freeNote([{ id: "web-search", priceUSD: 0.05 }]), "");
});

test("a visitor's failed brief is given back: it does not count toward their runs for the day", () => {
  const dir = mkdtempSync(join(tmpdir(), "nuru-"));
  const L = limits(dir), now = new Date("2026-12-01T10:00:00Z");
  L.start("1.2.3.4", now); L.start("1.2.3.4", now);
  L.giveBack("1.2.3.4", now);
  const s = JSON.parse(readFileSync(join(dir, "limits-2026-12-01.json"), "utf8"));
  assert.deepEqual(Object.values(s.visitors), [1]);
  L.giveBack("1.2.3.4", now); L.giveBack("1.2.3.4", now);
  assert.deepEqual(Object.values(JSON.parse(readFileSync(join(dir, "limits-2026-12-01.json"), "utf8")).visitors), [0], "never below zero");
});
