# Components: foundation reference

Shared pieces for the Groww-parity rebuild (`design/UI.md`, `design/UX.md`). Every colour is a CSS token
from `app/globals.css`; no shadows, no gradients, 10px radius, 16px body text, 48px hit areas.
Sizes below already include the UI.md section 7 legibility addendum.

Type roles are CSS classes in `globals.css` (`t-page-title`, `t-section-title`, `t-card-title`,
`t-list-title`, `t-body`, `t-price-large`, `t-price-row`, `t-change-lg`, `t-change-sm`, `t-label`,
`t-label-sm`, `t-caption`, `t-nav-label`, `t-chip`, `t-tab`, `t-button`, `t-input-value`,
`t-readout`, `t-mono`). Use them instead of ad-hoc `text-[..]`. `.num` = tabular figures.
Tailwind colour utilities: `text-text`, `text-text-2`, `text-text-3`, `bg-bg`, `bg-surface`,
`bg-surface-2`, `border-line`, `border-line-strong`, `text-gain-text`, `text-loss-text`, `bg-gain`,
`bg-loss` (lines/fills only), `bg-buy`, `bg-sell`, `text-brand`, `text-brand-text`, `text-warn`,
`bg-chip-on-bg`, `border-chip-on-line`, `bg-inverse-bg`, `text-inverse-text`.

Rules of thumb: money numbers use `gain-text` / `loss-text` and always carry a sign; `--gain` /
`--loss` are for chart lines, sparklines, the tab underline and progress fills only; blue is nav and
logo only; protocol words go inside `<Details>`.

## theme.tsx

| export | what |
|---|---|
| `ThemeProvider` | Wraps the app (already inside `Providers`). |
| `useTheme()` | `{ theme: "system" \| "light" \| "dark", resolved: "light" \| "dark", setTheme }`. Persists to `localStorage.theme`, stamps `data-theme` on `<html>`, updates the `theme-color` metas. |
| `useOnThemeChange(cb)` | Fires on `data-theme` mutation or OS preference change (charts re-read tokens). |
| `THEME_SCRIPT` | Pre-paint inline script used by `app/layout.tsx`. `?theme=light\|dark` overrides for that load (screenshots) without persisting. |

## providers.tsx

`useApp()`: `connected, sessionReady, address, ensName, usdcBalance, ethBalance, connect(), disconnect(),
isIssuerFor, network { ok, name, chainId }, switchNetwork(), setWrongNetwork(bool), anon { transport,
reads, direct, lastError, since }, countRead(n), sendTx({ title, success, revert, revertTitle,
revertDetail, delayMs }), notify(title, status?, detail?)`. Toasts render one at a time at the bottom
(UI.md 2.20): pending "Check your wallet app", success headline, error headline with the decoded
error name on the grey second line.

Sign-in is real (see wallet/ below): `connected`, `sessionReady`, `address` and `ensName` come from the
signed-in account, `connect()` opens the sign-in flow and `disconnect()` ends the session. Everything
else is still mock, so the demo works with a wallet that owns nothing on chain. `sessionReady` is false
only while the session is being read; hold space rather than flashing "Sign in". `isIssuerFor` is non-empty
when the signed-in address owns the demo listings; `?issuer=1` allowlists whatever address is signed in.

## wallet/ (sign-in)

`WalletSessionProvider` (mounted inside `Providers`) and `useWalletSession()` →
`{ mode, ready, connected, address, ensName, login(), logout() }`. With a real
`NEXT_PUBLIC_PRIVY_APP_ID` it is Privy (`@privy-io/react-auth`): email with a Privy embedded wallet plus
MetaMask and other browser wallets, Sepolia only, themed from our tokens (`privy-theme.css`). Without an
app id Privy cannot initialise, so `demo-session.tsx` takes over with the same shape: a local sign-in
sheet offering email, a browser wallet, or the demo issuer account. `ens.ts` resolves reverse ENS on
mainnet; it is one cached read and every failure is null. Config is in `env.ts`; see `app/.env.example`.

## avatar/ (profile pictures)

| export | what |
|---|---|
| `UserAvatar` | `address, size=36`. The picture for an address: the uploaded one, else the generated one. Decorative, so it carries no label. |
| `GeneratedAvatar` | `address, variant=0, size` — inline SVG, flat geometric shapes on a 64-unit grid, 12 templates x 10 token palettes x 4 rotations. Same address and variant always give the same picture. |
| `EditAvatarSheet` | `open, onClose, address` — the picture large, eight variants to choose from, upload, and "Use generated picture". Opened from the Account sheet's "Profile picture" row. |
| `useAvatarPref` / `setAvatarPref` / `clearAvatarPref` | Per-address choice in `localStorage("thamba.avatar.<address>")`. Uploads are downscaled to 256x256 and stored as a data URL; nothing leaves the device. |

## shell.tsx (UI.md 2.1 to 2.3, 2.14; UX.md section 2)

| export | props | notes |
|---|---|---|
| `Logo` | `size=34` | Flat brand circle, white step glyph. |
| `Container` | `className` | Full width + 20px padding on phone, 1200px centred on desktop. Tab and detail layouts already wrap pages in it. |
| `TwoColumn` | `children, panel, panelOnMobile?` | Desktop grid 776 + 24 + 400, panel sticky under the nav. Panel hidden on phone unless `panelOnMobile`. Use on company pages; the panel holds the Buy/Sell or Apply panel. |
| `AppBar` | `title, right?, below?` | Mobile tab-screen header: 34px logo, 20/500 title, Search (icon + label), Account control. Hairline appears after scroll. Hidden at >= 1024 (TopNav takes over). `below` is the slot for a full-width search field if a screen wants one. |
| `TopNav` | none | Desktop 56px nav: logo + wordmark, Markets · Orders · Portfolio (· Console for issuers), 320px search, Account. Mounted once in `app/layout.tsx`. |
| `BottomNav` | none | Mobile 64px, 3 items, active = brand icon + label, no pill. Mounted by `(tabs)/layout.tsx`. |
| `DetailBar` | `fallback="/", right?` | 56px bar with "Back" (history, else `fallback`). Company pages leave `right` empty; Share sits with the company name. |
| `ShareButton` | `title` | Labelled Share control (Web Share API). |
| `IconButton` | `label, icon, onClick?, href?` | Icon 24 over a 13/500 label, 48x56 target. Never icon-only. |
| `AccountControl` | `compact?` | "Sign in" outlined pill when signed out; avatar + "Account" when signed in. Opens `AccountSheet`. |
| `AccountSheet` | `open, onClose` | Signed out: title "Sign in", one 56px filled "Sign in" button into the real sign-in flow, one explainer line, Appearance, About. Signed in: Signed in as / Available to spend / Sign out, Profile picture (opens `EditAvatarSheet`), Get free test USDC (< 20), Network row or "Switch to Sepolia" button (`network.ok=false`), Private browsing (opens `PrivacySheet`), Appearance segmented, Issuer console (if owner), Add to home screen (when installable), About. |
| `PrivacySheet` | `open, onClose` | The private-reads explainer (KV rows + "What this doesn't hide"). |
| `SearchButton` / `SearchSheet` | | Search sheet with `SearchField`; results are `ListRow`s to `/stock/[ticker]`. |
| `ActionBar` | `children` | Mobile fixed bottom bar (hairline top, safe-area). Put two `Button size="bar"` (sell / buy) or one. Renders nothing at >= 1024. |
| `TabHeader`, `DetailHeader` | | Deprecated aliases for `AppBar` / `DetailBar`. |

## ui.tsx (UI.md section 2)

| export | props | UI.md | notes |
|---|---|---|---|
| `cx` | strings | | class joiner |
| `TickerLogo` | `ipo? \| initials?, size=36` | 6.2 | Flat initials on `surface-2` with a hairline, radius 8. No coloured fills. (`TickerAvatar` deprecated alias.) |
| `Card` | `className, interactive?, role?` | 6.2 | 10px, 1px line, surface fill. |
| `Change` | `abs, rel, digits=2, size="sm"\|"lg"` | 7.6 | "+0.12 (1.11%)", sign always, gain-text / loss-text, tabular. |
| `ProgressBar` | `value, max, marker?` | 3.2 | 4px track, gain fill, threshold tick. (`Progress` alias.) |
| `Chip` | `selected, onClick?, href?, variant="filter"\|"range", disabled?` | 2.5 / 2.6 | 40px, 48px hit area. `href` chips use `Link replace` (URL-backed selection like `?tab=`). Range variant is borderless at rest. |
| `ChipRow` | children | 2.5 | Horizontal scroll row keeping the 20px page padding. Max one per screen. |
| `Segmented` | `options, value, onChange, label?` | 2.5 | Single-select chip row as a radiogroup (Open · Upcoming · Closed, System · Light · Dark). |
| `UnderlineTabs` | `tabs [{id,label,count?}], value, onChange, equal=true, underline="gain"\|"loss"` | 2.7 | 48px, one sliding 3px underline, count suffix in text-2. (`Tabs` alias.) |
| `ListRow` | `href?, onClick?, logo, title, sub?, right?, rightSub?, flag?, sparkline?, chevron?` | 2.9 | 64px min. `right` 18/500, `rightSub` 14/500 (pass `<Change/>`). `flag` = `{ text: "Watch"\|"Halted", tone: "warn"\|"loss" }` before the price. Whole row is the link. Wrap rows in `divide-y divide-line`. |
| `CompanyCard` | `href, logo, name, price, change?, sub?` | 2.8 | 2-col grid card (160 min). For an open IPO pass "Closes in 02:14" as `price`. |
| `IndexCard` | `href? \| onClick?, label, value, change?` | 2.4 | 68px strip card, `flex-1`. |
| `SummaryCard` | `cells [4 x {label, value, tone?}], footer? {left, right}` | 2.12 | 2x2 grid, right cells right-aligned. |
| `PromoCard` | `href? \| onClick?, icon, title, sub?` | 2.13 | Icon tile 48 + title + sub + chevron. Max one per screen. |
| `Sheet` | `open, onClose, title, children, footer?` | 2.15 | Bottom sheet on phone (10px top radius, 56px header with labelled Close, 90dvh), centred 480px modal at >= 768. Escape closes. |
| `AmountField` | `label, value, onChange, unit?, onMax?, error?, helper?, autoFocus?` | 2.16 | 72px, 24/500 value, unit suffix, "Max" text button inside. Error = loss border + caption. |
| `Slider` | `min, max, step, value, onChange, ticks? [{label}], label` | 2.16 | 2px track, gain fill, 24px flat thumb, 48px hit area. Never extend `max` past the allowed cap. |
| `SearchField` | `value, onChange, placeholder?, autoFocus?` | 2.16 | 48px outlined field with icon and a labelled Clear. |
| `Stepper` | `steps [{title, sub?}], current (1-based)` | 2.17 / 7.7 | Three circles, one-sentence `sub` under the current step. No green. |
| `StatusChip` | `ipo? \| children, halted?` | 2.18 | The only chip of its kind: outlined, text-2; "Halted" in loss. `statusLabel(ipo)` gives the plain word. (`Pill` deprecated alias.) |
| `RuleStrip` | `kind "listing"\|"surveillance"\|"one-way"\|"halted", text, onDetails?` | 2.19 | Flat full-bleed strip, 48px min, square + sentence + "Details". No animation. Prefer `CircuitBanner` which maps a policy to it. |
| `Toast` | `status, title, detail?, link?, onDismiss?` | 2.20 | Presentational; `Providers` renders it. |
| `Skeleton` | `w?, h?, className` | 2.21 | surface-2 block with opacity pulse. |
| `EmptyState` | `title, body?, action? {label, href? \| onClick?}` | 2.22 | Text first, left aligned, no icon. (`Empty` alias ignores `icon`.) |
| `KV` | `k, v, sub?, mono?` | 2.23 | 48px row, key 14 text-2, value 16/500 right (mono 14 when `mono`). Wrap in `divide-y divide-line`. (`KVRow` alias.) |
| `Details` | `title="Details", children, defaultOpen?` | UX 3 | Collapsed disclosure for addresses, versions, block numbers, protocol names. |
| `Table` | `columns [{key,label,align?,width?,render}], rows, rowKey, href?, onRowClick?, empty?` | 2.25 / 7.9 | Desktop only, 56px rows, 16px. Same data is `ListRow`s on phone. |
| `Button` | `variant "buy"\|"sell"\|"primary"\|"secondary"\|"text"\|"danger", size "bar"(56)\|"default"(48)\|"sm"(40), busy?` | 2.14 | One filled button per screen. Disabled = surface-2 fill, text-3. Legacy `tone`/`solid`/`outline` still map. |
| `TextLink` | `href? \| onClick?` | 6.2 | 14/500 gain-text link with an 8px hit pad. |
| `CopyAddress` | `value, label?` | 2.23 | Mono value + labelled "Copy" and "View" (Etherscan). |
| `SectionTitle` | `children, action?` | 6.2 | 18/500, 24 top / 12 bottom. |

## states.tsx (UX.md section 3 shared rules)

`SkeletonList({ rows })`, `SkeletonCards({ count })`, `SkeletonChart({ height })`,
`ErrorCard({ title?, body?, onRetry?, retrying? })` (plain English + Retry, never a silent fallback),
`OfflineStrip({ asOf?, force? })` (grey strip, renders nothing while online), `useOnline()`.
The wrong-network button lives in `AccountSheet` (`useApp().setWrongNetwork(true)` to demo it).

## time-chart.tsx + chart/ (UI.md section 3, UX.md 3.11)

`PriceChart` props: `data [{time, value, halted?}]`, `kind "market"\|"clearing"\|"raised"`,
`type "line"\|"bars"` (candles, market only), `baseline?` (dotted line at the window open, or the
issue price on an IPO), `reference?` (`RefPoint[]` → the trading limits from `bandBps`), `showBand?`
(force the limits on/off), `lines? [{price, label?}]` (floor / cap / minimum raise, dashed,
right-edge labels, pinned to the edge with a caret when off-scale), `rejects? number[]` (times inside
the window, drawn as 9px red x), `height=280`, `digits=2`, `onHover(p | null)`, `readout=true`,
`labels=true` (right-edge level labels), `axes=false` (time axis, Expand only), `detail=false`
(Expand only: adds the dotted reference step line).
`baseline?` (dotted: range start, or the issue price on an IPO), `reference?`
(`RefPoint[]` → dotted step line + shaded band from `bandBps`; directional draws the zone a swap may land in (no further from the
reference than now or within 5%, always inside the band); halted spans draw no band), `showBand?`, `lines? [{price, label?}]` (floor / cap /
minimum raise, dotted, right-edge labels), `rejects? number[]` (times, clamped to the nearest point,
drawn as 9px red x), `height=280`, `digits=2`, `onHover(p | null)`, `readout=true` (24px line above
the chart: time left, 18/500 value right), `labels=true` (H / L / last), `axes=false` (time axis for
Expand), `onExpand?` (labelled Expand button, mobile only). Line is 3px (2.5 visual) and coloured by
last >= first of the data passed. Chart is created once per theme / kind / height; data changes go
through `setData` and the primitive, never a rebuild. Hover never rebuilds.

**The price scale is the data's own low and high in the selected window** (plus 12% scale margins).
Limits, levels and the baseline never widen it; an off-scale level is clipped and its label pinned at
the edge with ↑ / ↓. Nothing else is drawn: no H / L labels, no last-price box, no band fill, no time
axis inline. The line is 3px (2.5 visual) and coloured by the change over the window.

A window or type change **tweens** (340ms ease-out, instant under `prefers-reduced-motion`):
`chart/series.ts` resamples both windows onto one grid of OHLC bars (`Shape`) and interpolates values,
times, the price window, the overlay and the line / candle alphas; candles grow out of the line.
The chart object is created once per theme / kind / height — never rebuilt on a range or type change.

`chart/controls.tsx`: `RangeChipRow({ value, onChange, options })` (the window chips: 5m, 15m, 30m,
1H, 1D, 1W, All — one row, no scrolling), `ChartTypeToggle({ value, onChange })` (Line | Bars),
`useChartType()` (remembered in `localStorage["thamba.chartType"]`), `ExpandButton({ onClick })`.
`chart/skeleton.tsx`: `ChartSkeleton({ height })`, shaped like the finished block so nothing shifts.
`chart/overlay.ts`: the series primitive drawing halt columns, the baseline, limits and reject marks.

`RangeChips({ value, onChange, options })` is the short toggle (Price / Subscription).
`sliceRange(points, range, nowSec)`, `RANGE_SECONDS`, `RANGE_OPTIONS`, `RANGE_WORDS`.
`FullscreenChart({ open, onClose, title, chart: (height) => node, footer })` is the Expand view.

`sparkline.tsx`: `Sparkline({ points, width=84, height=32, up?, max=72, seconds=86400 })`, 2.5px,
coloured by `up` (pass the row's change sign) or last >= first. When the points carry `time` it draws
the last `seconds` of the series, evenly sampled to `max` points, so the line matches the change
printed beside it whatever the data's resolution.

`circuit-banner.tsx`: `CircuitBanner({ ticker, policy })` = `RuleStrip` + "Trading rule" sheet
(sentence, why, changed time, allowed range, collapsed Details). Renders nothing on Normal.
`ruleCopy(policy)` returns the plain-English `{ kind, label, text, why }` or null.

## Layout and routes

- `app/layout.tsx`: Roboto, pre-paint theme script, `Providers`, `TopNav`, no width wrapper.
- `(tabs)/layout.tsx`: `Container` + bottom padding + `BottomNav`. Routes: `/` (Markets, `?tab=stocks|ipo`),
  `/orders`, `/portfolio`, `/console`, `/console/[ticker]`.
- `(detail)/layout.tsx`: `Container` + room for the `ActionBar`. Routes: `/stock/[ticker]` (every phase), `/about`.
- `next.config.ts` redirects: `/market` → `/`, `/market/:t` and `/ipo/:t` → `/stock/:t`, `/bids` → `/orders`.
- Pages with `useSearchParams` must sit under a `<Suspense>` (cache components); see `(tabs)/page.tsx`.

## Deprecated shims to delete once screens are rewritten

`TickerAvatar`, `Pill`, `FilterChip`, `Tabs`, `Progress`, `Empty`, `KVRow`, `TabHeader`, `DetailHeader`,
the `tone` / `solid` / `outline` props on `Button`, the ignored `size` prop on `Segmented`.
