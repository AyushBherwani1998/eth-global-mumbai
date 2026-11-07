#!/bin/bash
# Execution operator start - cursor/multi-stock-config-8da0 @ 4487eab

set -e

echo "=== Multi-Stock Deployment Execution ==="
echo "Branch: cursor/multi-stock-config-8da0"
echo "Commit: 4487eab"
echo ""

# Preserve existing sepolia.json
if [ -f "contracts/deployments/sepolia.json" ]; then
    echo "Backing up existing sepolia.json..."
    cp contracts/deployments/sepolia.json contracts/deployments/sepolia.json.backup
fi

cd contracts

# JIOFIN
echo "=== JIOFIN (5 min) ==="
set -a && source config-jiofin.env && set +a
echo "Deploy: $DEMO_LABEL → $DEPLOYMENTS_FILE"
# make deploy launch wait-start bids wait-migration settle trade

# Reliance
echo "=== Reliance (5 min) ==="
set -a && source config-reliance.env && set +a
echo "Deploy: $DEMO_LABEL → $DEPLOYMENTS_FILE"
# make deploy launch wait-start bids wait-migration settle trade

# TCS
echo "=== TCS (6 hours, leave open) ==="
set -a && source config-tcs.env && set +a
echo "Deploy: $DEMO_LABEL → $DEPLOYMENTS_FILE"
# make deploy launch wait-start bids
# DO NOT SETTLE

cd ..

# API config
echo ""
echo "=== API Configuration ==="
echo 'Add to services/api/.env:'
echo 'DEPLOYMENTS_FILES="../../contracts/deployments/sepolia.json#acme,../../contracts/deployments/sepolia-jiofin.json#jiofin,../../contracts/deployments/sepolia-reliance.json#reliance,../../contracts/deployments/sepolia-tcs.json#tcs"'
echo ""
echo "Restart API or wait for hot-reload"
echo "Verify: curl http://localhost:8788/v1/listings | jq '.listings[].ticker'"
echo ""
echo "Expected tickers: acme, jiofin, reliance, tcs"
