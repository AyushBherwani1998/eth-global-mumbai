#!/bin/bash
# Quick test that config params work correctly
set -e

export SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export DEMO_WALLET_KEYS="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d,0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

echo "Testing JIOFIN config parameterization..."
set -a && source config-jiofin.env && set +a

echo "DEMO_LABEL: $DEMO_LABEL"
echo "STOCK_NAME: $STOCK_NAME"
echo "STOCK_SYMBOL: $STOCK_SYMBOL"
echo "ISSUE_POINTS: $ISSUE_POINTS"
echo "FLOOR_POINTS: $FLOOR_POINTS"
echo "CAP_PERCENT: $CAP_PERCENT"

# Verify calculations
EXPECTED_CAP=$((ISSUE_POINTS * CAP_PERCENT / 100))
echo "Calculated cap: $EXPECTED_CAP (should be 190)"

echo ""
echo "Testing Reliance config..."
set -a && source config-reliance.env && set +a
echo "ISSUE_POINTS: $ISSUE_POINTS (should be 571)"
echo "FLOOR_POINTS: $FLOOR_POINTS (should be 457)"
EXPECTED_CAP=$((ISSUE_POINTS * CAP_PERCENT / 100))
echo "Calculated cap: $EXPECTED_CAP (should be 1085)"

echo ""
echo "Testing TCS config..."
set -a && source config-tcs.env && set +a
echo "ISSUE_POINTS: $ISSUE_POINTS (should be 1081)"
echo "FLOOR_POINTS: $FLOOR_POINTS (should be 865)"
EXPECTED_CAP=$((ISSUE_POINTS * CAP_PERCENT / 100))
echo "Calculated cap: $EXPECTED_CAP (should be 2054)"

echo ""
echo "✓ All configs loaded successfully"
