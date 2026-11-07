# Deployment Records Configuration

## Available Listings

The API serves multiple stock listings from deployment records in `contracts/deployments/`:

- **ACME** (`sepolia.json`) - Completed demo listing
- **JIO** (`sepolia-jiofin.json`) - JioFin Services, settled auction (99 test USDC raised, 110 clearing points)
- **TCS** (`sepolia-tcs.json`) - Tata Consultancy Services, live auction with 6 bids (135 test USDC committed, ends block 12082530)
- **Reliance** (`sepolia-reliance.json`) - Reliance Industries, settled auction (120 test USDC raised, 600 clearing points)

## Vercel Environment Configuration

The hosted API at `https://listing-day-api.vercel.app` requires the `DEPLOYMENTS_FILES` environment variable to discover all listing records.

### Required Environment Variable

```
DEPLOYMENTS_FILES=contracts/deployments/sepolia.json#acme,contracts/deployments/sepolia-jiofin.json#jiofin,contracts/deployments/sepolia-tcs.json#tcs,contracts/deployments/sepolia-reliance.json#reliance
```

**Format:** Comma-separated list of `path#ticker` entries
- `path` is root-relative (Vercel function cwd is `/var/task`)
- `#ticker` override is required when the record lacks an ENS ticker section
- Records are re-read on every request (no restart needed for updates)

### Verification

After setting the environment variable in Vercel dashboard:

```bash
# Check all listings are discoverable
curl https://listing-day-api.vercel.app/v1/listings | jq '.listings[] | {ticker, label, status}'

# Verify specific tickers
curl https://listing-day-api.vercel.app/v1/listings/jiofin | jq '{ticker, label, auction}'
curl https://listing-day-api.vercel.app/v1/listings/tcs | jq '{ticker, label, auction}'
curl https://listing-day-api.vercel.app/v1/listings/reliance | jq '{ticker, label, auction}'
```

Expected response includes all four tickers: `acme`, `jiofin`, `tcs`, `reliance`.

### Current Status (as of records)

- **ACME**: `sepolia.json` - Already deployed, no changes
- **JIO**: `sepolia-jiofin.json` - Settled, 99 test USDC raised at 110 clearing points, migrated at block 12080785 (tx `0x7d2987...fed6b`), listed at 08:12:12 IST, metadata references Nov 6 INR close ₹231.20
- **TCS**: `sepolia-tcs.json` - Live auction with 6 bids, 135 test USDC committed, ends block 12082530 (~14:04 IST), metadata references Nov 6 INR close ₹2498.50
- **Reliance**: `sepolia-reliance.json` - Settled, 120 test USDC raised at 600 clearing points, migrated at block 12080850 (tx `0x12e916...83f6b96`), listed at 08:24:48 IST, metadata references Nov 6 INR close ₹1320.00

All records use chain ID 11155111 (Sepolia testnet) with actual on-chain addresses and transaction history from demo deployment. Amounts are in test USDC (6 decimals): 99, 135, and 120 test USDC, not millions.

### Notes

- The `vercel.json` bundle pattern `contracts/deployments/**` already includes all records
- No code changes required - records are pure data files
- No ENS names registered, no halts configured, baseline policy still zeros
- Small trades not included (compilation blocked), DON workflow not deployed
- Mock forwarder configured only; production CRE workflow not required for demo
