# Deployment Records Configuration

## Available Listings

The API serves multiple stock listings from deployment records in `contracts/deployments/`:

- **ACME** (`sepolia.json`) - Completed demo listing
- **JIO** (`sepolia-jiofin.json`) - JioFin Services, graduated auction (99 USDC raised, 110 clearing points)
- **TCS** (`sepolia-tcs.json`) - Tata Consultancy Services, live auction (ends block 12082530)

## Vercel Environment Configuration

The hosted API at `https://listing-day-api.vercel.app` requires the `DEPLOYMENTS_FILES` environment variable to discover all listing records.

### Required Environment Variable

```
DEPLOYMENTS_FILES=contracts/deployments/sepolia.json#acme,contracts/deployments/sepolia-jiofin.json#jiofin,contracts/deployments/sepolia-tcs.json#tcs
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
```

Expected response includes all three tickers: `acme`, `jiofin`, `tcs`.

### Current Status (as of records)

- **ACME**: `sepolia.json` - Already deployed, no changes
- **JIO**: `sepolia-jiofin.json` - Auction settled, 99M USDC raised at 110 clearing points, metadata references Nov 6 INR close ₹231.20
- **TCS**: `sepolia-tcs.json` - Auction open with 6 bids (135M USDC committed), ends block 12082530, metadata references Nov 6 INR close ₹2498.50

All records use chain ID 11155111 (Sepolia testnet) with actual on-chain addresses and transaction history.

### Notes

- The `vercel.json` bundle pattern `contracts/deployments/**` already includes all records
- Reliance record will be added to this same PR when operator provides the data
- No code changes required - records are pure data files
