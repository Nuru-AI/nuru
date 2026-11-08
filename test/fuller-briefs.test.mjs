// The page's three free changes after the 2026-11-08 quality test: page names reach the writer, the reader keeps
// more facts per page, and the brief has room. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceLine, READER_PROMPT, READER_CLAIMS_PER_DOC, BRIEF_LIMITS } from "../lib/agent.mjs";

test("an evidence line names the page's title and address, with its Google position", () => {
  const c = { id: "C1", publisher: "Web Content Extraction", url: "https://ap2-protocol.org/", rank: 2, claim: "AP2 is open.", quote: "AP2 is an open protocol" };
  const line = evidenceLine(c, { title: "AP2 - Agent Payments Protocol Documentation" });
  assert.equal(line, 'C1 (Web Content Extraction; page: "AP2 - Agent Payments Protocol Documentation" https://ap2-protocol.org/, Google result #2): AP2 is open. | quote: "AP2 is an open protocol"');
});

test("an evidence line without a document still carries the address, and marks a title-only paper", () => {
  const c = { id: "C4", publisher: "Scholarly Papers", via: "Paper Search", url: "https://doi.org/x", claim: "c", quote: "q" };
  assert.match(evidenceLine(c, undefined), /^C4 \(Scholarly Papers; page: https:\/\/doi\.org\/x, found by Paper Search\)/);
  assert.match(evidenceLine(c, { title: "A paper", titleOnly: true }), /a paper's title only/);
});

test("the reader keeps up to 6 facts a page and the brief has room for a full list", () => {
  assert.equal(READER_CLAIMS_PER_DOC, 6);
  assert.match(READER_PROMPT, /up to 6 factual claims/);
  assert.ok(BRIEF_LIMITS.points >= 12 && BRIEF_LIMITS.pointWords >= 50, JSON.stringify(BRIEF_LIMITS));
});
