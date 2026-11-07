# Multi-Stock Demo Configuration

This guide explains how to deploy multiple independent stock listing demos (Reliance Industries, JIOFIN, TCS) with configurable parameters. Each stock gets its own deployment file, separate contracts, and discoverable API endpoint.

## Overview

Three demo stocks are planned:
1. **Reliance Industries** - 5-minute total auction (bid + clearing phases)
2. **Jio Financial Services (JIOFIN)** - 5-minute total auction with verified listed stock price
3. **Tata Consultancy Services (TCS)** - 6-hour auction left open for ICO-style bidding

Each listing is **completely independent**:
- Separate token contract (CREATE2 address depends on DEMO_LABEL)
- Separate auction, hook, and receiver contracts
- Separate deployment JSON file
- Separate ENS name (optional)

## Price Points System (Unchanged)

The system uses **points** as the price unit:
- **1 point = 0.01 USDC per 1,000-share lot**
- **100 points = 1.00 USDC per lot = 0.001 USDC per share** (the original "issue price")
- Example: 80 points = 0.80 USDC per lot = $0.0008 per share

**This is NOT claiming real USD-to-equity pricing.** Points are demo reference units. The UI should display both:
- Points value (e.g., "80 points")
- Equivalent demo USDC (e.g., "0.80 USDC per 1000-share lot")
- Clear disclaimer: "Demo prices in test USDC, not real market values"

## Stock-Specific Configuration

### Environment Variables Per Stock

Set these before each `make deploy`:

```bash
# Required: Unique per stock
export DEMO_LABEL="jiofin-v1"              # CREATE2 salt; must be unique
export DEPLOYMENTS_FILE="deployments/jiofin.json"

# Token identity
export STOCK_NAME="Jio Financial Services"
export STOCK_SYMBOL="JIOFIN"
export STOCK_TICKER="jiofin"               # lowercase, for ENS

# Price configuration (in points: 100 points = 1.00 USDC per 1000 shares)
export FLOOR_POINTS=<TBD>                  # Minimum auction price, >= 32
export ISSUE_POINTS=<TBD>                  # Reference price (display only)

# Supply configuration (in whole shares, before 1e18 decimals)
export TOTAL_SUPPLY_SHARES=110000          # Total token supply
export AUCTION_SUPPLY_SHARES=90000         # Sold in auction
export LP_RESERVE_SHARES=20000             # Held for v4 pool

# Auction duration (blocks at ~12s each)
export BID_WINDOW_BLOCKS=20                # Zero-issuance bidding phase
export CLEAR_BLOCKS=5                      # Supply release phase; must divide 1e7
# Total duration: BID_WINDOW_BLOCKS + CLEAR_BLOCKS
# 5 minutes ≈ 25 blocks, 6 hours ≈ 1800 blocks

# Minimum raise for graduation (raw USDC, 6 decimals)
export REQUIRED_RAISE_USDC_RAW=45000000    # 45 USDC (adjust based on expected clearing)

# Optional: ENS ticker (defaults to STOCK_TICKER)
export ENS_TICKER="jiofin"
```

### Price Point Calculation Examples

**DO NOT use these examples as real values.** Actual prices must come from verified sources.

For reference only, here's how to convert a hypothetical reference price to points:

```
Example: If a demo reference is ₹100 per share
1. Choose a demo USDC lot price (e.g., 1.00 USDC per 1000 shares)
2. That's 100 points (by definition)
3. Set FLOOR_POINTS lower (e.g., 80 points = 0.80 USDC per lot)
4. Set ISSUE_POINTS = 100
```

The system requires `FLOOR_POINTS >= 32` due to CCA's minimum tick spacing (Q96 conversion).

## Deployment Process (Per Stock)

### 1. Set Configuration

```bash
cd contracts

# Example: JIOFIN listing
export DEMO_LABEL="jiofin-v1"
export DEPLOYMENTS_FILE="deployments/jiofin.json"
export STOCK_NAME="Jio Financial Services"
export STOCK_SYMBOL="JIOFIN"
export STOCK_TICKER="jiofin"

# WAIT for verified price data before setting these:
# export FLOOR_POINTS=<TBD>
# export ISSUE_POINTS=<TBD>

# Auction timing: 5 minutes total ≈ 25 blocks
export BID_WINDOW_BLOCKS=20
export CLEAR_BLOCKS=5

# Supply and raise (can use defaults)
# export TOTAL_SUPPLY_SHARES=110000
# export AUCTION_SUPPLY_SHARES=90000
# export LP_RESERVE_SHARES=20000
# export REQUIRED_RAISE_USDC_RAW=45000000
```

### 2. Deploy Contracts

```bash
make deploy    # Creates token, hook, receiver with new DEMO_LABEL
```

Each deployment creates a new set of contracts at different addresses because the CREATE2 salt includes `DEMO_LABEL`.

### 3. Launch Auction

```bash
make launch    # Creates auction, binds validation hook
```

### 4. Place Demo Bids

During the auction window:

```bash
make bids      # Uses same DEMO_WALLET_KEYS
```

**Gas limit fix:** The existing bid script hardcodes 3M gas for `submitBid`. This is preserved.

### 5. Settle & Trade

```bash
make wait-migration
make settle
make trade
```

### 6. Optional: ENS Registration

```bash
make ens-sepolia   # Registers {ticker}.listingday.eth
```

## API Discovery

The API reads **multiple deployment files** via comma-separated `DEPLOYMENTS_FILES`:

```bash
# In services/api/.env or environment
export DEPLOYMENTS_FILES="../../contracts/deployments/sepolia.json,../../contracts/deployments/jiofin.json,../../contracts/deployments/reliance.json,../../contracts/deployments/tcs.json"
```

Or with explicit tickers:

```bash
export DEPLOYMENTS_FILES="deployments/sepolia.json#acme,deployments/jiofin.json#jiofin,deployments/reliance.json#reliance,deployments/tcs.json#tcs"
```

The API hot-reloads these files on every request, so new listings appear immediately after `make deploy`.

### API Endpoints

Each stock is accessible by ticker:
- `GET /v1/listings/:ticker` - listing detail
- `GET /v1/auction/:ticker` - auction state
- `GET /v1/market/:ticker` - market view
- etc.

Example:
```
GET /v1/listings/jiofin
GET /v1/auction/reliance
GET /v1/market/tcs
```

## Three-Stock Demo Setup

### Reliance Industries (5-minute auction)

```bash
export DEMO_LABEL="reliance-v1"
export DEPLOYMENTS_FILE="deployments/reliance.json"
export STOCK_NAME="Reliance Industries Limited"
export STOCK_SYMBOL="RELIANCE"
export STOCK_TICKER="reliance"

# Timing: 5 minutes ≈ 25 blocks (12s each)
export BID_WINDOW_BLOCKS=20
export CLEAR_BLOCKS=5

# Prices: AWAITING VERIFIED DATA
# export FLOOR_POINTS=<TBD>
# export ISSUE_POINTS=<TBD>

make deploy launch
# After startBlock:
make bids wait-migration settle trade
```

### JIOFIN (5-minute auction)

```bash
export DEMO_LABEL="jiofin-v1"
export DEPLOYMENTS_FILE="deployments/jiofin.json"
export STOCK_NAME="Jio Financial Services"
export STOCK_SYMBOL="JIOFIN"
export STOCK_TICKER="jiofin"

# Timing: 5 minutes
export BID_WINDOW_BLOCKS=20
export CLEAR_BLOCKS=5

# Prices: AWAITING VERIFIED DATA for latest JIOFIN listed price
# export FLOOR_POINTS=<TBD>
# export ISSUE_POINTS=<TBD>

make deploy launch bids wait-migration settle trade
```

### TCS (6-hour auction, open for bidding)

```bash
export DEMO_LABEL="tcs-v1"
export DEPLOYMENTS_FILE="deployments/tcs.json"
export STOCK_NAME="Tata Consultancy Services"
export STOCK_SYMBOL="TCS"
export STOCK_TICKER="tcs"

# Timing: 6 hours ≈ 1800 blocks
# For demo purposes, use shorter clearing to stay under block gas limits
export BID_WINDOW_BLOCKS=1750
export CLEAR_BLOCKS=50        # Must divide 1e7; 50 works

# Prices: AWAITING VERIFIED DATA
# export FLOOR_POINTS=<TBD>
# export ISSUE_POINTS=<TBD>

# Deploy and launch, then LEAVE OPEN (do not run settle yet)
make deploy launch

# Participants can bid during the 6-hour window
# Run settle only after demo period ends:
# make wait-migration settle
```

**Important:** For TCS, `make bids` can be run multiple times during the 6-hour window with different wallets.

## Test USDC Per-Wallet Caps

The `AllowAllModule` enforces a per-applicant cap (default 20 USDC). With demo wallets receiving 20 USDC each from `make fund`, each can bid their full balance.

**Gas consideration:** Avoid very large auction supplies or extremely long clearing periods, as `LBPStrategy.migrate` has a 5M gas limit.

## Commands Reference

```bash
# Deploy a new stock listing
make deploy                    # Uses current env vars

# Launch auction
make launch                    # Creates CCA, sets validation hook

# Fund demo wallets (once, shared across listings)
make fund                      # Sends USDC + ETH to DEMO_WALLET_KEYS

# Place bids (during auction)
make bids                      # One bid per BID_AMOUNTS entry

# Settle after auction
make wait-migration            # Polls until migrationBlock
make settle                    # Exit bids, sweep, migrate to v4 pool
make trade                     # Demo in-band and out-of-band swaps

# ENS registration (optional)
make ens-sepolia              # Registers {ticker}.listingday.eth

# Export updated deployment JSON
make export-json              # Updates DEPLOYMENTS_FILE with tx hashes
```

## Constraints & Limits

1. **Floor price:** `FLOOR_POINTS >= 32` (CCA MIN_FLOOR_PRICE after Q96)
2. **Clear blocks:** Must divide 1e7 (used in mps calculation)
3. **Gas limits:** 
   - `submitBid`: 3M gas (hardcoded in DemoBid.sol)
   - `migrate`: 5M gas (hardcoded in DemoBase.sol)
4. **Block times:** Sepolia ~12s per block
5. **USDC cap:** 20 USDC per wallet (AllowAllModule)
6. **Unique labels:** Each DEMO_LABEL must be distinct for separate listings

## Notes

- **No band/halt demonstrations** in this parallel deployment setup
- **Each stock is independent:** separate contracts, no shared state
- **API serves all simultaneously** via `DEPLOYMENTS_FILES`
- **UI shows multiple listings** from `GET /v1/listings`
- **Test USDC only:** Not real value, clear disclaimers required

## Price Data Integration Checklist

Before deploying each stock, verify and set:

- [ ] Obtain verified reference price from trusted source
- [ ] Convert to appropriate point scale (document calculation)
- [ ] Set `FLOOR_POINTS` (typically 80-90% of issue price)
- [ ] Set `ISSUE_POINTS` (reference/display price)
- [ ] Document price source and conversion in deployment commit
- [ ] Add UI disclaimer: "Demo prices in test USDC, not real market values"

## Example Deployment Log

```bash
# JIOFIN (example with placeholder values)
export DEMO_LABEL="jiofin-v1"
export DEPLOYMENTS_FILE="deployments/jiofin.json"
export STOCK_NAME="Jio Financial Services"
export STOCK_SYMBOL="JIOFIN"
export STOCK_TICKER="jiofin"
export FLOOR_POINTS=85
export ISSUE_POINTS=100
export BID_WINDOW_BLOCKS=20
export CLEAR_BLOCKS=5

make deploy
# Output: MockSME 0x... (deployed)
#         ListingHook 0x... (deployed)
#         wrote deployments/jiofin.json

make launch
# Output: auction (CCA) 0x...
#         startBlock 12080000
#         endBlock 12080025
```

Each listing produces its own deployment file that the API can read independently.
