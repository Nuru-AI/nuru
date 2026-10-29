#!/bin/sh
# Local start on Elad's Mac: keys from the Keychain, the agent wallet key from its file.
cd "$(dirname "$0")"
export AGENT_WALLET_KEY_FILE="${AGENT_WALLET_KEY_FILE:-$HOME/.sippar/tavily-test-wallet-2026-10-28.key}"
exec ../../scripts/secrets/with-secrets paying-reader -- node server.mjs
