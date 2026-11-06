# rich/: extra blocks, each one backed by real API data

Seven components that make the screens carry more of what the exchange already publishes.
They follow `design/UI.md` (tokens only, 1px `--line` hairlines, 10px radius, no shadows, no gradients,
no tinted status cards, 16px body, 48px hit areas, green and red only for money, blue only for nav)
and the type roles in `globals.css` (`t-body`, `t-label`, `t-caption`, `t-list-title`, `.num`).

Every component takes plain props: numbers, strings and arrays, never an API response object and never
anything from `src/screens`. They import only `cx` / `Card` / `ProgressBar` from `components/ui.tsx`
and formatters from `lib/format.ts`, so they can be dropped into any screen.

See them all at **`/gallery`** (`app/src/app/(dev)/gallery/page.tsx`), a development-only page with
realistic sample props. `?theme=light` / `?theme=dark` force a theme.

Import from the folder: `import { BandMeter, ExchangeNotices } from "@/components/rich";`

---

## MarketStatus — `market-status.tsx`

**Shows** whether trading is open right now, under which rule, since when, the limits in force, and the
next scheduled change (listing day ending, a stale report that will stop trading).

**Fed by** `GET /v1/policy/:ticker`: `mode`, `halted`, `since`, `version`, `band.low` / `band.high`,
`bandBps`, `referencePrice`, `stale`, `staleAt`; `nextChange.at` from `listingDayEndsAt` or `coolOffUntil`.

**Screen** top of the company page (`/stock/[ticker]`), under the price block; and the Live card in the
issuer console. It is not `RuleStrip` / `CircuitBanner`: those are the full-bleed warning strip that
renders *nothing* while trading is normal. This one always renders and carries "since" and "what next".

| prop | type | |
|---|---|---|
| `mode` | `"listing" \| "normal" \| "surveillance" \| "directional" \| "halted"` | required |
| `since` | `string \| null` | ISO; prints "since 19:18 IST" |
| `version` | `number \| null` | prints "Rule v2" |
| `band` | `{ low, high } \| null` | second line: "Trades go through between 1.045 and 1.155" |
| `bandBps`, `referencePrice` | `number \| null` | the "±5% of 1.10" suffix |
| `nextChange` | `{ label, at } \| null` | footer line above a hairline |
| `stale`, `staleAt` | `boolean`, `string \| null` | warn line: trading stops until the next report |
| `digits` | `number` (3) | band decimals |

## BandMeter — `band-meter.tsx`

**Shows** where the price sits inside today's allowed limits, how much room is left before a trade stops
going through, and how much of the band the day has actually used.

**Fed by** `GET /v1/market/:ticker`: `price`, `band.low` / `band.high`, `policy.referencePrice`,
`policy.bandBps`, `policy.halted`; `dayLow` / `dayHigh` are the min and max of
`GET /v1/market/:ticker/swaps` `prices[]` inside the selected window.

**Screen** company page, directly under the chart, where the one-line band caption sits today.

| prop | type | |
|---|---|---|
| `price` | `number` | required; drawn as the marker with its value above |
| `band` | `{ low, high }` | required; the track |
| `reference` | `number \| null` | hairline tick inside the track |
| `bandBps` | `number \| null` | "±5%" in the right-hand caption |
| `dayLow`, `dayHigh` | `number \| null` | the darker segment = traded so far |
| `halted` | `boolean` | greys the track and swaps the sentence |
| `title` | `string` ("Today's limits") | |
| `digits` | `number` (3) | |

## ExchangeNotices — `exchange-notices.tsx`

**Shows** every notice the exchange has published for this company, newest first, each with its time,
block and receipt link. This is the most under-used real data in the product.

**Fed by** `GET /v1/market/:ticker` `events[]` = `{ time, kind, label, tx, block }`. `label` is already
written by the backend ("Listed at 1.10 · ±5% band", "v2 Normal ±20% · ref listing price") and is printed
as it comes; `kind` colours the square, `tx` becomes the "Receipt" link.

**Screen** company page, Overview tab (it replaces the plain "Rule history" list in `screens/company.tsx`)
and inside the Trading rule sheet.

| prop | type | |
|---|---|---|
| `notices` | `{ time, kind, label, tx?, block? }[]` | any order; sorted newest first internally |
| `title` | `string` ("Exchange notices") | |
| `limit` | `number` (4) | the rest sit behind a labelled "Show N earlier notices" button |
| `txUrl` | `(tx) => string` | defaults to `lib/format` `txUrl` (Etherscan) |
| `emptyText` | `string` | |

## StatGrid — `stat-grid.tsx`

**Shows** named facts in a hairline-divided grid, each with a caption saying what the number means, so
nothing is a number without a reason to read it.

**Fed by** `GET /v1/market/:ticker` `liquidity.usdc` / `liquidity.shares` (what the pool can actually
buy and sell), `policy.referencePrice`, `policy.bandBps`, `policy.version`, `listingPrice`; on an IPO by
`GET /v1/auction/:ticker` (`issuePrice`, `floorPrice`, `capPrice`, `perApplicantCap`, `totalSupply`,
`requiredRaise`).

**Screen** company page, Overview tab, above the key-value rows; and the console Live card. Different
from `SummaryCard` (UI.md 2.12), which is a fixed 2x2 of portfolio totals with right-aligned money.

| prop | type | |
|---|---|---|
| `stats` | `{ label, value, sub? }[]` | any length; a short last row is padded so no hairline block shows |
| `columns` | `2 \| 3` (2) | |
| `title` | `string` | optional 14/400 label above the grid |

## LifecycleRail — `lifecycle-rail.tsx`

**Shows** where a listing has got to — draft, applications, final price, trading — with the date, block
or countdown for each stage, including the failed ending ("Not listed").

**Fed by** `GET /v1/listings/:ticker` `phase` (`draft | live | cleared | refunding | listed`) mapped to
stage states, plus `GET /v1/auction/:ticker` `startBlock`, `endBlock`, `claimBlock`, `blocksRemaining`,
`graduated` and the listing's `listedAt` / `clearingPrice` for the captions.

Suggested mapping: `draft` → draft current; `live` → applications current; `cleared` → final price
current; `listed` → trading current, everything before it done; `refunding` → final price current with
`tone: "loss"` and the label "Not listed".

**Screen** IPO phases of the company page, above the chart; and the console Listing header. It is not
the approval `Stepper` (UI.md 2.17), which counts three wallet prompts inside a sheet.

| prop | type | |
|---|---|---|
| `stages` | `{ id, label, sub?, state, tone? }[]` | `state: "done" \| "current" \| "upcoming"`; `tone: "loss"` for a terminal failure |
| `title` | `string` | optional label above the rail |

## SubscriptionMeter — `subscription-meter.tsx`

**Shows** how much of an IPO has been applied for, whether it has passed the raise it needs to list
(the tick on the bar), by how many times it is subscribed, and who applied.

**Fed by** `GET /v1/auction/:ticker`: `raised`, `targetRaise`, `requiredRaise`, `bidCount`, `applicants`,
`perApplicantCap`, `graduated`; `closes` is `blocksRemaining` through `blocksToCountdown`.

**Screen** IPO phases of the company page, under the chart (UX.md 3.4 "subscription card"), and the IPO
card in the Markets list.

| prop | type | |
|---|---|---|
| `raised`, `targetRaise`, `requiredRaise` | `number` | required |
| `bidCount`, `applicants`, `perApplicantCap` | `number \| null` | the three facts under the hairline |
| `graduated` | `boolean \| null` | `false` swaps the sentence to "closed below the minimum, refundable" |
| `closes` | `ReactNode` | right-hand caption ("Closes in 42m") |
| `title` | `string` ("Applications") | |

## DemandLadder — `demand-ladder.tsx`

**Shows** how much money is waiting at each top price, and which of it clears: whether the price is held
up by one high application or a wall of them, and how close the next one is to being refunded.

**Fed by** `GET /v1/bids?ticker=` — group `bids[]` by `maxPrice`, sum `budget`, count the rows. The line
through the ladder is `clearingPrice` from `GET /v1/auction/:ticker`.

**Screen** IPO phases of the company page, Overview tab; and the console Monitor step next to the
applications table.

| prop | type | |
|---|---|---|
| `rows` | `{ price, usdc, bids? }[]` | any order; sorted high to low internally; bar width is relative to the biggest row |
| `clearingPrice` | `number \| null` | draws the dotted "Final price" line above the first refunded row |
| `title`, `caption` | `string` | |
| `digits` | `number` (2) | price decimals |

---

## What was considered and rejected

- **A standalone day-range bar.** `screens/company.tsx` already draws one (`DayRange`), and a second
  horizontal bar next to `BandMeter` would be the same shape answering half the question. The traded
  low/high is folded into `BandMeter` instead, where it reads against the limits that matter.
- **A "Product & Tools" row** (Groww's icon grid). No data behind it, the tiles are illustration clip art
  (banned by UI.md 6.1), and the destinations are already in the bottom nav.
- **Rejected-trade feed.** `GET /v1/market/:ticker` `rejected` is always `[]`: reverted swaps emit no
  logs, so the API cannot see them. Only the app's own receipts know, which is screen state, not a
  component's data source.
- **Sector, market cap, volume, P/E, news, 52-week range.** `sector` and `city` are `null` in the API
  ("nothing onchain carries them yet") and the rest has no endpoint. Any of them would be invented.
- **A pool depth curve.** The API returns `liquidity` at the current price only (the full-range position),
  not a curve, so a depth chart would be drawn from one point.
- **A holders / applicants breakdown.** `/v1/bids` gives owner addresses but no identity or size cohort;
  anything beyond the demand ladder would be decoration over the same five rows.
