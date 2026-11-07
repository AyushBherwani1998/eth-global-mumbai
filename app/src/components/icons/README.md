# icons/: bespoke marks

Three small vector systems, drawn here rather than taken from a library. Inline SVG, no network, no
dependency, everything on one 24 grid, every colour from a token.

**The bar for being in this folder.** A mark earns its place when it speeds recognition, encodes state,
or explains a mechanism. It fails when it is a picture next to a word that already says the same thing.
UI.md 6.1 bans decorative icons and illustration clip art, and that ban is not softened here: these are
not pictures of things, they are diagrams of the rule the exchange is running.

**What stays on lucide-react.** Every labelled control — Back, Search, Share, Expand, Copy, View,
Sort, Close — plus the bottom-nav icons, the busy spinner, the chevron and the stepper check. Those are
controls with a word beside them (UI.md 7.3), not state, and a house-drawn arrow would be a worse arrow.

**Colour.** Every glyph is `fill="currentColor"`. The caller sets the colour with a token class, which
is why each one has to survive being plain `text-text-2` grey at 16px — that is its worst case, and the
gallery shows it in that case on purpose.

See all of it at **`/gallery`** (`app/src/app/(dev)/gallery/page.tsx`), with `?theme=light` /
`?theme=dark` to force a ground.

```ts
import { RuleGlyph, BandDiagram, StageMark } from "@/components/icons";
```

---

## RuleGlyph — `rule-glyph.tsx`

**What it is.** One mark per trading-rule state, so the five rules a share can be under are told apart
by shape, not only by colour.

**Why it exists.** The app has exactly one state symbol today: an 8px filled square, in `ui.tsx`
`RuleStrip`, `rich/market-status.tsx` and `rich/exchange-notices.tsx`. It collapses five rules into three
colours, and two pairs share a colour exactly — `listing` and `normal` are both `bg-text`, `surveillance`
and `directional` are both `bg-warn`. In the notices feed, the day a share went under watch and the day
it went one-way are the same picture. UI.md's rule that colour is never the only carrier of meaning is
broken in the one place where the meaning is the point.

**The grammar.** Every glyph is the same drawing: two bars are the limits a price may trade between, and
what sits between them says what may happen today. Ink is the severity scale — `normal` is the lightest
mark in the set, `halted` the heaviest.

| state | word | what is drawn | means |
|---|---|---|---|
| `listing` | Listing day | the band with a solid post at its left edge | the band opened today |
| `normal` | Open | thin limits far apart, the price square loose between them | ordinary room to move |
| `watch` | Under watch | heavy limits pressed onto the price | the band has been narrowed |
| `oneway` | One-way day | one heavy limit, a triangle running to the thin one | one direction is capped tight, the other still goes through |
| `halted` | Halted | the two limits fused into one slab | nowhere to trade |

**Where it goes.** Everywhere a rule is named: the `RuleStrip` (in place of the square), `StatusChip`,
`MarketStatus`, the `ExchangeNotices` timeline, the Markets alert rows (UX.md 3.1 item 3), the Trading
rule sheet header, and the trading-rule row in the company Overview. The same state always gets the same
mark; that repetition is the whole value.

**Two directions.** `DIRECTION` in the file picks what ships; the other renders from the same file, as in
`avatar/art.tsx`.

- `band` (shipping) — the limits drawn literally. Needs 16px or more. Recommended: it is the only one
  that says anything about the mechanism.
- `mark` — the same five meanings inside one 16-unit square. Reads down to 8px, so it can replace the
  current status square with no layout change, at the cost of being more arbitrary.

| prop | type | |
|---|---|---|
| `state` | `RuleState` | required: `listing \| normal \| watch \| oneway \| halted` |
| `size` | `number` (20) | 16, 20, 24 and 40 are the drawn sizes |
| `direction` | `"band" \| "mark"` (`DIRECTION`) | |
| `title` | `string` | an accessible name. Without it the glyph is `aria-hidden`, which is right beside its own word |
| `className` | `string` | where the colour goes: `text-text`, `text-warn`, `text-loss-text` |

Also exported: `RULE_WORD` (the plain-English word per state, matching `circuit-banner.tsx`),
`RULE_TONE` (the token class per state), and `RuleLabel` — glyph plus word on one line.

---

## BandDiagram — `band-diagram.tsx`

**What it is.** A figure showing the reference price, today's limits, where the price is now, and what
happens to two trades: one that lands inside the limits and one that would land outside.

**Why it exists.** The band is the product, and it currently reaches the user only as sentences — the
rule strip, the Trading rule sheet, the caption under the chart and the rejection toast all describe the
same picture in words. `rich/band-meter.tsx` shows where the price sits *now*; it cannot show what would
happen to a trade, which is the part people get wrong.

**How it is drawn.** The geometry is flat token-coloured blocks positioned by percentage, exactly as the
chart draws its band (UI.md 3.1): `--band-fill` between the limits, limits as 1px `--line-strong`, the
reference as 1px dotted `--text-2`. SVG is used only for the two trade marks, which must not stretch
with the container: a filled `--text` square for a trade that goes through, and the same 9px `--loss`
cross the chart already uses for a reverted swap. Labels are HTML in our own type classes, never SVG
`<text>`, so they stay 13px at every width and follow the theme.

**Where it goes.** The Trading rule sheet (above the key/value rows), the `/about` explainer, and the
"outside today's limits" error in the Trade sheet. One figure replaces the paragraph in all three.

| prop | type | |
|---|---|---|
| `mode` | `"normal" \| "oneway" \| "halted"` (`normal`) | `oneway` adds the tighter away-cap line in `--warn`; `halted` drops the band and fills the field with `--loss-fill` |
| `reference` | `number` (1.10) | `policy.referencePrice` |
| `band` | `{ low, high }` | `market.band` |
| `price` | `number` | where the price is now |
| `awayLimit` | `number` | `oneway` only: how far a trade moving away from the reference may go. Defaults to the tighter surveillance cap |
| `trades` | `{ to, allowed, label }[]` | override the two worked examples |
| `height` | `number` (196) | |
| `digits` | `number` (3) | |
| `title` | `ReactNode` | a 14/400 label above the figure |

The whole figure carries one `role="img"` and an `aria-label` that states the limits and both outcomes,
so a screen reader gets the sentence the picture replaced.

---

## StageMark — `stage-mark.tsx`

**What it is.** How far a listing has got — draft, applications, final price, trading — as one small
square. Four cells, filled as the listing advances.

**Why it is not a set of pictures.** The obvious set (an envelope for applications, a gavel for the final
price, a chart for trading) fails the bar: in `rich/lifecycle-rail.tsx` every stage already prints its own
word directly under it, so each drawing would say what the label says. What is missing is the compact
form — the rail needs 280px and four labels, while an Orders row, an ICO card or a notice has room for
16px. This mark carries the one fact a glance needs, with no pictorial content at all.

**Where it goes.** Orders rows, ICO cards in the Markets list, and the console listing header. The
`LifecycleRail` keeps its numbered circles: at that size the number plus the label is better.

| prop | type | |
|---|---|---|
| `stage` | `number` | 1..4. `Draft` is 1, `Trading` is 4. Use `stageOf(phase)` to map `GET /v1/listings/:ticker` `phase` |
| `failed` | `boolean` (false) | the listing ended without listing: the cells stay held back and the mark is struck. Draw it in `text-loss-text` |
| `size` | `number` (20) | |
| `direction` | `"quad" \| "bar"` (`DIRECTION`) | `quad` is a 2x2 block and sits in an icon slot; `bar` is four upright segments, more obviously a progression, better beside a word |
| `title` | `string` | accessible name; hidden without it |
| `className` | `string` | |

Also exported: `STAGES` (the four stage words in order) and `stageOf(phase)`.

---

## Considered and rejected

- **Marks for empty states.** UI.md 2.22 makes empty states text-first and left-aligned, and that is
  right: in this app almost every "empty" screen is really signed-out or still loading, and what the
  reader needs is the sentence and the way out. A drawing above it would be the clearest case of a
  picture next to a word that already says the same thing, and the one genuinely terminal case ("You
  don't own any shares yet") is a sentence anyone can read in half a second. No marks drawn.
- **A tools / shortcuts row** in the manner of Groww's Product & Tools. Revisited and rejected again.
  Three of the four plausible tiles (Orders, Portfolio, Markets) are the bottom nav, so the row would be
  a second copy of the navigation; the fourth, the band explainer, is already a `PromoCard` on the
  Markets list with a sentence that does more than a tile would. Groww's row works because it leads to
  F&O, Events and ICO — products that exist nowhere else in its app. Ours has no such destination.
- **A pictorial lifecycle set.** See StageMark above.
- **A bespoke verified tick, shield or wallet mark.** `BadgeCheck`, `ShieldCheck` and `Wallet` are
  conventions a 50-year-old already reads; redrawing them buys nothing and costs the convention.
- **A glyph for `normal` in the strip.** The strip deliberately renders nothing while trading is
  ordinary (UI.md 2.19). `RuleGlyph` draws `normal` because the notices feed and the chip need it, but
  no strip should appear for it.
