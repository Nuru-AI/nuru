# Nuru

With a pay-per-call budget, the digital world is flat: Nuru reaches any data and asks its AI
friends for their knowledge, opinions and creations.

Nuru owns its stack and runs natively from your preferred harness. It plans the job, pays per
call with no subscription and no key, keeps to its budget, and does its searching and reading
outside the chat, so the harness receives a short summary.

Built for the Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track.

## How it works

- **The model.** NVIDIA Nemotron by default, or any model you pick. From a harness, Sippar's door
  buys it per call on AntSeed; Nuru's own runtime in this repo runs it on Nebius Token Factory.
- **Pay per call.** With x402, a service answers "402 Payment Required", Nuru pays in USDC on Base
  and gets the data. Never past its budget.
- **The plan.** Nemotron plans the job over a live catalog of services and their prices, and code
  checks every step before anything is paid.
- **Search.** Tavily, bought per call. Tavily's keyless pay-per-search is the design target; during
  the build those calls settled through a reseller of Tavily search, and each response names the
  path that served it.
- **The publishers.** Each Tavily search sends a share to the publishers whose pages appear in
  its results. Any publisher can be paid this way, into a wallet created for the publisher's email
  that only they can open, before they have signed up with anyone. The first payment reached
  Dataconomy on 30 October 2026.
- **Any harness.** ChatGPT, Claude, Hermes Agent in NVIDIA's NemoClaw sandbox on Nebius, or Nuru's
  own page at https://agent.sippar.network.

Nuru calls Sippar's public endpoints the way any agent can. Sippar, the payment rail, existed
before the hackathon, and its catalog is one choice: Nuru plans over any marketplace that
publishes a catalog and pays whatever a seller's 402 names.

## Run it in your harness

1. Add the MCP server `https://sippar.network/mcp/protocol/pay` to ChatGPT, Claude or Hermes Agent
   ([skills/sippar-connect](skills/sippar-connect/SKILL.md)).
2. Get a Sippar Unlock card, paid by card through Stripe, at https://sippar.network/unlock. Sign
   in once and redeem its code ([skills/sippar-pay](skills/sippar-pay/SKILL.md)). The card is the
   run's hard cap.
3. Ask for the job, for example "find the audience for Nebius AI Cloud"
   ([skills/sippar-workflows](skills/sippar-workflows/SKILL.md)).

## Run Nuru's own runtime (Nemotron on Nebius Token Factory)

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
node cli.mjs "How are publishers getting paid when AI agents read their articles?" "a publisher"
```

Settings: `MAX_SPEND_USD` (per-run ceiling, default 0.50), `PLANNER` (`catalog`, the default, or
`fixed`), `CATALOG_URL` (any marketplace's catalog; Sippar's free catalog by default),
`PLANNER_MODEL`, `WORKER_MODEL`, `WRITER_MODEL`, `TOKEN_FACTORY_BASE_URL`, `MAX_STEPS`, `MAX_DOCS`.
On the page: `RUNS_PER_IP_PER_DAY` (default 3) and `DAILY_SPEND_USD` (spend shared by every
visitor, default 1), counted per UTC day.

## Inside NVIDIA's sandbox on Nebius

[harness/nemoclaw](harness/nemoclaw/README.md): the NemoClaw policy, the Hermes profile and the
VM setup script that ran Hermes Agent in NVIDIA OpenShell on a Nebius AI Cloud VM on 29 October
2026, with Nemotron 3 Super on Token Factory as its model.

## Files

- `lib/agent.mjs`: one run: plan, buy, read, write, account
- `lib/planner.mjs`, `lib/catalog.mjs`: the plan format, the code check, the catalog
- `lib/tf.mjs`: Nemotron on Token Factory
- `lib/pay.mjs`, `lib/tools.mjs`: x402 payments and the fallback source list
- `server.mjs`, `public/`: the page; `cli.mjs`: the command line
- `skills/`: any harness on the same door

## License

MIT
