# The same agent inside NVIDIA OpenShell, with NemoClaw, on a Nebius AI Cloud VM

What ran on 2026-10-29: Hermes Agent inside an OpenShell sandbox (NemoClaw v0.0.137) on a Nebius
AI Cloud VM (Ubuntu 24.04, 4 vCPU, 16 GiB), NVIDIA Nemotron 3 Super on Nebius Token Factory as
its model, Sippar's door as its MCP server. It signed in with a device code, bought a seven-step
workflow (Reddit, X, news) for $0.27 of a $2 cap and read it back with sources. The Token Factory
key never entered the sandbox: OpenShell holds it and supplies it at egress.

## Files

- `setup-nemoclaw-hermes.sh`: run on the VM over SSH with the key in the command's environment
  only. Installs Docker and Node 22, runs NVIDIA's installer non-interactively with Hermes and
  Token Factory as a custom OpenAI-compatible provider, allow-lists `sippar.network:443`.
  Attaching the door and signing in are the commands below.
- `hermes-config.yaml`: the `mcp_servers` block to append to the sandbox's `~/.hermes/config.yaml`.
- `policy-sippar.yaml`: the network policy block with the one line that made it work.

## The one trap

`openshell policy update <sandbox> --add-endpoint sippar.network:443:full:rest:enforce` is
accepted, and the sandbox's egress proxy still answers `CONNECT ... 403`. The proxy refuses any
binary not listed under the endpoint's `binaries`, even with `access: full`
(NVIDIA/NemoClaw#307). Export the policy with `nemohermes <sandbox> policy get`, add the
`binaries` block from `policy-sippar.yaml` under `allow_sippar_network_443`, apply with
`openshell policy set --policy <file> --wait <sandbox>`. After that a request from inside gets a
real answer from Sippar.

## Commands

```bash
# one message through Nemotron, inside the sandbox
nemohermes <sandbox> exec --timeout 150 -- hermes chat -q "Reply with exactly: NEMOTRON OK" --oneshot --max-turns 5 --run-budget 120

# attach the door (append hermes-config.yaml to ~/.hermes/config.yaml inside the sandbox; `hermes mcp add` is interactive)
nemohermes <sandbox> exec --timeout 40 -- sh -c 'cat >> ~/.hermes/config.yaml' < hermes-config.yaml

# sign in once: prints a code to type at https://sippar.network/connect/
nemohermes <sandbox> exec --timeout 700 -- hermes mcp login sippar --flow device

# a capped run
nemohermes <sandbox> exec --timeout 620 -- hermes chat -q "<your request>" --oneshot --max-turns 40 --run-budget 560
```

Always cap a paid model: `--max-turns` and `--run-budget`. Nemotron 3 Ultra inside Hermes's
tool-search loop repeated one malformed tool lookup 285 times before it was stopped; Super did
not.

## Nebius notes

A Nebius VM, not a Devlab: NemoClaw needs Docker on the host. The default project in `eu-north1`
had a non-GPU vCPU quota of 0; `eu-west1` had 200. Stop the VM between sessions; the sandbox
keeps its state.
