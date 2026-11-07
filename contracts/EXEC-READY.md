# Ready for Execution: Three-Stock Sepolia Demo

## Summary

Minimal parameterization complete for deploying three independent stock listings (JIOFIN, Reliance, TCS) with verified INR price inputs mapped to demo point system. **NO broadcasts executed yet** - code ready for execution worker.

## Price Mappings (Verified Nov 6 2026)

Sources: charting.in, stockanalysis.com, goodreturns.in (third-party, not official NSE)

| Stock | INR Close | Issue Points | Floor Points | Cap Points |
|-------|-----------|--------------|--------------|------------|
| **JIOFIN** | ₹231.20 | 100 | 80 | 190 |
| **Reliance** | ₹1320.00 | 571 | 457 | 1085 |
| **TCS** | ₹2498.50 | 1081 | 865 | 2054 |

**Scaling**: JIOFIN baseline 100 points; others proportional. Floor = 80% of issue, Cap = 190% of issue.

**Disclaimer**: Demo prices in test USDC (1 point = 0.01 USDC per 1000-share lot). Not real USD-equity pricing. UI must show INR source and test-only disclaimer.

## Modified Files

- `script/demo/DemoDeploy.s.sol` - token name/symbol, floor/issue/cap params
- `script/demo/DemoLaunch.s.sol` - supply amounts, required raise
- `script/demo/DemoBid.s.sol` - bid max price from cap percent
- `config-jiofin.env`, `config-reliance.env`, `config-tcs.env` - per-stock configs
- `DEPLOY-MULTI.sh` - execution command reference (dry-run)
- `STOCK-CONFIG.md` - detailed configuration guide

## Execution Commands

### Per Stock

```bash
# Load config
set -a && source config-jiofin.env && set +a

# Deploy (creates token, hook, receiver at new addresses)
make deploy

# Launch auction
make launch

# Place bids (after startBlock)
make wait-start
make bids

# Settle (after endBlock)
make wait-migration
make settle
make trade
```

Repeat for each stock with its config file. **TCS: do NOT run settle** - leave 6-hour auction open.

### API Configuration

In `services/api/.env`:
```bash
DEPLOYMENTS_FILES="../../contracts/deployments/sepolia.json,../../contracts/deployments/jiofin.json,../../contracts/deployments/reliance.json,../../contracts/deployments/tcs.json"
```

API hot-reloads; listings appear immediately after `make deploy`.

## Auction Timings

- **JIOFIN**: 20 bid + 5 clear = 25 blocks ≈ 5 min total
- **Reliance**: 20 bid + 5 clear = 25 blocks ≈ 5 min total  
- **TCS**: 1750 bid + 50 clear = 1800 blocks ≈ 6 hours total (LEAVE OPEN)

## Funding Status (Read-Only Check)

Deployer `0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9`:
- ~449.22 test USDC
- ~0.8691 Sepolia ETH

Demo wallets (5 bidders + 1 trader):
- Wallets 0-2: 0.018-0.020 ETH, 0 USDC
- Wallets 3-4: 0.018-0.020 ETH, 20 USDC each
- Trader: 20 USDC

**Execution worker should top up via `make fund` as needed from deployer before bids.** No user funding required now.

## Gas Preserved

- `submitBid`: 3M gas limit (preserved existing fix)
- `migrate`: 5M gas limit (preserved)
- All other hooks unchanged

## What's NOT Included

- No band/halt demonstrations
- No ENS registration commands (optional: `make ens-sepolia` per stock)
- No Railway/hosting changes
- No frontend modifications
- No secrets or broadcasts in this PR

## Verification Before Broadcast

```bash
# Test config loading
./test-config.sh

# Dry-run command reference
./DEPLOY-MULTI.sh

# Fork test (requires forge, not run here)
# SEPOLIA_RPC_URL=<rpc> make demo-fork
```

## Critical Constraints

1. `FLOOR_POINTS >= 32` (CCA MIN_FLOOR_PRICE)
2. `CLEAR_BLOCKS` must divide 1e7
3. Each `DEMO_LABEL` must be unique
4. Separate `DEPLOYMENTS_FILE` per stock
5. Demo wallets need USDC + ETH before bids

## Next Steps for Execution Worker

1. Source each config file
2. Run `make deploy launch` per stock
3. Check deployer owns full supply before launch
4. Top up demo wallets: `make fund`
5. Wait for `startBlock`, run `make bids`
6. For JIOFIN/Reliance: settle and trade
7. For TCS: **LEAVE OPEN** (no settle)
8. Update API `DEPLOYMENTS_FILES` to include all JSONs
9. Verify UI shows all three listings at separate tickers

## Point System Reference

```
1 point = 0.01 USDC per 1000-share lot
100 points = 1.00 USDC per lot = 0.001 USDC per share

JIOFIN 100 points = "1.00 USDC per 1000 shares (demo ref: ₹231.20)"
Reliance 571 points = "5.71 USDC per 1000 shares (demo ref: ₹1320.00)"
TCS 1081 points = "10.81 USDC per 1000 shares (demo ref: ₹2498.50)"
```

UI should display both point value AND demo USDC equivalent with INR source attribution and test-only disclaimer.

---

**Branch**: `cursor/multi-stock-config-8da0`  
**Status**: Code ready, NO broadcasts yet  
**Verified**: Config loading, price calculations, relative cap scaling  
**Awaiting**: Execution worker broadcast with existing funded deployer
