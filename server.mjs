// A small server: the page, a streamed run, and saved runs. No framework.
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { loadWallet } from "./lib/pay.mjs";
import { research } from "./lib/agent.mjs";
import { freeModels, DEFAULT_FREE_MODEL } from "./lib/tf.mjs";
import { limits, RUNS_PER_IP_PER_DAY, DAILY_SPEND_USD } from "./lib/limits.mjs";

const PORT = Number(process.env.PORT || 8790);
// A run must be able to fund its own ceiling before it starts: a brief that dies halfway
// through its reading is worse for a reader than one that never began.
const MIN_BALANCE_USD = Math.max(0.2, Number(process.env.MAX_SPEND_USD || 0.5));
const PUBLIC = new URL("./public/", import.meta.url).pathname;
const RUNS = new URL("./runs/", import.meta.url).pathname;
mkdirSync(RUNS, { recursive: true });
const LIMITS_DIR = new URL("./limits/", import.meta.url).pathname;
mkdirSync(LIMITS_DIR, { recursive: true });
const daily = limits(LIMITS_DIR);
const RUN_CEILING_USD = Number(process.env.MAX_SPEND_USD || 0.5);

// The visitor's address: the proxy's X-Forwarded-For only when the request came through the local proxy.
function clientIp(req) {
  const plain = (a) => String(a || "").trim().replace(/^::ffff:/, "");
  const peer = plain(req.socket.remoteAddress);
  const fwd = plain(String(req.headers["x-forwarded-for"] || "").split(",")[0]);
  return (peer === "127.0.0.1" || peer === "::1") && fwd ? fwd : peer;
}
const wallet = loadWallet();
let busy = false;

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".png": "image/png" };

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/wallet") {
      return send(res, 200, { address: wallet.address, balanceUsd: await wallet.balance().catch(() => null) });
    }
    // The free models a visitor may pick, from BlockRun's live catalog; the default first.
    if (url.pathname === "/api/models") {
      const list = await freeModels().catch(() => []);
      return send(res, 200, { default: DEFAULT_FREE_MODEL, models: list.length ? list : [{ id: DEFAULT_FREE_MODEL, name: "NVIDIA Nemotron 3 Ultra", owner: "nvidia", categories: ["chat"] }] });
    }
    if (url.pathname === "/api/runs") {
      const list = readdirSync(RUNS).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 20).map((f) => {
        const r = JSON.parse(readFileSync(join(RUNS, f), "utf8"));
        return { id: f.replace(/\.json$/, ""), question: r.question, spentUsd: r.ledger?.spentUsd ?? 0 };
      });
      return send(res, 200, list);
    }
    if (url.pathname.startsWith("/api/runs/")) {
      const id = url.pathname.slice(10).replace(/[^\w-]/g, "");
      const f = join(RUNS, `${id}.json`);
      return existsSync(f) ? send(res, 200, readFileSync(f)) : send(res, 404, { error: "No run with that id." });
    }
    if (url.pathname === "/api/run" && req.method === "POST") {
      if (busy) return send(res, 429, { error: "Another brief is being researched. Try again in a minute." });
      let raw = ""; for await (const c of req) raw += c;
      const { question, reader, model } = JSON.parse(raw || "{}");
      if (!question || question.length > 400) return send(res, 400, { error: "Ask a question of up to 400 characters." });
      // Only a model on BlockRun's free list right now; anything else is refused before any money moves.
      let pick;
      if (model && model !== DEFAULT_FREE_MODEL) {
        const free = await freeModels().catch(() => []);
        if (!free.some((m) => m.id === model)) return send(res, 400, { error: `${String(model).slice(0, 80)} is not one of the free models right now. Pick one from the list.` });
        pick = model;
      }
      const ip = clientIp(req);
      const why = daily.refusal(ip, RUN_CEILING_USD);
      if (why === "visitor") return send(res, 429, { error: `You have run ${RUNS_PER_IP_PER_DAY} briefs today, the most one visitor can run on this page in a day. Saved briefs stay readable, and the same agent runs from ChatGPT, Claude or any MCP host with a Sippar Unlock card (sippar.network/unlock).` });
      if (why === "day") return send(res, 429, { error: `Today's $${DAILY_SPEND_USD.toFixed(2)} for this page's reading is spent. It opens again at 00:00 UTC; saved briefs stay readable, and the same agent runs from ChatGPT, Claude or any MCP host with a Sippar Unlock card (sippar.network/unlock).` });
      const bal = await wallet.balance().catch(() => 0);
      if (bal < MIN_BALANCE_USD) {
        return send(res, 402, {
          error: "The agent's wallet is out of funds, so it cannot buy sources for a new brief. " +
            "An earlier brief is still readable from its link, and the same agent can be reached " +
            "from ChatGPT, Claude or any MCP host with a Sippar Unlock card (sippar.network/unlock).",
        });
      }
      daily.start(ip);
      busy = true;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      const push = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const run = await research({ question, reader: reader || "the person who asked", wallet, pick, onEvent: (e) => push("progress", e) });
        daily.spent(run.ledger?.spentUsd);
        const id = run.startedAt.replace(/[:.]/g, "-");
        writeFileSync(join(RUNS, `${id}.json`), JSON.stringify(run, null, 2));
        push("result", { id });
      } catch (e) {
        // Count what the failed run paid: its own ledger, or the balance drop when that is larger.
        const after = await wallet.balance().catch(() => bal);
        const spent = Math.max(Number(e.spentUsd) || 0, bal - after, 0);
        daily.spent(spent);
        const reason = String(e.message || e).slice(0, 200);
        push("failed", { error: `The brief could not be finished: ${reason}${spent > 0 ? ` The sources already bought cost $${spent.toFixed(2)}.` : ""} Try again, or pick another free model.` });
      } finally {
        busy = false; res.end();
      }
      return;
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    p = join(PUBLIC, p.replace(/\.\.+/g, ""));
    if (existsSync(p)) return send(res, 200, readFileSync(p), TYPES[extname(p)] || "application/octet-stream");
    send(res, 404, "Not found", "text/plain");
  } catch (e) {
    send(res, 500, { error: String(e.message || e).slice(0, 300) });
  }
}).listen(PORT, () => console.log(`nuru on http://localhost:${PORT}  wallet ${wallet.address}`));
