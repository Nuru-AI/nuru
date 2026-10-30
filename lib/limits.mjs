// Daily limits for the public page: a few runs per visitor, and one spend ceiling shared by everyone. Kept in a small
// file per UTC day so a restart does not reset them. Visitors are stored as a hash of their IP, never the IP itself.
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const RUNS_PER_IP_PER_DAY = Number(process.env.RUNS_PER_IP_PER_DAY || 3);
export const DAILY_SPEND_USD = Number(process.env.DAILY_SPEND_USD || 1);

const day = (now = new Date()) => now.toISOString().slice(0, 10);
const visitor = (ip) => createHash("sha256").update(String(ip)).digest("hex").slice(0, 16);

export function limits(dir) {
  const file = (d) => join(dir, `limits-${d}.json`);
  const load = (d) => {
    try { return existsSync(file(d)) ? JSON.parse(readFileSync(file(d), "utf8")) : { visitors: {}, spentUsd: 0 }; }
    catch { return { visitors: {}, spentUsd: 0 }; }
  };
  const save = (d, s) => writeFileSync(file(d), JSON.stringify(s));
  return {
    /** Why a new run may not start, or null. `runCeilingUsd` is the most one run may spend. */
    refusal(ip, runCeilingUsd, now) {
      const s = load(day(now));
      if ((s.visitors[visitor(ip)] || 0) >= RUNS_PER_IP_PER_DAY) return "visitor";
      if (s.spentUsd + runCeilingUsd > DAILY_SPEND_USD + 1e-9) return "day";
      return null;
    },
    start(ip, now) {
      const d = day(now), s = load(d);
      s.visitors[visitor(ip)] = (s.visitors[visitor(ip)] || 0) + 1;
      save(d, s);
    },
    spent(usd, now) {
      if (!(usd > 0)) return;
      const d = day(now), s = load(d);
      s.spentUsd = Math.round((s.spentUsd + usd) * 1e6) / 1e6;
      save(d, s);
    },
  };
}
