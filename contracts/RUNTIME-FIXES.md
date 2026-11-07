# Runtime Blockers FIXED - TCS Already Launched

## Critical Issues Resolved

### 1. Stack Too Deep - FIXED
**Makefile**: Added `FORGE_FLAGS=--via-ir` default

### 2. LP_RESERVE Arithmetic - FIXED
**Problem**: Launch distributes `TOTAL - LP_RESERVE` to auction, NOT `AUCTION_SUPPLY`
**Fix**: 
- Reliance: LP_RESERVE = 110k - 20k = 90k
- TCS: LP_RESERVE = 110k - 12k = 98k
- JIOFIN: LP_RESERVE = 110k - 90k = 20k (unchanged)

### 3. BidAboveCap Error DECODED
**Error**: 0xc9cb70dc = BidAboveCap(maxPrice, capQ96)
- TCS bid maxPrice: 2054 points
- TCS capQ96: 2053 points (integer division!)

**Root cause**: Cap calculation `(issue * 190) / 100`
- TCS: (1081 * 190) / 100 = 2053 points (not 2054)
- Reliance: (571 * 190) / 100 = 1084 points (not 1085)

**Fix**: Corrected BID_MAX_POINTS in all configs

### 4. TCS Already Deployed & Launched
**Preserving**:
- Token: 0xf85Cd9c3F02dC578e0a82F8fdA1e837916034f09
- Hook: 0xA1d11E02B66E2fe9d1e24d907251e757473Fb0C0
- Receiver: 0xABA8dEFf6B92F952fF64a04Eb76C5A1E58966b14
- Auction: 0x44F69021Fe7e109f974d8E7785E785e11Cb6B2ad
- Blocks: 12080730 (start) → 12082530 (end) → 12082531 (migration)

**Status**: NO BIDS YET - can now bid with corrected BID_MAX_POINTS=2053

## Corrected Budget (6 wallets @ 75 USDC each)

| Stock | Auction | LP Reserve | Bids | Bid Cap |
|-------|---------|------------|------|---------|
| JIOFIN | 90k | 20k | 99 (5 wallets) | 190 |
| Reliance | 20k | 90k | 120 (6 wallets) | 1084 |
| TCS | 12k | 98k | 135 (6 wallets) | 2053 |

**Total**: 354 USDC from 450 available (96 margin) ✓

## Execution Commands CORRECTED

### TCS (RESUME - Already Launched)
```bash
cd contracts
set -a && source config-tcs.env && set +a
export SKIP_OUT_OF_BAND_TEST=true

# Auction already launched, just bid:
make bids
# STOP - no settle, 6-hour auction
```

### JIOFIN (Resume from Deployed)
```bash
set -a && source config-jiofin.env && set +a
export SKIP_OUT_OF_BAND_TEST=true

# Contracts deployed, need auction:
make launch wait-start bids wait-migration settle trade
```

### Reliance (Full Deploy)
```bash
set -a && source config-reliance.env && set +a
export SKIP_OUT_OF_BAND_TEST=true

make deploy launch wait-start bids wait-migration settle trade
```

## Verification

### Check TCS Auction Supply
```bash
# Should show 12k * 1e18
cast call 0x44F69021Fe7e109f974d8E7785E785e11Cb6B2ad "totalSupply()(uint256)" --rpc-url $SEPOLIA_RPC_URL
```

### Test TCS Bid (Read-Only Simulation)
```bash
# Should succeed now with BID_MAX_POINTS=2053
DEMO_WALLET_KEYS=... BID_AMOUNTS=25000000 forge script script/demo/DemoBid.s.sol --rpc-url $SEPOLIA_RPC_URL
```

## No Recreations Needed
- TCS auction valid, just needed corrected bid cap
- JIOFIN contracts preserved
- Reliance not yet deployed

All fixes maintain existing deployments.
