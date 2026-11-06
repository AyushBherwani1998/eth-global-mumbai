#!/usr/bin/env bash
# API integration test against a local anvil fork of Sepolia running the demo deploy:
#   1. anvil forks Sepolia at SEPOLIA_FORK_BLOCK (default: head - 5)
#   2. contracts/script/demo/anvil-rehearsal.sh runs the whole demo on it (acme: auction, settle, trade, halt,
#      resume, ENS) -> contracts/deployments/anvil.json
#   3. a second listing is deployed and launched, and its auction is left live -> deployments/anvil-live.json
#   4. node --test test/integration/*.test.ts hits every endpoint (in-process app, live RPC)
# Needs foundry (anvil, cast, forge), jq, the contracts submodules, and a Sepolia RPC that serves the fork block.
#   SEPOLIA_RPC_URL=<rpc> [SEPOLIA_FORK_BLOCK=<n>] [KEEP_ANVIL=1] npm run test:integration
set -euo pipefail
cd "$(dirname "$0")/.."
api_dir="$PWD"
contracts="$(cd ../../contracts && pwd)"

export SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
port="${ANVIL_PORT:-8547}"
rpc="http://127.0.0.1:${port}"
log_dir="$api_dir/.integration"
mkdir -p "$log_dir"

if cast chain-id --rpc-url "$rpc" > /dev/null 2>&1; then
  echo "port $port is already in use (set ANVIL_PORT)" >&2
  exit 1
fi
fork_block="${SEPOLIA_FORK_BLOCK:-$(( $(cast block-number --rpc-url "$SEPOLIA_RPC_URL") - 5 ))}"
echo "== anvil: Sepolia fork at block $fork_block on $rpc"
anvil --fork-url "$SEPOLIA_RPC_URL" --fork-block-number "$fork_block" --chain-id 31337 --port "$port" --block-time 2 \
  > "$log_dir/anvil.log" 2>&1 &
anvil_pid=$!
trap 'kill $anvil_pid 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast block-number --rpc-url "$rpc" > /dev/null 2>&1 && break; sleep 1; done

echo "== demo rehearsal (acme) -> contracts/deployments/anvil.json (log: .integration/rehearsal.log)"
rm -f "$contracts/deployments/anvil-live.json"
if ! ANVIL_EXTERNAL=1 ANVIL_PORT="$port" bash "$contracts/script/demo/anvil-rehearsal.sh" > "$log_dir/rehearsal.log" 2>&1; then
  tail -40 "$log_dir/rehearsal.log" >&2
  exit 1
fi
tail -1 "$log_dir/rehearsal.log"

echo "== second listing (kesar), auction left live -> contracts/deployments/anvil-live.json"
key() { cast keccak "listing-day anvil $1"; }
(
  cd "$contracts"
  export PRIVATE_KEY="$(key deployer)" TREASURY_KEY="$(key treasury)" CRE_BROADCASTER_KEY="$(key creBroadcaster)" ANVIL_MINE=1
  make -e deploy launch wait-start RPC_URL="$rpc" DEPLOYMENTS_FILE=deployments/anvil-live.json \
    DEMO_LABEL="anvil-live-$(date +%s)" BID_WINDOW_BLOCKS=1000
) > "$log_dir/live.log" 2>&1 || { tail -40 "$log_dir/live.log" >&2; exit 1; }
jq -c '{label, auction: (.auction | {address, startBlock, endBlock})}' "$contracts/deployments/anvil-live.json"

echo "== API integration tests"
RPC_URL="$rpc" \
  DEPLOYMENTS_FILES="$contracts/deployments/anvil.json,$contracts/deployments/anvil-live.json#kesar" \
  node --test --test-concurrency=1 test/integration/*.test.ts

if [[ "${KEEP_ANVIL:-0}" == "1" ]]; then
  echo "KEEP_ANVIL=1: anvil keeps running at $rpc; Ctrl-C to stop"
  wait "$anvil_pid"
fi
