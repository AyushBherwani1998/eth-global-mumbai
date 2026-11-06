# api: the Listing Day backend proxy

This is the thin HTTP layer the app calls instead of `app/src/lib/mock.ts`. Design notes are in [plan.md §6.1](../../plan.md#61-backend-proxy-servicesapi).

- **Pure proxy.** Every request runs live `eth_call` / `eth_getLogs` through viem against one RPC, pinned to one head block per request. There is **no cache, no indexer and no DB**. Same-tick reads share one Multicall3 call.
- **Never signs or sends.** `POST /v1/prepare/*` returns unsigned calldata plus a simulation from the user's address. The app sends the steps through MetaMask.
- **Config from the demo deployments JSON** (`contracts/deployments/<network>.json`), with env overrides. The same build serves an anvil Sepolia fork and real Sepolia.

It runs on Hono and `@hono/node-server`. Node 22.18 or newer runs the TypeScript directly (type stripping), as in `services/mock-exchange`.

## Run it

```bash
cd services/api
npm install

# Against a local anvil rehearsal of the demo (contracts/: KEEP_ANVIL=1 SEPOLIA_RPC_URL=<rpc> make demo-anvil)
RPC_URL=http://127.0.0.1:8546 DEPLOYMENTS_FILES=../../contracts/deployments/anvil.json npm start

# Against Sepolia (contracts/deployments/sepolia.json, the live ACME listing)
SEPOLIA_RPC_URL=<rpc> npm start                     # http://127.0.0.1:8788

npm run dev          # same as start, restarts on file changes
npm test             # unit tests (no RPC)
npm run lint && npm run typecheck
npm run abis:check   # src/abis.generated.ts matches contracts/abis (npm run abis regenerates it)
SEPOLIA_RPC_URL=<rpc> [SEPOLIA_FORK_BLOCK=<n>] npm run test:integration   # anvil fork + demo + every endpoint
```

Every variable is documented in [`.env.example`](.env.example). The main ones:

| Env | Default | |
| --- | --- | --- |
| `DEPLOYMENTS_FILES` | `../../contracts/deployments/sepolia.json` | Comma-separated, one listing per file, re-read on every request (a running server picks up `make launch`, `settle`, `ens-*`). Use `path#ticker` to name a file with no ENS section |
| `RPC_URL` / `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Must support `eth_getLogs` from the deployment's `deployBlock` to head, and `eth_simulateV1` (prepare with pending approvals, swap `priceAfter`). **publicnode prunes logs older than about 1.5 days**: once the deploy block falls out of that window, bids / policy history / swaps come back empty or 502. Use a provider with full log history (Alchemy, Infura, QuickNode, …) for anything hosted |
| `CHAIN_ID` | first file's `chainId` | `/health` returns 503 when the RPC disagrees |
| `PORT`, `HOST` | `8788`, `127.0.0.1` | The Docker image sets `HOST=0.0.0.0`; hosts that inject `PORT` are honored |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated exact origins, `*`, or one-label wildcards such as `https://*.vercel.app` (matches `https://pr-21.vercel.app`, not `https://a.b.vercel.app`) |
| `EXPLORER_URL` | Etherscan for Sepolia | Served in `/v1/config` for tx / address links |
| `*_ADDRESS` | deployments file, then Sepolia constants | `USDC_ADDRESS`, `PERMIT2_ADDRESS`, `POOL_MANAGER_ADDRESS`, `UNIVERSAL_ROUTER_ADDRESS`, `QUOTER_ADDRESS`, `STATE_VIEW_ADDRESS`, ... |

## Conventions

- **Prices** are USDC per 1,000-share lot (`1.1`) and **points** (`110`; 100 points = 1.00 USDC / lot = the issue price), rounded to 0.01 point. This matches the mock's units.
- **Amounts** are human USDC (6 dec) and shares (18 dec) as JSON numbers. Exact values (Q96 prices, raw token units, sqrtPriceX96) are decimal strings under `raw`.
- **Times** are ISO strings (`since`, `listedAt`, `staleAt`). Chart points (`time` in clearing, trades) are unix seconds.
- **Errors** are `{"error": {"code", "message", "details?"}}`:

  | Status | Codes | When |
  | --- | --- | --- |
  | 400 | `BAD_REQUEST` | Bad query or body (address checksum, decimals, off-tick price) |
  | 404 | `UNKNOWN_TICKER`, `UNKNOWN_BID`, `NOT_FOUND` | Unknown ticker, bid or route |
  | 409 | `NOT_LAUNCHED` | No auction yet |
  | 502 | `RPC_ERROR` | The node failed |
  | 500 | `INTERNAL` | Anything else |

- **A contract revert is not an HTTP error.** Prepare endpoints return 200 with `simulate.ok = false` and the decoded error.
- **Headers.** Every response has `Cache-Control: no-store`.
- **Types.** All response and body types are in [`src/types.ts`](src/types.ts), which has no imports (no viem needed in the app): `import type { MarketView } from "../../services/api/src/types"`, or the package export `@listing-day/api/types`.

### Nullable fields

Every `T | null` field is null for one documented reason; show "—" or a gap, never 0. The rest are always set.

| Type | Field | Null when |
| --- | --- | --- |
| `Listing` | `sector`, `city` | Always: nothing onchain carries them. Keep them in the app's copy |
| `Listing` | `description`, `url` | The ENS text record is empty |
| `Listing` / `Auction` | `clearingPrice`, `raised`, `graduated`, `startBlock`, `endBlock`, `claimBlock` | No auction yet (`phase: "draft"`) |
| `Listing` / `MarketView` | `listedAt`, `listingPrice`, `listingDayEndsAt` | The pool is not listed yet |
| `ClearingPoint` | `raised` | The RPC no longer serves state at that checkpoint's block (non-archive nodes) |
| `Bid` | `filledShares`, `refund` | The bid has not exited (only `BidExited` carries them) |
| `Bid` | `claimableShares` | Not exited yet (fill unknown). 0 once claimed or refunded |
| `Bid` | `refundableUsdc` | Not exited and the refund depends on the final fill (e.g. a bid at the clearing price). Known before exit when the auction failed (whole budget) or the bid stayed above the clearing price (0) |
| `PolicyView` / `MarketView` | `referencePrice`, `band` | The pool is not listed yet (after listing a 0 report reference means the listing price, which is filled in) |
| `PolicyView` | `asOf`, `creTx` | No CRE report has landed yet. `since` then falls back to `listedAt` (null only before both) |
| `PolicyView` / `MarketView` | `haltCause` | Trading is open |
| `MarketView` | `price` | The pool is not initialized |
| `SwapQuote` | `amountOut`, `avgPrice` | The quote reverted (`error` says why) |
| `SwapQuote` | `priceBefore`, `priceAfter`, `priceImpactBps` | The pool is not initialized, or the quote reverted with a non-band error (Halted, CoolingOff, …) |

## Endpoints

| Endpoint | Returns (`src/types.ts`) | RPC |
| --- | --- | --- |
| `GET /health` | `Health` | yes |
| `GET /v1/config` | `ConfigResponse`: addresses per listing | no |
| `GET /v1/errors` | `ErrorCatalog` | no |
| `GET /v1/listings`, `/v1/listings/:ticker` | `ListingsResponse`, `ListingDetail` | yes |
| `GET /v1/ens/:ticker` | `EnsView` | yes |
| `GET /v1/auction/:ticker`, `/clearing` | `Auction`, `ClearingResponse` | yes |
| `GET /v1/bids?ticker=&owner=` | `BidsResponse` | yes |
| `GET /v1/eligibility?ticker=&address=` | `Eligibility` | yes |
| `GET /v1/policy/:ticker` | `PolicyView` | yes |
| `GET /v1/policy/:ticker/history` | `PolicyHistory` | yes |
| `GET /v1/market/:ticker?limit=` | `MarketView` (combined) | yes |
| `GET /v1/market/:ticker/swaps?limit=&fromBlock=` | `SwapsResponse` | yes |
| `GET /v1/issuer/:ticker?address=` | `IssuerView` | yes |
| `GET /v1/portfolio/:address?ticker=` | `Portfolio` | yes |
| `POST /v1/prepare/{bid,swap,exit,claim}` | `Prepared<BidDetails \| SwapDetails \| ExitDetails \| ClaimDetails>` | yes |

Examples marked "live Sepolia" are real responses for the ACME listing (trimmed); the others come from the anvil rehearsal (`acme`: settled, listed, traded, halted, resumed; `kesar`: a second listing with a live auction). Long values are elided with `…`.

### `GET /health`

```json
{ "ok": true, "rpcChainId": 31337, "block": 12077334, "chainId": 31337, "rpc": "http://127.0.0.1:8546",
  "deployments": [{ "file": "anvil.json", "ticker": "acme", "ok": true }] }
```

The response is 503 with `ok: false` and an `error` field when the RPC is down, the chain id is wrong, or no deployments file is readable. The RPC URL is reduced to scheme and host, so API keys in the path are not leaked.

### `GET /v1/listings` and `GET /v1/listings/:ticker`

```json
{ "parent": "listingday.eth", "chainId": 31337, "currentBlock": 12077335, "now": "2026-11-06T13:58:11.000Z",
  "listings": [{
    "ticker": "acme", "symbol": "ACME", "name": "Acme SME", "ensName": "acme.listingday.eth",
    "sector": null, "city": null, "description": "Acme SME (ACME): Listing Day IPO. …", "url": "https://github.com/…",
    "avatar": { "initials": "AC", "bg": "#db2777", "fg": "#ffffff", "uri": "data:image/svg+xml;base64,…" },
    "status": "listed", "statusSource": "ens", "phase": "listed", "eligibility": "open",
    "clearingPrice": 1.1, "clearingPoints": 110, "graduated": true, "listedAt": "2026-11-06T13:47:51.000Z",
    "raised": 99, "bidCount": 5, "applicants": 5, "startBlock": 12076978, "endBlock": 12077028, "claimBlock": 12077028,
    "records": { "addr": "0x326E…185a", "token": "0x326E…185a", "auction": "0x3975…9d9d", "hook": "0x3508…f0c0",
                 "policy": "0xa3D0…d41f", "pool": "0x6f73…9885" },
    "raw": { "clearingPriceQ96": "87150978765691", "currencyRaised": "99000000" } },
   { "ticker": "kesar", "status": "auction", "phase": "live", "clearingPrice": 0.8, "bidCount": 0, "…": "…" }] }
```

- **`status`** comes first from ENS `listingday.status`, then from `ListingPolicyReceiver.status()`, then is derived from chain state. `statusSource` says which one was used.
- **`phase`** is one of `draft | live | cleared | refunding | listed`, like the mock.
- **`sector` / `city`** are null: nothing onchain carries them yet. Keep them in the app's own copy.
- **`/v1/listings/:ticker`** adds `offer` (supply, issue / floor / cap price, per-applicant cap, target and required raise, LP %), `chainId`, `deployBlock`, `contracts` and `external` addresses.

### `GET /v1/ens/:ticker`

```json
{ "ticker": "acme", "name": "acme.listingday.eth", "universalResolver": "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  "records": { "addr": "0x326E…185a", "listingday.auction": "0x3975…9d9d", "listingday.pool": "0x6f73…9885",
               "listingday.hook": "0x3508…f0c0", "listingday.policy": "eip155:31337:0xa3D0…d41f",
               "listingday.status": "listed", "listingday.eligibility": "open",
               "description": "…", "url": "…", "avatar": "data:image/svg+xml;base64,…" },
  "matchesDeployment": { "addr": true, "auction": true, "pool": true, "hook": true, "policy": true },
  "resolved": true, "error": null }
```

### `GET /v1/auction/:ticker` and `GET /v1/auction/:ticker/clearing`

```json
{ "ticker": "acme", "address": "0x3975…9d9d", "phase": "claimable", "currentBlock": 12077337,
  "startBlock": 12076978, "endBlock": 12077028, "claimBlock": 12077028, "migrationBlock": 12077029, "blocksRemaining": null,
  "clearingPrice": 1.1, "clearingPoints": 110, "floorPrice": 0.8, "capPrice": 1.9, "issuePrice": 1, "tickSpacingPoints": 1,
  "raised": 99, "requiredRaise": 45, "targetRaise": 90, "graduated": true, "totalSupply": 90000, "totalCleared": 89999.99999999977,
  "committed": 99, "bidCount": 5, "applicants": 5, "perApplicantCap": 20,
  "validationHook": "0x299D…B44f", "eligibilityModule": "0x7d10…ABE1", "tokensRecipient": "0x651F…5e48", "fundsRecipient": "0x9543…2000",
  "offer": { "…": "…" }, "raw": { "clearingPriceQ96": "87150978765691", "floorPriceQ96": "63382530011360", "…": "…" } }
```

- **`phase`** is one of `notLaunched | upcoming | live | ended | claimable`.
- **`blocksRemaining`** counts down to the next phase boundary.
- **`/clearing`** returns one point per `CheckpointUpdated`, oldest first:

```json
{ "ticker": "acme", "auction": "0x3975…9d9d", "series": [
  { "block": 12076983, "time": 1793972797, "price": 0.8, "points": 80, "raised": 0, "committed": 20, "raw": { "…": "…" } },
  { "block": 12077028, "time": 1793972859, "price": 1.1, "points": 110, "raised": 99, "committed": 99, "raw": { "…": "…" } } ] }
```

`raised` is null when the RPC no longer serves state at that block (non-archive public nodes).

### `GET /v1/bids?ticker=&owner=`

Both parameters are optional: no ticker means every listing, and no owner means every bidder. Bids are newest first.

Live Sepolia:

```json
{ "ticker": "acme", "owner": null, "committed": { "acme": 60 },
  "bids": [{ "key": "0xf36d09f6c780bde8f09000d87e47b9d3e2ee5ae3:2", "id": 2, "ticker": "acme",
             "auction": "0xF36d09f6C780bde8f09000d87e47B9D3E2EE5aE3", "owner": "0x657f…Fad16",
             "budget": 20, "maxPrice": 1.9, "maxPricePoints": 190, "submittedBlock": 12077392, "submittedAt": "2026-11-06T15:17:36.000Z",
             "state": "claimed", "status": "claimed", "filledShares": 25000.0000000203, "refund": 0,
             "claimableShares": 0, "refundableUsdc": 0, "exitedBlock": 12077421, "claimed": true, "tx": "0x0ae7…4d5c",
             "actions": { "exit": null, "claim": false },
             "raw": { "amount": "20000000", "maxPriceQ96": "150533508776980", "tokensFilled": "25000000000020301364913",
                      "currencyRefunded": "0", "claimable": "0", "refundable": "0" } },
           "…"] }
```

- **`key`** is `<auction, lowercase>:<id>`, the same string as the app's `bidKey()`. Bid ids restart at 0 in every auction, so use `key` for React keys and busy / override maps.
- **`status`** is where the money is, the field to drive Orders from:

  | `status` | Meaning | Next action |
  | --- | --- | --- |
  | `open` | Auction running | Wait (or exit if outbid: `actions.exit`) |
  | `awaitingExit` | Auction over, not exited | Exit (`actions.exit`) |
  | `exited` | Exited, filled shares still in the auction | Claim (`actions.claim` once the claim block passes) |
  | `claimed` | Shares claimed | None |
  | `refunded` | Exited with a 0 fill: fully refunded | None |

- **`state`** (unchanged) is the price-position view: `active | outbid | partial | filled | refundable | exited | claimed`.
- **`actions.exit`** names the exit function that works right now (`exitBid` / `exitPartiallyFilledBid`), or null. **`actions.claim`** is true once the claim is open.
- **`filledShares` / `refund`** come from `BidExited`; **`claimableShares` / `refundableUsdc`** are what is still to come (see "Nullable fields").

### `GET /v1/eligibility?ticker=&address=`

```json
{ "ticker": "kesar", "address": "0x0000…b1d01", "eligible": true, "mode": "open", "reason": null,
  "module": "0x…", "cap": 20, "committed": 10, "remaining": 10,
  "raw": { "cap": "20000000", "committed": "10000000", "remaining": "10000000" } }
```

Listings are open (World ID is dropped), so `eligible` is always true. The per-wallet budget cap still applies: `reason` is set when `remaining` is 0.

### `GET /v1/policy/:ticker`

```json
{ "ticker": "acme", "version": 2, "mode": "listing", "referencePrice": 1.1, "referencePoints": 110, "bandBps": 500,
  "halted": false, "since": "2026-11-06T13:48:03.000Z", "asOf": "2026-11-06T13:48:02.000Z", "coolOffMin": 0, "coolOffUntil": null,
  "creTx": "0xd843…b75b", "hookPhase": "ListingDay", "band": { "low": 1.045, "high": 1.155, "lowPoints": 104.5, "highPoints": 115.5 },
  "listingDayEndsAt": "2026-11-06T14:47:51.000Z", "stale": false, "staleAt": "2026-11-07T13:48:03.000Z", "maxAge": 86400,
  "policyMode": 0, "normalBandBps": 2000, "survBandBps": 500, "receiver": "0xa3D0…d41f", "receiverStatus": "listed",
  "raw": { "refSqrtPriceX96": "…", "sqrtPriceMinX96": "…", "sqrtPriceMaxX96": "…", "asOf": "1793972882", "coolOffUntil": "0", "staleAt": "1794059283", "latestHalted": false } }
```

This is the **effective** policy the hook enforces right now, not just the last CRE report:

- **`mode`** is one of `listing | normal | surveillance | directional | halted`. During the listing day (`hookPhase: "ListingDay"`), the listing band applies whatever the CRE policy says.
- **`halted`** is true when CRE halted trading or the receiver's policy is stale (`stale`; `staleAt` is when that happens).
- **`haltCause`** says why trading is closed: `report` (CRE halted it), `stale` (no fresh report within `maxAge`: not an exchange decision, word the banner accordingly) or `coolingOff` (until `coolOffUntil`; `halted` stays false). Null when open.
- **`tradingOpen`** is `haltCause === null`: a swap can go through right now (band permitting). Halts and cool-off apply during the listing hour too.
- **`band`** is the current band. It is null before listing.
- **`since` / `creTx`** come from the receiver's `PolicyApplied` event, not from a tx status.

### `GET /v1/policy/:ticker/history`

The effective rules over time, rebuilt from `Listed`, `PolicyApplied` and `MaxAgeSet` logs with the hook's own rules (listing-hour band override, 0-band defaults, staleness, cool-off). Live Sepolia ACME, trimmed:

```json
{ "ticker": "acme", "hook": "0xf8bb…f0c0", "receiver": "0xE577…EeA0", "now": "2026-11-06T18:35:00.000Z", "currentBlock": 12078368, "maxAge": 86400,
  "listing": { "listedAt": "2026-11-06T15:24:00.000Z", "block": 12077424, "tx": "0x211c…b535", "listingPrice": 0.8, "listingPoints": 80,
               "listingDayEndsAt": "2026-11-06T16:24:00.000Z", "bandBps": 500, "band": { "low": 0.76, "high": 0.84, "lowPoints": 76, "highPoints": 84 } },
  "entries": [
    { "version": 1, "block": 12077463, "time": "2026-11-06T15:31:48.000Z", "timestamp": 1793979108, "tx": "0xac5e…92fd", "status": "halted",
      "asOf": "2026-11-06T15:31:24.000Z", "mode": "normal", "policyMode": 0, "halted": true, "coolOffUntil": null,
      "referencePrice": null, "referencePoints": null, "normalBandBps": 0, "survBandBps": 0,
      "staleAt": "2026-11-07T15:31:25.000Z", "supersededAt": "2026-11-06T15:42:36.000Z",
      "effective": { "mode": "halted", "tradingMode": "listing", "referencePrice": 0.8, "bandBps": 500, "band": { "…": "…" },
                     "directionalBandBps": null, "listingDayOverride": true },
      "raw": { "refSqrtPriceX96": "0", "asOf": "1793979084", "coolOffUntil": "0" } },
    "… v2 to v5" ],
  "spans": [
    { "from": "2026-11-06T16:29:12.000Z", "to": "2026-11-06T16:31:12.000Z", "fromTime": 1793982552, "toTime": 1793982672,
      "trigger": "policyApplied", "tx": "0x7ee6…147d", "block": 12077744, "version": 3, "mode": "directional", "tradingMode": "directional",
      "halted": false, "coolingOff": false, "tradingOpen": true, "haltCause": null, "referencePrice": 0.7, "referencePoints": 70,
      "bandBps": 2000, "band": { "low": 0.56, "high": 0.84, "lowPoints": 56, "highPoints": 84 }, "directionalBandBps": 500, "raw": { "…": "…" } },
    "…" ],
  "haltSpans": [
    { "from": "2026-11-06T15:31:48.000Z", "to": "2026-11-06T15:42:36.000Z", "fromTime": 1793979108, "toTime": 1793979756, "cause": "report", "version": 1, "tx": "0xac5e…92fd" },
    { "from": "2026-11-06T16:31:12.000Z", "to": "2026-11-06T16:32:00.000Z", "fromTime": 1793982672, "toTime": 1793982720, "cause": "report", "version": 4, "tx": "0xc62c…54b6" } ],
  "reference": [
    { "time": 1793978640, "value": 0.8, "mode": "listing", "bandBps": 500, "low": 0.76, "high": 0.84, "version": 0, "carryForward": false },
    "…",
    { "time": 1793990100, "value": 0.8, "mode": "normal", "bandBps": 2000, "low": 0.64, "high": 0.96, "version": 5, "carryForward": true } ],
  "notes": ["…"] }
```

- **`entries`**: one per `PolicyApplied` (what CRE reported, as reported) with `staleAt`, `supersededAt` and the `effective` rules the hook enforced right after it landed (null for a report before listing).
- **`spans`**: contiguous intervals of constant effective rules from the listing to now (`to: null` = current). `trigger` is what started the span: `listed | policyApplied | listingDayEnded | maxAgeSet | coolOffEnded | stale`. `mode` is the banner mode (`halted` wins); `tradingMode` is the rule set underneath.
- **`haltSpans`**: the closed-trading intervals only, for chart columns (adjacent spans with the same cause merged).
- **`reference`**: the chart's reference / band line, one point per span plus a final `carryForward: true` point at `now`. Carry-forward points are display-only, not observations.

The same `reference` and `haltSpans` are in `/v1/market/:ticker`.

### `GET /v1/market/:ticker?limit=` (combined market view)

Everything the company page needs in one call, at one block: pool price, effective reference and band, halt state, liquidity, recent trades and the chart series. `limit` (1 to 1000, default 100) caps `trades` / `prices`. Live Sepolia ACME, `limit=5`:

```json
{ "ticker": "acme", "listed": true, "hookPhase": "Normal", "mode": "normal", "usdcIsCurrency0": true,
  "price": 0.79, "points": 79, "referencePrice": 0.8, "referencePoints": 80,
  "band": { "low": 0.64, "high": 0.96, "lowPoints": 64, "highPoints": 96 },
  "halted": false, "haltCause": null, "tradingOpen": true,
  "listingPrice": 0.8, "listedAt": "2026-11-06T15:24:00.000Z", "listingDayEndsAt": "2026-11-06T16:24:00.000Z",
  "policy": { "…": "same as /v1/policy" }, "liquidity": { "usdc": 10.732287, "shares": 13585.174346556103 }, "rejected": [],
  "trades": [{ "time": 1793982780, "side": "buy", "usdc": 0.068349, "shares": 86.80710911079133, "price": 0.79, "avgPrice": 0.7874,
               "tx": "0xeec2…567f", "block": 12077763, "sender": "0x62F4…32bE", "raw": { "…": "…" } }, "…"],
  "prices": [{ "time": 1793978880, "value": 0.82, "block": 12077444 }, "…"], "tradesLimit": 5,
  "reference": [{ "time": 1793978640, "value": 0.8, "mode": "listing", "bandBps": 500, "low": 0.76, "high": 0.84, "version": 0, "carryForward": false }, "…"],
  "haltSpans": [{ "fromTime": 1793979108, "toTime": 1793979756, "cause": "report", "version": 1, "…": "…" }, "…"],
  "events": [
    { "time": "2026-11-06T15:24:00.000Z", "kind": "listing", "label": "Listed at 0.80 · ±5% band", "tx": "0x211c…b535", "block": 12077424 },
    { "time": "2026-11-06T16:29:12.000Z", "kind": "directional", "label": "v3 Directional · only trades toward ref 0.70", "tx": "0x7ee6…147d", "block": 12077744 },
    "…" ],
  "poolId": "0x6165…50a4", "poolKey": { "currency0": "0x1c7D…7238", "currency1": "0x8F90…8152", "fee": 3000, "tickSpacing": 60, "hooks": "0xf8bb…f0c0" },
  "raw": { "sqrtPriceX96": "2818811522473629111479198094196215754", "tick": 347762, "liquidity": "381837661841625", "pointsE2": "7899", "bandPointsE2": ["6399", "9599"] } }
```

- **`price` / `referencePrice` / `band` / `halted` / `haltCause` / `tradingOpen`** are the same values as `policy`, lifted to the top level.
- **`liquidity`** is the full-range pool position at the current price (pool amounts, not anyone's LP position).
- **`trades`** are newest first. `price` is the pool price **after** the swap; `avgPrice` is the execution average (`usdc / shares × 1000`, fee included): show `avgPrice` as "bought at".
- **`prices`** are oldest first, one per trade, for the chart. History is sparse (one point per real swap): handle 0 and 1 points and same-block duplicates; don't interpolate.
- **`reference` / `haltSpans`** are the structured policy timeline (see `/v1/policy/:ticker/history`): draw the reference line and band from `reference`, halt columns from `haltSpans`. Swaps never carry a halted flag (nothing trades while halted).
- **`rejected`** is always `[]`. Reverted swaps emit no logs, so the app keeps its own receipts (and the demo's published hashes) for chart markers, as in plan.md §9.

### `GET /v1/market/:ticker/swaps?limit=&fromBlock=`

Only `trades` and `prices` (same shapes), for paging older history with `fromBlock`:

```json
{ "ticker": "acme", "poolId": "0x6165…50a4", "trades": ["…"], "prices": [{ "time": 1793978880, "value": 0.82, "block": 12077444 }] }
```

### `GET /v1/issuer/:ticker?address=`

The token contract vs the issuer wallet, and who holds every role, read live. **The ENS `addr` record of a ticker (`records.addr`) is its share TOKEN contract, not a wallet.** The issuer is the ENSv2 owner of the ticker name. Live Sepolia, with `?address=` set to the issuer:

```json
{ "ticker": "acme", "ensName": "acme.listingday.eth", "chainId": 11155111, "block": 12078368,
  "token": { "address": "0x8F902CABeD3D72bd21EFaaC878a490E81aF78152", "name": "Acme SME", "symbol": "ACME" },
  "ensAddr": "0x8F902CABeD3D72bd21EFaaC878a490E81aF78152", "ensAddrIsToken": true,
  "issuer": { "address": "0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9", "source": "ens" },
  "treasury": "0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9",
  "roles": [
    { "role": "ens.nameOwner", "contract": "0x6e79…deE8", "contractName": "ENSv2 UserRegistry", "holder": "0xAfD0…0Dd9",
      "description": "Owns acme.listingday.eth: sets its resolver and records (the issuer wallet)", "source": "onchain" },
    { "role": "receiver.broadcaster", "contract": "0xE577…EeA0", "contractName": "ListingPolicyReceiver", "holder": "0x6F52…70dA",
      "description": "Required tx.origin of CRE reports (the exchange's CRE operator); zero = any", "source": "onchain" },
    "… ens.parentOwner, ens.statusMirror, hook.owner, hook.policySource, receiver.owner, receiver.forwarder,
       auction.tokensRecipient, auction.fundsRecipient, validationHook.deployer, lp.owner, deployment.treasury, deployment.deployer" ],
  "check": { "address": "0xAfD0…0Dd9", "isIssuer": true,
             "roles": ["ens.nameOwner", "ens.parentOwner", "hook.owner", "receiver.owner", "auction.tokensRecipient", "validationHook.deployer", "lp.owner", "deployment.treasury", "deployment.deployer"] },
  "notes": ["records.addr / ENS addr of acme.listingday.eth is the ERC20 share token …, not a wallet: never ask a user to connect it.", "…"] }
```

- **`issuer.source`** is `ens` (read from the UserRegistry) or `deployment` (fallback to the deployments file, unverified).
- **`check`** (with `?address=`) is how the console gates itself: `isIssuer` and the roles that wallet holds. It is a read, not authentication; the contracts enforce the roles.
- Exchange-operator roles (`receiver.broadcaster`, `receiver.forwarder`) are separate from the issuer: the issuer cannot publish trading policy.

### `GET /v1/portfolio/:address?ticker=`

Balances, holdings marked at the pool (or clearing) price, and every bid of one wallet across all listings. Live Sepolia, an auction winner:

```json
{ "address": "0xa13b57405cF7DA5e8F4dbF8D5E33626B87ABbf6B", "chainId": 11155111, "block": 12078368, "asOf": "2026-11-06T18:35:00.000Z",
  "balances": { "eth": 0.01804224453559648, "usdc": 0, "raw": { "eth": "18042244535596482", "usdc": "0" } },
  "holdings": [{ "ticker": "acme", "symbol": "ACME", "token": "0x8F90…8152", "shares": 25000.0000000203, "unclaimedShares": 0, "pendingBids": 0,
                 "price": 0.79, "priceSource": "pool", "value": 19.75, "avgCost": null,
                 "raw": { "balance": "25000000000020301364913", "unclaimed": "0" } }],
  "bids": [{ "…": "same shape as /v1/bids" }],
  "totals": { "holdingsValueUsdc": 19.75, "unclaimedShares": { "acme": 0 }, "refundableUsdc": 0, "inAuctionUsdc": 0 },
  "unsupported": {
    "costBasis": "Not computed: acquisitions (auction fills, swaps, transfers) need an accounting policy and full history. avgCost is always null.",
    "pnl": "Not computed (needs cost basis).", "lpPositions": "Not listed per wallet: use GET /v1/issuer/:ticker (role lp.owner) for the demo LP NFT.",
    "lpFees": "Not computed.", "tradeHistory": "Not attributable: pool Swap logs name the router, not the wallet. Keep the app's own receipts." } }
```

- **`shares`** is the wallet's ERC20 balance; **`unclaimedShares`** are exited-but-unclaimed fills (claimable from the auction). They never double count: claiming moves shares from one to the other.
- **`pendingBids`** have not exited: their fill is unknown and is not counted anywhere (`totals.inAuctionUsdc` is their budget).
- **`unsupported`** lists what this API does not compute. Hide those UI elements or label them.

### `GET /v1/config`

The deployments files as the app needs them, with **no RPC** (works when the node is down): replace the app's address fixtures with this.

```json
{ "apiVersion": "v1", "chainId": 11155111, "chainName": "Sepolia", "parent": "listingday.eth", "explorerUrl": "https://sepolia.etherscan.io",
  "frontendEnv": { "apiUrl": "NEXT_PUBLIC_API_URL" },
  "listings": [{
    "ticker": "acme", "ensName": "acme.listingday.eth", "label": "acme-v1", "chainId": 11155111, "deployBlock": 12077327,
    "contracts": { "token": "0x8F902CABeD3D72bd21EFaaC878a490E81aF78152", "auction": "0xF36d09f6C780bde8f09000d87e47B9D3E2EE5aE3",
                   "listingHook": "0xf8bbC5E4F9257b1e9EFCb6e7761eA8A05dd0f0c0", "listingPolicyReceiver": "0xE57781EaC05C0e3A9aE7ed9D115e59d50DB7EeA0",
                   "allowAllModule": "0x35Fa94d5Be2700D42Bbbc82665eE7B79699Ea453", "auctionValidationHook": "0xB1FCD717C120A7BB8e0732d5C703DEa1682Be002" },
    "wallets": { "issuer": "0xAfD0AeDb40DcDd5E725b487DaB40a8A5dBB60Dd9", "treasury": "0xAfD0…0Dd9", "deployer": "0xAfD0…0Dd9",
                 "creBroadcaster": "0x6F520A9e473f3f3DAa0EFFf5eF5e1690C86970dA" },
    "pool": { "poolId": "0x61653a49f83d9702ec18151366558a4d08f35daea687bc2af3b5d5a156e450a4",
              "poolKey": { "currency0": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "currency1": "0x8F90…8152", "fee": 3000, "tickSpacing": 60, "hooks": "0xf8bb…f0c0" },
              "usdcIsCurrency0": true, "listingDayBandBps": 500 },
    "auction": { "startBlock": 12077363, "endBlock": 12077413, "claimBlock": 12077413 },
    "ens": { "registry": "0x6e79404aA7cAB39d8ACd921eD5277Ab5A101deE8", "resolver": "0x07de0A7f6206Ee4b49295EDbd316f24B7912C844",
             "universalResolver": "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" },
    "lpTokenId": 41464,
    "external": { "usdc": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
                  "poolManager": "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543", "positionManager": "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
                  "universalRouter": "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b", "stateView": "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C",
                  "quoter": "0x68aFa8b853cAa7a2D40B0F6AEE5C4DbC147C8244", "lbpStrategy": "0x95434E898Af471945Cab33D5064d2aC1A6Ba2000",
                  "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11" },
    "offer": { "…": "as /v1/listings/:ticker" } }],
  "errors": [] }
```

`wallets` are as recorded by the deploy scripts; `/v1/issuer` reads the roles onchain. `errors` lists unreadable deployments files by basename. The swap spender is `external.universalRouter`, never the demo's PoolSwapTest router.

### `GET /v1/errors`

Every custom error the decoder knows, sorted by name: `simulate.error.name` / `quote.error.name` is one of these (or `Error`, `Panic`, `Unknown`, `EmptyRevert`). Includes every error in [`contracts/errors.md`](../../contracts/errors.md) (a unit test checks each selector decodes to its documented name).

```json
{ "errors": [
  { "name": "CoolingOff", "selector": "0xfbf97c58", "signature": "CoolingOff(uint64)" },
  { "name": "DirectionalWidening", "selector": "0xe3e23539", "signature": "DirectionalWidening(uint160,uint160,uint160)" },
  { "name": "Halted", "selector": "0x1ee9080f", "signature": "Halted()" },
  { "name": "OutOfBand", "selector": "0xbfdfc64e", "signature": "OutOfBand(uint160,uint160,uint160)" },
  "…" ] }
```

## Prepare endpoints (`POST`, JSON body)

The response has the same shape for all four:

```json
{ "ticker": "kesar", "action": "bid", "from": "0x0000…b1d01", "chainId": 31337,
  "to": "0xf8F7…c22A", "data": "0x…", "value": "0",
  "steps": [
    { "kind": "approveUsdcToPermit2", "to": "0x1c7D…7238", "data": "0x095e…", "value": "0", "needed": true,  "description": "Approve Permit2 to move your USDC (once per token)" },
    { "kind": "permit2Approve",       "to": "0x0000…8BA3", "data": "0x87517c45…", "value": "0", "needed": true,  "description": "Permit2: allow 0xf8F7… to pull USDC (expires in 24 h)" },
    { "kind": "submitBid",            "to": "0xf8F7…c22A", "data": "0x…", "value": "0", "needed": true,  "description": "Bid 10 USDC up to 1.3 USDC / lot" } ],
  "permit2": { "token": "0x1c7D…7238", "spender": "0xf8F7…c22A", "amount": "10000000", "expiration": 1794060071,
               "current": { "erc20AllowanceToPermit2": "0", "permit2Amount": "0", "permit2Expiration": 0 } },
  "simulate": { "ok": true, "method": "eth_simulateV1", "block": 12077430, "error": null, "gasUsed": "1804510", "note": "3 calls simulated in order" },
  "details": { "auction": "0xf8F7…c22A", "owner": "0x0000…b1d01", "budget": 10, "maxPrice": 1.3, "maxPricePoints": 130, "usdcBalance": 50, "warnings": [], "raw": { "…": "…" } } }
```

- **The top-level `{to, data, value}`** is the final call, the same as the last step.
- **Send every step with `needed: true`** in order, one wallet transaction each (`value` is a decimal wei string). Skip the steps marked `needed: false`: the allowance is already in place.
- **Simulation method.** `simulate.method` is `eth_call` when only the final call is needed, and `eth_simulateV1` when approvals must land first: they are simulated in order in one block. If the RPC lacks `eth_simulateV1`, you get `ok: null` and a `note`: send the approvals, then prepare again.
- **On a revert**, `simulate.ok` is false and `simulate.error` holds the innermost decoded error:

```json
{ "ok": false, "method": "eth_simulateV1", "block": 12077365, "gasUsed": null, "note": "the final call reverts after 1 approval step(s)",
  "error": { "name": "OutOfBand", "selector": "0xbfdfc64e",
             "args": { "sqrtPriceX96": "1840722885164987285154412915757571830", "sqrtPriceMinX96": "…", "sqrtPriceMaxX96": "…" },
             "message": "Outside today's price band (1.045 to 1.155 USDC / lot): the price after this trade would be 1.853",
             "wrappers": ["WrappedError"], "data": "0xbfdfc64e…" } }
```

`wrappers` lists the envelopes that were peeled: CCA `ValidationHookCallFailed`, v4 `WrappedError`, V4Quoter `UnexpectedRevertBytes` and Universal Router `ExecutionFailed`. `message` is the UI copy from [`contracts/errors.md`](../../contracts/errors.md). These errors were seen on the fork:

- `OutOfBand`
- `CapExceeded` ("Over the 20 USDC per-applicant limit (this bid would bring you to 25 USDC)")
- `BidAboveCap`
- `BidMustBeAboveClearingPrice`
- `AuctionIsOver`
- `TransferFromFailed` (no USDC or allowance)
- `BidAlreadyExited`

`Halted`, `CoolingOff` and `DirectionalWidening` decode the same way (covered by the unit tests).

| Endpoint | Body | Steps |
| --- | --- | --- |
| `/v1/prepare/bid` | `ticker`, `owner`, `budget` (USDC, e.g. `10` or `"19.5"`) or `budgetRaw`, `maxPrice` (USDC / lot, a multiple of 0.01) or `maxPricePoints` (integer), optional `permit2ExpiresIn` (s, default 86400) | `USDC.approve(Permit2, max)`, `Permit2.approve(USDC, auction, budget, expiry)`, `submitBid(maxPriceQ96, amount, owner, floorPriceQ96, 0x)` |
| `/v1/prepare/swap` | `ticker`, `from`, `side` (`buy` = USDC → shares, `sell`), `amount` (USDC for buy, shares for sell) or `amountRaw`, optional `slippageBps` (default 100), `minOutRaw`, `deadlineSeconds` (600), `permit2ExpiresIn` | `token.approve(Permit2, max)`, `Permit2.approve(token, UniversalRouter, amount, expiry)`, `UniversalRouter.execute(V4_SWAP, …, deadline)` |
| `/v1/prepare/exit` | `ticker`, `bidId`, optional `from` (default: the bid owner) | `exitBid(id)`, or `exitPartiallyFilledBid(id, lastFullyFilledCheckpointBlock, outbidBlock)` with the hints computed from the checkpoints |
| `/v1/prepare/claim` | `ticker`, `bidId` or `bidIds` (one owner), optional `from` | `claimTokens(id)` or `claimTokensBatch(owner, ids)` |

Exit `details.reason` explains why no exit works yet (for example "bid is still active: exit after the auction ends"). Exit and claim `details` carry `key` / `keys` (`Bid.key`). Bid, swap and claim `details.warnings` flag a low balance or an empty claim.

**Swap `details.quote`** is the V4Quoter result plus the pool move it implies. Live Sepolia, a 1 USDC buy and a 5 USDC buy (thin demo pool):

```json
{ "side": "buy", "amountIn": 1, "minOut": 1143.2045099102277, "slippageBps": 100, "quote": {
    "ok": true, "amountOut": 1154.7520302123512, "avgPrice": 0.866,
    "priceBefore": 0.79, "priceAfter": 0.9436, "priceImpactBps": 1944.24, "avgPriceVsSpotBps": 962.03, "priceAfterSource": "simulation",
    "error": null, "raw": { "sqrtPriceBeforeX96": "2818811522473629111479198094196215754", "sqrtPriceAfterX96": "2579210009432498747300358028863549534" } } }
```

```json
{ "side": "buy", "amountIn": 5, "minOut": 0, "quote": {
    "ok": false, "amountOut": null, "avgPrice": null, "priceBefore": 0.79, "priceAfter": 1.6943, "priceImpactBps": 11447.19, "avgPriceVsSpotBps": null,
    "priceAfterSource": "revert",
    "error": { "name": "OutOfBand", "selector": "0xbfdfc64e", "wrappers": ["UnexpectedRevertBytes", "WrappedError"],
               "message": "Outside today's price band (0.64 to 0.96 USDC / lot): the price after this trade would be 1.694", "…": "…" } } }
```

- **`priceBefore` / `priceAfter`** are pool spot prices (USDC / lot) before and after the swap; **`priceImpactBps`** is the signed move between them (+ for buys). **`avgPriceVsSpotBps`** is the execution average vs `priceBefore` (size + 0.3% LP fee).
- **`priceAfterSource`**: `simulation` (`StateView.getSlot0` read right after the simulated swap, exact), `revert` (the hook's `OutOfBand` / `DirectionalWidening` args: the price the hook refused), or `estimate` (single-range v4 math when the swap can't be simulated from this wallet yet, e.g. no balance; exact for the demo's one full-range position).
- `minOut` is `amountOut × (1 − slippageBps / 10 000)`: a 0.5% UI slippage is `slippageBps: 50`.

**Error names are exact.** `simulate.error.name` and `quote.error.name` are the contract's custom error names, unwrapped: `OutOfBand`, `DirectionalWidening`, `Halted`, `CoolingOff` (pool); `CapExceeded`, `BidAboveCap`, `SenderMustBeOwner` (bid hook); `BidMustBeAboveClearingPrice`, `AuctionIsOver`, `BidAlreadyExited`, … (CCA); `V4TooLittleReceived`, `TransactionDeadlinePassed` (router). There is no `WrongDirection`. `GET /v1/errors` lists them all.

## Hosting (HTTPS)

An HTTPS app can't call an `http://` API (mixed content), and remote browsers can't reach `127.0.0.1`, so a shared demo needs the API behind TLS. [`Dockerfile`](Dockerfile) builds a production image (runtime deps only, `HOST=0.0.0.0`, `/health` healthcheck, the committed `sepolia.json` baked in). Build it from the **repository root**:

```bash
docker build -f services/api/Dockerfile -t listing-day-api .
docker run --rm -p 8788:8788 \
  -e SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key> \
  -e CORS_ORIGINS='https://<app>.vercel.app,https://*.vercel.app,http://localhost:3000' \
  listing-day-api
```

Any container host that terminates TLS and injects `PORT` (Render, Railway, Fly.io, Cloud Run) then serves it over HTTPS: point it at the repo with Dockerfile path `services/api/Dockerfile` and build context `.`. Set:

- **`SEPOLIA_RPC_URL`**: a provider with full log history (see the env table: publicnode's log window is about 1.5 days). It's a server-side secret: never put it in `NEXT_PUBLIC_*`.
- **`CORS_ORIGINS`**: the app's production origin, plus `https://*.vercel.app` for preview deploys if wanted.
- Health check path: `/health` (503 when the RPC is down or on the wrong chain).

Then set **`NEXT_PUBLIC_API_URL=https://<api host>`** in the app (no trailing slash; `GET ${NEXT_PUBLIC_API_URL}/v1/config` should answer). That is the only API variable the app needs. An alternative to CORS is a same-origin Next.js rewrite from `/api/*` to the API host.

## Frontend migration notes (PR #21 / `app/src/lib/mock.ts`)

1. **Base URL and addresses.** Read `NEXT_PUBLIC_API_URL`. Replace `USDC_ADDRESS`, fixture `records`, pool ids and the single global `OFFER` with `GET /v1/config` (static, per listing). Replace `CURRENT_BLOCK` / `NOW` with `currentBlock` / `now` from `/v1/listings`.
2. **Types.** `import type { … } from "@listing-day/api/types"` (or the relative path to `services/api/src/types`). Against the PR #21 mock types, the only remaining differences are the documented nulls (`Listing.sector/city`, `Bid.filledShares/refund` before exit, `Policy.referencePrice` before listing, `ClearingPoint.raised` on non-archive RPCs, see "Nullable fields") and `Phase` including `cleared`. Render them as "—", not 0.
3. **Company page = 1 call.** `GET /v1/market/:ticker` replaces `getMarket()` (the `/market` + `/swaps` join): `prices`, `trades`, `reference`, `haltSpans`, `policy`, `band`, `liquidity` are all there. `reference[]` has the mock's `{time, value, mode, bandBps}` plus `low` / `high` (draw the band from those instead of recomputing it) and `carryForward`. Chart halt columns come from `haltSpans`, not from a `halted` flag on price points.
4. **Banner.** Use `tradingOpen` and `haltCause` (`report` = exchange halt, `stale` = no fresh CRE report, `coolingOff` = until `coolOffUntil`). The listing-hour ±5% band overrides policy modes but not halts.
5. **Trade sheet.** Show `quote.priceAfter`, `quote.priceImpactBps / 100` (%) and `quote.avgPrice` from `POST /v1/prepare/swap`, and delete the local constant-product estimator (`VIRTUAL_DEPTH`) and the directional check: when the hook would reject, `quote.ok` is false with `quote.error.name` (`OutOfBand` / `DirectionalWidening` / `Halted` / `CoolingOff`) and `priceAfter` still says where the trade would have ended. Slippage is in bps (0.5% = 50).
6. **Orders.** Fetch `GET /v1/bids?owner=<wallet>` (never unfiltered for "my orders") and key by `bid.key` (equals the app's `bidKey()`). Drive buttons from `status` + `actions`: `exited` still has shares to claim; `refunded` and `claimed` are done. `trades` in `/v1/market` are the public tape, not the user's trades.
7. **Executed price.** `Trade.avgPrice` is "bought / sold at"; `Trade.price` is the pool price after the trade.
8. **Portfolio.** `GET /v1/portfolio/:address`: `balances`, `holdings[].shares + unclaimedShares`, `value`, and the wallet's bids. `avgCost`, P&L, LP fees and personal trade history are listed under `unsupported`: hide or label those cards.
9. **Issuer console.** `GET /v1/issuer/:ticker?address=<connected wallet>`: gate on `check.isIssuer`, show `issuer.address`, and never present `records.addr` / `token.address` as "owner wallet" (it is the share token). Exchange-operator roles are listed separately.
10. **Writes (unchanged).** Call `prepare`, show `simulate.error.message` before asking for a signature, then send each `needed` step with `sendTransaction({ to, data, value: BigInt(value) })` and wait for each receipt. The wallet must be on `chainId` (11155111). Prepare again if the user waits: allowances, the clearing price and the band move. HTTP 200 with `simulate.ok: false` is a predicted revert, not success.
11. **Polling.** No push: poll per block (~12 s) or after a receipt. Each response is one consistent block (`currentBlock` / `block`), but separate calls may be at different blocks.
12. **Privacy (plan.md §9, EF Anon-RPC).** The proxy sees the wallet addresses the app asks about. Screens that carry the Anon-RPC pitch must read directly over the Anon-RPC worker, or the proxy's own RPC traffic must go through Anon-RPC.

## Layout

| Path | |
| --- | --- |
| `src/app.ts` | Routes, CORS, error mapping |
| `src/index.ts` | Server entry (`@hono/node-server`) |
| `src/config.ts` | Env + deployments JSON → listings |
| `src/chain.ts` | viem client, chunked `getLogs` |
| `src/reads/` | `listing.ts` (listings, ENS), `auction.ts` (auction, clearing, bids, eligibility, exit planning), `market.ts` (policy, combined market, swaps), `policy-history.ts` (policy timeline), `issuer.ts` (roles), `portfolio.ts`, `config.ts` (static `/v1/config`) |
| `src/prepare.ts` | Calldata, Permit2 steps, simulation |
| `src/revert.ts` | Revert unwrapping + UI copy |
| `src/units.ts` | Points / Q96 / sqrtPriceX96 / token-unit math (as `ListingPrice.sol`) |
| `src/types.ts` | Exported response + body types |
| `src/abis.generated.ts` | Generated from `contracts/abis` by `npm run abis` |
| `Dockerfile` | Production image (build context: repo root) |
| `scripts/integration.sh` | anvil fork + `contracts/script/demo/anvil-rehearsal.sh` + a second live listing + `test/integration` |
