# Listing Day: UX spec (Groww model, trading first)

Scope: the investor PWA and the issuer console in `app/`. This is the single UX source for the rebuild on branch `ui-groww`. Written against the current code (`app/src/screens/*`, `app/src/components/*`, `app/src/app/*`, `app/mock/*`), `plan.md` (4, 5, 7, 8, 10, 12, 13), `screens.md`, `design/reference/TOKENS.md` and the four Groww screenshots in `design/reference/`.

## 0. Product stance (read before anything else)

- This is a share-trading app first. The daily job is: watch a few companies, see price and today's change at a glance, buy or sell in two taps, see what I own and how it is doing. IPOs are a secondary mode inside Markets. The IPO sub-tab, the apply flow and the auction mechanics stay, but they must not dominate the home screen, the nav or the company page.
- The user to design for is a 50-year-old Groww user who has never used a crypto app. Every screen passes this test: one primary action, plain English, nothing to decode.
- Hard rules that apply everywhere:
  - One primary action per screen (one filled button). Everything else is text or outlined.
  - Labels: Buy, Sell, Price, Today's change, Your shares, Total value, Apply, Collect shares, Refund. Never pool, hook, policy, CCA, Permit2, nullifier, Q96, hookData, zeroForOne, Quoter, router, migrate, graduate in the main flow. Those words live only inside a collapsed "Details" row, or in the Console's Developer section.
  - Type: body 16px minimum, secondary 14px minimum (never 11px or 13px in content), list price 18px, hero price 32px. Numbers use tabular figures.
  - Touch: 48px minimum for every tappable thing; primary buttons 52px; chips 40px tall; list rows 72px.
  - No icon-only controls. Every icon has a visible text label next to or under it (bottom nav already does this). "Back", "Share", "Expand", "Search" are words, with the icon as decoration.
  - No dense chip rows. At most one row of 2 to 3 wide chips per screen, 40px tall. Filters that need more options use a segmented control or a dropdown.
  - Wallet is framed as "Sign in". "Sign in with MetaMask" / "Sign in with WalletConnect". After sign-in the header shows "Account". The words wallet, address, chain, gas appear only inside the Account screen.
  - Approvals are one-sentence steps: "Allow this app to use your USDC", "Allow this IPO to take your application amount", "Confirm". The wallet prompt count is stated up front.
  - Errors are one sentence plus the fix: "This trade would push the price above today's limit of 1.155. Try a smaller amount." The protocol error name is a 14px grey second line.
  - Light and dark are both first class. All colours are tokens.
  - Groww is the pattern library: white ground, outlined cards, no shadows, teal gain, coral loss, blue only on the active nav item, 3-item bottom nav, price and change above the chart, fixed Sell/Buy bar on the company page.
  - Mobile first, and the same routes render a real desktop layout at >= 1024px.

---

## 1. What is wrong today

### Weighting and information architecture

- The home route is the IPO list (`app/(tabs)/page.tsx` → `screens/ipo-list.tsx`). The product is a trading app; the first screen should be listed companies with price and today's change.
- Bottom nav is `IPOs · My bids · Market · Portfolio (+ Console)` (`components/shell.tsx` BottomNav). The owner wants Markets first and IPO inside it. Console appears as a fifth tab only when the wallet is an issuer, so the bar changes width on sign-in and hard-links to `isIssuerFor[0]`.
- Listed companies appear three times on one screen and again on another: the index-style strip at the top of `ipo-list.tsx`, the "Listed on Listing Day" grid further down, and all of `market-list.tsx`.
- The "Tools" grid on the IPO list duplicates the bottom nav (My bids, Portfolio) and is the only route to About.
- Two detail screens for one company (`ipo-detail.tsx` at `/ipo/[ticker]`, `market-detail.tsx` at `/market/[ticker]`) with different header icons, different tab sets and a hand-off button "Listed at 1.10 · View market". `hrefFor()` in `lib/mock.ts` picks the screen from ENS status, so a bookmark or back-stack can land on the stale one.
- Filter chips on the IPO list are `Explore · Live auction · 3 · Listed · Upcoming & closed`: a Groww tab name misused as "All", one chip with a count, and a chip that mixes a future IPO with a failed one.
- The privacy badge, "Sepolia" pill and "Get test USDC" pill sit above the content on the home screen. Infrastructure chrome is the first thing an investor sees, and the badge is missing from every other screen.
- No watchlist. The owner's primary job ("watch a few companies") has no UI.

### Non-crypto usability

- Text is small everywhere: 11px bottom-nav labels, 11px legend, 11px bid metadata, 12px/13px secondary copy across every screen. Body is 15px.
- Icon-only controls: back arrow, bell, bookmark, share, search, copy, external link, close X, expand. Bell toggles a local boolean, Bookmark does nothing, Search on `market-detail.tsx` navigates to `/`.
- "Connect" / "Connect a wallet" / "Disconnect" framing (`shell.tsx` WalletAvatar, WalletSheet, every empty state). The Account sheet leads with a conic-gradient blob, a 0x address, "ETH (gas)".
- The bid sheet has two equal 22px inputs side by side (Budget, Max price), a slider that goes past the cap to 2.10 on purpose, and a primary button that turns red "Submit anyway (will revert)". The trade sheet does the same. Demo paths are the default controls.
- The World ID sheet ships a "Preview state (mock)" switcher inside the investor sheet.
- Dense chip rows: `Explore · Live auction · Listed · Upcoming & closed`, `1H 4H 1D ALL`, `0.5% 1% 2%`, `Overview · Trades · Rejected · ENS`, six-option World state switcher.
- Toast headlines are the protocol error ("Reverted: BidAboveCap", "Reverted: OutOfBand") with no fix.
- No "Sign in" return path: My bids and Portfolio show an empty state with a Connect button; detail actions do not prompt sign-in.

### Protocol jargon in the main flow

- `ipo-detail.tsx` Overview: "Start block", "End block", "Claim from block", "Unsold shares: Go to issuer treasury", "Raise to LP: Seeds the Uniswap v4 pool at the clearing price", "Graduation threshold met", tab "ENS".
- `market-detail.tsx`: "Token order: USDC is currency0 · Buys are zeroForOne", "Pool ID", "Policy v4 via CRE", "v4 POOL" in the exchange-name slot, "Rejected attempts seen by this app", tab "ENS".
- `market-list.tsx` intro: "Each listed SME trades in a Uniswap v4 pool. Its ListingHook reverts any swap that lands outside the rule in force."
- `bid-sheet.tsx`: "Pass rides in hookData with this bid", "This bid will revert BidAboveCap", "Will revert CapExceeded", "The one-applicant pass in hookData has expired", step "Approve auction".
- `trade-sheet.tsx`: "You receive (Quoter)", "The ListingHook will revert it onchain", "Swap · Buy", "Enable ACME for Permit2".
- `my-bids.tsx`: "Your bids are read from the auction's BidSubmitted logs", "One transaction with claimTokensBatch", "Exit bid", "Exit partial", "#14 · block 7,412,061".
- `portfolio.tsx`: "Seeded by LBPStrategy at migration"; shows an LP position whose `owner` is `issuer` to the bidder wallet.
- `circuit-banner.tsx`: "Report asOf", "Mirrored by the CRE receiver", "'Applied' is read from the receiver's own ReportProcessed event".
- `shell.tsx` badge: "Reads via Nox · 100%".

### Hierarchy on the company page

- `market-detail.tsx` stacks price, vs-issue change, sector chip, a per-share/vs-clearing/vs-ref line, a full `CircuitBanner` card, the chart, a "v4 POOL" label, range chips, a 4-item legend and a holdings card before the tabs. Groww goes price, change, chart.
- Change base differs per screen (vs issue on lists, three bases on detail, "total returns" on Portfolio). `dayOpen()` in `lib/mock.ts` exists and is unused, so there is no today's change anywhere.
- Decimals vary: `lotFixed(last, 3)` on lists, 2 on detail, 5 per share; "USDC / lot", "USDC/lot" and "/ lot" are all used.

### States and platform

- No skeletons, no private-read error state with Retry (screens.md requires no silent fallback), no wrong-network state, no offline state, no install prompt. `WalletSheet` shows a static "Sepolia" pill.
- No theme toggle; `globals.css` supports `data-theme` but nothing sets it, and `time-chart.tsx` only listens to `prefers-color-scheme`.
- `app/layout.tsx` wraps everything in `max-w-[480px]`; on desktop the app is a phone column with a fixed bottom nav. Sheets and toasts are capped too. `manifest.ts` forces `orientation: "portrait"`.
- `StatusChip` maps ENS status but lotus has `status: auction` with `phase: refunding`; the UI needs one derived display state.

### Charts (`components/time-chart.tsx`)

- No readout on hover beyond a dashed vertical line with a time label. Groww swaps the header price and shows the time under it.
- Five layers at once: baseline fill above and below, dashed blue reference, two dotted red band lines, red triangles, blue circles and squares. Groww is one line and one dotted baseline.
- Colour flips green/red around the reference, not by the change over the selected range.
- Range chips `1H 4H 1D ALL`; no expand control; no full-screen view.
- The chart is destroyed and rebuilt on every dependency change, including freshly allocated `lines` and `markers` arrays, so it flickers. Markers outside the visible window are dropped silently.

### Issuer console (`screens/console.tsx`, `/console/[ticker]`)

- Reachable only via the conditional bottom tab, and dressed as an investor tab (`TabHeader`, app logo, title "Console").
- "Demo controls" is lifecycle step 7. Setting the reference price, surveillance and halts are exchange-operator actions, not issuer steps, and not "demo".
- Engineer tooling is mixed into the steps: the Q96 block, "Test role denial", "Sweep unsold", a black hard-coded terminal box (not theme aware).
- No desktop layout.

---

## 2. Information architecture

### Mobile bottom nav (3 items, fixed)

| Position | Label | Route |
|---|---|---|
| 1 | Markets | `/` |
| 2 | Orders | `/orders` |
| 3 | Portfolio | `/portfolio` |

Bar 56px + safe area; icon 24px over a 12px label; active = brand blue; white/card ground; hairline top border. Item count never changes. Console, About and Privacy are not tabs.

### Header on tab screens

Row 1 (56px): 32px logo, title 20/500 ("Markets", "Orders", "Portfolio"); on the right one text pill: "Sign in" (outlined, 40px tall) when signed out, "Account" with a small coloured dot when signed in.
Row 2 (Markets only): a full-width search field, 48px, placeholder "Search companies". It is a real field, not an icon.

### Account screen (from "Account" / "Sign in")

Opens as a bottom sheet on phone, a right-aligned dropdown panel on desktop. Rows, 56px each, 16px text:

1. Signed in as `bidder.eth` (or short address). Under it: "USDC balance 14.62". Row link "Get free test USDC" when balance < 20. Text button "Sign out".
2. Network: "Sepolia test network" with a green dot. If wrong: a filled button "Switch to Sepolia" and the one-line reason "This app only works on the Sepolia test network."
3. Private browsing: "On · your lookups are private" with chevron into the Privacy screen (existing copy from `PrivacyBadge` including "What this doesn't hide").
4. Appearance: segmented System / Light / Dark.
5. Issuer console (only if the wallet owns a ticker): chevron to `/console`.
6. Add to home screen (only when installable and not already standalone).
7. About Listing Day: disclaimer, credits, TradingView NOTICE.

Signed out: the sheet shows a title "Sign in", two 56px buttons "Sign in with MetaMask" and "Sign in with WalletConnect", and one line: "Signing in uses a crypto wallet on the Sepolia test network. Nothing is charged."

### Desktop top nav (>= 1024px)

56px bar: logo + wordmark, `Markets · Orders · Portfolio`, (issuer only) `Console`, a 320px search field, then "Sign in" / "Account". Active item: 2px brand underline. No bottom nav.

### Where Console lives

Entry points: Account row, desktop nav item, and a banner on the company page ("You manage this listing · Open console") when the signed-in wallet owns the ticker. Routes `/console` (list) and `/console/[ticker]`. Own header (Back, company, runner status). Spec in 3.9.

### Markets internal structure

Under the search field, one row of two 40px chips, Groww style (selected = grey fill, 1px dark border):

| Chip | Route | Default |
|---|---|---|
| Stocks | `/` | yes |
| IPO | `/?tab=ipo` | |

Chip selection lives in the URL so back and reload preserve it.

Stocks shows listed companies as watchlist-style rows (3.1). IPO shows a segmented `Open · Upcoming · Closed` and IPO cards (3.2).

**One row component for every company, three variants.** 72px tall: 40px logo, name 17/500, one 14px grey line, right column aligned right.

| Variant | Grey line | Right column |
|---|---|---|
| Listed | sector | price 18/500, today's change 15/600 green/red under it |
| Listed, surveillance or halted | sector | as above, plus a 14px amber "Watch" or red "Halted" word before the price |
| IPO open | "IPO open · closes in 42m" | "Apply" in brand 16/600 |
| IPO upcoming | "IPO opens 7 Nov, 10:00" | "0.80 to 1.90" 16px grey |
| IPO closed, not listed | "Not listed · refunds open" | "Refund" in brand if this wallet has money there, else grey "Closed" |

Tapping any row opens `/stock/[ticker]`. Search results use the same rows.

---

## 3. Screen-by-screen spec

Shared rules:

- Prices are USDC per lot of 1,000 shares. The unit appears once per screen as a 14px grey line ("Prices in USDC per 1,000 shares"), not after every number. Two decimals in lists and heroes; band edges use as many as needed (`1.045`, via `bandDigits`).
- Today's change is the only change shown on listed-company lists and heroes (open = first price in the IST day, or the listing price on listing day). IPO pages show "vs issue price". Portfolio shows today's change first and "since you bought" second.
- Loading: skeleton rows and a skeleton chart, never spinners in content. Error: inline card "We couldn't load prices privately. Check your connection and try again." + "Try again"; never a silent fallback to a direct RPC. Offline: grey top strip "You're offline · showing prices from 15:40 IST", primary buttons disabled.
- Every write shows a toast: pending ("Confirm in your wallet"), done (plain headline, "View receipt" link), rejected (plain sentence with the fix, 14px grey error name under it, "View receipt" link).
- "Details" is a collapsed row at the bottom of a page or sheet. It holds addresses, ENS record names, policy version, block numbers and protocol names. Everything above it is investor language.
- Signed-out behaviour: everything is readable. Any action (Buy, Sell, Apply, Collect, Refund) opens the Sign in sheet first and then continues to the action.

### 3.1 Markets, Stocks chip (home screen)

Purpose: see the companies I follow, price and today's change, in one glance.

Layout, top to bottom:

1. Header row 1 (logo, "Markets", "Sign in"/"Account"), row 2 search field.
2. Chips `Stocks` (selected) `IPO`.
3. Alert rows (only if any company is halted or under surveillance): a 56px row per company, red or amber left bar, 16px: "Vayu E-Mobility · trading halted since 14:32 IST". Tap opens the company.
4. Section "Watchlist" (18/500). Rows for watched companies. First run: all listed companies are watched (max 6) so the list is never empty. Each company page has an "Add to watchlist" / "Remove from watchlist" text button; the row itself has no star to keep it clean. Empty: "Add companies from their page to see them here."
5. Section "All companies": every listed company, same rows, sorted by name. Hidden if identical to the watchlist.
6. One low-key card, 56px: "2 IPOs open · see them" → switches to the IPO chip. If none are open: "Upcoming IPOs" → IPO chip, Upcoming. This is the only IPO presence on the home screen.
7. Foot line, 14px grey: "Prices in USDC per 1,000 shares · NSE-inspired mock, not a regulated product."

Primary action: tap a row. Secondary: search, chip switch.

States: loading skeleton (6 rows); empty "No companies listed yet" with "See upcoming IPOs"; private-read error card with Try again; offline strip.

Desktop: 1200px container. Left (8/12): alerts, Watchlist table, All companies table (name, sector, price, today's change, status), hover rows, click opens the company. Right (4/12): "Your shares" summary card (total value, today's change, "Open portfolio") and the IPO card. Index strips and "Most traded" grids are P2 and not required.

### 3.2 Markets, IPO chip

Purpose: find an IPO and apply, in the same visual language as Stocks.

1. Header, search, chips (`IPO` selected).
2. Segmented control `Open · Upcoming · Closed`, 44px, default Open (Upcoming if nothing is open).
3. IPO cards, full width, outlined, 16px padding, one primary line each:
   - Row 1: logo, name 17/500, sector 14px grey.
   - Open: "Closes in 42m" (live), "Current price 1.24", "Subscribed 0.68 times", a progress bar with a tick at the minimum raise. Full-width outlined button "Apply" (48px). If this wallet already applied: "You applied 8 USDC" and the button reads "View application".
   - Upcoming: "Opens 7 Nov, 10:00 IST", "Price range 0.80 to 1.90", "Up to 20 USDC per person".
   - Closed, listed: "Listed at 1.10 · now 1.11 (+0.9%)".
   - Closed, not listed: "Did not reach the minimum · refunds open". Button "Refund" if this wallet has money there.
   - A 14px line with a shield when the IPO is one-per-person: "One application per person".
4. If the wallet has applications: a 56px card "Your applications · 3 · see in Orders".
5. Foot line: "An IPO lists only if it raises at least half its target. Otherwise every application is refunded."

Primary action: Apply (opens the company page with the Apply sheet open).

Desktop: two columns of cards.

### 3.3 Company page, listed (`/stock/[ticker]`)

One route for every phase; this is the listed phase. 3.4 covers IPO phases.

Layout:

1. Detail header, 56px: left "‹ Back" (text + chevron), right "Share" (text + icon). Nothing else.
2. Company block: 40px logo, name 20/400, under it sector 14px grey and a green "Verified ✓" word (tap opens Details). The ENS name lives in Details.
3. Price block: price 32/600; under it today's change 16/500 green/red with the word "Today". On hover or long-press on the chart the price swaps to the hovered point and "Today" becomes the time.
4. Rule line (only when the rule is not Normal), 48px, tinted, 16px, plain sentence: "Listing day: trades allowed between 1.045 and 1.155" (blue) · "Under watch: trades allowed between 0.855 and 0.945" (amber) · "One-way trading: moves away from 0.90 stop at 5%, trades toward it go through within 20%" (amber) · "Trading halted since 14:32 IST" (red). Tap opens the Trading rule sheet with the same sentence, "Why" paragraph in two sentences, the time it changed, and a "Details" row (policy version, report receipt, ticker status).
5. Chart, 280px (3.11). Under it: a dotted separator, range chips `1D · 1W · All` (40px, three only) left, "Expand" (text + icon) right.
6. Your shares card (always present when signed in): "You own 14,109 shares · worth 15.52 USDC" and "Today +0.12 (0.8%)". If shares are waiting: a second line "3,200 shares ready to collect" with a text button "Collect". Signed out: "Sign in to see your shares". No holdings: "You don't own any shares yet".
7. Sections as three tabs (text, active = green + 3px underline, 48px): `Overview · Activity · Details`.
   - Overview: two-paragraph description, then key facts as label/value rows (16px): Today's range, Listing price, Issue price, Listed on, Trading rule today (plain sentence), Liquidity available ("18.4 USDC + 16,380 shares"). Then "Rule history": dated list of changes in plain words.
   - Activity: "Recent trades" (time, Buy/Sell, shares, price) and under it "Your orders" for this company. Rejected attempts appear in the same list with a red "Rejected" word and a one-line reason ("Would have moved the price above 1.155").
   - Details: ENS name and records (copy / open), pool id, hook, policy contract, token order, policy version and report receipt. The only place protocol names appear.
8. Fixed action bar: `Sell` (coral) and `Buy` (teal), 52px, 10px radius, 50/50. Buy is the primary.

States: loading skeleton; halted → rule line red, Sell and Buy disabled with the label "Trading halted" and a tap opening the Trading rule sheet; under watch / one-way → enabled, the Trade sheet does the check; error card above the chart with the bar hidden; signed out → Buy/Sell open Sign in then the sheet.

Desktop: two columns. Left (8/12): company block, price, rule line, chart 420px, Your shares, tabs. Right (4/12, sticky under the nav): the Trade panel from 3.6 with `Buy | Sell` tabs on top, like Groww web. No fixed bottom bar.

### 3.4 Company page, IPO phases

Same route, same header and company block. The rest changes by phase.

Upcoming
- Price block: "Issue price 1.00"; under it "Price range 0.80 to 1.90 · opens 7 Nov, 10:00 IST".
- Chart slot: a flat card "Applications open in 6h 12m" with the price range drawn as a scale (0.80, 1.00, 1.90).
- Tabs `Overview · Details`. Overview: about the company, then facts: Shares on offer, Issue price, Price range, Up to 20 USDC per person, Minimum raise to list, One application per person (yes/no), Opens, Closes.
- Action bar: one disabled button "Opens in 6h 12m".

Open
- Price block: "Current price 1.24" with "+24% vs issue price" and a line "Closes in 42m". A small pulsing "IPO open" word next to the sector.
- Chart: step line of the price so far; dotted line at issue 1.00; the 1.90 cap as the top of the scale. Toggle `Price · Subscription` (two chips) switches to the amount raised with a dotted line at the minimum. No range chips.
- Subscription card: "61.4 of 90 USDC raised · subscribed 0.68 times · 19 people" with a progress bar and "Lists if it reaches 45 USDC".
- One-person row (when required): "One application per person · Verify" (outlined, 48px) or "Verified for this IPO ✓ · valid 9:48". Appears once, here.
- Tabs `Overview · Your application · Details`.
- Action bar: single teal "Apply" (or "Apply again" while cap remains; disabled "You've applied the maximum" at the cap).

Closed, awaiting result
- Price block "Final price 1.10", chart frozen, subscription card shows "Reached the minimum · listing soon" or "Below the minimum · refunds open". Action bar: "View application" if any, else hidden.

Closed, not listed
- Grey "Not listed" word by the sector; amber card "This IPO did not reach 45 USDC. Every application is refundable." Action bar: "Refund 10 USDC" if this wallet has money there, else hidden.

Closed, listed: render 3.3; Overview adds an "IPO result" row group (final price, subscription, listing gain).

Desktop: same two columns; the right panel holds the Apply panel (open) or the subscription card (other phases).

### 3.5 Apply sheet

Opens from "Apply". Bottom sheet on phone, right panel on desktop. Title "Apply for Kesar Agro Foods".

1. Amount: one dominant input, 32px numerals, "USDC" at the right, "Max" chip (sets min(balance, remaining cap)). Helper 14px: "Up to 20 USDC per person · 7 left for you". If balance is short: "You have 14.62 USDC · Get free test USDC".
2. Price, a two-option control (radio rows, 56px):
   - "Pay the final price (recommended)", selected by default. Helper: "You pay whatever price the IPO closes at, never more than 1.90."
   - "Set a maximum price". Reveals a slider from 0.80 to 1.90 (the cap is the end; no over-cap drag), the current price marked on the track, value shown as "up to 1.40". Helper: "If the final price ends above your maximum, your money is refunded."
3. Estimate rows (16px): "Shares at today's price: about 6,451" · "Money reserved: 8 USDC".
4. One-person status (when required): "Verified ✓ · valid 6:52" or an outlined "Verify you're one person" (opens 3.5a). Primary is disabled until verified.
5. Warnings, one sentence each, with the fix. Amber (non-blocking): "Your maximum is below today's price. Raise it or you may be refunded." Red (blocking): "That's more than your 7 USDC remaining. Enter 7 or less." / "That's more than your balance. Get free test USDC."
6. Footer: a step row and the primary button.

The wallet prompts. Before the first tap the footer says, 14px: "Your wallet will ask you up to 3 times." The step row shows only the remaining steps, each one sentence:
   1. "Allow this app to use your USDC" (skipped if already allowed)
   2. "Allow this IPO to take your application amount" (skipped if the allowance covers it)
   3. "Confirm your application"
The primary button is the current step's sentence. After the last confirm: toast "Application placed · 8 USDC", the sheet closes, the "Your application" tab shows the row. If the wallet supports batching (EIP-5792): one button "Confirm your application" and "One wallet prompt".

Demo paths are reachable only in Demo mode (3.10): an over-cap price unlocks and a text link "Send anyway" appears under the disabled primary, with "This will be rejected: above the 1.90 cap". The toast then reads "Rejected: the price limit was above the 1.90 cap. Lower it and try again." with `BidAboveCap` in grey.

Details row: "Maximum price 1.90 = 0.0019 USDC per share", auction contract, "Your verification is sent with the application".

### 3.5a One-person verification sheet

Title "One application per person". Intro, 16px: "Each person can apply once per IPO. World ID checks that you're a real, unique person. It does not identify you and it is not KYC."

| State | Copy | Button |
|---|---|---|
| Not verified | "Takes about 10 seconds in the World App." | "Verify with World ID" |
| Verifying | "Waiting for the World App…" | none |
| Verified | "Verified for this IPO · valid 9:48" | "Done" |
| Already applied | "This person already applied for this IPO from another account. A second application isn't possible." | "Close" |
| Cancelled | "Verification was cancelled. You can apply after verifying." | "Try again" |
| Expired | "Your verification expired. Verify again to apply." | "Verify again" |

No state switcher inside the sheet; it moves to the Demo drawer.

### 3.6 Trade sheet (Buy / Sell)

Opens from Buy or Sell. Title "Buy Acme SME" / "Sell Acme SME". A `Buy | Sell` segmented toggle at the top (48px).

1. Amount: one dominant 32px input. Buy: "Amount in USDC"; a text link under it "Enter shares instead" swaps the unit. Sell: "Shares". "Max" chip; balance line "You have 14.62 USDC" / "You own 10,909 shares".
2. Result rows (16px): "You'll get about 892 shares" / "You'll get about 1.09 USDC" and "Price after your trade 1.113". A collapsed "More options" row holds slippage (0.5% default, segmented 0.5 / 1 / 2) and price impact.
3. Rule check row (always present, 48px, 16px):
   - Allowed: green, "Allowed · within today's limits 1.045 to 1.155".
   - Blocked by band: red, "This trade would push the price to 1.171, above today's limit of 1.155. Try a smaller amount."
   - Blocked by one-way (`DirectionalWidening`): "This trade would push the price further from 0.90 than the 0.855–0.945 allowed today. Try a smaller amount or the other side."
   - Halted: "Trading is halted since 14:32 IST. Try later."
4. Footer: primary "Buy for 1 USDC" (teal) / "Sell 1,000 shares" (coral). When blocked: primary disabled with label "Not allowed today"; a 16px text link under it "Send anyway to see it rejected" (demo path, never the primary). Sell has a first permission step "Allow this app to sell your shares", shown as in 3.5.

Rejected result: toast "Rejected: the price would have gone above today's limit. Try a smaller amount." with `OutOfBand` in grey; a coral dot appears on the chart; the Activity list gains a Rejected row.

Details row: route, quote source, pool id, raw price after.

Desktop: this sheet is the sticky right panel with `Buy | Sell` tabs.

### 3.7 Orders (`/orders`)

Purpose: everything I've asked the market to do.

1. Header "Orders", "Account".
2. Segmented `IPO applications · Market trades` (48px). Default Market trades, unless an application needs action.
3. Action card (if anything is actionable): "2 allotments ready · Collect all" or "10 USDC refundable · Refund all" (one filled button).
4. Market trades: every trade in the listed pools, not only this wallet's (per-wallet history is not indexed), labelled "All market trades" with a line saying so. Newest first, 72px rows: company, "Buy · 892 shares at 1.11" / "Sell · 1,000 shares at 1.09", time, "Receipt" link. Rejected attempts show "Rejected" in red with the one-line reason.
5. IPO applications: grouped by company. Group header: logo, name, "Current price 1.24 · closes in 42m" / "Listed at 1.10" / "Not listed", status word. Three 16px stats: Applied, Shares allotted, Refundable. Rows: "8 USDC up to 1.40", time (no block numbers), status word, one action button when valid.
   Status words: `Likely allotted` (above the current price), `Below the price`, `Partly allotted`, `Allotted`, `Collected`, `Refunded`, `Refund available`.
   Actions: "Refund", "Collect shares", "Settle" (partly allotted: collects shares and refunds the rest).

States: signed out ("Sign in to see your orders", one filled "Sign in"); empty per segment ("No market trades yet · See companies"); loading; per-row pending.

Desktop: a table per segment, action column right; the action card becomes a banner.

### 3.8 Portfolio (`/portfolio`)

Purpose: what I own, what it's worth, how it did today.

1. Header "Portfolio", "Account".
2. Hero card: "Total value" 32/600 `31.20 USDC`; under it "Today +0.42 (1.4%)" 18/500 green/red; third line 16px grey "Since you bought +2.10 (7.2%)". Nothing else in the hero.
3. "Shares to collect" strip (amber, 56px) if any: "17,284 shares waiting · Collect in Orders".
4. Section "Your shares (3)": 72px rows: logo, name, "10,909 shares · bought at 1.10"; right: value 18/500, today's change 15/600. Tap opens the company.
5. Section "Cash": "USDC 14.62" and "Get free test USDC" when low. ETH for fees goes under a Details row.
6. Section "Liquidity you provide" (only if this wallet owns a position): "Acme SME · 18.4 USDC + 16,380 shares · earned 0.21" and an outlined "Withdraw liquidity" (always enabled, with "Works even while trading is halted").

States: signed out ("Sign in to see your shares"), empty ("Shares you buy or get from an IPO show up here"), loading.

Desktop: hero left, Your shares table right, Cash and Liquidity below.

### 3.9 Issuer console (`/console`, `/console/[ticker]`)

A separate surface for two roles, laid out so a judge can tell them apart: Listing (issuer) and Exchange desk (operator). Protocol words are allowed here, but the step labels stay plain.

`/console`: the wallet's listings: logo, name, phase, "Next: Launch auction", runner status.

`/console/[ticker]` on phone:

1. Console header: "‹ Back", logo, name, ENS name, runner status word ("Runner online" green / "Runner offline" red with the one-line reason "Exchange actions need the CRE runner on the demo laptop").
2. Live card: phase, current or last price, raised vs minimum, the rule line from 3.3.
3. "Listing" accordion stepper (current step open):
   - Create listing: parameter form (name, symbol, supply, auctioned, issue price, floor %, cap %, max per person, % to liquidity, minimum raise %, duration, claim delay, treasury) and one toggle "One application per person (World ID)" with "Fixed once the auction starts". Button "Save draft".
   - Register ticker: label input with availability check, preview `acme.listingday.eth`, records table (addr, auction, pool, hook, policy, description, url; status read-only "set by the exchange"), buttons "Register", "Save records", "Grant exchange status role". Link "View in ENS app".
   - Launch auction: parameter summary, "Launch". On success "Auction address written to ticker" with the receipt.
   - Monitor: price step chart (140px), stats (raised, applications, unique people, verifications issued, second-account denials, rejected applications), applications table.
   - List on market: "Reached the minimum" or "Below the minimum, refunds open". "Open market" then "Write market to ticker". Shows unsold shares returned to treasury.
4. "Exchange desk" (visible from Launch on, enabled after listing): reference price input + "Update"; rule buttons Normal · Under watch · One-way · Halt (red outline) · Resume (only when halted). Each action shows "Signing → Broadcasting → Applied", then the receipt and "Ticker status now: halted". "Applied" comes from the receiver event, never tx status; a failed report shows "Report rejected by the policy contract". "Withdraw liquidity" lives here too (halt demo).
5. "Developer" (collapsed, grey): Q96 previews, predicted token order, "Test role denial", "Sweep unsold tokens", the runner log in a monospace block that uses theme tokens.

Desktop: three columns. Left 240px step rail; centre the open step; right 360px sticky: Live card, price chart, rule line, last five runner lines.

States: not the owner ("This console is for the owner of acme.listingday.eth"); runner offline (exchange buttons disabled with the reason); per-button pending; report rejected.

### 3.10 Sign in, privacy, appearance, demo

- Sign in sheet: "Sign in with MetaMask", "Sign in with WalletConnect", one explanatory line. Wrong network: the same sheet shows "Switch to Sepolia" with the reason.
- Privacy screen: title "Private browsing"; existing counters and the "What this doesn't hide" list, rewritten at 16px. On phone the Markets header carries no privacy badge; the Account row shows "Private browsing: on". A 14px grey "Private" word with a shield sits next to the foot line on Markets, tap opens the screen. It is present but not in the way.
- Appearance: System / Light / Dark, persisted in localStorage, applied as `data-theme` on `<html>` before first paint (inline script in the root layout); the chart re-reads tokens via a MutationObserver on that attribute; the theme-color meta updates at runtime.
- Demo mode: a toggle in the Account sheet that appears after the URL has carried `?demo=1` once. It unlocks over-cap prices, the "Send anyway" links, the verification state drawer, and the console Developer section. Off by default.
- About: disclaimer (NSE-inspired mock, not regulated, World ID is not KYC, test USDC only), credits with the TradingView NOTICE text and link.

### 3.11 Chart spec (replaces the `time-chart.tsx` configuration)

Keep Lightweight Charts v5. Change the layers and behaviour.

- One line: `LineSeries`, 2px, coloured by the change over the selected range (gain when last >= first, loss otherwise). No area fill, no baseline fill.
- One dotted baseline: the day's open (listed, `1D`), the first point of the range (`1W`, `All`), or the issue price (IPO). 1px dotted muted. This is Groww's previous-close line and the thing today's change is measured from.
- Band: a light shaded zone between the band edges with 14px labels at the right edge ("1.155", "1.045"). Shown on listing day, under watch and one-way; on Normal only when the band is inside the visible price range. Not two red dotted lines.
- Markers: rejected attempts are 8px coral dots on the line; rule changes are small flags at the bottom edge. Tap or hover shows "Rejected · above the limit · 11:22". Markers outside the visible range are clamped to the nearest visible point, not dropped.
- Axes: no grid; price axis hidden; time axis hidden in the inline chart (Groww style), visible in Expand.
- Hover and touch: a vertical hairline only; the header price and change swap to the hovered point; "Today" becomes the time. On touch, long-press starts the scrub; a tap does nothing.
- Range chips: `1D · 1W · All` (three, 40px); none while an IPO is open. Selected = grey fill, 1px dark border.
- "Expand" (text + icon) opens a full-screen chart (landscape-friendly) with both axes, a legend row (Price, Day open, Today's limits, Rejected) and the same chips.
- Theming: read tokens once per theme change and apply via `applyOptions`; never recreate the chart on hover or marker changes; memoise `lines` and `markers` and update through `setData` / `setMarkers`.
- List sparklines: keep the SVG sparkline only in the Portfolio rows (56x26, coloured by today's change). Markets rows have no sparkline; the price and change carry the information.

---

## 4. Navigation and flow maps

Trade flow (the primary job)
```
Markets › Watchlist row → /stock/acme → Buy
  → (signed out) Sign in sheet → MetaMask → back to Buy
  → Trade sheet → amount → rule check row
  → Allowed: "Buy for 1 USDC" → toast "Bought 892 shares" → Your shares card updates
  → Blocked: primary disabled "Not allowed today"; text link "Send anyway to see it rejected"
      → toast "Rejected: … Try a smaller amount." → coral dot on chart → Activity row
  → Sell: "Allow this app to sell your shares" step, then "Sell 1,000 shares"
```

Apply (IPO) flow
```
Markets › IPO chip › card "Apply" → /stock/kesar with the Apply sheet open
  → (signed out) Sign in → back to Apply
  → (wrong network) "Switch to Sepolia" inside the sheet
  → (one per person, not verified) "Verify you're one person" → 3.5a → Verified
  → amount, price option
  → steps: Allow this app to use your USDC → Allow this IPO to take your application amount → Confirm
  → toast "Application placed" → Your application tab
  → later: Orders › IPO applications › Collect shares / Refund
```

Halt flow (investor side)
```
Policy report lands → company page polls → rule line turns red and flashes once
  → Sell/Buy bar reads "Trading halted" (disabled); tap opens the Trading rule sheet
  → Markets alert row "Vayu E-Mobility · trading halted since 14:32 IST"
  → Portfolio › Liquidity you provide › Withdraw liquidity stays enabled
  → Resume report → rule line clears, bar re-enables, toast "Trading in Vayu E-Mobility has resumed"
```

Issuer flow
```
Account › Issuer console (or desktop nav Console, or the company-page banner)
  → /console → /console/acme
  → Listing: Create → Register ticker → Launch → Monitor → List on market
  → Exchange desk: Update reference → Under watch / One-way → Halt → Withdraw liquidity → Resume
  → every action: progress → receipt → "Ticker status now: …"
```

First run and sign in
```
App opens on Markets, signed out; everything readable
  → header shows "Sign in"
  → any action opens Sign in first and returns to the action
  → after sign in: network check → USDC check → "Get free test USDC" row if < 20
```

Dark/light: Account › Appearance › System / Light / Dark (dropdown on desktop).

---

## 5. Responsive and PWA model

| Name | Width | Nav | Lists | Company page | Sheets |
|---|---|---|---|---|---|
| Phone | < 640 | bottom nav, 3 items | single column rows | one column, fixed Sell/Buy bar | bottom sheets, 90dvh max |
| Tablet | 640 to 1023 | bottom nav | content max 720px centred | one column, chart 360px | centred dialogs, 480px wide |
| Desktop | >= 1024 | top nav, no bottom nav | 1200px container, tables | two columns, sticky right trade panel 360px | trade panel inline; others are centred dialogs |

Remove the global `max-w-[480px]` wrapper in `app/layout.tsx`; apply widths per layout.

PWA:
- Manifest: `display: "standalone"`, `display_override: ["window-controls-overlay", "standalone"]`, `orientation: "any"`, `start_url: "/"`, `theme_color` light ground (runtime-updated for dark), `background_color` white.
- Safe areas: header `padding-top: max(12px, env(safe-area-inset-top))`; bottom nav, action bars and sheet footers `padding-bottom: max(12px, env(safe-area-inset-bottom))`; side insets in the Expand chart.
- Standalone back navigation: "‹ Back" uses history when available, else the parent route (`/` for company pages, `/console` for ticker consoles). Never leave a screen without a back control.
- Install: capture `beforeinstallprompt`; show the "Add to home screen" row in Account; never a pop-up. iOS: the row opens a two-step instruction sheet.
- Offline: the service worker caches the shell (`/`, `/orders`, `/portfolio`, `/about`, `/offline`) and static assets, never chain data. The app keeps the last good read in memory/IndexedDB and shows it with the offline strip and disabled actions. A cold offline open shows `/offline`: logo and "Reconnect to see prices".
- Update the SW `SHELL` list when routes change (`/bids` and `/market` go away).
- Sizes: body 16px, secondary 14px, 48px targets, 52px buttons, 72px rows, 40px chips.

---

## 6. Naming glossary (UI label → protocol term)

| UI label | Protocol / code term |
|---|---|
| Sign in / Sign out / Account | wallet connect / disconnect / wallet sheet |
| Markets | app root; Stocks = listed tickers, IPO = CCA phases |
| Watchlist | local list of tickers (localStorage), default all listed |
| Company page | `/stock/[ticker]`; replaces `/ipo/*` and `/market/*` |
| Price | last pool price (listed) or current clearing price (IPO open) |
| Today's change | change vs the IST day open (`dayOpen`), or vs listing price on listing day |
| Since you bought | change vs average cost (clearing price for IPO fills) |
| Your shares / You own | token balance + unclaimed allotment |
| Total value | holdings × last price |
| Shares to collect | claimable allotment after `claimBlock` |
| Collect shares / Collect all | `claimTokens` / `claimTokensBatch` |
| Verified ✓ | ENSv2 subname resolved via UniversalResolverV2 |
| Buy / Sell | Universal Router swap on the v4 pool |
| Buy for 1 USDC / Sell 1,000 shares | exact-in swap |
| You'll get about | Quoter result |
| Price after your trade | post-swap price from Quoter |
| Allow this app to sell your shares | token `approve(Permit2)` + Permit2 permit |
| Allowed / Not allowed today | client mirror of `ListingHook.afterSwap` |
| Rejected | reverted swap (`OutOfBand`, `DirectionalWidening`, `Halted`) |
| Today's limits | `bandBps` around `referencePrice` |
| Trading rule today | policy mode (`listing`, `normal`, `surveillance`, `directional`, `halted`) |
| Listing day | mode listing, ±5% around clearing |
| Under watch | surveillance, mode = 1 |
| One-way trading | directional, mode = 2 |
| Trading halted | `halted = true` |
| Reference / toward 0.90 | `policy.referencePrice` from the CRE report |
| Exchange notice / report receipt | CRE report tx, `ReportProcessed` / `PolicyUpdated` |
| Exchange desk (console) | CRE simulate runner + `ListingPolicyReceiver` |
| Ticker status | ENS text `listingday.status` |
| Apply / Application | `submitBid`, a CCA bid |
| Amount (application) | `amount` (budget, USDC 6 dec) |
| Pay the final price | price limit = cap, 190% of issue |
| Set a maximum price | `maxPriceQ96` |
| Current price (IPO) / Final price | CCA clearing price |
| Issue price | policy anchor, 100 points = 1.00 per lot |
| Price range (IPO) | CCA `floorPrice` (80%) and the 190% cap in `AuctionValidationHook` |
| Up to 20 USDC per person | per-wallet / per-human cap in the eligibility module |
| Subscribed 0.68 times | `currencyRaised / target` |
| Minimum raise to list | `requiredCurrencyRaised` |
| Listed / Not listed | graduated (migrated) / not graduated (refunds) |
| Open market (console) | `LBPStrategy.migrate()` |
| Listing price | pool initial price = clearing price |
| One application per person | World ID pass (`EligibilityPass`), nullifier binding |
| Verify you're one person | IDKit / Agent Pass, backend-signed pass |
| Already applied from another account | nullifier bound to a different wallet |
| Verification expired | pass `expiry` passed; bid would revert `NotEligible` |
| Allow this app to use your USDC | `USDC.approve(Permit2)` |
| Allow this IPO to take your application amount | `Permit2.approve(USDC, auction, amount, expiration)` |
| Confirm your application | `submitBid(..., hookData = pass)` |
| Likely allotted / Below the price | bid above / below clearing |
| Partly allotted | bid at the clearing tick |
| Allotted | filled |
| Refund | `exitBid` |
| Settle | `exitPartiallyFilledBid` |
| Liquidity you provide / Withdraw liquidity | LP position from LBPStrategy / PositionManager decrease |
| Private browsing | Anon-RPC (Nox mixnet, tor-js fallback) |
| Free test USDC | Circle Sepolia USDC faucet, `0x1c7D…7238` |
| Receipt | Etherscan tx link |
| 1,000 shares | one lot |
| Details | the collapsed row that holds addresses, versions, blocks and protocol names |

---

## 7. Prioritised build list

Sized for one engineer in one hackathon day, reusing what already fits (Card, Sheet, Segmented, Tabs, KV, toasts, formatters, `policy.ts`).

### P0 (must)

1. Type and touch scale: body 16, secondary 14, price 32/18, 48px targets, 52px buttons, 72px rows, 40px chips. Update `globals.css` and the shared components once; remove every 11px/12px/13px class from screens.
2. Nav: bottom nav `Markets · Orders · Portfolio`; Markets at `/` with `Stocks | IPO` chips in the URL; delete `/market` list, the index strip, the Listed grid and the Tools grid. Header "Sign in"/"Account" pill and a real search field.
3. Home = Stocks: alert rows, Watchlist rows (default all listed), All companies, one IPO card, foot line. Today's change wired from `dayOpen()`.
4. One company route `/stock/[ticker]` rendering by phase; redirect `/ipo/*` and `/market/*`. Order: company block, price + today's change, rule line, chart, Your shares, tabs `Overview · Activity · Details`, Sell/Buy bar. "‹ Back" and "Share" as text buttons; no bell or bookmark.
5. Trade sheet: one input, result rows, rule check sentences with fixes, disabled primary + "Send anyway" text link, sell permission step, "More options" for slippage.
6. Apply sheet: one input, "Pay the final price / Set a maximum price", slider capped at 1.90, one-sentence steps with the prompt count, verification row. Demo paths behind Demo mode.
7. Sign in framing everywhere: Sign in sheet, Account sheet rows, signed-out states that return to the action, wrong-network button.
8. Copy pass: every string from section 1 moved into Details or rewritten per the glossary; toasts as sentence + fix + grey error name.
9. Chart: single line coloured by range change, dotted day-open baseline, shaded limits, header hover readout, `1D · 1W · All`, no rebuild on hover or marker changes.
10. Orders: `Trades · IPO applications`, status words and verbs per 3.7, Collect all / Refund all card.
11. Portfolio: hero (Total value, Today, Since you bought), Shares to collect strip, Your shares rows, Cash. Liquidity only for the owning wallet.
12. Theme: Appearance control sets `data-theme`; chart re-themes; no hard-coded colours (RunnerLog, avatar).
13. Desktop shell: top nav at >= 1024, container widths, two-column company page with the trade panel inline. Drop the 480px wrapper.
14. States: skeletons, private-read error card with Try again, offline strip, per-row pending.

### P1 (should)

15. Console: own header, `/console` list, Listing stepper and Exchange desk split, Developer collapsed, three-column desktop, "Applied" from the receiver event, plain step labels.
16. IPO chip: `Open · Upcoming · Closed` cards per 3.2; "Your applications" card.
17. Watchlist add/remove on the company page, persisted in localStorage.
18. Expand chart with axes and legend; marker tooltips; clamp markers.
19. Trading rule sheet with the "Why" copy and rule history in Overview.
20. PWA: manifest `orientation: any` + `display_override`, install row, `/offline`, SW shell list, runtime theme-color.
21. Search results on every tab using the row variants.

### P2 (nice)

22. Index strip ("Listing Day SME" composite, "IPOs open") and "Most traded" grid on desktop.
23. EIP-5792 batched approvals ("One wallet prompt").
24. Price alerts and a bookmark-style watch toggle in the header (only once they work).
25. Tablet dialog variants; landscape chart in Expand; keyboard navigation for chips and tabs.
26. "Notify me" on upcoming IPOs.
