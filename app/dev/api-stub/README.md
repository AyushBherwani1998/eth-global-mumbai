# api-stub: the backend, without a chain

The real backend is `services/api`. It needs `contracts/deployments/<network>.json`,
which only exists after a deploy, so it cannot run in a fresh checkout.

This is a stand-in. Same routes, same JSON shapes (`services/api/README.md`),
same error envelope, served from fixtures. It exists so the app can be run and
reviewed end to end with no RPC, no anvil and no deploy.

**It is not app code.** Nothing under `src/` imports it, and it is plain Node
with no dependencies.

## Run it

```bash
cd app
node dev/api-stub/server.mjs            # http://127.0.0.1:8788
```

Then point the app at it and restart `next dev` (the variable is read at build
time, so a running dev server will not pick it up):

```bash
echo 'NEXT_PUBLIC_API_URL=http://127.0.0.1:8788' >> .env.local
pnpm dev
```

| Env | |
| --- | --- |
| `PORT`, `HOST` | default `8788`, `127.0.0.1` |
| `STUB_FAIL=RPC_ERROR` | every `/v1` route fails with that code, so the app's error cards and Retry can be checked. Also `BAD_REQUEST`, `UNKNOWN_TICKER`, `NOT_LAUNCHED`, `INTERNAL` |
| `STUB_DELAY=600` | milliseconds of latency, so the skeletons are visible |

## What it serves

A whole demo exchange, defined in [`app/mock/demo-exchange.json`](../../mock/demo-exchange.json)
and expanded into API shapes by `fixtures.mjs`. Eight companies, chosen so every
rule and every lifecycle phase is on screen somewhere:

| Ticker | | |
| --- | --- | --- |
| `acme` | Listed, listing day ±5% | **The one that is real.** Cleared at 0.80, 60 USDC raised, 3 applicants, policy version 5: the numbers live Acme shows on Sepolia |
| `masala` | Listed, normal ±20% | Five policy versions over four days |
| `nirmaan` | Listed, under watch ±5% | Slid after listing, then put under surveillance |
| `vayu` | Listed, halted | Normal, then a one-way day, then halted an hour ago |
| `kesar` | IPO open | Closes in ~40 minutes, 0.68x subscribed |
| `tara` | IPO open | Just opened, barely subscribed |
| `lotus` | Refunding | Closed below the minimum raise |
| `prakriti` | Upcoming | Opens in ~2 hours |

`sector` and `city` stay null for every one of them, exactly as the real proxy
returns them. Where a company has a trade and a town, it is in the ENS
description, which is where a real issuer would put it.

Routes: `/health`, `/v1/listings`, `/v1/listings/:ticker`, `/v1/ens/:ticker`,
`/v1/auction/:ticker`, `/v1/auction/:ticker/clearing`, `/v1/bids`,
`/v1/eligibility`, `/v1/policy/:ticker`, `/v1/market/:ticker`,
`/v1/market/:ticker/swaps`, and `POST /v1/prepare/{bid,swap,exit,claim}`.

Series (pool prices, trades, auction checkpoints) are built relative to the
moment the server starts, so the 5m / 1H / 1D chart windows always have data:
5-second points for the last quarter hour, 20s for the last hour, 1m for the
last six, 5m for the rest of today, 20m for older days.
`/v1/bids?owner=` returns the applications the spec marks `mine` as belonging to whoever
asks, so Orders and Portfolio have something to show for any wallet.

## It says it is a stub

`/health` reports `rpc: "stub://fixtures"` and every response carries
`X-Data-Source: stub`. The app watches `/health` and shows a **Demo data** strip
across the top of Markets, Orders and Portfolio for as long as it is pointed
here, so nobody can mistake these numbers for live ones.

## When the real backend is available

Nothing in the app changes: point `NEXT_PUBLIC_API_URL` at
`http://127.0.0.1:8788` served by `services/api` instead. Seven of the eight
companies simply stop existing, because the app shows what the API returns and
nothing else, and the Demo data strip disappears on its own because `/health`
then reports a real RPC host.

## Editing the demo

`app/mock/demo-exchange.json` is the whole story: who exists, what phase they
are in, which rule changes landed when, and which applications belong to the
signed-in wallet. Times are minutes before the server starts. Add a company by
adding an entry; the pool walk, the trades, the clearing series, the ENS
records and the contract addresses are all derived. Nothing under `app/src`
reads this file.
