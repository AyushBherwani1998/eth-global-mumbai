# Listing Day UI spec (Groww parity, light + dark, phone + desktop)

Source of truth: `design/reference/TOKENS.md` and the four screenshots in `design/reference/`.
The old `design.md` is superseded: blue #5076EE is NOT the accent and Inter is NOT the face.
Green #00B386 is the action colour, blue #5367FF is nav/brand only, Roboto is the face.

Groww in one sentence: white ground, 1px #E8E8E8 outlines at 10px radius, no shadows, black text with
grey secondary, green and red only when money moves, blue only on the active nav item, grey chips,
green tab underline, big plain numbers, whitespace, dotted separators, list rows with a right value column.

Engineer rules that apply everywhere:
- No gradients, no blur, no shadow, no soft tinted status backgrounds, no emoji, no decorative icons.
- Colour is never the only carrier of meaning: every gain/loss number carries a + or - sign.
- Numbers use `font-variant-numeric: tabular-nums` (class `num`) everywhere a value can change.
- Page padding 20px on phone. Desktop content lives in a centred 1200px container.

---------------------------------------------------------------------------------------------------

## 1. Token system

### 1.1 Palette (CSS custom properties)

Light is defined on bare `:root`. Dark is the same set redefined twice (media query guarded with
`:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`), matching the existing globals.css.

```css
:root {
  /* ground */
  --bg: #FFFFFF;            /* page */
  --surface: #FFFFFF;       /* cards, sheets, nav (same as bg in light) */
  --surface-2: #F5F5F5;     /* icon tiles, hover rows, skeleton, expand button, halt strip */
  --line: #E8E8E8;          /* every outline and separator */
  --line-strong: #D0D0D0;   /* dotted separators, input borders, slider thumb ring */
  /* text */
  --text: #000000;          /* names, prices, titles */
  --text-2: #767676;        /* labels, captions. Groww measures #919191 (2.8:1); #767676 is 4.54:1 */
  --text-3: #919191;        /* placeholders and disabled text only */
  /* money: Groww hue for lines and fills, a darker step for anything that is text (see section 7) */
  --gain: #00B386;          /* chart line up, sparkline up, tab underline, progress fill */
  --loss: #F35D5D;          /* chart line down, sparkline down, halt square */
  --gain-text: #00805F;     /* gain numbers, text links. 4.9:1 */
  --loss-text: #D23232;     /* loss numbers, Halted word. 4.95:1 */
  --buy: #00805F;           /* Buy button fill, white label 4.9:1 (same in dark) */
  --sell: #D23232;          /* Sell button fill, white label 4.95:1 (same in dark) */
  /* brand */
  --brand: #5367FF;         /* active bottom-nav icon, desktop nav underline, logo mark. Nothing else. */
  --brand-text: #4556E6;    /* active nav label. 5.6:1 */
  --warn: #A66200;          /* Surveillance / Directional word, rejected-bid reason. 4.8:1 */
  /* chips */
  --chip-on-bg: #EBEBEB;
  --chip-on-line: #222222;
  /* chart only (the only "soft" fills Groww-style UI tolerates; never on buttons or chips) */
  --gain-fill: rgb(0 179 134 / 0.10);   /* raise-progress area */
  --loss-fill: rgb(243 93 93 / 0.08);   /* halt column */
  --band-fill: rgb(0 0 0 / 0.04);       /* allowed trading band */
  --overlay: rgb(0 0 0 / 0.50);
  --inverse-bg: #000000;    /* toast */
  --inverse-text: #FFFFFF;
  color-scheme: light;
}

:root[data-theme="dark"],
/* and the same block under @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} } */
{
  --bg: #121212;
  --surface: #1A1A1A;
  --surface-2: #242424;
  --line: #2C2C2C;
  --line-strong: #3A3A3A;
  --text: #FFFFFF;
  --text-2: #8F8F8F;        /* 5.8:1 on #121212, 5.4:1 on #1A1A1A */
  --text-3: #6B6B6B;
  --gain: #0FCB9A;          /* 8.9:1 */
  --loss: #FF6B6B;          /* 6.7:1 */
  --gain-text: #0FCB9A;     /* same as gain in dark */
  --loss-text: #FF6B6B;
  --buy: #00805F;           /* 3.8:1 against the ground, white label 4.9:1 */
  --sell: #D23232;
  --brand: #7B8BFF;         /* 6.2:1 */
  --brand-text: #7B8BFF;
  --warn: #F5A623;          /* 9.2:1 */
  --chip-on-bg: #2A2A2A;
  --chip-on-line: #E6E6E6;
  --gain-fill: rgb(15 203 154 / 0.12);
  --loss-fill: rgb(255 107 107 / 0.10);
  --band-fill: rgb(255 255 255 / 0.05);
  --overlay: rgb(0 0 0 / 0.65);
  --inverse-bg: #2C2C2C;
  --inverse-text: #FFFFFF;
  color-scheme: dark;
}
```

Contrast (hand-checked, WCAG relative luminance):

| token | light on #FFF | dark on #121212 | note |
|---|---|---|---|
| text | 21:1 | 18.7:1 | |
| text-2 | 4.54:1 | 5.8:1 | Groww's #919191 fails (2.8:1); keep it only as text-3 |
| gain (lines only) | 2.7:1 | 8.9:1 | Groww-exact; never used for text in light |
| gain-text | 4.9:1 | 8.9:1 | every green number and link |
| loss (lines only) | 3.2:1 | 6.7:1 | never used for text in light |
| loss-text | 4.95:1 | 6.7:1 | every red number, the Halted word |
| white on buy / sell | 4.9:1 / 4.95:1 | 4.9:1 / 4.95:1 | button labels |
| brand | 4.4:1 | 6.2:1 | icon and underline only (3:1 non-text rule) |
| brand-text | 5.6:1 | 6.2:1 | active nav label |
| warn | 4.8:1 | 9.2:1 | |

Tailwind v4 mapping (`@theme inline`): `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-line`,
`--color-line-strong`, `--color-text`, `--color-text-2`, `--color-text-3`, `--color-gain`, `--color-loss`,
`--color-gain-text`, `--color-loss-text`, `--color-buy`, `--color-sell`, `--color-brand`, `--color-brand-text`,
`--color-warn`. Delete `--bg-subtle`, `--card`, `--fg`, `--fg-strong`, `--muted`,
`--brand-soft`, `--gain-soft`, `--loss-soft`, `--warn-soft`, `--shadow`.

### 1.2 Radius, spacing, hairlines

- Radius: `--r-card: 10px` (cards, buttons, inputs, sheets' top corners, modal), `--r-sm: 8px`
  (icon tiles, logo tiles, toast), `--r-chip: 999px` (chips, avatars, expand button).
- Spacing scale: 4, 8, 12, 16, 20, 24. Page padding 20. Section gap 24. Grid gap 20 (cards), 16 (index strip).
- Lines: 1px solid `--line`. Dotted separator: `border-top: 1px dotted var(--line-strong)`.
  Elevation does not exist: no shadows anywhere, in either theme. Layering is expressed by lines.

### 1.3 Type

Face: Roboto (the Figma file uses Roboto and Groww's own grotesk is a Roboto-class face). Load once:

```ts
// app/layout.tsx
import { Roboto } from "next/font/google";
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", display: "swap" });
<html lang="en" className={`${roboto.variable} antialiased`}>
```
```css
/* globals.css @theme inline */
--font-sans: var(--font-roboto), Roboto, system-ui, -apple-system, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;  /* no extra font download */
```
Static Roboto has no 600: where TOKENS.md says 600, use 500. Letter-spacing is 0 everywhere
(remove the -0.02em heading rule). Headings are 500, never 700, except price-large.

Minimums (section 7): body 16, secondary 14, captions 13, nothing smaller anywhere.

| role | size/weight/line | colour | where |
|---|---|---|---|
| page-title | 22/500/28 | text | top bar "IPOs", "Markets" |
| section-title | 18/500/24 | text | "Listed", "Investments (4)" |
| card-title | 17/500/22 | text | 2-col company card name |
| list-title | 16/500/22 | text | list row name, promo card title |
| body | 16/400/24 | text | descriptions, sheet copy |
| price-large | 32/500/38 | text | detail header price |
| price-row | 16/400/22 | text | row / card price |
| change-lg | 16/500/22 | gain-text or loss-text | detail header change |
| change-sm | 14/500/20 | gain-text or loss-text | card and row change |
| label | 14/400/20 | text-2 | summary card labels, KV keys, row secondary |
| label-sm | 13/500/18 | text | index card label |
| caption | 13/400/18 | text-2 | timestamps, helper text, chart labels |
| nav-label | 13/500/16 | brand-text or text-2 | bottom nav |
| chip | 15/500/20 | text | filter and range chips |
| tab | 15/500/20 | text or gain-text | underline tabs |
| button | 17/500/22 | white | Buy / Sell / Place bid |
| input-value | 24/500/30 | text | amount fields (desktop order panel 18/500/24 labels, 24 value) |
| readout | 18/500/24 | text | chart hover value |
| mono-data | 14/400/20 | text | addresses, tx hashes, ENS records |

---------------------------------------------------------------------------------------------------

## 2. Components

Dimensions below were raised for the legibility addendum (section 7): chips 40, rows 64, nav 64,
action buttons 56, every tap target at least 48x48. Section 7 wins where a number here is smaller.

Legend for states: default / hover (pointer only) / pressed / disabled / active.
Hover on anything flat = background `--surface-2`. Pressed = `filter: brightness(0.94)` for filled
buttons, background `--surface-2` for flat items. Disabled = text `--text-3`, border `--line`, fill
`--surface-2`, no opacity tricks. Focus-visible = 2px solid `--text` outline, offset 2px (not brand).

### 2.1 Top app bar

Mobile (tab screens), height 56 + safe-area top, padding 0 20, solid `--bg`, no blur, no border.
A 1px `--line` bottom edge appears only after the page has scrolled (toggle a class at scrollY > 0).

```
+------------------------------------------------------+
| (34) IPOs                        [search] [qr] (34)  |   logo 34 round, title 20/500, gap 12
+------------------------------------------------------+   icons 24px in 48px targets, gap 4, avatar 36
```
- Logo: 34px circle filled `--brand`, white 2.5px stroke "step-up" glyph (three joined segments). Flat.
- Right: "Search" (icon 24 + 13/500 label under it, 48x48 target), then the account control. Signed in:
  36 round avatar, `--surface-2` fill, 1px `--line`, initial of the ENS name in 15/500 `--text`, with
  the 13/500 label "Account" under it. Signed out: a 40px-high text button "Sign in", 15/500, outlined
  `--line`, radius 999, padding 0 16. No QR icon.

Mobile (detail screens), height 56: back arrow 24px at left (48 target, the only icon-only control
in the app), nothing else in the bar. The logo row 24px below holds the ticker tile at left and, at
right, labelled icon buttons "Alert" and "Watch" (icon 24 over a 13/500 label, 48x56 target each).

Desktop (>= 1024px) top nav, height 64, full width, bottom 1px `--line`, content in the 1200 container:
```
| (34) Listing Day   IPOs   Markets   My bids   Portfolio   [ Search a ticker........ ]   (34) |
```
Links 16/500 `--text`; active link has a 2px `--gain` underline 8px below baseline. Search: 400x40,
outlined 1px `--line`, radius 10, icon 18 `--text-2`, placeholder `--text-3`. No bottom nav on desktop.

### 2.2 Bottom nav (mobile only)

Fixed, height 64 + safe-area bottom, `--surface`, 1px `--line` top, no blur. Four items, equal width:
Markets, IPOs, My bids, Portfolio (Markets first: it is the primary tab). Console is reached from the
account sheet when `isIssuerFor` is set.
```
|   [icon]        [icon]        [icon]        [icon]   |   icon 26 (stroke 1.75), label 13/500 4px below
|  Markets         IPOs        My bids      Portfolio |   active: icon --brand, label --brand-text; inactive --text-2
```
No tile behind the active icon, no dot, no badge. Active stroke 2.

### 2.3 Desktop layout grid

Container 1200px centred, padding 0 24 below 1248px viewport. Two columns: left 776, gap 24, right 400.
Right column is `position: sticky; top: 88px` and holds the order / bid panel (2.17) on detail pages,
the summary card on list pages. Below 1024px the right column stacks under the left and the fixed
Buy/Sell bar returns. Lists use the full 776 column; the 2-col company grid becomes 3-col at >= 1024px
(three 243px cards, gap 20).

### 2.4 Index strip cards

Two outlined cards side by side at the top of IPOs and Markets, each `flex: 1`, height 68, padding 12 16,
radius 10, 1px `--line`, gap 16. Horizontal scroll with more than two (snap, no scrollbar).
```
+--------------------------+  +--------------------------+
| ACME                     |  | BOLT                     |   label-sm 12/500 text
| 1.234  +0.234 (23.4%)    |  | 0.912  -0.088 (8.8%)     |   value 12/400 text, change 12/400 gain/loss
+--------------------------+  +--------------------------+
```
Pressed: background `--surface-2`. Whole card is the link.

### 2.5 Filter chips (and the Stocks | IPO segmented row)

Height 40, padding 0 18, radius 999, 15/500, gap 8. Default: 1px `--line`, text `--text`, transparent.
Selected: fill `--chip-on-bg`, 1px `--chip-on-line`, text `--chip-on-line` (dark: `--text`).
Hover: fill `--surface-2`. Pressed: 120ms background. Disabled: text `--text-3`.
Row: horizontal scroll, gap 8, page padding preserved with negative margins, no fade masks.
```
( Explore )  ( Live auction )  ( Listed )  ( Upcoming )
 ^selected
```
"Stocks | IPO" inside Markets is this same row, single-select, first thing under the index strip.
Groww uses this chip row as its segmented control; do not build a pill-slider segmented control.

### 2.6 Range chips (chart: 1D 1W 1M ALL)

Height 40, min-width 52, padding 0 14, radius 999, 15/500. Default: no border, text `--text-2`.
Selected: fill `--chip-on-bg`, 1px `--chip-on-line`, text `--text`. Gap 8. Left-aligned under the chart.
On a listed company this is the screen's one chip row; the Stocks | IPO row lives on the Markets list.

### 2.7 Underline tabs

Height 48, label 15/500, equal widths on mobile (`flex: 1`), auto width with padding 0 24 on desktop.
Inactive text `--text`. Active text `--gain` with a 3px `--gain` underline spanning the tab width;
the underline is one element that translates between tabs in 200ms. Container has a 1px `--line` bottom.
Count suffix: " 3" in `--text-2`. No pill, no background.
```
   Overview        Trades        Rejected 2        ENS
   ==========
```

### 2.8 Company card (2-col grid)

Width `(100% - 20px) / 2`, min-height 160, padding 16, radius 10, 1px `--line`, no fill in light,
`--surface` fill in dark. Grid gap 20.
```
+------------------------+
| [36]                   |   ticker tile 36, radius 8, flat avatar.bg fill, initials 13/700 avatar.fg
|                        |
| Acme Tools             |   card-title 16/500, mt 20, single line ellipsis
| 1.234                  |   price-row 15/400, mt 8  (unit "USDC / lot" is NOT repeated per card)
| +0.234 (23.4%)         |   change-sm 13/500 gain/loss, mt 4
+------------------------+
```
Live auction variant: replace price line with "Ends in 02:14" caption, change line with the clearing
price. No countdown pill, no progress bar inside the card (progress lives on the detail page).
Hover: 1px `--line-strong`. Pressed: background `--surface-2`.

### 2.9 List row

Min-height 64, padding 12 0 (separators are full-width 1px `--line` inside the card, or dotted
`--line-strong` between sections). Columns: tile 40, text (flex 1), sparkline 84x32, value 104 right.
```
| [40]  Acme Tools                  ~~/\/~~    1,234.00  |   list-title 16/500 ; price-row 16/400 right
|       Listed · Normal                      +23.40%     |   label 14/400 text-2 ; change-sm 14/500 right
```
Sparkline hidden under 360px. Status words in the sub line are plain text (not a chip).
Right column is right-aligned and tabular. Whole row is the link; hover `--surface-2`.

### 2.10 Company detail header

```
<-                                              (bar, 56)
                                                (24 gap)
[40]                              [Alert]  [Watch]       labelled icon buttons, 48x56
                                                (32 gap)
Acme Tools                                      name 22/400 text
1,234.00                                        price-large 32/500, mt 12, unit "USDC per lot" 16/400 text-2 after
+234.00 (23.40%)  Today          ( Tools )      change-lg 16/500 + range word 16/400 text-2 ; sector chip right
```
Sector chip: outlined 1px `--line`, radius 10, padding 4 10, 13/500 `--text-2`. It is the only
chip on this header. The ENS name goes to the ENS tab, not under the title.
While hovering the chart the price and change show the hovered values and the "1D" label becomes the
hovered time "14:32 IST".

### 2.11 Chart block (layout; drawing rules in section 3)

```
                                                        
   price line, baseline dotted, band shaded             height 300 (desktop 360)
                                        [ Expand ]      48 tall, --surface-2, radius 999, icon 18 + 13/500 label, bottom-right 12/12
 . . . . . . . . . . . . . . . . . . . . . . . . . .    1px dotted --line-strong, mt 8
 (1D) (1W) (1M) (ALL)                                   range chips, mt 12
 Band 0.95 to 1.05 · Normal · ref 1.00                  caption 12/400 text-2, mt 8 (replaces the legend row)
```
No legend swatches, no "v4 POOL" / "CCA" labels, no NSE|BSE toggle equivalent.
Readout line: during hover a 24px line sits directly above the chart: left "12 Nov, 14:32 IST" in
caption 13/400 `--text-2`, right "1,234.00" in readout 18/500 `--text`. Hidden otherwise (reserve
the 24px, do not shift the chart). The header price also switches to the hovered value.

### 2.12 Summary card (2x2)

Outlined 10px, padding 16. Two rows of two cells; left cell left-aligned, right cell right-aligned.
Label 14/400 `--text-2`, value 16/500 `--text` 4px under. Row gap 16. Optional footer row above a
1px `--line`: "XIRR 37.67%" left, text link right in 14/500 `--gain` with a 16px icon.
```
+------------------------------------------------+
| Current                         Total returns  |
| 2,14,720                   +52,129 (32.06%)    |   gains in --gain
|                                                |
| Invested                          1D returns   |
| 1,62,592                    +689.07 (0.32%)    |
|------------------------------------------------|
| XIRR  37.67%               [icon] Analysis ->  |
+------------------------------------------------+
```
Used for: Portfolio totals, IPO raise summary (Raised / Target / Bids / Applicants), issuer console status.

### 2.13 Promo / info card

Outlined 10px, padding 16, min-height 88. Icon tile 48, radius 10, `--surface-2`, 20px icon `--text`.
Title list-title 15/500, sub caption 13/400 `--text-2`, chevron-right 20 `--text-2`.
```
+------------------------------------------------+
| [48]  Create a bid                          >  |
|       Budget, max price, one wallet approval   |
+------------------------------------------------+
```
Used for: "Create a bid", "Verify once" (World ID), "Get test USDC" (only when balance is low),
"You hold 1,200 ACME", "Issuer console". Max one promo card per screen above the tabs.

### 2.14 Buy / Sell fixed bar (mobile) and the desktop order panel

Mobile: fixed bottom, `--surface`, 1px `--line` top, padding 12 20 + safe-area, two buttons 50/50 gap 16.
Button: height 56, radius 10, 17/500 white. Sell fill `--sell`, Buy fill `--buy`. Always visible on a
listed company, without scrolling, on every viewport.
Single action (Place bid, Claim): one full-width `--gain` button. Secondary actions (Exit bid): outlined
1px `--line-strong`, text `--text`, same height. Disabled: fill `--surface-2`, text `--text-3`.
Busy: label becomes "Waiting for wallet" with a 16px spinner at left, button stays enabled-looking.
```
|  [      Sell       ]  [       Buy        ]  |
```
Desktop: the right sticky panel is an outlined card: underline tabs "Buy | Sell" (Sell's underline is
`--loss`), fields (2.16), KV rows (2.23), then the same 52px button full width at the bottom of the
card. Padding 20. Field labels 18/500, values 24/500, KV rows 16/400 (section 7.9).

### 2.15 Bottom sheet (mobile) / modal (desktop)

Sheet: slides from bottom, `--surface`, top radius 10, 1px `--line` top (no handle bar), header 56 with
title 18/500 and a 24px close icon at right, body padding 0 20 20, footer above a 1px `--line` with
padding 12 20 + safe area. Max height 90dvh. Overlay `--overlay`, no blur.
Modal (>= 768px): centred, width 480, radius 10, 1px `--line`, same header/body/footer. No shadow.

### 2.16 Inputs

Amount field: height 72, outlined 1px `--line-strong`, radius 10, padding 12 16.
Label 14/400 `--text-2` top, value 24/500 `--text` tabular, unit suffix 16/400 `--text-2` right-aligned
on the value line. Focus: 1.5px `--text` border, no ring. Error: 1px `--loss` border + 12/400 `--loss`
helper below. "Max" is a 14/500 `--gain` text button inside the field, not a chip.
```
+----------------------------------+
| Budget                           |
| 5.00                      USDC   |
+----------------------------------+
```
Slider: 2px track `--line`, filled part `--gain`, thumb 20 round `--surface` with 1px `--line-strong`,
no shadow. Tick labels under in caption `--text-2` (Floor 0.80 · Clearing 1.12 · Cap 1.90).
Search input: height 44, outlined `--line`, radius 10, icon 18, suffix ".listingday.eth" 14/400 `--text-2`.

### 2.17 Stepper (3 wallet approvals)

Horizontal, three steps, used inside the sheet footer above the button.
```
 (v)----(2)----( 3 )
 Enable  Approve  Submit
```
Circle 20: done = `--text` fill, white 12px check; current = 1.5px `--text` outline, number 11/500;
upcoming = 1px `--line` outline, number `--text-2`. Connector 1px `--line` (done segments `--text`).
Labels 12/500, current `--text`, others `--text-2`. No green in the stepper.

### 2.18 Status chip (the only chip of its kind)

Height 24, padding 0 8, radius 999, 1px `--line`, 12/500 `--text-2`, label only.
Exception: "Halted" gets `--loss` text and `--loss` border. No dot, no icon, no fill, never animated.
Allowed on: the Upcoming list rows (Upcoming / Refunding), the My bids rows (Active / Outbid / Filled /
Refundable / Claimed), the detail header for an IPO in auction ("Live"). Not allowed in the 2-col grid,
the index strip, or next to a title that already says the same thing.

### 2.19 Circuit / halt banner

A flat full-bleed strip (negative page margins), height 40, background `--surface-2`, 13/500, padding 0 20.
Leading 8px square in the mode colour (`--loss` halted, `--warn` surveillance / directional),
leading word in that colour, rest of the sentence `--text`, right: "Details" 13/500 `--text-2`.
```
|  ■ Halted  Swaps revert. LP exits stay open.                  Details  |
```
Shown only for halted, surveillance, directional. Normal and listing modes get no strip; the band
caption under the chart (2.11) carries the information. No icon, no animation on change, no border.
Tap opens the circuit sheet (KV rows). On the IPO list, alerts are list rows with the status word
in colour, not banners.

### 2.20 Toast

Bottom, above the nav / action bar, width `100% - 40px`, max 440 centred, height 48, radius 8,
`--inverse-bg` with `--inverse-text` 14/500, padding 0 16, optional 16px check or x icon at left.
Slide up 160ms, auto-dismiss 3s, one at a time, replaces the previous. Desktop: bottom-left of the
container.

### 2.21 Skeleton

Blocks of `--surface-2`, radius 8, sized to the real text line (height = line-height, width 40..80%).
Opacity pulse 1 to 0.6, 1.2s. No shimmer sweep. Cards keep their 1px `--line` while loading.

### 2.22 Empty state

Left-aligned text block, padding 24 0: title 15/500 `--text`, body 14/400 `--text-2` 4px under,
optional text link 14/500 `--gain` 12px under. No icon, no circle, no illustration, not centred.
```
No holdings yet
Shares you are allotted in an IPO show up here after you claim them.
Go to My bids
```

### 2.23 Key / value rows

Row min-height 44, padding 10 0, key 14/400 `--text-2` left, value 14/500 `--text` right (tabular).
Optional sub under the value in caption `--text-2`. Rows separated by 1px `--line`. Mono values use
`--font-mono` 13/400. Copy and external-link icons 16 `--text-2`, 32px targets, at the right of the value.

### 2.24 Issuer console step list

Vertical list, each step a 56px row: circle 24 at left (same rules as the stepper), title 15/500,
chevron 20 `--text-2` right, 1px `--line` connector between circles. Open step expands below with
KV rows and at most one outlined secondary button. Current step title `--text`, others `--text-2`.
Runner status is a KV row "Runner  Online", not a pill with a pulsing dot.

### 2.25 Table (desktop)

Header 40px, 13/400 `--text-2`, no uppercase, 1px `--line` under. Rows 48px, 14/400 `--text`,
numeric columns right-aligned tabular, row separators 1px `--line`, hover `--surface-2`.
First column is the name (tile 28 + text), last column the action (text link 14/500 `--gain`).
Used for: Trades, Rejected swaps, My bids, console bids. On mobile the same data is list rows.

---------------------------------------------------------------------------------------------------

## 3. Charts

The chart is the hero of every detail page. It is a Groww line chart: one line, no grid, no axes,
no fill under the line, dotted baseline, three tiny labels, and the readout lives in the page header.

### 3.1 Listed company (Markets detail)

Layers, bottom to top:
1. Halt shading: a full-height column over every interval where `PricePoint.halted` is true,
   fill `--loss-fill`. Edges sharp, no border.
2. Band: the allowed range `ref * (1 +- bandBps/10000)` over time, drawn as a shaded step polygon,
   fill `--band-fill`, no outline. Surveillance narrows the band (smaller bps), so it simply gets
   tighter; directional mode draws where a swap may land: no further from the reference than now,
   or within 5% of it, and always inside the 20% band (ListingHook `DirectionalWidening`);
   halted draws no band for that span.
3. Reference: dotted step line, 1px, colour `--text-2` (not blue).
4. Issue price baseline: dotted horizontal line, 1px, `--line-strong`, across the full width.
5. Price line: 2.5px, colour `--gain` if last >= issue price else `--loss` (one colour for the whole
   line; no two-tone baseline series, no area fill).
6. Reverted swaps: small red x, 7px, 1.5px stroke, `--loss`, centred on the price at that time.
7. Labels (HTML, absolutely positioned over the chart): "H 1.312" at the max point (above it),
   "L 1.044" at the min point (below it), last value "1.234" at the right edge level with the line.
   All caption 12/400 `--text-2`, tabular. Nothing else is labelled.

### 3.2 IPO in auction (IPO detail)

View "Clearing": step line (`LineType.WithSteps`) of the clearing price, 2px, `--gain` if last >= issue
else `--loss`. Floor and cap: dotted 1px `--line-strong` lines with right-end labels "Cap 1.90" and
"Floor 0.80" in caption `--text-2`. Issue price: the dotted baseline as above.
View "Raised": line 2px `--gain` with an area fill `--gain-fill` to zero; the graduation threshold is a
dashed 1px `--text-2` line labelled "Graduates at 10" at its right end. Under the chart a plain
progress bar: height 4, track `--line`, fill `--gain`, threshold tick 1px x 10px `--text`.
Not started: no chart; a 160px block with the caption "Auction starts at block 7,912,340" left-aligned.

### 3.3 Sparklines (lists)

84x32, last 72 points, 2.5px stroke, round joins, no fill, no dots, no baseline. Colour: `--gain` if
the row's displayed change is positive else `--loss` (same rule as the number next to it). Never
draws band, halts or markers. Hidden under 360px.

### 3.4 Colours in both themes

| element | light | dark |
|---|---|---|
| price line up / down | #00B386 / #F35D5D | #0FCB9A / #FF6B6B |
| reference step | #767676 dotted | #8F8F8F dotted |
| issue baseline, floor, cap | #D0D0D0 dotted | #3A3A3A dotted |
| band fill | rgb(0 0 0 / .04) | rgb(255 255 255 / .05) |
| halt fill | rgb(243 93 93 / .08) | rgb(255 107 107 / .10) |
| raise area fill | rgb(0 179 134 / .10) | rgb(15 203 154 / .12) |
| crosshair line | #D0D0D0 solid | #3A3A3A solid |
| crosshair dot | 4px radius, line colour, 2px `--bg` ring | same |
| labels | #767676 | #8F8F8F |

### 3.5 Axes and labels policy

Both price scales hidden, time scale hidden, grid off, no watermark text. `fixLeftEdge` and
`fixRightEdge` true, `fitContent()` after data. Scale margins top 0.14 / bottom 0.14 so H and L labels
have room. Range chips: 1D, 1W, 1M, ALL (replace 1H / 4H). The chart's own tooltip / axis labels
are off; the readout is the header price plus the 20px readout line (2.11).

### 3.6 Hover and crosshair

Mouse: crosshair follows in magnet mode; vertical 1px solid line, horizontal line off, axis labels off,
dot on the series. Leaving the chart clears the readout and restores the live price.
Touch: the page must still scroll vertically over the chart. Long-press (LWC default) shows the
crosshair and the readout follows the finger; lift clears it. Container gets `touch-action: pan-y`.
Range chips do not re-animate the line; data swaps instantly.

### 3.7 Expand to fullscreen (mobile)

The 40px expand button opens a fixed full-screen view (not a sheet): 56px bar with back arrow, name,
and the price readout at right; chart fills the remaining height; range chips at the bottom.
Try `screen.orientation.lock("landscape")` inside try/catch and ignore failures. Back closes it.
Desktop: the button is hidden; the chart is already 360px in a 776px column.

### 3.8 Lightweight Charts v5 settings

```ts
createChart(el, {
  autoSize: true, height,
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: t.text2,
            fontFamily: "Roboto, system-ui, sans-serif", fontSize: 13, attributionLogo: true },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { visible: false, scaleMargins: { top: 0.14, bottom: 0.14 } },
  leftPriceScale: { visible: false },
  timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
  crosshair: { mode: CrosshairMode.Magnet,
               vertLine: { color: t.lineStrong, width: 1, style: LineStyle.Solid, labelVisible: false },
               horzLine: { visible: false, labelVisible: false } },
  handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
  handleScale: false,
  trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
});
```
Series (add in this order so z-order is right):
- Halt column: `HistogramSeries` on an overlay scale: `priceScaleId: "halt"`, `base: 0`, value 1 at every
  halted point (0 elsewhere so bars are contiguous), `color: t.lossFill`, `priceLineVisible: false`,
  `lastValueVisible: false`, `autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } })`,
  then `chart.priceScale("halt").applyOptions({ scaleMargins: { top: 0, bottom: 0 } })`.
- Band: a series primitive attached to the price series (`series.attachPrimitive(new BandPrimitive(...))`):
  `paneViews()` returns one view with `zOrder: "bottom"`; its renderer takes `(time, lo, hi)` steps,
  converts with `series.priceToCoordinate` and `chart.timeScale().timeToCoordinate`, and fills the
  polygon between the two step paths with `t.bandFill` inside `target.useMediaCoordinateSpace`.
  Fallback with zero custom drawing: two `AreaSeries` with `lineType: LineType.WithSteps`, upper filled
  `t.bandFill`, lower filled opaque `t.bg`, both `lineVisible: false` and `crosshairMarkerVisible: false`.
- Reference: `LineSeries`, `lineWidth: 1`, `lineStyle: LineStyle.Dotted`, `lineType: LineType.WithSteps`,
  `color: t.text2`, `crosshairMarkerVisible: false`, `lastValueVisible: false`, `priceLineVisible: false`.
- Price: `LineSeries`, `lineWidth: 3` (v5 accepts 1 to 4 integers; 3 reads as the 2.5 target on 2x screens), `color: up ? t.gain : t.loss`, `lastValueVisible: false`,
  `priceLineVisible: false`, `crosshairMarkerVisible: true`, `crosshairMarkerRadius: 4`,
  `crosshairMarkerBorderColor: t.bg`, `crosshairMarkerBorderWidth: 2`, `lineType` `Simple` (market)
  or `WithSteps` (clearing). Raised view: `AreaSeries` with `lineColor: t.gain`, `topColor: t.gainFill`,
  `bottomColor: "transparent"`.
- Baselines (issue, floor, cap, threshold): `series.createPriceLine({ price, color, lineWidth: 1,
  lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" })`; labels are HTML.
- Reverted swaps: primitive drawing two 7px strokes in `t.loss` at `(timeToCoordinate, priceToCoordinate)`.
  Quick fallback: `createSeriesMarkers(series, [{ time, position: "inBar", shape: "circle", color: t.loss, size: 0.5 }])`.
- Autoscale: one `autoscaleInfoProvider` on the price series returning min/max over data, band edges
  and baselines, so nothing is clipped.
- Theme: tokens are read with `getComputedStyle` at create time; re-create on `prefers-color-scheme`
  change AND on a `MutationObserver` for `data-theme` on `<html>`.
- H / L / last labels: after `fitContent()`, position with `series.priceToCoordinate(v)` and
  `chart.timeScale().timeToCoordinate(t)`; re-run on `chart.timeScale().subscribeSizeChange`.

TradingView attribution: keep `attributionLogo: true` (licence). It renders bottom-left inside the
chart; keep our expand button bottom-right so they never overlap, and keep 12px clear space on the
left edge. The NOTICE text stays on /about.

---------------------------------------------------------------------------------------------------

## 4. Dark mode

What flips: bg, surface, surface-2, line, line-strong, text, text-2, text-3, chip fills, overlay,
inverse (toast), chart fills, crosshair, labels, the TradingView logo (it adapts to `layout.textColor`).
What stays: gain stays green, loss stays red, brand stays blue (all lifted per the table in 1.1 so they
pass contrast on #121212). Ticker tile fills stay as the flat brand colours. Buy and Sell buttons keep
white text. No "dark card shadow": cards are `--surface` (#1A1A1A) with a 1px `--line` (#2C2C2C).
Hairlines stay 1px; do not thicken borders in dark.

Toggle: a KV-style row "Appearance" with a 3-chip filter row (System / Light / Dark) inside the wallet
/ avatar sheet on mobile and the avatar dropdown on desktop. Not in the top bar.

Attribute strategy (compatible with the current globals.css):
- `<html data-theme="light" | "dark">` or no attribute (system). The CSS already has the three blocks.
- An inline script in `<head>` (before paint) reads `localStorage.theme` and sets the attribute, so
  there is no flash. The toggle writes localStorage and the attribute, and updates
  `<meta name="theme-color">` to `--bg` (#FFFFFF / #121212). Keep `color-scheme` in each block so
  native controls and scrollbars follow.
- `viewport.themeColor` in layout.tsx keeps its media entries for the system case.

---------------------------------------------------------------------------------------------------

## 5. Motion

Allowed (all respect `prefers-reduced-motion` by collapsing to 1ms):
- Sheet slide-up 240ms `cubic-bezier(0.2, 0.8, 0.2, 1)`, overlay fade 160ms.
- Modal fade + 8px rise 160ms.
- Tab underline translateX 200ms ease-out.
- Chip and row press: background-color 120ms.
- Number tick: when a live price changes, the number's opacity goes 0.4 to 1 in 160ms. No colour flash.
- Toast slide-up 160ms, slide-down 120ms.
- Skeleton opacity pulse 1.2s.
- Stepper circle fill: 120ms background.
- Button busy spinner (16px) rotating.

Banned: banner flash / box-shadow pulse, pulsing dots, scale bounces, chart line draw-on, gradient
sweeps and shimmer, blur transitions, parallax, confetti, auto-playing count-ups, hover lifts.
Delete `banner-flash`, `pulse-dot` and `toast-in` (replace with a plain slide) from globals.css.

---------------------------------------------------------------------------------------------------

## 6. Do-not-do list and component mapping

### 6.1 Do not

- No gradient logo, no conic-gradient avatars, no coloured rings around avatars.
- No pills on cards, headers, rows or sheets. One outlined status chip, only where 2.18 allows.
- No soft tinted backgrounds for status or warnings. Warnings are plain 13/400 text in `--warn` or
  `--loss` with a 16px icon, no box.
- No `backdrop-blur`, no `/95` translucent bars, no shadows (delete `--shadow`).
- No radius above 10px except chips and avatars (999). No 12px or 20px radii.
- No emoji, no decorative icons in titles, no icon circles in empty states, no "Tools" icon grid with
  coloured tiles (Groww's product tiles are grey isometric art; ours become plain promo cards).
- No "Reads via Nox mixnet", "Sepolia", "v4 POOL", "CCA", "zeroForOne" chips or captions in the main
  flow. Network, privacy transport and read counts live as KV rows in the wallet sheet and on /about.
- No legend rows under charts. No two-tone baseline chart. No area fill on price lines.
- No centered helper copy under lists ("Every ticker resolved from ENS..."); put it on /about.
- No blue outside the bottom nav active item, desktop nav active underline and the logo.
- No icon-only controls except the back arrow (section 7.3). No "Connect wallet" wording (7.7).
- No bold (700) headings. 500 everywhere except price-large (500 too). 700 only in ticker tile initials.
- No letter-spacing tweaks. No `opacity-40` disabled states.
- No animation on circuit mode change. The strip just changes text.

### 6.2 Mapping: old export -> new component

`app/src/components/ui.tsx`

| old | new |
|---|---|
| `cx` | keep |
| `TickerAvatar` | `TickerTile`: 36 (or 28 / 48) square, radius 8, flat `avatar.bg` fill, initials 13/700, no ring |
| `Pill` | delete. Status words become plain text in rows; the only chip is `StatusChip` |
| `StatusChip` | `StatusChip` per 2.18: outlined, text-2, "Halted" in loss, no dot, no tone prop |
| `modeTone` | delete (tone drives no backgrounds any more); keep `modeInfo` in lib for words |
| `FilterChip` | `Chip` per 2.5 (36px, selected = chip-on fill + chip-on line) |
| `Card` | `Card`: radius 10, 1px `--line`, `--surface` fill, no shadow, optional `interactive` hover |
| `Change` | keep; enforce sign always, 13/500 or 14/500, tabular |
| `Progress` | `ProgressBar` per 3.2: 4px, track `--line`, fill `--gain`, threshold tick; no tone prop |
| `Tabs` | `UnderlineTabs` per 2.7 (single sliding underline, count suffix in text-2) |
| `Segmented` | `RangeChips` per 2.6 (borderless until selected). For Stocks/IPO use `Chip` row |
| `CopyAddress` | keep; mono 13, icons 16 `--text-2`, 32px targets |
| `Sheet` | `Sheet` per 2.15 (no handle, 10px top radius, 56px header, 1px lines, modal at >= 768) |
| `KV` | `KVRow` per 2.23 |
| `SectionTitle` | keep; 18/500, margin 24 top 12 bottom, optional right text link 14/500 `--gain` |
| `Button` | `Button` per 2.14: variants `buy` (gain), `sell` (loss), `secondary` (outlined), `text` (gain link); height 52 (`sm` 40) |
| `Empty` | `EmptyState` per 2.22, no icon prop |

`app/src/components/shell.tsx`

| old | new |
|---|---|
| `Logo` | `Logo`: flat `--brand` circle, white step glyph, no `<linearGradient>` |
| `WalletAvatar` (internal) | `Avatar`: 34 round, `--surface-2`, initial; "Connect" outlined text button |
| `PrivacyBadge` | delete from screens; its sheet content becomes KV rows inside the wallet sheet ("Private reads", "Direct reads", "Transport") and /about |
| `WalletSheet` (internal) | keep as `Sheet`; flat avatar, KV rows, "Appearance" chip row, "Get test USDC" as a promo card, Disconnect as secondary button |
| `TabHeader` | `AppBar` per 2.1 (solid, no blur, scroll hairline); desktop renders `TopNav` instead |
| `DetailHeader` | `DetailBar` per 2.1 (back only); page content holds the tile + icon row |
| `IconButton` | keep; 44 target, 24 icon, `--text`, active state uses `--text` filled icon, not brand |
| `BottomNav` | `BottomNav` per 2.2: four items, no tile, no badge, mobile only |
| `ActionBar` | `ActionBar` per 2.14: solid, hairline, 52px buttons; hidden on desktop where `OrderPanel` is sticky |

Other files

| old | new |
|---|---|
| `circuit-banner.tsx` `CircuitBanner` | `CircuitStrip` per 2.19 (flat strip, three modes only) + `CircuitSheet` (KV rows, no tinted box) |
| `time-chart.tsx` `TimeChart` | `PriceChart` per section 3 (props: `data`, `kind: "market" | "clearing" | "raised"`, `baseline`, `band`, `reference`, `halts`, `rejects`, `lines`, `onHover`), plus `ChartLabels` overlay and `FullscreenChart` |
| `market-list.tsx` `Sparkline` | `Sparkline` per 3.3 (84x32, 1.5px, sign colour) |
| `ipo-list.tsx` `Tool` grid | delete; replace with up to one promo card |
| `ipo-list.tsx` `AuctionCard` / `ListedCard` | `CompanyCard` per 2.8 with `variant: "listed" | "auction"` |
| `ipo-list.tsx` `OtherRow` / `market-list` row | `ListRow` per 2.9 |
| `bid-sheet.tsx` `Field` / `Steps` | `AmountField` per 2.16, `Stepper` per 2.17 |
| `console.tsx` step list | `StepList` per 2.24 |
| `globals.css` tokens | section 1.1 palette, `@theme inline` names, Roboto variable, delete banned keyframes |
| `layout.tsx` `Inter` | `Roboto` per 1.3; add the pre-paint theme script; remove the `max-w-[480px]` body frame on desktop (phone keeps 480 max; desktop uses the 1200 container) |

### 6.3 Screen-level notes for the engineer

- IPOs home: index strip (listed tickers) -> chip row (Explore / Live auction / Listed / Upcoming) ->
  section "Live auctions" 2-col cards -> section "Listed" 2-col cards -> "Upcoming" list rows inside
  one card. Alerts for halted / surveillance tickers are list rows at the top with the mode word in
  colour, not banners. Search is the top-bar icon; it opens a sheet with the search input.
- Markets: index strip -> chip row (Stocks / IPO) -> one card of list rows with sparklines.
- Market detail: detail bar -> tile + icon row -> name, price, change -> readout line -> chart ->
  dotted separator -> range chips -> band caption -> circuit strip (only if not normal) -> promo card
  (holding or claim) -> underline tabs (Overview / Trades / Rejected / ENS) -> KV rows or table.
  Fixed Buy / Sell bar on mobile, sticky order panel on desktop.
- IPO detail: same skeleton; chart view toggle "Clearing / Raised" is a `RangeChips` pair at the
  left of the range row; raise summary is a 2x2 summary card; World ID is a promo card; tabs
  Overview / ENS / My bids; fixed "Place bid" bar.
- Portfolio: 2x2 summary card -> chip row (vs clearing / vs issue) -> list rows with value column.
- My bids: list rows grouped by ticker, status chip at right, secondary buttons inline.
- Console: chip row of tickers -> KV header card -> step list.

---------------------------------------------------------------------------------------------------

## 7. Legibility and everyday-trading addendum

Two added constraints: the app is first a place to trade listed shares every day (IPO is a secondary
tab inside Markets), and it must be comfortable for a 50-year-old who has never used a crypto app.
Where a number in sections 1 to 6 is smaller than one here, this section wins. Global rule: wherever
an earlier section colours text with `--gain` or `--loss`, read it as `--gain-text` / `--loss-text`;
`--gain` and `--loss` are now line and fill colours only (chart lines, sparklines, tab underline, progress).

### 7.1 Type minimums (size/weight/line-height)

| role | value | note |
|---|---|---|
| body | 16/400/24 | descriptions, sheet copy, warnings, empty states |
| list-row secondary | 14/400/20 | the second line under a name, KV keys |
| caption | 13/400/18 | the floor. Timestamps, chart labels, nav labels. Nothing is ever below 13 |
| price-large | 32/500/38 | detail header |
| change (header) | 16/500/22 | |
| change (row, card) | 14/500/20 | |
| chip, tab | 15/500/20 | |
| button | 17/500/22 | |
| input value | 24/500/30 | label 14/400/20 |
| hover readout | 18/500/24 | |
| mono-data | 14/400/20 | |

### 7.2 Touch targets

Every tappable element is at least 48x48 in hit area; the visual can be smaller, the hit area may not.
Chips 40 tall (hit area padded to 48) with 8px gap. List rows 64 min, the whole row tappable.
Buy / Sell bar buttons 56 tall. Bottom nav 64 tall, each item the full column. Icon buttons 48x48
visual. Range chips 40 tall, min-width 52. KV copy icons: 16px glyph inside a 48x48 area.
Slider thumb 24 visual, 48 hit area. Close button in sheets 48x48. Links in running text get
`padding: 8px 0; display: inline-block`.

### 7.3 Icon rule

No icon-only controls, except the back arrow. Every icon has a visible text label (13/500 under it,
or 15/500 beside it). This covers: Search, Account, Alert, Watch, Expand, Close ("Close" beside the x),
Copy ("Copy"), Open in explorer ("View"), Sort ("Sort"). Decorative icons stay banned; a labelled
action icon is a control, not decoration.

### 7.4 Density

Max one row of chips per screen. One primary (filled) action per screen; everything else is outlined or
a text link. On a listed company the Buy / Sell bar is visible without scrolling on every viewport
(mobile fixed bar, desktop sticky panel). Two numbers per row at most: price and change. A card shows
name, price, change and nothing else. Sections are separated by 24px of white, not by boxes.
Tabs come after the chart and the one promo card, never before them.

### 7.5 Contrast at the new sizes (4.5:1 for all text, both themes)

All text roles pass with these token changes, now applied in section 1.1:
- Light `--gain-text #00805F` (4.9:1), `--loss-text #D23232` (4.95:1), `--brand-text #4556E6` (5.6:1).
  Groww's #00B386 and #F35D5D stay for lines and fills only (they are 2.7:1 and 3.2:1, fail for text).
- Button fills `--buy #00805F` and `--sell #D23232` in both themes so the white 17px label is 4.9:1.
  (White on #00B386 is 2.7:1, white on dark #0FCB9A is 2.1:1; both fail.)
- Dark: `--gain-text` = `--gain` #0FCB9A (8.9:1), `--loss-text` = `--loss` #FF6B6B (6.7:1),
  `--brand-text` = #7B8BFF (6.2:1), `--text-2` #8F8F8F (5.8:1 on #121212, 5.4:1 on #1A1A1A).
- `--text-2 #767676` (4.54:1 light) is now used at 13px and up only; `--text-3 #919191` is placeholder
  and disabled text only, which WCAG exempts.
- `--warn #A66200` 4.8:1 light, `#F5A623` 9.2:1 dark. No other changes.

### 7.6 Price display

Big plain numbers, tabular, Roboto 500. Thousand separators always (en-IN grouping: 1,23,456.00 for
rupee-style, or en-US 123,456.00; pick one app-wide, en-US recommended since the unit is USDC).
USDC values two decimals always: 1,234.00, never 1.234 or 1,234. Share counts no decimals: 1,200.
Change always shows the sign, the amount and the percent: "+234.00 (23.40%)" / "-88.00 (8.80%)".
Colour plus sign, never colour alone; the sign is part of the string, not a styled glyph. Unit words
are spelled out once per block ("USDC per lot"), never as a suffix on every number. Prices per lot
are the default; per-share appears only in the order panel as a second line "= 1.23 USDC per share".

### 7.7 Plain-language copy

Account: the top-bar control says "Sign in" and the sheet title is "Sign in". Body: "Sign in with
MetaMask or WalletConnect. We never move your money without asking." The row after sign-in reads
"Signed in as acme.eth" with a "Sign out" text link. Never "Connect wallet", "Wallet", "address".
Balance row: "Available to spend  1,234.00 USDC". Network and privacy details live under "About".

Approval stepper (each step one sentence, shown under the step title):
1. "Allow this app to use your USDC. One-time, you can turn it off later."
2. "Allow this auction to take up to 5.00 USDC from you."
3. "Place your bid. It can't be cancelled: your USDC stays with the auction until it ends."
Trading: 1. "Allow this app to sell your ACME shares." 2. "Confirm the sale."
Button labels: "Allow USDC", "Allow 5.00 USDC", "Place bid", "Buy for 5.00 USDC", "Sell 1,000 shares".
Busy label: "Check your wallet app". Done toast: "Bid placed", "Bought 980 ACME shares".

Errors always say what happened and what to do, in one or two sentences, 16/400, no error codes
in the main text (the code goes in a "Details" text link):
- Price above cap: "Your top price is above 1.90, the most this IPO allows. Lower it to 1.90 or less."
- Over cap: "You can put at most 20.00 USDC into this IPO. You have 4.00 USDC left."
- Not enough money: "You need 5.00 USDC but have 2.00. Add USDC or lower the amount."
- Outside band: "This price is outside today's allowed range of 0.95 to 1.05. Try a smaller amount."
- Directional widening (`DirectionalWidening`): "This trade would push the price further from 1.00 than the 0.95–1.05 allowed today. Try a smaller amount or the other side."
- Halted: "Trading is paused. You can still withdraw liquidity. Try again when the pause lifts."
- Pass expired: "Your one-person check has expired. Verify again, it takes a minute."
Halt strip: "Trading paused. Buying and selling are off until the regulator lifts it. Details".
Surveillance strip: "Extra checks today. Prices can move at most 2% from 1.00. Details".
Directional strip: "One-way day. Trades that move the price further from 1.00 can go at most 5% from it. Trades toward 1.00 go through within 20%. Details".

### 7.8 Charts for older eyes

Price line and sparklines 2.5px (Lightweight Charts `lineWidth: 3`, sparkline SVG `stroke-width: 2.5`).
Hover readout 18/500 `--text`, time 13/400 `--text-2`, on its own 24px line above the chart.
Crosshair dot radius 5 with a 2px `--bg` ring. H / L / last labels 13/500. Range chips 40 tall,
min-width 52, 15/500, gap 8. Reverted-swap x marks 9px. Dotted baselines stay 1px but use
`--line-strong`. Touch: long-press 200ms to start the readout; the readout stays until the finger
lifts; a tap on the chart does nothing (no accidental zoom). Band fill raised to 0.06 light / 0.07 dark
so the allowed range is visible on a bright screen.

### 7.9 Desktop (1200px container)

Same rules: 16 body, 48 targets, one chip row, one primary action. The sticky order panel uses field
labels 18/500/24, input values 24/500/30, KV rows 16/400/24 with 48px row height, and a 56px
Buy / Sell button. Tables use 16/400 rows at 56px. Top-nav links 17/500. Chart 360 tall, readout 18.
Hover states exist but nothing depends on hover: every hover affordance is also visible at rest
(prices, labels, chevrons are always drawn). Keyboard: Tab order follows reading order; Enter on a
row opens it; Escape closes the panel or modal.
