#!/usr/bin/env bash
# Waits until the ENS commitment written by the first EnsName run is old enough to reveal (MIN_COMMITMENT_AGE,
# 60 s on Sepolia), i.e. until the latest block's timestamp >= .ens.parent.commit.validFrom.
# Exits at once if there is nothing to wait for (name already registered, or no commitment recorded).
# Env: RPC_URL (required), DEPLOYMENTS_FILE (default deployments/sepolia.json),
#      ANVIL_MINE=1 moves anvil's clock instead of waiting (local anvil rehearsal only).
set -euo pipefail

file="${DEPLOYMENTS_FILE:-deployments/sepolia.json}"
target="$(jq -r '.ens.parent.commit.validFrom // 0' "$file" 2>/dev/null || echo 0)"
if [[ -z "$target" || "$target" == "null" || "$target" == "0" ]]; then
  echo "wait-for-commit: no pending commitment in $file"
  exit 0
fi

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
