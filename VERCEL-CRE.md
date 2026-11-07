# Vercel Deployment for CRE Support

## Overview

Minimal Vercel configuration to host HTTP endpoints for Chainlink Runtime Environment (CRE) workflow integration. **Vercel hosts stateless HTTP APIs only**—the CRE workflow itself runs separately via local `cre` CLI simulation or optional DON deployment.

## What Vercel Hosts

**✅ HTTP Endpoints (Serverless Functions):**
- `/v1/*` - Listing Day API (existing, already configured)
- `/api/policy` - Exchange policy feed (NEW, for CRE workflow)

**❌ NOT Hosted on Vercel:**
- CRE workflow execution (runs via `cre` CLI)
- Long-running workers or cron jobs
- Persistent state storage

## Architecture

```
Vercel (Stateless HTTP)          CRE Workflow (Separate)
┌────────────────────┐           ┌──────────────────────┐
│ api/policy.ts      │  ←─GET─── │ cre workflow simulate│
│ GET  /api/policy   │           │ (runs from cre/ dir) │
│ POST /api/policy   │           │                      │
└────────────────────┘           └──────────────────────┘
```

## Files Changed

1. **`api/policy.ts`** (NEW) - Serverless policy endpoint
2. **`vercel.json`** (UPDATED) - Route and function config

## Configuration

### 1. Vercel Environment Variables

Set in Vercel Dashboard → Settings → Environment Variables:

**Required for policy endpoint:**
```
MOCK_EXCHANGE_SECRET=<random-hex-secret>
```

Generate secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Required for listings API (existing):**
```
DEPLOYMENTS_FILES=contracts/deployments/sepolia.json#acme,contracts/deployments/sepolia-jiofin.json#jiofin,contracts/deployments/sepolia-tcs.json#tcs,contracts/deployments/sepolia-reliance.json#reliance
SEPOLIA_RPC_URL=<your-rpc-url-with-full-logs>
```

### 2. CRE Workflow Configuration

Edit `cre/listing-policy/config.staging.json` to point to Vercel:

```json
{
  "schedule": "0 */1 * * * *",
  "apiUrl": "https://your-project.vercel.app/api/policy",
  "chainSelectorName": "ethereum-testnet-sepolia",
  "receiverAddress": "0xYourDeployedReceiverAddress",
  "usdcIsCurrency0": true,
  "gasLimit": "1800000"
}
```

## API Endpoints

### GET /api/policy (Read - No Auth)

Returns current exchange policy. CRE workflow fetches this.

**Example:**
```bash
curl https://your-project.vercel.app/api/policy
```

**Response:**
```json
{
  "ticker": "ACME",
  "refPricePoints": null,
  "mode": "normal",
  "halted": false,
  "coolOffUntil": 0,
  "bands": { "normalBps": 2000, "surveillanceBps": 500 },
  "status": "",
  "revision": 0,
  "updatedAt": 1730936400
}
```

### POST /api/policy (Write - Auth Required)

Update policy fields. Requires `x-api-key: <secret>` or `Authorization: Bearer <secret>`.

**Example:**
```bash
curl -X POST https://your-project.vercel.app/api/policy \
  -H "x-api-key: $MOCK_EXCHANGE_SECRET" \
  -H "content-type: application/json" \
  -d '{"mode": "surveillance", "refPricePoints": 90}'
```

## CRE Workflow Simulation

**Prerequisites:**
- `cre` CLI installed (`curl -sSL https://app.chain.link/cre/install.sh | bash`)
- CRE account (`cre login` or `export CRE_API_KEY=...`)
- Bun ≥ 1.2.21 for tests

**Steps:**

```bash
# 1. Install dependencies
cd cre/listing-policy
bun install

# 2. Update config.staging.json with Vercel URL (see above)

# 3. From cre/ directory (NOT cre/listing-policy):
cd ..
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0
```

**Official Rules:** [ETHGlobal Mumbai - Chainlink](https://ethglobal.com/events/mumbai/prizes/chainlink)  
CLI simulation is sufficient for Best Workflow track. DON deployment is optional.

## Verification

### 1. Verify Vercel Deployment

```bash
# Health check
curl https://your-project.vercel.app/health

# Policy endpoint
curl https://your-project.vercel.app/api/policy

# Listings (should return 4 tickers)
curl https://your-project.vercel.app/v1/listings | jq '.listings[] | .ticker'
```

### 2. Check Contract Integration

Query receiver's policy view (after successful CRE broadcast):

```bash
# View function signature from IListingPolicyReceiver.sol:
# function policy() external view returns (
#   uint160 refSqrtPriceX96, uint64 asOf, uint64 coolOffUntil,
#   uint16 normalBandBps, uint16 survBandBps, uint8 mode,
#   bool halted, uint64 staleAt, uint16 policyMode
# );

cast call $RECEIVER_ADDRESS \
  "policy()(uint160,uint64,uint64,uint16,uint16,uint8,bool,uint64,uint16)" \
  --rpc-url $SEPOLIA_RPC_URL
```

## Limitations

### Serverless Constraints

**⚠️ State resets on cold starts:**
- Policy stored in-memory only
- Resets to defaults when function cold-starts
- **Not suitable for production control store**
- Mutations may not persist across invocations

**For persistent state:**
- Deploy `services/mock-exchange` to Railway (persistent `STATE_FILE`)
- Or implement external storage (Upstash KV, database)

### Security

**Server-side secrets only:**
- `MOCK_EXCHANGE_SECRET` - Write auth
- `SEPOLIA_RPC_URL` - RPC key

Never use `NEXT_PUBLIC_*` prefix for secrets.

**Authentication:**
- GET /api/policy - Public (CRE needs read access)
- POST/PUT /api/policy - Requires secret header
- Failed auth returns 401

## Troubleshooting

### Policy endpoint returns 500

Check Vercel logs: `vercel logs --follow`

Common causes:
- Missing `MOCK_EXCHANGE_SECRET` env var
- Import path errors

### CRE workflow fails to fetch

Check:
1. `apiUrl` in `config.staging.json` is correct
2. Endpoint responds: `curl https://your-project.vercel.app/api/policy`
3. CORS headers present (check response)

### Listings API returns empty

Missing `DEPLOYMENTS_FILES` environment variable. Add comma-separated paths with `#ticker` overrides.

## Testing Status

**✅ Basic verification:**
- Syntax valid
- Logic matches `services/mock-exchange` contract
- Routes configured

**⚠️ Requires Vercel access to test:**
- Actual deployment
- Environment variable injection
- Cold start behavior

## Next Steps

1. Deploy PR to Vercel
2. Set environment variables in dashboard
3. Verify `/api/policy` endpoint responds
4. Update `cre/listing-policy/config.staging.json` with Vercel URL
5. Run CRE simulation: `cd cre && cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0`

## Documentation

- [CRE Workflow README](cre/README.md)
- [Mock Exchange README](services/mock-exchange/README.md)
- [Listing Day API README](services/api/README.md)
- [Deployments Config](DEPLOYMENTS.md)
