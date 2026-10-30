#!/usr/bin/env bash
# Hermes Agent inside NVIDIA OpenShell (NemoClaw) on a Nebius AI Cloud VM, with Nemotron on Token Factory as
# its model and Sippar's hosted MCP door as its tools. Hackathon sandbox check, 2026-10-29.
#
# Runs ON THE VM (Ubuntu 24.04, 4 vCPU, 16 GB), driven from your own machine over SSH:
#   ssh ubuntu@<vm-ip> "NEBIUS_API_KEY=$NEBIUS_API_KEY bash -s" < setup-nemoclaw-hermes.sh
# The key travels in the ssh command's environment only; it is never written to the VM's disk by this script.
# NemoClaw keeps it outside the sandbox (OpenShell supplies it at egress).
#
# Facts this rests on (docs.nvidia.com/nemoclaw/latest, read 2026-10-29): Docker Engine + Node 22.19+, 4 vCPU,
# 8 GB minimum (16 recommended); custom OpenAI-compatible provider via NEMOCLAW_PROVIDER=custom,
# NEMOCLAW_ENDPOINT_URL, NEMOCLAW_MODEL, COMPATIBLE_API_KEY; egress allowlist via
# `openshell policy update <sandbox> --add-endpoint host:port:access:type:enforce`.
# Known trap (NVIDIA/NemoClaw#307): a provider base URL reached directly from inside the sandbox is blocked by the
# egress proxy; the custom-provider route above is the supported path. Whether a REMOTE https custom endpoint is
# accepted by onboarding is the first thing this script measures (the doc's example is a loopback vLLM).
set -euo pipefail

: "${NEBIUS_API_KEY:?NEBIUS_API_KEY must be in the environment (with-secrets tokenfactory)}"
SANDBOX="${SANDBOX:-sippar-hermes}"
MODEL="${MODEL:-nvidia/nemotron-3-super-120b-a12b}"
TF_URL="${TF_URL:-https://api.tokenfactory.nebius.com/v1}"
SIPPAR_DOOR="https://sippar.network/mcp/protocol/pay"

step() { printf '\n==== %s\n' "$*"; }

step "1. host facts"
nproc; free -g | head -2; df -h / | tail -1; lsb_release -ds

step "2. Docker Engine (official apt repo)"
if ! command -v docker >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg binutils
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io
  sudo usermod -aG docker "$USER"
fi
sudo docker version --format '{{.Server.Version}}'

sudo apt-get install -y -qq binutils >/dev/null  # NemoClaw installer needs `strings` (measured 2026-10-29)
step "3. Node 22 (NodeSource)"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
node -v; npm -v

step "4. NemoClaw with Hermes, non-interactive, Token Factory as the custom provider"
# sg docker: the group membership from step 2 is not in this shell yet.
sg docker -c "
  export NEMOCLAW_AGENT=hermes NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1 \
         NEMOCLAW_DISABLE_TELEMETRY=1 NEMOCLAW_SANDBOX_NAME='$SANDBOX' \
         NEMOCLAW_PROVIDER=custom NEMOCLAW_ENDPOINT_URL='$TF_URL' NEMOCLAW_MODEL='$MODEL' \
         COMPATIBLE_API_KEY='$NEBIUS_API_KEY'
  curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
"

step "5. sandbox status"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
nemohermes "$SANDBOX" status || true

step "6. allow egress to Sippar's door (OpenShell policy)"
openshell policy update "$SANDBOX" --add-endpoint sippar.network:443:full:rest:enforce || \
  echo "policy update failed: approve sippar.network:443 in 'openshell term' when the agent first tries it"

step "done"
echo "Next: attach the door and sign in with the commands in README.md, then run with --max-turns and --run-budget."
