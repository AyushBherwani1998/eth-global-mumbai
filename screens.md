# Listing Day: screen plan

Derived from [`plan.md`](./plan.md) §10 (screens), §4 (IPO mechanics and quote currency), §5 (lifecycle), §7 (ENS), §8 (World ID) and §13 (demo script).
Mobile-first Next.js PWA, wagmi + viem. **All reads go through Anon-RPC; writes go through the wallet.**

**Quote currency:** Circle **Sepolia USDC** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 dec). There is no mint; test funds come from the [Circle faucet](https://faucet.circle.com/) (20 USDC per address every 2 h).

**Price display:** prices are shown **per 1,000-share lot** ("1.10 USDC / lot"), with the per-share value to 5 decimals as secondary text. plan.md's "points" map 1:1: 100 points = 1.00 USDC / lot = 0.001 USDC / share.

Demo numbers used below: 110,000 shares (90,000 auctioned, 20,000 LP), issue 1.00 USDC / lot, range 0.80–1.90, cap 20 USDC per applicant, required raise 45 of 90 USDC, clears ~1.10, listing band 1.045–1.155.

## Overview

| # | Screen | Route | Who | Lifecycle phase | Cut priority |
|---|---|---|---|---|---|
| 0 | App shell (header, nav, badge, wallet) | layout | All | All | Never |
| 1 | IPO list | `/` | Investor | All | Never |
| 2 | IPO detail + bid sheet | `/ipo/[ticker]` | Investor | Draft, CCA live, Clears | Never |
| 2a | World verify sheet (Phase 2) | modal on 2 | Investor | CCA live | Cut #2 |
| 3 | My bids / allotment | `/bids` | Investor | CCA live → Claim | Never |
| 4 | Live market + trade sheet | `/market/[ticker]` | Investor | Listing day, Normal | Never |
| 5 | Circuit status banner | global component | All | Listing day → Halted | Never |
| 6 | Portfolio | `/portfolio` | Investor | After claim | Cut #5 |
| 7 | Issuer console | `/console/[ticker]` | Issuer | All | Never |

Two things to settle before building:

- **The circuit banner is a component, not a screen.** It mounts in the shell and appears on screens 1, 2 and 4.
- **LP removal must not live only on Portfolio.** The halt demo (§12 step 9) needs "LP removal still works", but Portfolio is cut #5. The LP NFT from `LBPStrategy` goes to the issuer's position recipient anyway, so the **Remove LP** button goes in the issuer console demo panel. Portfolio can show it as a bonus.

---

## 0. App shell (global)

**Purpose:** wallet, network, privacy badge and navigation on every screen.

**Header**
- Wallet button: Connect (MetaMask injected / WalletConnect) → shows `0x12…ab` or ENS name, tap → disconnect sheet
- Network chip: "Sepolia". If the wrong chain, show a "Switch to Sepolia" button
- **Anon-RPC badge:** "Reads via Tor · 100%" (anon reads / total reads). Tap → privacy sheet
- **Get test USDC** link to faucet.circle.com, shown when the connected wallet's USDC balance is below the 20 USDC cap (one faucet request covers a full application)

**Privacy sheet (from the badge)**
- Transport name (Tor-js / Nox), reads via Anon-RPC count, direct reads count (must be 0), last error
- Honest note: "The RPC still sees which addresses you query. The bootstrap read isn't private. Writes go through your wallet's RPC."

**Bottom nav:** IPOs · My bids · Market · Portfolio. Console tab only if the connected wallet owns a ticker.

**Shared components:** circuit banner (screen 5), status chip, tx toast with decoded revert reason, block countdown (block → time at ~12 s/block), IST timestamp formatter.

**TODO**
- [ ] Next.js PWA scaffold (manifest, icons, mobile viewport), wagmi config for Sepolia
- [ ] viem `custom` transport → Anon-RPC worker; route every public client through it
- [ ] Read counter (per-transport) + badge + privacy sheet
- [ ] **No silent fallback:** on Anon-RPC failure, show an error state with Retry, never a direct RPC
- [ ] Wallet connect (MetaMask in-app browser + WalletConnect), wrong-network guard
- [ ] "Get test USDC" faucet link when balance < cap
- [ ] Shared formatters: USDC with 6 decimals; prices as "X.XX USDC / lot" + per-share to 5 decimals
- [ ] Tx toast: pending → confirmed / reverted, with error names decoded from ABIs (`BidAboveCap`, `CapExceeded`, `NotEligible`, `OutOfBand`, …) and a Sepolia Etherscan link
- [ ] Store every app-sent tx receipt (incl. `status = 0`) locally; the chart markers need these
- [ ] Hide the Console tab unless the wallet owns a ticker

---

## 1. IPO list

**Purpose:** discover IPOs. Everything is resolved from ENS; nothing hard-coded beyond `listingday.eth`.

**Data:** UserRegistry registration events → labels → resolve each `<label>.listingday.eth` via UniversalResolverV2 (through Anon-RPC). Records: `addr`, `listingday.status`, `listingday.auction`, `listingday.pool`, `description`, `avatar`.

**Fields**
- Search input: "Type a ticker (e.g. acme)" → resolves `acme.listingday.eth` live, shows "Resolved from ENS" with a tick
- Per IPO card:
  - Avatar, ticker (`ACME`), full ENS name (`acme.listingday.eth`)
  - Status chip from `listingday.status`: `draft` / `auction` / `listed` / `surveillance` / `halted`
  - Issue price (100), range (80–190)
  - Auction: current clearing price + time left. Listed: last pool price + % vs issue
- Filter chips: All · Live auction · Listed

**Buttons / actions**
- Tap card → `auction`/`draft` opens screen 2; `listed`/`surveillance`/`halted` opens screen 4
- Pull to refresh

**States:** loading skeleton · empty ("No IPOs registered under listingday.eth") · ticker not found · Anon-RPC error with Retry

**TODO**
- [ ] Fetch UserRegistry registration events via `eth_getLogs` (Anon-RPC)
- [ ] Batch-resolve text records for each ticker via viem ENS actions → UniversalResolverV2 proxy
- [ ] Ticker search with debounced live ENS resolution
- [ ] IPO card component + status chip
- [ ] Route by status to detail or market
- [ ] Empty, not-found and error states

---

## 2. IPO detail + bid sheet

**Purpose:** see the offer and place a CCA bid.

**Data:** ENS records (auction address from `listingday.auction` only), CCA state (floor, clearing price, `currencyRaised`, `requiredCurrencyRaised`, start/end/claim blocks), `ClearingPriceUpdated` / checkpoints, eligibility module's committed total for the wallet (or human key), USDC balance, USDC → Permit2 allowance and Permit2 → auction allowance.

**Header**
- Ticker, ENS name, status chip, description, url
- **"Resolved from ENS" panel** (collapsible): token, auction, hook, policy, pool (empty until migrate), each with a copy button and explorer link. This is the ENS judging evidence; keep it visible.

**Offer facts**
- Total supply 110,000 · Auctioned 90,000 · LP reserve 20,000
- Issue price 1.00 USDC / lot · Range 0.80–1.90 USDC / lot (floor 0.80, cap 1.90)
- Per-applicant cap: "20 USDC per applicant"
- Raise progress bar: `currencyRaised` / `requiredCurrencyRaised` ("graduates at 45 of 90 USDC")
- Phase + countdown: "Starts in N blocks" / "Ends in ~mm:ss (block X)" / "Claim from block Y"
- Current clearing price (big number)

**Clearing chart:** Lightweight Charts line of clearing price per block, with floor (80) and cap (190) price lines and the TradingView attribution logo.

**Bid sheet (bottom sheet, opens from "Place bid")**
- Input: **Budget** (USDC), with "Max" = min(balance, cap remaining)
- Input: **Max price** (USDC / lot), with a slider from 0.80 to 1.90; per-share value shown underneath
- Derived, read-only:
  - Shares if filled at your max: budget / max price
  - Shares at current clearing: budget / clearing
  - Cap remaining: cap − already committed (exits don't refund cap; say so)
  - USDC balance (with "Get test USDC" if below the budget)
- Warnings (inline, non-blocking):
  - Max price > 1.90 / lot → "Above the 1.90 cap. This bid will revert `BidAboveCap`." Keep the button enabled so the demo can show the revert.
  - Budget > cap remaining → "Will revert `CapExceeded`"
  - Max price < current clearing → "Below clearing; you'll be outbid unless it falls"
- Phase 2 only: World verify row (see 2a). Submit stays disabled until a valid voucher exists.
- Buttons, shown as a 3-step progress row so a first-time bidder knows why there are three wallet prompts:
  1. **Enable USDC** → `USDC.approve(Permit2, max)` (once per wallet; skip if already approved)
  2. **Approve for this auction** → `Permit2.approve(USDC, auction, amount, expiration)` (skip if the allowance covers the budget)
  3. **Submit bid** → `submitBid(maxPriceQ96, amount, owner, hookData)`

**States:** draft ("Auction not started"), live, ended-awaiting-clear, graduated ("Listed at 110 → View market"), not graduated ("Refunding → My bids").

**TODO**
- [ ] Resolve auction/hook/policy/token from ENS only; render the "Resolved from ENS" panel
- [ ] Read CCA state + block countdowns
- [ ] Clearing chart from `ClearingPriceUpdated` / checkpoint logs
- [ ] Bid sheet: budget + max price inputs, USDC-per-lot → per-share → `maxPriceQ96` conversion (`P_usdcPerShare × 10^6 / 10^18 × 2^96`), derived share estimates
- [ ] Read committed total from the eligibility module → cap remaining
- [ ] Inline warnings for cap (190), per-applicant cap and below-clearing; don't block submission
- [ ] 3-step approve flow (USDC → Permit2, Permit2 → auction) that skips steps already done, then `submitBid` with `hookData` (empty in Phase 1, voucher in Phase 2)
- [ ] Decoded revert toast; record the receipt
- [ ] Phase-dependent CTAs (not started / live / graduated / refunding)

### 2a. World verify sheet (Phase 2)

**Purpose:** one human, one application. Opens from the bid sheet's "Verify you're one applicant".

**States and copy**
- Unverified: "Verify with World ID" button (Agent Pass OIDC or IDKit widget, simulator/staging)
- Verifying: spinner, "Waiting for World…"
- **Verified:** "Verified · voucher expires in mm:ss", human key short hash, bound wallet
- **Denied:** "This human already applied with 0xAB…CD for ACME." No voucher, bid stays disabled
- **Cancelled:** "Verification cancelled." Bid stays disabled, Retry button
- **Expired:** "Voucher expired." Re-verify button. (For the demo, a "Use expired voucher" debug toggle shows the `NotEligible` revert.)

**TODO**
- [ ] Pick Agent Pass vs IDKit after the World spike; wire the client widget
- [ ] `POST /api/verify` → backend validates, checks human key ↔ wallet binding, returns EIP-712 voucher or denial
- [ ] Encode the voucher into `hookData`
- [ ] All four failure states with distinct copy
- [ ] Voucher expiry countdown
- [ ] Debug toggle for the forged/expired voucher demo (hidden behind `?demo=1`)

---

## 3. My bids / allotment

**Purpose:** track bids, exit losing ones, claim shares.

**Data:** CCA `BidSubmitted` logs filtered by `owner` (Anon-RPC), bid structs, clearing price, `claimBlock`, graduation status, exit/claim events.

**Auction summary card (per IPO)**
- Final or current clearing price, graduated yes/no, claim block countdown
- Totals: committed, filled shares, refundable USDC

**Per bid row**
- Bid ID, ticker, budget, max price, submitted block/time (IST)
- State chip: **Active** (above clearing) · **Outbid** (below clearing) · **Partial** (at clearing tick) · **Filled** · **Exited / refunded** · **Claimed**
- Filled shares, refund amount (USDC)

**Buttons / actions** (shown only when valid)
- **Exit bid** → `exitBid` (outbid after end, or auction not graduated)
- **Exit partial** → `exitPartiallyFilledBid` (needs checkpoint hints; compute them client-side)
- **Claim shares** → `claimTokens`, after `claimBlock`
- **Claim all** → `claimTokensBatch`
- Banner when not graduated: "Raise below threshold. Every bid is refundable." + "Exit all"

**States:** no wallet · no bids ("You haven't applied to any IPO") · loading · per-row pending tx

**TODO**
- [ ] Fetch the user's bids from logs + read bid structs
- [ ] Derive bid state from clearing price, end block and graduation
- [ ] Exit, exit-partial (with hint computation) and claim actions with tx toasts
- [ ] Claim-all batch
- [ ] Not-graduated refund banner
- [ ] Refresh on new block while the auction is live

---

## 4. Live market chart + trade sheet

**Purpose:** trade on the v4 pool and *see* the circuit rules enforced.

**Data:** PoolId from `listingday.pool`, hook from `listingday.hook`, policy from `ListingPolicyReceiver.policy()` + its events, `Swap` logs, StateView `getSlot0`, Quoter, the app's stored receipts.

**Header**
- Ticker, last price (big), % vs issue (100), % vs reference
- Band line: "Listing band ±5% · 1.045–1.155" (or "Normal ±20% · 0.88–1.32", "Surveillance ±5%", "Directional: ref 0.90", "Halted"), all in USDC / lot

**Chart (Lightweight Charts v5)**
- Pool price line (from `Swap` logs)
- CRE reference line (from receiver events)
- Upper/lower band price lines (`createPriceLine`), updated on mode change
- Baseline series coloured above/below reference
- Markers: rejected swaps (red ×, from stored receipts + demo hashes), circuit trips (from CRE reports)
- Legend label: "Rejected attempts seen by this app"
- TradingView attribution logo (`attributionLogo: true`)

**Trade sheet (bottom sheet)**
- Toggle: **Buy / Sell**
- Input: amount in (USDC for buy, ACME for sell); balance + Max
- Output (read-only): quote from Quoter, price after swap, price impact
- Slippage setting (default 0.5%)
- **Pre-check row:**
  - In band: "Within band ✓"
  - "Would revert: price after 1.17 is outside the band (max 1.155)"
  - Directional: "Would revert: widens the gap from reference 0.90"
  - Halted: "Trading halted. Swaps revert."
- Buttons: **Approve** (Permit2) → **Swap** (Universal Router). On a predicted revert, the button reads "Submit anyway (will revert)" so the demo can produce the on-chart marker.

**Below the chart**
- Recent trades (from `Swap` logs): time IST, side, size, price
- Rejected attempts (from receipts): time, size, reason

**TODO**
- [ ] Resolve pool + hook from ENS; read slot0 via StateView
- [ ] Chart: pool line, reference line, band price lines, baseline series, markers, attribution
- [ ] Band math client-side mirroring `ListingHook` for the pre-check. **USDC is almost always `currency0`**, so the raw pool price is ACME-per-USDC (inverted): a buy is `zeroForOne`, "price up" means `sqrtPriceX96` goes down, and upper/lower bounds swap. Read the token order from the PoolKey; don't assume it
- [ ] One price helper (sqrtPriceX96 + token order → USDC / lot) shared by the header, chart, quotes and pre-check
- [ ] Quoter integration for buy/sell quotes
- [ ] Permit2 approve + Universal Router v4 swap encoding
- [ ] "Submit anyway" path; save the reverted receipt → marker
- [ ] Recent trades + rejected attempts lists
- [ ] Live update per block

---

## 5. Circuit status banner (global component)

**Purpose:** one glance at the rule in force.

**Data:** `ListingPolicyReceiver.policy()` + `PolicyUpdated` events, `listingday.status` from ENS.

**States and colours**
| State | Copy | Colour |
|---|---|---|
| Listing band | "Listing day · ±5% · 1.045–1.155" | Blue |
| Normal | "Normal · ±20% · 0.88–1.32" | Green |
| Surveillance | "Surveillance · ±5%" | Amber |
| Directional | "Directional · only trades toward ref 0.90" | Amber |
| Halted | "Halted · swaps revert · LP exits open" | Red |

Each shows "since 14:32 IST". Tap → details sheet: policy version, `asOf`, ref price, band bps, mode, halted, cool-off, ENS status, CRE report tx link.

**TODO**
- [ ] Read policy + latest report event; poll per block
- [ ] Map policy → state, copy and colour
- [ ] Changed-at timestamp in IST
- [ ] Details sheet with the CRE tx link and ENS status (shows the mirror worked)
- [ ] Mount on screens 1, 2 and 4; animate on state change (the halt moment is a demo beat)

---

## 6. Portfolio (cut #5)

**Purpose:** holdings and PnL.

**Fields**
- Per ticker: ACME balance, avg cost (= clearing price for auction fills), last price, value in USDC
- PnL vs issue price (1.00 / lot) and vs clearing (1.10 / lot), in USDC and %
- Unclaimed shares (link to My bids)
- USDC balance + "Get test USDC" link
- LP positions (if the wallet holds any): range, liquidity, fees, **Remove liquidity** button

**TODO**
- [ ] Token balances + last pool price
- [ ] Cost basis from the user's filled bids
- [ ] PnL calc vs issue and vs clearing
- [ ] LP positions from PositionManager + remove liquidity
- [ ] Empty state

---

## 7. Issuer console

**Purpose:** run the whole IPO and the demo controls. Gate the route to the ticker owner (or a hard-coded demo issuer wallet as a fallback).

Lay it out as a **stepper** with the current lifecycle step expanded: Create → Ticker → Policy → Launch → Monitor → Graduate → Demo controls.

### 7.1 Create listing
- Fields: token name ("Acme SME"), symbol ("ACME"), total supply (110,000), auctioned (90,000), LP reserve (20,000, derived), issue price (1.00 USDC / lot), floor % (80 → 0.80), cap % (190 → 1.90), per-applicant cap (20 USDC), % of raise to LP (20%), graduation threshold (50% of target), start block / duration, claim block, unsold-token and leftover-USDC recipient (issuer treasury)
- Quote currency: read-only "Sepolia USDC `0x1c7D…7238`" (used for both the auction and the pool; LBPStrategy reverts `CurrencyMismatch` otherwise)
- Read-only preview: floor and cap in raw-unit Q96, target raise (90 USDC), required raise (45 USDC), predicted token order ("USDC is currency0"), "unsold → issuer treasury"
- Button: **Save draft** (local)

### 7.2 Register ENS ticker
- Input: label ("acme") with availability check → preview `acme.listingday.eth`
- Owner: connected wallet (read-only)
- Registering `listingday.eth` itself (one-off, usually by script) is paid in **ENS test USDC** `0x240b…14aa`, not Circle USDC. If the console does it, label the balance and the mint + approve buttons "ENS test USDC" so the two tokens aren't confused
- Records editor: `addr`, `listingday.auction`, `listingday.pool`, `listingday.hook`, `listingday.policy`, `description`, `url`, `avatar`. Status is read-only here (receiver-owned)
- Buttons: **Register ticker** · **Save records** · **Grant receiver status role** (`ROLE_SET_TEXT` scoped to `listingday.status`) · **Test role denial** (receiver tries to set `url` → shows the revert; ENS judging evidence)
- Link: "View in ENS app"

### 7.3 Publish policy (CRE)
- Fields: version, reference price, normal band (20%), surveillance band (5%), mode, halted
- Button: **Publish policy v1 via CRE**
- Runner log: "Editing exchange JSON → simulating → broadcasting → tx 0x…" + ENS status now `draft`

### 7.4 Launch auction
- Summary of 7.1 params
- Button: **Launch** (LiquidityLauncher multicall: createToken + distribute → LBPStrategy → CCA)
- After success: auto-write `listingday.auction` and status `auction` (one tx or a prompt)

### 7.5 Monitor
- Live: clearing price chart, raised vs required, bid count, unique applicants (wallets / humans), time left
- Bids table: owner, budget, max price, state
- Rejected bids seen (reverts from demo scripts)

### 7.6 Graduate
- Shows: graduated? clearing price, unsold amount
- Button: **Migrate** (`LBPStrategy.migrate()`) → pool opens at clearing
- Then: **Write pool to ENS** (`listingday.pool`, status `listed`)
- Not graduated: "Refunds open" (no migrate)

### 7.7 Demo controls
- Current policy card (mirrors banner details)
- Input: reference price + **Update reference**
- Buttons: **Normal** · **Surveillance** · **Directional** · **Halt** · **Resume**
- **Remove LP** (proves LP exits work while halted)
- Each button shows runner progress and the resulting Sepolia tx + ENS status

**TODO**
- [ ] Route guard: ticker owner (from ENS) or demo issuer
- [ ] Stepper with lifecycle-driven step state
- [ ] 7.1 form + validation + Q96 preview
- [ ] 7.2 ENS register, records write, scoped role grant, role-denial test
- [ ] 7.3 / 7.7 Next API route that edits the mock exchange JSON and spawns `cre workflow simulate --broadcast`; stream the log back
- [ ] 7.4 Launcher multicall + ENS auction record write
- [ ] 7.5 monitor panel (reuse the screen 2 clearing chart)
- [ ] 7.6 migrate + ENS pool/status write
- [ ] 7.7 demo buttons + Remove LP
- [ ] Every action shows its tx hash with an explorer link (judges watch these)

**Risk:** the CRE buttons shell out to a local CLI, so they only work when the console runs on the laptop with the CRE CLI installed. Don't put the console on the hosted demo URL expecting those buttons to work; host the investor screens and run the console locally (or show a "runner offline" state when the API route can't reach the CLI).

---

## Suggested build order (Lane B)

Matches plan.md §14 and the cut list:

1. Shell + Anon-RPC badge (Gate 0 decides everything else)
2. IPO list → IPO detail + bid sheet (Phase 1, no World) → My bids
3. Market + trade sheet + circuit banner
4. Issuer console (7.3, 7.4, 7.6, 7.7 first; 7.1 can be a hard-coded params form; 7.2 lands with the ENS lane)
5. **Checkpoint Sat 01:30 IST:** MetaMask e2e
6. ENS resolution swap-in on screens 1, 2, 4 (replace any temporary addresses)
7. Portfolio
8. World verify sheet (2a), hard stop Sat 05:30 IST
