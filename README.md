# Nuru: the agent that pays per sip and unlocks the web

Every source paid per call, every claim with a receipt. Nuru is a Nemotron agent, built on
Sippar, that researches a question the way a careful analyst would and pays for what it reads.
A sip is a hundredth of a cent. The same door it buys from serves any harness; `skills/` and
`harness/` show how.
NVIDIA Nemotron plans the reading on Nebius Token Factory. The agent's own wallet buys each source
per call, in USDC on Base. Nemotron pulls quotes from what was bought, code checks every quote
word for word, and Nemotron writes a short brief. Each point in the brief opens to its quote, its
source, its price and its payment on chain.

Built for the Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track.

## Why it matters

Agents are becoming the heaviest readers on the web. A single research question turns into
dozens of model calls and many source reads, so the work an agent does grows with the question
rather than with the number of people asking. This project shows that loop running end to end with
real money: the publisher of a source is paid for the read, the reader gets a brief where every
claim can be traced, and the model work runs on open NVIDIA models.

## How a brief is made

1. **Plan (Nemotron 3 Ultra).** The question goes to `nvidia/Nemotron-3-Ultra-550b-a55b` with a
   closed list of sources. It returns up to six steps as strict JSON (`response_format:
   json_schema`). Code drops any step that names a source outside the list.
2. **Buy and read.** Each step runs against its source. Paid sources answer `402 Payment
   Required`; the agent signs a USDC authorization on Base (x402), retries, and keeps the
   transaction hash it gets back. A per-run spend ceiling stops the run before it overspends.
3. **Quote (Nemotron 3 Super).** `nvidia/nemotron-3-super-120b-a12b` reads every document in
   parallel and returns claims with exact supporting quotes. A claim is kept only if its quote
   appears word for word in the document the agent paid for.
4. **Write (Nemotron 3 Ultra).** The brief is written from verified claims only. Code removes any
   citation that does not resolve and any point left with no evidence, and lists what the
   sources did not cover.
5. **Account.** Prices, receipts and who was paid are computed in code from what each step
   returned. The model never computes a number.

## Sources

| Source | What it gives | How it is paid |
|---|---|---|
| Web search | Tavily's live web search, unchanged, with the source named | Per call through Sippar, x402 on Base |
| Page text | The clean text of one page | Per call through Sippar, x402 on Base |
| Scholarly papers | OpenAlex, Crossref, arXiv and PubMed records | Per call through Sippar, x402 on Base |
| News | Google News headlines and snippets | Per call through Sippar, x402 on Base |
| Dataconomy | Articles from a Berlin tech and data publication | Per call through Sippar, x402 on Base; the publisher is paid per read |

Sippar connects agents to the data and services they trust and settles each call on chain. This
project uses Sippar's public endpoints the same way any agent can, with no account: a request
answers 402, the agent pays, the source is named on the response. Tavily's own pay-per-call
door did not settle during the build, so Sippar reaches Tavily through a reseller of Tavily
search today and the response says so; paying Tavily directly per search is first on the
roadmap.

## NVIDIA Nemotron on Nebius Token Factory

- Models: `nvidia/Nemotron-3-Ultra-550b-a55b` for planning and writing, where reasoning matters;
  `nvidia/nemotron-3-super-120b-a12b` for the many parallel reading calls.
- Every model call uses Token Factory's OpenAI-compatible API with JSON-schema constrained
  output, so the agent never parses free text.
- One brief is typically 15 to 20 Nemotron calls. The page shows the calls and tokens per model
  for every run.

## Run it

Requirements: Node.js 22, a Nebius Token Factory API key, and a wallet on Base holding a few
dollars of USDC. No other key: every read is bought per call.

```bash
npm install
export NEBIUS_API_KEY=...        # Token Factory
export AGENT_WALLET_KEY=0x...    # the agent's own Base wallet, funded with USDC
npm start                        # http://localhost:8790
```

Or from the command line:

```bash
node cli.mjs "What is the current evidence that GLP-1 drugs reduce the risk of Alzheimer's disease?" "a neuroscience researcher"
```

Optional settings: `MAX_SPEND_USD` (per-run ceiling, default 0.50), `MAX_STEPS` (default 6),
`PLANNER_MODEL`, `WORKER_MODEL`, `WRITER_MODEL`, `TOKEN_FACTORY_BASE_URL`.

## The same agent in any harness

`skills/` holds agent skills (a `SKILL.md` each) for connecting a Nemotron agent to the same
door from Hermes Agent, OpenClaw, LangGraph or Claude Code, and `harness/nemoclaw/` holds the
NVIDIA NemoClaw policy, the Hermes profile and the VM setup script that ran this agent inside
NVIDIA OpenShell on a Nebius AI Cloud VM on 2026-10-29. Read `skills/README.md` first.

## Files

- `lib/agent.mjs`: the run (plan, buy, quote, write, account)
- `lib/tf.mjs`: Nemotron on Token Factory, with token accounting
- `lib/tools.mjs`: the closed source list
- `lib/pay.mjs`: the agent wallet and x402 payments
- `server.mjs`, `public/index.html`: the page, with the run streamed as it happens

## Feedback on Nebius and NVIDIA tools

- JSON-schema output on Token Factory made a multi-step agent dependable: plans and claims parse
  every time, with no prompt tricks.
- Nemotron 3 Super is a good fit for many parallel reading calls; Nemotron 3 Ultra noticeably
  improves the plan and the final brief.
- The regional base URL shown in the console (`api.tokenfactory.us-central1.nebius.com`) and the
  one in examples (`api.tokenfactory.nebius.com`) both work; one line in the docs saying so
  would save new users a moment of doubt.
- When a trial ends with credit still on the account, calls fail with `credit_balance_exhausted`
  while the console shows a positive balance. A message that names the real cause (billing
  suspended until a card is added) would save time.

## License

MIT
