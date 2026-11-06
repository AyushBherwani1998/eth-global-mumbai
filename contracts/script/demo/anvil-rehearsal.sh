#!/usr/bin/env bash
# Full broadcast rehearsal of `make demo-sepolia` against a local anvil fork of Sepolia: every step is a separate
# `forge script --broadcast` process (as on Sepolia), blocks are mined instead of waited for, and the export
# collects real tx hashes. Uses throwaway keys funded through anvil cheats; nothing touches Sepolia.
# `make -e`: these throwaway keys win over a .env the Makefile would otherwise load.
#   SEPOLIA_RPC_URL=<rpc> script/demo/anvil-rehearsal.sh      (or: make demo-anvil)
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${SEPOLIA_RPC_URL:?set SEPOLIA_RPC_URL}"
port="${ANVIL_PORT:-8546}"
export RPC_URL="http://127.0.0.1:${port}"
export DEPLOYMENTS_FILE="deployments/anvil.json"
export ANVIL_MINE=1
export DEMO_LABEL="anvil-$(date +%s)"

key() { cast keccak "listing-day anvil $1"; }
export PRIVATE_KEY="$(key deployer)"
export FUNDER_KEY="$PRIVATE_KEY"
export TREASURY_KEY="$(key treasury)"
export CRE_BROADCASTER_KEY="$(key creBroadcaster)"
wallets=()
for i in 0 1 2 3 4 5 6 7; do wallets+=("$(key "wallet$i")"); done
DEMO_WALLET_KEYS="$(IFS=,; echo "${wallets[*]}")"
export DEMO_WALLET_KEYS

# A few blocks behind the head, so every node behind a load-balanced public RPC already has the fork block.
fork_block="$(( $(cast block-number --rpc-url "$SEPOLIA_RPC_URL") - 5 ))"
anvil --fork-url "$SEPOLIA_RPC_URL" --fork-block-number "$fork_block" --chain-id 31337 --port "$port" --block-time 2 --silent &
anvil_pid=$!
trap 'kill $anvil_pid 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast block-number --rpc-url "$RPC_URL" > /dev/null 2>&1 && break; sleep 1; done

usdc=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
funder="$(cast wallet address "$PRIVATE_KEY")"
cast rpc anvil_setBalance "$funder" 0x56BC75E2D63100000 --rpc-url "$RPC_URL" > /dev/null # 100 ETH
# FiatTokenV2_2 keeps balances in `balanceAndBlacklistStates` (slot 9); the top bit is the blacklist flag.
slot="$(cast index address "$funder" 9)"
cast rpc anvil_setStorageAt "$usdc" "$slot" "$(cast to-uint256 200000000)" --rpc-url "$RPC_URL" > /dev/null
echo "funder $funder USDC: $(cast call "$usdc" 'balanceOf(address)(uint256)' "$funder" --rpc-url "$RPC_URL")"

make -e fund RPC_URL="$RPC_URL" DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE"
make -e demo-sepolia RPC_URL="$RPC_URL" DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE"
make -e resume RPC_URL="$RPC_URL" DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE"
make -e export-json DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE"
echo "anvil rehearsal done: $DEPLOYMENTS_FILE"
