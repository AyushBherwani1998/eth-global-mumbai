# Vercel Deployment Guide for CRE Support

## Overview

This guide explains how to deploy Listing Day's HTTP APIs on Vercel to support the Chainlink CRE (Continual Risk Evaluation) workflow. **Important:** Vercel hosts only the HTTP API endpoints—the CRE workflow itself runs separately via local CLI simulation or optional Chainlink DON deployment.

### What Vercel Hosts

**✅ Vercel Hosts (Serverless HTTP Functions):**
- **Listing Day API** (`/v1/*`) - Main API for listings, auctions, market data
- **Policy Feed** (`/api/policy`) - Exchange policy endpoint that CRE workflow fetches

**❌ Vercel Does NOT Host:**
- CRE Workflow execution (runs via `cre` CLI or Chainlink DON)
- Long-running polling/cron workers
- Persistent stateful processes
- Real-time WebSocket connections

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Vercel (Serverless HTTP)                                    │
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │ api/index.ts         │    │ api/policy.ts            │  │
│  │ Listing Day API      │    │ Exchange Policy Feed     │  │
│  │ GET /v1/listings     │    │ GET  /api/policy        │  │
│  │ GET /v1/market/:id   │    │ POST /api/policy        │  │
│  │ POST /v1/prepare/*   │    │ PUT  /api/policy        │  │
│  └──────────────────────┘    │ POST /api/policy/reset  │  │
│                               └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ HTTP GET
                                      │
                         ┌────────────┴──────────────┐
                         │ CRE Workflow              │
                         │ (Runs Separately)         │
                         │                           │
                         │ • Local: `cre simulate`   │
                         │ • DON: Deployed workflow  │
                         │ • Fetches policy on cron  │
                         │ • Writes to blockchain    │
                         └───────────────────────────┘
```

## Deployment Files

### Repository Structure

```
eth-global-mumbai/
├── api/
│   ├── index.ts              # Vercel entry for Listing Day API
│   └── policy.ts             # Vercel entry for Policy Feed (NEW)
├── vercel.json               # Vercel configuration (UPDATED)
├── contracts/deployments/    # Stock listing records
│   ├── sepolia.json          # ACME
│   ├── sepolia-jiofin.json   # JIO
│   ├── sepolia-tcs.json      # TCS
│   └── sepolia-reliance.json # Reliance
├── services/api/             # Listing Day API source
│   └── src/
│       ├── bootstrap.ts
│       └── ...
└── services/mock-exchange/   # Policy feed source
    └── src/
        ├── policy.ts
        └── server.ts
```

### Changes Made

#### 1. `api/policy.ts` (NEW)
Serverless adapter for the exchange policy feed. Wraps `services/mock-exchange` logic for Vercel execution.

**Key Features:**
- Stateless serverless function
- CORS enabled for browser console access
- Same HTTP contract as local `mock-exchange`
- In-memory state (resets on cold start)

**Limitations:**
- No persistent `STATE_FILE` support (serverless limitation)
- Policy resets to defaults on cold starts
- For persistence, use external KV store or Railway deployment

#### 2. `vercel.json` (UPDATED)
Added policy feed function configuration:

```json
{
  "rewrites": [
    { "source": "/api/policy(.*)", "destination": "/api/policy" },
    { "source": "/(.*)", "destination": "/api" }
  ],
  "functions": {
    "api/index.ts": {
      "includeFiles": "{contracts/deployments/**,services/api/src/**}",
      "maxDuration": 60
    },
    "api/policy.ts": {
      "includeFiles": "services/mock-exchange/src/**",
      "maxDuration": 10
    }
  }
}
```

## Vercel Configuration

### Required Environment Variables

Configure in Vercel Dashboard → Project Settings → Environment Variables:

#### For Listing Day API (`api/index.ts`)

| Variable | Value | Notes |
|----------|-------|-------|
| `DEPLOYMENTS_FILES` | `contracts/deployments/sepolia.json#acme,contracts/deployments/sepolia-jiofin.json#jiofin,contracts/deployments/sepolia-tcs.json#tcs,contracts/deployments/sepolia-reliance.json#reliance` | **Required.** Comma-separated list with `#ticker` overrides |
| `SEPOLIA_RPC_URL` or `RPC_URL` | `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY` | **Required.** Full log history provider (not publicnode) |
| `CHAIN_ID` | `11155111` | Optional. Defaults to first deployment's chainId |
| `CORS_ORIGINS` | `https://your-app.vercel.app,https://*.vercel.app` | Optional. Defaults to localhost |
| `EXPLORER_URL` | `https://sepolia.etherscan.io` | Optional. For tx/address links |

**Important:** These are server-side secrets. Never use `NEXT_PUBLIC_*` prefix for RPC URLs or keys.

#### For Policy Feed (`api/policy.ts`)

| Variable | Value | Notes |
|----------|-------|-------|
| `MOCK_EXCHANGE_SECRET` | `<generate-random-secret>` | **Required.** Shared secret for write operations (POST/PUT) |
| `TICKER` | `ACME` | Optional. Default ticker name |

**Generate secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Vercel Project Settings

1. **Root Directory:** Leave as `.` (repository root)
2. **Framework Preset:** None / Other
3. **Build Command:** Leave empty (uses `vercel.json`)
4. **Install Command:** `npm ci` (default)
5. **Output Directory:** Leave empty
6. **Node.js Version:** 22.x (set in Project Settings → General)

## CRE Workflow Configuration

The CRE workflow runs **separately** from Vercel, either locally or on Chainlink DON.

### Local Simulation (No CRE Account Required)

**Prerequisites:**
- Node.js ≥ 22.18
- Bun ≥ 1.2.21
- `cre` CLI (install: `curl -sSL https://app.chain.link/cre/install.sh | bash`)

**Simulation Steps:**

```bash
# 1. Set up CRE workflow
cd cre/listing-policy
bun install
bun test              # Verify tests pass

# 2. Update config.staging.json
# Change apiUrl to your Vercel deployment
nano config.staging.json
```

**`cre/listing-policy/config.staging.json`:**
```json
{
  "schedule": "0 */1 * * * *",
  "apiUrl": "https://your-project.vercel.app/api/policy",
  "chainSelectorName": "ethereum-testnet-sepolia",
  "receiverAddress": "0xYourReceiverAddress",
  "usdcIsCurrency0": true,
  "gasLimit": "1800000"
}
```

**Update `apiUrl`:**
- Local mock-exchange: `http://127.0.0.1:8787/policy`
- Vercel deployment: `https://your-project.vercel.app/api/policy`
- Railway deployment: `https://your-project.railway.app/policy`

**Run simulation:**
```bash
# With CRE account (requires login)
cre login
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0

# Expected output:
# ✓ Fetched policy from apiUrl
# ✓ Encoded ListingPolicy report
# ✓ Prepared writeReport transaction
# ℹ Report payload: 0x...
```

**Without CRE account:**
```bash
# Run offline tests (no CLI required)
cd cre/listing-policy
bun test              # All tests must pass
```

### Chainlink DON Deployment (Optional)

**Official Rules:** [ETHGlobal Mumbai - Chainlink Prize](https://ethglobal.com/events/mumbai/prizes/chainlink)
- **Simulation is sufficient** for the Best Workflow track
- DON deployment is optional, not required

**If deploying to DON:**
1. Fund broadcaster key with Sepolia ETH
2. Deploy `ListingPolicyReceiver` contract
3. Update `config.staging.json` with receiver address
4. Deploy workflow: `cre workflow deploy ./listing-policy --target staging-settings`
5. Monitor via Chainlink dashboard

**Broadcast Requirements:**
- `CRE_ETH_PRIVATE_KEY`: Funded key (server-side only, never commit)
- Receiver's `broadcaster` must match key's address
- Use `MockKeystoneForwarder` (0x15fC...F88) for simulation
- Production: Switch to `KeystoneForwarder` (0xF834...82)

## Verification

### 1. Verify Vercel Deployment

**Check Listing Day API:**
```bash
# Health check
curl https://your-project.vercel.app/health

# List all tickers
curl https://your-project.vercel.app/v1/listings | jq '.listings[] | {ticker, label}'

# Should return: acme, jiofin, tcs, reliance
```

**Check Policy Feed:**
```bash
# Get current policy (no auth required)
curl https://your-project.vercel.app/api/policy | jq

# Expected response:
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

**Test policy write (requires secret):**
```bash
SECRET="your-secret-here"
curl -X POST https://your-project.vercel.app/api/policy \
  -H "x-api-key: $SECRET" \
  -H "content-type: application/json" \
  -d '{"halted": true}'
```

### 2. Test CRE Workflow Integration

**Verify workflow can fetch policy:**
```bash
# From cre/ directory
cd cre/listing-policy

# Update config.staging.json with your Vercel URL
# Then run workflow tests
bun run test:workflow

# Or simulate full run (requires cre login)
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0
```

**Expected workflow output:**
```
✓ Trigger: Cron (0 */1 * * * *)
✓ Fetched policy: {"ticker":"ACME","mode":"normal",...}
✓ Encoded report: 0x... (460 bytes)
✓ Report hash: 0x...
✓ Transaction prepared: writeReport(receiver, report, context, sigs)
```

### 3. Verify Contract Integration (On-chain)

**After successful broadcast:**
```bash
# Check receiver received report
cast logs --address $RECEIVER_ADDRESS \
  --from-block $DEPLOY_BLOCK \
  --to-block latest \
  --rpc-url $SEPOLIA_RPC_URL \
  "PolicyApplied(uint32,uint64,uint64,uint160,uint16,uint16,uint8,bool,uint64)"

# Query latest policy
cast call $RECEIVER_ADDRESS \
  "latestPolicy()((uint32,uint64,uint64,uint160,uint16,uint16,uint8,bool,uint64))" \
  --rpc-url $SEPOLIA_RPC_URL
```

## Limitations & Boundaries

### Vercel Limitations

1. **No Persistent State**
   - Policy resets to defaults on cold starts
   - Use external storage (Upstash KV, Supabase) for persistence
   - Or deploy mock-exchange to Railway/Docker

2. **No Long-Running Processes**
   - CRE workflow cron must run externally
   - No background workers or polling loops
   - No WebSocket connections

3. **Function Timeouts**
   - Hobby: 10s max
   - Pro: 60s max (current API setting)
   - Enterprise: 900s max

4. **Cold Starts**
   - First request after idle may be slow (1-3s)
   - Policy state resets on cold start
   - RPC connections need warm-up

### CRE Workflow Boundaries

**What CRE Workflow Does:**
- Fetches policy from Vercel API endpoint
- Validates and encodes policy
- Signs report with DON consensus
- Broadcasts to `ListingPolicyReceiver` contract

**What CRE Workflow Does NOT Do:**
- Host HTTP endpoints (that's Vercel's job)
- Store policy state (stateless fetcher)
- Execute trades or mutations
- Manage user authentication

**Simulation vs DON:**
- **Simulation:** Local CLI execution, sufficient for hackathon
- **DON Deployment:** Optional production path, not required

## State Persistence Options

Since Vercel functions are stateless, policy edits reset on cold starts. Options for persistence:

### Option 1: External KV Store (Recommended for Vercel)

**Upstash Redis:**
```typescript
// Add to api/policy.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

async function getPolicy(): Promise<ExchangePolicy> {
  const stored = await redis.get('policy');
  return stored ?? defaultPolicy('ACME', now());
}

async function setPolicy(next: ExchangePolicy): Promise<ExchangePolicy> {
  await redis.set('policy', next);
  return next;
}
```

**Environment variables:**
- `UPSTASH_REDIS_URL`
- `UPSTASH_REDIS_TOKEN`

### Option 2: Railway Deployment (Persistent)

Deploy `services/mock-exchange` to Railway for persistent `STATE_FILE`:

```bash
# Railway deployment (from repo root)
railway link
railway up --service mock-exchange
railway variables set MOCK_EXCHANGE_SECRET=<secret>
railway variables set STATE_FILE=/data/policy.json
```

**Benefits:**
- Persistent file-based state
- Long-running server
- Webhook support

**Update CRE config:**
```json
{
  "apiUrl": "https://your-project.railway.app/policy"
}
```

## Security Considerations

### Secrets Management

**Server-Side Only:**
- `MOCK_EXCHANGE_SECRET`: Write authentication
- `SEPOLIA_RPC_URL`: RPC access key
- `CRE_ETH_PRIVATE_KEY`: Broadcaster key (CRE side, not Vercel)

**Never Use `NEXT_PUBLIC_*`:**
These expose secrets to browser JavaScript. All API secrets must be server-side.

### Policy Write Protection

**Authentication Required:**
- All POST/PUT requests require `x-api-key: <secret>` or `Authorization: Bearer <secret>`
- GET requests are public (CRE workflow needs read access)
- Secret rotates per deployment

**CORS Policy:**
- Policy feed allows `*` origin for CRE workflow access
- Browser console can call GET (useful for debugging)
- Write operations protected by secret

### Rate Limiting

**Vercel automatically provides:**
- DDoS protection
- Rate limiting per IP
- Function concurrency limits

**Recommended additional limits:**
- Implement per-IP write rate limit
- Monitor unusual policy change patterns
- Alert on multiple failed auth attempts

## Troubleshooting

### Policy Feed Returns 500

**Check Vercel logs:**
```bash
vercel logs --follow
```

**Common causes:**
- Missing `MOCK_EXCHANGE_SECRET`
- Import path errors
- TypeScript compilation issues

**Solution:**
```bash
# Verify build locally
cd api
tsc --noEmit policy.ts
```

### CRE Workflow Cannot Fetch Policy

**Symptoms:**
- `cre simulate` fails with network error
- "Failed to fetch policy" in logs

**Check:**
1. Vercel URL is correct in `config.staging.json`
2. Policy endpoint responds: `curl https://your-project.vercel.app/api/policy`
3. CORS headers present: Check response headers
4. No auth required for GET requests

**Fix:**
```bash
# Test endpoint directly
curl -v https://your-project.vercel.app/api/policy

# Should return 200 with JSON body
# Headers should include: Access-Control-Allow-Origin: *
```

### Listing Day API Returns Empty Listings

**Symptom:**
```json
{"listings": [], "errors": ["...not found..."]}
```

**Cause:** Missing or incorrect `DEPLOYMENTS_FILES` environment variable

**Fix:**
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add/Update `DEPLOYMENTS_FILES`:
   ```
   contracts/deployments/sepolia.json#acme,contracts/deployments/sepolia-jiofin.json#jiofin,contracts/deployments/sepolia-tcs.json#tcs,contracts/deployments/sepolia-reliance.json#reliance
   ```
3. Redeploy: `vercel --prod`

### Cold Start Resets Policy

**Expected behavior:** Serverless functions are stateless

**Solutions:**
1. **Accept resets:** Fine for demo/testing
2. **Use KV store:** Upstash Redis for persistence
3. **Deploy to Railway:** Persistent STATE_FILE support

## Testing Checklist

Before deploying to production:

- [ ] Vercel deployment succeeds
- [ ] `/health` returns `{"ok": true}`
- [ ] `/v1/listings` returns all 4 tickers
- [ ] `/api/policy` returns valid policy JSON
- [ ] CRE workflow tests pass (`bun test`)
- [ ] Policy write with secret succeeds
- [ ] Policy write without secret returns 401
- [ ] CORS headers present on all responses
- [ ] RPC_URL has full log history
- [ ] DEPLOYMENTS_FILES includes all records
- [ ] Secrets are server-side only (not NEXT_PUBLIC_)

**Build verification:**
```bash
# From repo root
npm ci
npm run build --if-present
vercel build --debug
```

**Lint & typecheck:**
```bash
# API
cd services/api
npm run lint
npm run typecheck

# Mock exchange
cd ../mock-exchange
npm run typecheck

# CRE workflow
cd ../../cre/listing-policy
bun run typecheck
```

## Additional Resources

### Documentation

- [Listing Day API README](services/api/README.md)
- [Mock Exchange README](services/mock-exchange/README.md)
- [CRE Workflow README](cre/README.md)
- [Deployments Configuration](DEPLOYMENTS.md)

### Official Links

- [Vercel Documentation](https://vercel.com/docs)
- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [ETHGlobal Mumbai - Chainlink Prize](https://ethglobal.com/events/mumbai/prizes/chainlink)

### Support

For deployment issues:
- Check Vercel logs: `vercel logs`
- Verify environment variables in dashboard
- Test endpoints with `curl -v`
- Review function logs in Vercel dashboard

For CRE workflow issues:
- Run offline tests: `cd cre/listing-policy && bun test`
- Check config.staging.json URLs
- Verify receiver address is deployed
- Ensure broadcaster key is funded

## Summary

**What You Get:**
- ✅ Listing Day API on Vercel (`/v1/*`)
- ✅ Policy Feed on Vercel (`/api/policy`)
- ✅ CRE workflow integration (local or DON)
- ✅ Stock listing records (4 tickers)

**What You Need:**
- Vercel account with project access
- Sepolia RPC URL with full log history
- Mock exchange secret for writes
- (Optional) CRE account for DON deployment

**What's Sufficient for Hackathon:**
- ✅ Local CRE simulation (`bun test` passing)
- ✅ Vercel endpoints accessible
- ✅ Demo data flow working
- ❌ DON deployment NOT required (simulation counts)

**Deployment Time:**
- Vercel setup: ~10 minutes
- Environment variables: ~5 minutes
- CRE configuration: ~5 minutes
- Testing: ~10 minutes
- **Total: ~30 minutes**
