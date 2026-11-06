#!/usr/bin/env bash
# Waits until the chain reaches a block recorded in the deployments file.
#   script/demo/wait-for-block.sh .auction.startBlock
#   script/demo/wait-for-block.sh .auction.migrationBlock
# Env: RPC_URL (required), DEPLOYMENTS_FILE (default deployments/sepolia.json),
#      ANVIL_MINE=1 mines the missing blocks instead of waiting (local anvil rehearsal only).
set -euo pipefail

key="$1"
file="${DEPLOYMENTS_FILE:-deployments/sepolia.json}"
target="$(jq -r "$key" "$file")"
if [[ -z "$target" || "$target" == "null" ]]; then
  echo "wait-for-block: $key not found in $file" >&2
  exit 1
fi

while true; do
  now="$(cast block-number --rpc-url "$RPC_URL")"
  if (( now >= target )); then
    echo "block $now >= $key ($target)"
    exit 0
  fi
  if [[ "${ANVIL_MINE:-0}" == "1" ]]; then
    cast rpc anvil_mine "$(( target - now ))" --rpc-url "$RPC_URL" > /dev/null
    continue
  fi
  echo "block $now: waiting for $key = $target (~$(( (target - now) * 12 )) s)"
  sleep 12
done
