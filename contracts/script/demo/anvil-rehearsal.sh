#!/usr/bin/env bash
# Full broadcast rehearsal of `make demo-sepolia` against a local anvil fork of Sepolia: every step is a separate
# `forge script --broadcast` process (as on Sepolia), blocks are mined instead of waited for, and the export
# collects real tx hashes. Uses throwaway keys funded through anvil cheats; nothing touches Sepolia.
# `make -e`: these throwaway keys win over a .env the Makefile would otherwise load.
#   SEPOLIA_RPC_URL=<rpc> script/demo/anvil-rehearsal.sh      (or: make demo-anvil; KEEP_ANVIL=1 leaves it running)
# SEPOLIA_FORK_BLOCK pins the fork block (default: head - 5); the RPC must still serve that block's state.
# ANVIL_EXTERNAL=1 reuses an anvil the caller already runs on ANVIL_PORT (forked with --chain-id 31337).
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${SEPOLIA_RPC_URL:?set SEPOLIA_RPC_URL}"
port="${ANVIL_PORT:-8546}"
export RPC_URL="http://127.0.0.1:${port}"
export DEPLOYMENTS_FILE="deployments/anvil.json"
export ANVIL_MINE=1
export DEMO_LABEL="anvil-$(date +%s)"
# Each rehearsal is a new throwaway chain that reuses block numbers, so earlier rehearsals' logs would pass the
# export's deploy-block filter.
rm -rf broadcast/*/31337 "$DEPLOYMENTS_FILE"

key() { cast keccak "listing-day anvil $1"; }
export PRIVATE_KEY="$(key deployer)"
export FUNDER_KEY="$PRIVATE_KEY"
export TREASURY_KEY="$(key treasury)"
export CRE_BROADCASTER_KEY="$(key creBroadcaster)"
wallets=()
for i in 0 1 2 3 4 5 6 7; do wallets+=("$(key "wallet$i")"); done
DEMO_WALLET_KEYS="$(IFS=,; echo "${wallets[*]}")"
export DEMO_WALLET_KEYS

anvil_pid=""
if [[ "${ANVIL_EXTERNAL:-0}" != "1" ]]; then
  # A few blocks behind the head, so every node behind a load-balanced public RPC already has the fork block.
  fork_block="${SEPOLIA_FORK_BLOCK:-$(( $(cast block-number --rpc-url "$SEPOLIA_RPC_URL") - 5 ))}"
  echo "forking Sepolia at block $fork_block"
  anvil --fork-url "$SEPOLIA_RPC_URL" --fork-block-number "$fork_block" --chain-id 31337 --port "$port" --block-time 2 --silent &
  anvil_pid=$!
  trap 'kill $anvil_pid 2>/dev/null || true' EXIT
fi
for _ in $(seq 1 60); do cast block-number --rpc-url "$RPC_URL" > /dev/null 2>&1 && break; sleep 1; done
[[ "$(cast chain-id --rpc-url "$RPC_URL")" == "31337" ]] || { echo "no anvil (chain id 31337) at $RPC_URL" >&2; exit 1; }

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

# ENSv2 ticker namespace after the demo: the "exchange" owns listingday.eth, the deployer is the issuer. The
# receiver already holds a status from the resume report, so EnsStatusRole mirrors it with syncStatus().
export ENS_OWNER_KEY="$(key exchange)"
export ISSUER_KEY="$PRIVATE_KEY"
cast rpc anvil_setBalance "$(cast wallet address "$ENS_OWNER_KEY")" 0x8AC7230489E80000 --rpc-url "$RPC_URL" > /dev/null
registrar=0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3
if [[ "$(cast call "$registrar" 'isAvailable(string)(bool)' listingday --rpc-url "$RPC_URL")" != "true" ]]; then
  export ENS_PARENT_LABEL="listingday-anvil" # the real name is already registered on the forked chain
fi
make -e ens-sepolia RPC_URL="$RPC_URL" DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE" ENS_READ_STRICT=true
status="$(jq -r '.ens.records["listingday.status"]' "$DEPLOYMENTS_FILE")"
[[ "$status" == "listed" ]] || { echo "expected listingday.status = listed, got '$status'" >&2; exit 1; }

make -e export-json DEPLOYMENTS_FILE="$DEPLOYMENTS_FILE"
echo "anvil rehearsal done: $DEPLOYMENTS_FILE"
if [[ "${KEEP_ANVIL:-0}" == "1" && -n "$anvil_pid" ]]; then
  echo "KEEP_ANVIL=1: anvil keeps running at $RPC_URL (e.g. point the frontend at it); Ctrl-C to stop"
  wait "$anvil_pid"
fi
