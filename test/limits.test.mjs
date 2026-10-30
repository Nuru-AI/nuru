// The page's daily limits. node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { limits } from "../lib/limits.mjs";

const now = new Date("2026-12-01T10:00:00Z");

test("three runs per visitor per day, then a refusal", () => {
  const L = limits(mkdtempSync(join(tmpdir(), "nuru-")));
  for (let i = 0; i < 3; i++) { assert.equal(L.refusal("1.2.3.4", 0.3, now), null); L.start("1.2.3.4", now); }
  assert.equal(L.refusal("1.2.3.4", 0.3, now), "visitor");
  assert.equal(L.refusal("5.6.7.8", 0.3, now), null);
});

test("a run starts only if its ceiling fits in the day's shared spend", () => {
  const L = limits(mkdtempSync(join(tmpdir(), "nuru-")));
  L.spent(0.65, now);
  assert.equal(L.refusal("1.2.3.4", 0.3, now), null);
  L.spent(0.1, now);
  assert.equal(L.refusal("1.2.3.4", 0.3, now), "day");
});

test("a new UTC day starts fresh", () => {
  const L = limits(mkdtempSync(join(tmpdir(), "nuru-")));
  L.spent(1, now);
  for (let i = 0; i < 3; i++) L.start("1.2.3.4", now);
  assert.equal(L.refusal("1.2.3.4", 0.3, new Date("2026-12-02T00:00:01Z")), null);
});

test("the file holds a hash of the visitor, never the address", () => {
  const dir = mkdtempSync(join(tmpdir(), "nuru-"));
  limits(dir).start("203.0.113.7", now);
  const text = readFileSync(join(dir, readdirSync(dir)[0]), "utf8");
  assert.ok(!text.includes("203.0.113.7"));
});
