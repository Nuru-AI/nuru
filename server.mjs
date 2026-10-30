// A small server: the page, a streamed run, and saved runs. No framework.
import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { loadWallet } from "./lib/pay.mjs";
import { research } from "./lib/agent.mjs";

const PORT = Number(process.env.PORT || 8790);
// A run must be able to fund its own ceiling before it starts: a brief that dies halfway
// through its reading is worse for a reader than one that never began.
const MIN_BALANCE_USD = Math.max(0.2, Number(process.env.MAX_SPEND_USD || 0.5));
const PUBLIC = new URL("./public/", import.meta.url).pathname;
const RUNS = new URL("./runs/", import.meta.url).pathname;
mkdirSync(RUNS, { recursive: true });
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
      const { question, reader } = JSON.parse(raw || "{}");
      if (!question || question.length > 400) return send(res, 400, { error: "Ask a question of up to 400 characters." });
      const bal = await wallet.balance().catch(() => 0);
      if (bal < MIN_BALANCE_USD) {
        return send(res, 402, {
          error: "The agent's wallet is out of funds, so it cannot buy sources for a new brief. " +
            "An earlier brief is still readable from its link, and the same agent can be reached " +
            "from ChatGPT, Claude or any MCP host with a Sippar Unlock card (sippar.network/unlock).",
        });
      }
      busy = true;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      const push = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const run = await research({ question, reader: reader || "a researcher", wallet, onEvent: (e) => push("progress", e) });
        const id = run.startedAt.replace(/[:.]/g, "-");
        writeFileSync(join(RUNS, `${id}.json`), JSON.stringify(run, null, 2));
        push("result", { id });
      } catch (e) {
        push("failed", { error: String(e.message || e).slice(0, 300) });
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
