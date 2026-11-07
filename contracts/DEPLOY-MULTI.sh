#!/bin/bash
# Deploy multiple stock listings to Sepolia
# NO BROADCASTS in this script - DRY RUN commands only

set -e

# Check we're in contracts/ directory
if [ ! -f "Makefile" ]; then
    echo "Error: Run from contracts/ directory"
    exit 1
fi

# Verify .env has required keys
if [ ! -f ".env" ]; then
    echo "Error: .env not found. Copy .env.example and fill in:"
    echo "  SEPOLIA_RPC_URL"
    echo "  PRIVATE_KEY (deployer)"
    echo "  DEMO_WALLET_KEYS (comma-separated, >=6 keys)"
    exit 1
fi

source .env

if [ -z "$PRIVATE_KEY" ] || [ -z "$DEMO_WALLET_KEYS" ]; then
    echo "Error: PRIVATE_KEY and DEMO_WALLET_KEYS must be set in .env"
    exit 1
fi

echo "=========================================="
echo "Multi-Stock Deployment Commands"
echo "=========================================="
echo ""
echo "Current deployer: $(cast wallet address $PRIVATE_KEY)"
echo "RPC: ${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
echo ""
echo "Price mappings (INR → demo points, 100 points = 1.00 USDC per 1000 shares):"
echo "  JIOFIN ₹231.20    → 100 points issue, 80 floor, 190 cap"
echo "  Reliance ₹1320.00 → 571 points issue, 457 floor, 1085 cap"  
echo "  TCS ₹2498.50      → 1081 points issue, 865 floor, 2054 cap"
echo ""
echo "Disclaimer: Demo prices in test USDC. Not real USD-equity pricing."
echo "INR sources: charting.in, stockanalysis.com, goodreturns.in (Nov 6 2026)"
echo ""

# Function to show deployment commands for one stock
show_stock_commands() {
    local config_file=$1
    local stock_name=$2
    
    echo "=========================================="
    echo "$stock_name"
    echo "=========================================="
    echo ""
    echo "# 1. Load configuration"
    echo "set -a && source $config_file && set +a"
    echo ""
    echo "# 2. Deploy contracts (token, hook, receiver)"
    echo "make deploy"
    echo ""
    echo "# 3. Launch auction (creates CCA)"
    echo "make launch"
    echo ""
    echo "# 4. Wait for auction start, then place demo bids"
    echo "make wait-start"
    echo "make bids"
    echo ""
    echo "# 5. After auction ends, settle and trade"
    echo "make wait-migration"
    echo "make settle"
    echo "make trade"
    echo ""
    echo "# 6. (Optional) Register ENS name"
    echo "make ens-sepolia"
    echo ""
}

show_stock_commands "config-jiofin.env" "JIOFIN (5-minute auction)"
show_stock_commands "config-reliance.env" "Reliance Industries (5-minute auction)"

echo "=========================================="
echo "TCS (6-hour open auction for ICO bidding)"
echo "=========================================="
echo ""
echo "# 1. Load configuration"
echo "set -a && source config-tcs.env && set +a"
echo ""
echo "# 2. Deploy and launch"
echo "make deploy"
echo "make launch"
echo ""
echo "# 3. Place initial bids (others can bid during 6-hour window)"
echo "make wait-start"
echo "make bids"
echo ""
echo "# 4. LEAVE OPEN - do NOT run settle yet"
echo "# Additional bidders can run 'make bids' anytime before endBlock"
echo "# Check auction status:"
echo "cast call \$AUCTION_ADDRESS \"endBlock()\" --rpc-url \$SEPOLIA_RPC_URL"
echo ""
echo "# 5. Only after demo period: settle"
echo "# make wait-migration"
echo "# make settle"
echo ""

echo "=========================================="
echo "API Configuration"
echo "=========================================="
echo ""
echo "In services/api/.env, set:"
echo ""
echo "DEPLOYMENTS_FILES=\"../../contracts/deployments/sepolia.json,../../contracts/deployments/jiofin.json,../../contracts/deployments/reliance.json,../../contracts/deployments/tcs.json\""
echo ""
echo "Or with explicit tickers:"
echo "DEPLOYMENTS_FILES=\"deployments/sepolia.json#acme,deployments/jiofin.json#jiofin,deployments/reliance.json#reliance,deployments/tcs.json#tcs\""
echo ""
echo "API hot-reloads files on every request. Listings appear immediately after deployment."
echo ""

echo "=========================================="
echo "Funding Check"
echo "=========================================="
echo ""
echo "Current balances:"
deployer_addr=$(cast wallet address $PRIVATE_KEY 2>/dev/null || echo "invalid")
if [ "$deployer_addr" != "invalid" ]; then
    echo "Deployer: $deployer_addr"
    cast balance --ether $deployer_addr --rpc-url ${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com} 2>/dev/null || echo "  ETH: (RPC error)"
    cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 "balanceOf(address)(uint256)" $deployer_addr --rpc-url ${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com} 2>/dev/null | awk '{printf "  USDC: %.2f (raw %s)\n", $1/1e6, $1}' || echo "  USDC: (RPC error)"
else
    echo "  Invalid PRIVATE_KEY in .env"
fi
echo ""
echo "Run 'make fund' to top up demo wallets if needed"
echo "Circle Sepolia USDC faucet: https://faucet.circle.com (20 USDC per 2h per address)"
echo ""

echo "=========================================="
echo "WARNING: NO BROADCASTS YET"
echo "=========================================="
echo "This script shows commands only."
echo "Review configs, then run each make command manually per stock."
echo "Each deployment is independent with separate contracts."
echo ""
