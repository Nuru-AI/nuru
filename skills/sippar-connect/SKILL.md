---
name: sippar-connect
description: Add Sippar's MCP door to ChatGPT, Claude, Hermes Agent, OpenClaw or LangGraph, list its tools without signing in, and sign in once, from a browser or with a device code on a box with no browser.
---

# Connect an agent to Sippar

The door is one URL: `https://sippar.network/mcp/protocol/pay`, a Streamable HTTP MCP server.
Anyone can connect and list tools without signing in; the tools that spend, or that read your
own budget, answer 401 until you sign in. Sign-in is OAuth with a device code, so a headless
agent signs in without a browser on its box.

## Hermes Agent

In `~/.hermes/config.yaml` (or a profile's `config.yaml`):

```yaml
mcp_servers:
  sippar:
    url: "https://sippar.network/mcp/protocol/pay"
    auth: oauth
    oauth:
      flow: device
    timeout: 240
    tools:
      include: ["list_products", "browse_products", "buy_product", "read_purchase", "my_budget", "redeem_pass", "save_reading", "plan_workflow"]
```

Then `hermes mcp login sippar --flow device`. It prints an 8-letter code and
`https://sippar.network/connect/`; type the code there on any device, sign in (email, Google or
a wallet), and the agent is authenticated. Measured 2026-10-29 on Hermes v0.22.2: "Authenticated,
17 tool(s) available". `tools.include` is worth setting: Hermes 0.22 hides MCP tools behind its
`tool_search`, and a 120B model found `list_products` in 34 calls with the list pinned against 64
without. Always run a paid model with `--max-turns` and `--run-budget`.

With `auth: oauth` and no token, Hermes refuses to connect at all ("non-interactive environment
and no cached tokens found"); without the `auth` line it connects anonymously and lists the
shelf, which is enough for a free look.

## OpenClaw

OpenClaw's gateway takes MCP servers in its config; use the same URL with OAuth. Nebius's own
recipe, "Connect OpenClaw to Nebius Token Factory", puts Nemotron behind it as a custom provider.

## LangGraph, CrewAI, Agno, Google ADK, Strands, Pydantic AI, LlamaIndex

Any framework with an MCP client takes the same URL. Nebius's Token Factory cookbook has an agent
on each of these; swap the tool server for this door and the model for a Nemotron id.

## ChatGPT

Add the URL as a custom connector in ChatGPT's settings. The tools that spend or read your budget
ask you to sign in; ChatGPT opens the sign-in in a browser tab, and you sign in with email, Google
or a wallet. Measured 2026-10-19: ChatGPT signed in, `my_budget` read the live budget, and a news
search was paid from the budget on Base with no card click. Redeem a pass with `redeem_pass` and
ask for the job.

## Claude Code and Claude.ai

Add the URL as a connector; Claude signs in through a browser tab the first time it meets a 401.

## Plain HTTP, no MCP

The free catalog is `GET https://sippar.network/api/sippar/sell/catalog`: every product's id,
name, description, example input and live price. A product is bought with
`POST https://sippar.network/api/sippar/sell/<id>` and a JSON body; the first answer is
`402 Payment Required` with the terms; pay and retry (see `sippar-pay`). This repository's
`lib/pay.mjs` and `lib/tools.mjs` do exactly that.

## Tools you will meet

`list_products` and `browse_products` (the shelf), `buy_product` (one call of one product),
`read_purchase` (the result of a purchase, or of a workflow still running), `my_budget` (sign in,
balance and pass), `redeem_pass` (a pass code someone gave you), `save_reading` (keep your
notes against a run), `plan_workflow`, `video_trend_finder`, `competitor_discovery`,
`audience_discovery`, `compare_images`, `my_knowledge` (what you bought, sealed to your wallet).

A purchase is readable for a while after it finishes; a `read_purchase` that answers "no longer
known to Sippar" means the result expired on the server (your payment is safe). Read a run back
as soon as it finishes.
