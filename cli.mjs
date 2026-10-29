// node cli.mjs "question" ["who the brief is for"]
import { mkdirSync, writeFileSync } from "fs";
import { loadWallet } from "./lib/pay.mjs";
import { research } from "./lib/agent.mjs";

const [question, reader] = process.argv.slice(2);
if (!question) { console.error('usage: node cli.mjs "question" ["reader"]'); process.exit(1); }

const wallet = loadWallet();
const run = await research({
  question, reader, wallet,
  onEvent: (e) => console.log(e.type, JSON.stringify({ ...e, t: undefined, type: undefined }).slice(0, 200)),
});
mkdirSync("runs", { recursive: true });
const file = `runs/${run.startedAt.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(run, null, 2));
console.log("\n" + run.brief.title + "\n" + run.brief.summary);
for (const p of run.brief.points) console.log(`- ${p.text} [${p.evidence.join(", ")}]`);
console.log("\nledger", JSON.stringify(run.ledger), "\nnemotron", JSON.stringify(run.nemotron), "\nsaved", file);
