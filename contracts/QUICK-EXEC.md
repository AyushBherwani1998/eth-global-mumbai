# Quick Execution Reference

## Price Mappings (Nov 6 2026 Verified)

```
JIOFIN (₹231.20)    → 100 points issue, 80 floor, 190 cap
Reliance (₹1320.00) → 571 points issue, 457 floor, 1085 cap
TCS (₹2498.50)      → 1081 points issue, 865 floor, 2054 cap
```

## Prerequisites

```bash
cd contracts
# Ensure .env has: SEPOLIA_RPC_URL, PRIVATE_KEY, DEMO_WALLET_KEYS
source .env
```

## Execute: JIOFIN (5-minute auction)

```bash
set -a && source config-jiofin.env && set +a
make deploy          # Creates token, hook, receiver
make launch          # Creates auction
make wait-start      # Polls until startBlock
make bids            # 5 demo wallets bid
make wait-migration  # Polls until migrationBlock
make settle          # Exit, sweep, migrate to v4
make trade           # Demo in-band swap
```

## Execute: Reliance (5-minute auction)

```bash
set -a && source config-reliance.env && set +a
make deploy
make launch
make wait-start
make bids
make wait-migration
make settle
make trade
```

## Execute: TCS (6-hour open auction)

```bash
set -a && source config-tcs.env && set +a
make deploy
make launch
make wait-start
make bids            # Initial seeding only

# STOP HERE - leave auction open for 6 hours
# Others can bid during window

# Only after demo period ends:
# make wait-migration
# make settle
```

## API Configuration

In `services/api/.env`:
```bash
DEPLOYMENTS_FILES="../../contracts/deployments/sepolia.json,../../contracts/deployments/jiofin.json,../../contracts/deployments/reliance.json,../../contracts/deployments/tcs.json"
```

Restart API or let it hot-reload on next request.

## Verify Listings

```bash
curl http://localhost:8788/v1/listings | jq '.listings[].ticker'
# Should show: acme, jiofin, reliance, tcs
```

## Funding

Top up demo wallets before bids:
```bash
make fund
```

Check deployer balance:
```bash
cast balance 0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9 --rpc-url $SEPOLIA_RPC_URL
cast call 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 "balanceOf(address)(uint256)" 0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9 --rpc-url $SEPOLIA_RPC_URL
```

## Timing

Each 5-minute auction: ~25 blocks @ 12s = ~5 minutes total  
TCS 6-hour auction: ~1800 blocks @ 12s = ~6 hours total

## Outputs

- `deployments/jiofin.json`
- `deployments/reliance.json`  
- `deployments/tcs.json`

Each contains full deployment addresses, auction params, and tx hashes.

## Troubleshooting

**Out of USDC**: `make fund` or Circle faucet (20 USDC per 2h per address)  
**Gas too low**: Check deployer has >0.5 ETH for all three deployments  
**Wrong config**: Verify `echo $DEMO_LABEL` shows correct stock before each make  
**Auction not started**: `make wait-start` polls automatically  

## Disclaimer

Demo prices in test USDC. Not real USD-equity pricing.  
INR sources: charting.in, stockanalysis.com, goodreturns.in (third-party)
