#!/usr/bin/env bash
# Waits until the ENS commitment sent by the first EnsName run is old enough to reveal: latest block timestamp >=
# ETHRegistrar.commitmentAt(commitment) + MIN_COMMITMENT_AGE (60 s on Sepolia). Reads the commit time from chain:
# the json's validFrom comes from forge's simulation, a block or two before the commit was mined.
# Exits at once if there is nothing to wait for (name already registered, or no commitment pending).
# Env: RPC_URL (required), DEPLOYMENTS_FILE (default deployments/sepolia.json),
#      ANVIL_MINE=1 moves anvil's clock instead of waiting (local anvil rehearsal only).
set -euo pipefail

registrar=0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3
file="${DEPLOYMENTS_FILE:-deployments/sepolia.json}"
commitment="$(jq -r '.ens.parent.commit.commitment // empty' "$file" 2>/dev/null || true)"
if [[ -z "$commitment" ]]; then
  echo "wait-for-commit: no commitment in $file"
  exit 0
fi
committed_at="$(cast call "$registrar" 'commitmentAt(bytes32)(uint64)' "$commitment" --rpc-url "$RPC_URL" | awk '{print $1}')"
if [[ "$committed_at" == "0" ]]; then
  echo "wait-for-commit: no pending commitment onchain (already registered, or not committed)"
  exit 0
fi
min_age="$(cast call "$registrar" 'MIN_COMMITMENT_AGE()(uint64)' --rpc-url "$RPC_URL" | awk '{print $1}')"
target=$(( committed_at + min_age ))

while true; do
  now="$(cast block latest --field timestamp --rpc-url "$RPC_URL")"
  if (( now >= target )); then
    echo "block timestamp $now >= commitment validFrom ($target): ready to register"
    exit 0
  fi
  if [[ "${ANVIL_MINE:-0}" == "1" ]]; then
    cast rpc evm_increaseTime "$(( target - now ))" --rpc-url "$RPC_URL" > /dev/null
    cast rpc anvil_mine 1 --rpc-url "$RPC_URL" > /dev/null
    continue
  fi
  echo "block timestamp $now: waiting for commitment validFrom = $target (~$(( target - now + 12 )) s)"
  sleep 12
done
