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

# Against Sepolia, once contracts/deployments/sepolia.json exists (make demo-sepolia)
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
| `RPC_URL` / `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Must support `eth_getLogs` over the demo's range. `eth_simulateV1` is needed when approvals are pending (anvil and publicnode support it) |
| `CHAIN_ID` | first file's `chainId` | `/health` returns 503 when the RPC disagrees |
| `PORT`, `HOST` | `8788`, `127.0.0.1` | |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated, or `*` |
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
- **Types.** All response and body types are in [`src/types.ts`](src/types.ts) (`import type { MarketView } from "../../services/api/src/types.ts"`, or the package export `@listing-day/api/types`).

## Endpoints

The examples below come from the anvil rehearsal (`acme`: settled, listed, traded, halted, resumed; `kesar`: a second listing with a live auction). Long values are elided with `…`.

### `GET /health`

```json
{ "ok": true, "rpcChainId": 31337, "block": 12077334, "chainId": 31337, "rpc": "http://127.0.0.1:8546",
  "deployments": [{ "file": "/…/contracts/deployments/anvil.json", "ticker": "acme", "ok": true }] }
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

```json
{ "ticker": "acme", "owner": null, "committed": { "acme": 99 },
  "bids": [{ "id": 4, "ticker": "acme", "owner": "0x3D4D…F140", "budget": 19, "maxPrice": 1.9, "maxPricePoints": 190,
             "submittedBlock": 12076995, "submittedAt": "2026-11-06T13:47:01.000Z", "state": "claimed",
             "filledShares": 17272.72727272723, "refund": 0, "exitedBlock": 12077042, "claimed": true, "tx": "0x1ca7…5bf7",
             "actions": { "exit": null, "claim": false },
             "raw": { "amount": "19000000", "maxPriceQ96": "150533508776980", "tokensFilled": "17272727272727227410982", "currencyRefunded": "0" } },
           "…"] }
```

- **`state`** is one of `active | outbid | partial | filled | refundable | exited | claimed`.
- **`actions.exit`** names the exit function that works right now (`exitBid` / `exitPartiallyFilledBid`), or null.
- **`actions.claim`** is true once the claim is open.
- **`filledShares` / `refund`** are known only after the exit (from `BidExited`).

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
- **`band`** is the current band. It is null before listing.
- **`since` / `creTx`** come from the receiver's `PolicyApplied` event, not from a tx status.

### `GET /v1/market/:ticker` and `GET /v1/market/:ticker/swaps?limit=&fromBlock=`

```json
{ "ticker": "acme", "listed": true, "hookPhase": "ListingDay", "mode": "listing", "usdcIsCurrency0": true,
  "price": 1.14, "points": 114, "band": { "low": 1.045, "high": 1.155, "lowPoints": 104.5, "highPoints": 115.5 },
  "listingPrice": 1.1, "listedAt": "2026-11-06T13:47:51.000Z", "listingDayEndsAt": "2026-11-06T14:47:51.000Z",
  "policy": { "…": "same as /v1/policy" }, "liquidity": { "usdc": 18.141106, "shares": 15913.25167740408 }, "rejected": [],
  "events": [
    { "time": "2026-11-06T13:47:51.000Z", "kind": "listing", "label": "Listed at 1.10 · ±5% band", "tx": "0x3190…f433", "block": 12077045 },
    { "time": "2026-11-06T13:48:00.000Z", "kind": "halted", "label": "v1 Halted", "tx": "0xbfc4…772c", "block": 12077054 },
    { "time": "2026-11-06T13:48:03.000Z", "kind": "normal", "label": "v2 Normal ±20% · ref listing price", "tx": "0xd843…b75b", "block": 12077057 } ],
  "poolId": "0x6f73…9885", "poolKey": { "currency0": "0x1c7D…7238", "currency1": "0x326E…185a", "fee": 3000, "tickSpacing": 60, "hooks": "0x3508…f0c0" },
  "raw": { "sqrtPriceX96": "2346535657612926232651887599287742833", "tick": 344094, "liquidity": "537293216038455", "pointsE2": "11399", "bandPointsE2": ["10449", "11549"] } }
```

```json
{ "ticker": "acme", "poolId": "0x6f73…9885",
  "trades": [{ "time": 1793972877, "side": "buy", "usdc": 0.35786, "shares": 318.60924735826416, "price": 1.14, "tx": "0xe6be…efc6",
               "block": 12077051, "sender": "0x62F4…32bE", "raw": { "amount0": "-357860", "amount1": "318609247358264133525", "…": "…" } }],
  "prices": [{ "time": 1793972877, "value": 1.14 }] }
```

- **`liquidity`** is the full-range pool position at the current price.
- **`rejected`** is always `[]`. Reverted swaps emit no logs, so the app keeps its own receipts (and the demo's published hashes) for chart markers, as in plan.md §9.
- **`trades`** are newest first. **`prices`** are oldest first, for the chart.

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

Swap `details` carry a V4Quoter `quote` (`amountOut`, `avgPrice`, and the decoded `error` when the quote itself reverts), plus the `minOut` used. Exit `details.reason` explains why no exit works yet (for example "bid is still active: exit after the auction ends"). Bid, swap and claim `details.warnings` flag a low balance or an empty claim.

## Wiring the app

1. **Base URL.** Point the app at the server, e.g. `NEXT_PUBLIC_API_URL=http://127.0.0.1:8788`. The app's origin must be in `CORS_ORIGINS`.
2. **Reads.** Replace each mock read with a fetch. Field names follow `mock.ts` where they exist:

   | Mock | Endpoint |
   | --- | --- |
   | `Ipo` | `listings[]` |
   | `Policy` | `/v1/policy` |
   | `Market` | `/v1/market` + `/swaps` |
   | `Bid` | `/v1/bids` |
   | `ClearingPoint` | `/clearing` `series[]` |

   - Prices are in the same USDC / lot units.
   - `listedAt` / `since` are ISO strings.
   - There is no server push: poll (each call is a few RPC round trips).
3. **Writes.** Call `prepare`, show `simulate.error.message` before asking for a signature, then send each `needed` step with wagmi `sendTransaction({ to, data, value: BigInt(value) })` and wait for each receipt. The wallet must be on `chainId` (31337 for the anvil fork, 11155111 for Sepolia). Prepare again if the user waits long: allowances, the clearing price and the band move.
4. **ENS.** The app can still resolve ENS itself (`contracts/README.md`); `/v1/ens/:ticker` returns the same records.
5. **Privacy (plan.md §9, EF Anon-RPC).** The proxy sees the wallet addresses the app asks about. Screens that carry the Anon-RPC pitch must read directly over the Anon-RPC worker, or the proxy's own RPC traffic must go through Anon-RPC.

## Layout

| Path | |
| --- | --- |
| `src/app.ts` | Routes, CORS, error mapping |
| `src/index.ts` | Server entry (`@hono/node-server`) |
| `src/config.ts` | Env + deployments JSON → listings |
| `src/chain.ts` | viem client, chunked `getLogs` |
| `src/reads/` | `listing.ts` (listings, ENS), `auction.ts` (auction, clearing, bids, eligibility, exit planning), `market.ts` (policy, market, swaps) |
| `src/prepare.ts` | Calldata, Permit2 steps, simulation |
| `src/revert.ts` | Revert unwrapping + UI copy |
| `src/units.ts` | Points / Q96 / sqrtPriceX96 / token-unit math (as `ListingPrice.sol`) |
| `src/types.ts` | Exported response + body types |
| `src/abis.generated.ts` | Generated from `contracts/abis` by `npm run abis` |
| `scripts/integration.sh` | anvil fork + `contracts/script/demo/anvil-rehearsal.sh` + a second live listing + `test/integration` |
