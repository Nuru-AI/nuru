# Skills: a Nemotron agent connected through Sippar, from any harness

These are agent skills (a `SKILL.md` with frontmatter each). Give your agent the folder, or read
them yourself; they say the same thing either way. They describe one door,
`https://sippar.network/mcp/protocol/pay`, an MCP server any MCP host can add, and the same
products reached over plain HTTP with x402 for an agent that holds its own wallet.

Sippar connects an agent to the data and services it trusts and settles each call on chain.
The agent's model is yours: in this repository it is NVIDIA Nemotron on Nebius Token Factory,
run standalone (the page and the CLI) and inside Hermes Agent under NVIDIA NemoClaw on a Nebius
AI Cloud VM. Prices are not written here: the shelf is live, and `list_products` or the free
catalog carries each product's price at the moment you ask.

| You want to | Read |
|---|---|
| add the door to Hermes, OpenClaw, LangGraph or Claude Code, and sign in once from a box with no browser | [sippar-connect/SKILL.md](./sippar-connect/SKILL.md) |
| pay: a prepaid pass, a capped budget, or the agent's own wallet over x402 | [sippar-pay/SKILL.md](./sippar-pay/SKILL.md) |
| buy data per call: search, news, social, papers, a publisher's articles, and read the result | [sippar-data/SKILL.md](./sippar-data/SKILL.md) |
| buy an image or a video clip and get the file back | [sippar-media/SKILL.md](./sippar-media/SKILL.md) |
| run a workflow Sippar executes for you: a plan over the shelf, YouTube trends, competitor discovery | [sippar-workflows/SKILL.md](./sippar-workflows/SKILL.md) |
| run the agent inside NVIDIA OpenShell with NemoClaw on a Nebius VM: policy, profile, setup | [../harness/nemoclaw/README.md](../harness/nemoclaw/README.md) |

Every response from the door names its source. What you make of the data is yours; Sippar
passes it through as the provider returns it.
