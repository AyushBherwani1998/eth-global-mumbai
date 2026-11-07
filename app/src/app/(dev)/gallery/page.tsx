import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BandMeter, DemandLadder, ExchangeNotices, LifecycleRail, MarketStatus, StatGrid, SubscriptionMeter } from "@/components/rich";
import { BandDiagram, RULE_TONE, RULE_WORD, RuleGlyph, STAGES, StageMark, type RuleState } from "@/components/icons";
import { usdc, shares as sharesFmt } from "@/lib/format";

export const metadata: Metadata = {
  title: "Component gallery (dev)",
  description: "Development page: the rich components with sample props.",
  robots: { index: false, follow: false },
};

/**
 * Development-only gallery for app/src/components/rich. It is not linked from
 * the app and is not part of any flow: it exists so the components can be read
 * side by side, in both themes, at phone and desktop width.
 *
 * Sample props below are the anvil rehearsal values from services/api/README.md
 * (acme: listed, listing day, halted then resumed; kesar: a live auction).
 */
export default function GalleryPage() {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-5 py-6 lg:py-10">
      <header className="rounded-[10px] border border-line bg-surface p-4">
        <p className="t-page-title">Component gallery</p>
        <p className="t-body mt-1 text-text-2">
          Development page. Not linked from the app and not part of any flow. Every component below lives in{" "}
          <span className="t-mono text-text">app/src/components/rich</span>, takes plain props, and is fed by a field the API really returns.
        </p>
        <p className="t-caption mt-2">
          Sample values are the anvil rehearsal in services/api/README.md. Add <span className="t-mono">?theme=light</span> or{" "}
          <span className="t-mono">?theme=dark</span> to this URL to force a theme.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Item
          name="MarketStatus"
          file="rich/market-status.tsx"
          data="GET /v1/policy/:ticker — mode, halted, since, version, band, bandBps, referencePrice, stale/staleAt, listingDayEndsAt"
          screen="Top of the company page, and the Live card in the issuer console. Always renders, unlike RuleStrip."
        >
          <div className="grid gap-3">
            <MarketStatus
              mode="listing"
              version={2}
              since="2026-11-06T13:48:03.000Z"
              band={{ low: 1.045, high: 1.155 }}
              bandBps={500}
              referencePrice={1.1}
              nextChange={{ label: "Listing-day limits end", at: "2026-11-06T14:47:51.000Z" }}
            />
            <MarketStatus
              mode="surveillance"
              version={5}
              since="2026-11-07T09:12:00.000Z"
              band={{ low: 0.855, high: 0.945 }}
              bandBps={500}
              referencePrice={0.9}
            />
            <MarketStatus mode="halted" version={6} since="2026-11-07T14:32:00.000Z" stale staleAt="2026-11-08T14:32:00.000Z" />
          </div>
        </Item>

        <Item
          name="BandMeter"
          file="rich/band-meter.tsx"
          data="GET /v1/market/:ticker — price, band.low/high, policy.referencePrice, policy.bandBps; day low/high from /swaps prices[]"
          screen="Company page, directly under the chart, where the band caption is today."
        >
          <div className="grid gap-6">
            <BandMeter price={1.14} band={{ low: 1.045, high: 1.155 }} reference={1.1} bandBps={500} dayLow={1.082} dayHigh={1.15} />
            <BandMeter
              title="Today's limits · under watch"
              price={0.871}
              band={{ low: 0.855, high: 0.945 }}
              reference={0.9}
              bandBps={500}
              dayLow={0.862}
              dayHigh={0.912}
            />
          </div>
        </Item>

        <Item
          name="ExchangeNotices"
          file="rich/exchange-notices.tsx"
          data="GET /v1/market/:ticker — events[] { time, kind, label, tx, block }"
          screen="Company page, Overview tab (replaces the plain 'Rule history' list) and the Trading rule sheet."
        >
          <ExchangeNotices
            notices={[
              { time: "2026-11-06T13:47:51.000Z", kind: "listing", label: "Listed at 1.10 · ±5% band", tx: "0x3190ffb1d05b28a6b1ae0cb0b7e0f1ba3f3ba0f0f1f2f3f4f5f6f7f8f9fa0f433", block: 12077045 },
              { time: "2026-11-06T13:48:00.000Z", kind: "halted", label: "v1 Halted", tx: "0xbfc4a1c2d3e4f5061728394a5b6c7d8e9fa0b1c2d3e4f50617283949a5b6772c", block: 12077054 },
              { time: "2026-11-06T13:48:03.000Z", kind: "normal", label: "v2 Normal ±20% · ref listing price", tx: "0xd843b1c2d3e4f5061728394a5b6c7d8e9fa0b1c2d3e4f50617283949a5b6b75b", block: 12077057 },
              { time: "2026-11-07T09:12:00.000Z", kind: "surveillance", label: "v5 Under watch ±5% · ref 0.90", tx: "0x4411b1c2d3e4f5061728394a5b6c7d8e9fa0b1c2d3e4f50617283949a5b6cc21", block: 12081190 },
              { time: "2026-11-07T14:32:00.000Z", kind: "halted", label: "v6 Halted · regulator notice", tx: "0x9f02b1c2d3e4f5061728394a5b6c7d8e9fa0b1c2d3e4f50617283949a5b6ad55", block: 12082744 },
            ]}
            limit={3}
          />
        </Item>

        <Item
          name="StatGrid"
          file="rich/stat-grid.tsx"
          data="GET /v1/market/:ticker — liquidity.usdc, liquidity.shares, listingPrice, policy.referencePrice, policy.bandBps, policy.version"
          screen="Company page, Overview tab, above the key-value rows. Also the console Live card."
        >
          <div className="grid gap-6">
            <StatGrid
              title="This market right now"
              stats={[
                { label: "Available to buy", value: `${sharesFmt(15913.25167740408)} shares`, sub: "What the pool can sell you at this price" },
                { label: "Available to sell into", value: `${usdc(18.141106)} USDC`, sub: "What the pool can pay you" },
                { label: "Reference price", value: "1.10", sub: "Today's limits are measured from this" },
                { label: "Allowed move", value: "±5%", sub: "Listing day, until 20:17 IST" },
              ]}
            />
            <StatGrid
              columns={3}
              title="The offer"
              stats={[
                { label: "Issue price", value: "1.00" },
                { label: "Price range", value: "0.80 – 1.90" },
                { label: "Cap per person", value: "20.00 USDC" },
                { label: "Shares on offer", value: sharesFmt(90000) },
                { label: "Needs to list", value: "45.00 USDC" },
                { label: "Rule version", value: "v2" },
              ]}
            />
          </div>
        </Item>

        <Item
          name="LifecycleRail"
          file="rich/lifecycle-rail.tsx"
          data="GET /v1/listings/:ticker phase (draft | live | cleared | refunding | listed) + GET /v1/auction/:ticker startBlock, endBlock, claimBlock, blocksRemaining, graduated"
          screen="ICO phase of the company page, above the chart; and the console Listing header."
        >
          <div className="grid gap-8">
            <LifecycleRail
              title="Kesar Agro Foods"
              stages={[
                { id: "draft", label: "Draft", sub: "Registered 6 Nov", state: "done" },
                { id: "auction", label: "Applications", sub: "Closes in 42m", state: "current" },
                { id: "cleared", label: "Final price", sub: "At block 12,077,028", state: "upcoming" },
                { id: "listed", label: "Trading", sub: "Minutes after that", state: "upcoming" },
              ]}
            />
            <LifecycleRail
              title="Acme SME"
              stages={[
                { id: "draft", label: "Draft", sub: "Registered 5 Nov", state: "done" },
                { id: "auction", label: "Applications", sub: "99.00 USDC, 5 people", state: "done" },
                { id: "cleared", label: "Final price", sub: "1.10 on 6 Nov", state: "done" },
                { id: "listed", label: "Trading", sub: "Since 6 Nov, 19:17", state: "current" },
              ]}
            />
            <LifecycleRail
              title="Lotus Textiles"
              stages={[
                { id: "draft", label: "Draft", sub: "Registered 2 Nov", state: "done" },
                { id: "auction", label: "Applications", sub: "31.00 of 90.00", state: "done" },
                { id: "cleared", label: "Not listed", sub: "Below the 45.00 minimum", state: "current", tone: "loss" },
                { id: "listed", label: "Trading", sub: "Does not open", state: "upcoming" },
              ]}
            />
          </div>
        </Item>

        <Item
          name="SubscriptionMeter"
          file="rich/subscription-meter.tsx"
          data="GET /v1/auction/:ticker — raised, targetRaise, requiredRaise, bidCount, applicants, perApplicantCap, graduated, blocksRemaining"
          screen="ICO phase of the company page, under the chart; and the ICO card in the Markets list."
        >
          <div className="grid gap-3">
            <SubscriptionMeter raised={61.4} targetRaise={90} requiredRaise={45} bidCount={19} applicants={14} perApplicantCap={20} closes="Closes in 42m" />
            <SubscriptionMeter raised={31} targetRaise={90} requiredRaise={45} bidCount={9} applicants={7} perApplicantCap={20} graduated={false} closes="Closed 5 Nov" />
          </div>
        </Item>

        <Item
          name="DemandLadder"
          file="rich/demand-ladder.tsx"
          data="GET /v1/bids?ticker= — bids[] grouped by maxPrice, summing budget; the line from GET /v1/auction/:ticker clearingPrice"
          screen="ICO phase of the company page, Overview tab; and the console Monitor step."
          className="lg:col-span-2"
        >
          <div className="max-w-[560px]">
            <DemandLadder
              clearingPrice={1.1}
              rows={[
                { price: 1.9, usdc: 19, bids: 1 },
                { price: 1.4, usdc: 28, bids: 2 },
                { price: 1.3, usdc: 22, bids: 1 },
                { price: 1.1, usdc: 18, bids: 1 },
                { price: 0.95, usdc: 12, bids: 2 },
                { price: 0.85, usdc: 8, bids: 1 },
              ]}
            />
          </div>
        </Item>
      </div>

      <Marks />

      <p className="t-caption mt-8">
        Prices are USDC per 1,000 shares.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Bespoke marks (app/src/components/icons). Nothing below is wired into a real
// screen yet: the "in context" blocks are mock-ups of the rows they belong in.
// ---------------------------------------------------------------------------

const RULE_STATES: RuleState[] = ["listing", "normal", "watch", "oneway", "halted"];

const SIZES = [16, 20, 24, 40];

function Marks() {
  return (
    <section id="marks" className="mt-10 border-t border-line pt-8">
      <h2 className="t-page-title">Bespoke marks</h2>
      <p className="t-body mt-1 text-text-2">
        Drawn in <span className="t-mono text-text">app/src/components/icons</span>: inline SVG, no library, currentColor only, every glyph on the
        same 24 grid. A mark is here only where it carries something the word next to it cannot — a state, a mechanism, a position in a sequence.
        Labelled controls (Back, Search, Expand, Copy) stay on lucide-react.
      </p>

      <div className="mt-6 grid gap-8 [&>*]:min-w-0">
        <Item
          shot="rule-band"
          name="RuleGlyph — direction “band” (recommended)"
          file="icons/rule-glyph.tsx"
          data="GET /v1/policy/:ticker — mode + halted; GET /v1/market/:ticker events[].kind for the notices feed"
          screen="RuleStrip, StatusChip, MarketStatus, ExchangeNotices, the Markets alert rows and the rule sheet. One mark per rule, used everywhere that rule appears."
        >
          <GlyphTable direction="band" />
        </Item>

        <Item
          shot="rule-mark"
          name="RuleGlyph — direction “mark” (alternative)"
          file="icons/rule-glyph.tsx (DIRECTION = “mark”)"
          data="Same."
          screen="The same places. This direction fits the 8px square slot the app uses today, so it drops in without a layout change; it reads at any size but says less about the mechanism."
        >
          <GlyphTable direction="mark" />
        </Item>

        <Item
          shot="rule-context"
          name="RuleGlyph — in context"
          file="icons/rule-glyph.tsx"
          data="Mock rows. Not wired into a screen."
          screen="Left: the rule strip and status chips. Right: the notices feed, where the glyph replaces today’s 8px square."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="grid gap-3">
              {(["listing", "watch", "oneway", "halted"] as RuleState[]).map((s) => (
                <MockStrip key={s} state={s} />
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                {RULE_STATES.map((s) => (
                  <MockChip key={s} state={s} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="t-section-title">Exchange notices</h3>
              <ol className="mt-2">
                {MOCK_NOTICES.map((n, i) => (
                  <li key={i} className="flex gap-3 pb-4 last:pb-0">
                    <span className={`shrink-0 pt-[2px] ${RULE_TONE[n.state]}`}>
                      <RuleGlyph state={n.state} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body block text-text">{n.label}</span>
                      <span className="t-caption block">{n.time}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Item>

        <Item
          shot="band-diagram"
          name="BandDiagram"
          file="icons/band-diagram.tsx"
          data="GET /v1/policy/:ticker — mode, referencePrice, band.low/high; GET /v1/market/:ticker price"
          screen="The Trading rule sheet, the /about explainer and the “outside today’s limits” error in the Trade sheet — the three places that explain the band in sentences today."
        >
          <div className="grid gap-8 lg:grid-cols-3">
            <BandDiagram title="Open" mode="normal" />
            <BandDiagram title="One-way day" mode="oneway" price={1.115} />
            <BandDiagram title="Halted" mode="halted" />
          </div>
        </Item>

        <Item
          shot="stage-mark"
          name="StageMark"
          file="icons/stage-mark.tsx"
          data="GET /v1/listings/:ticker phase → stageOf(phase)"
          screen="Compact places LifecycleRail does not fit: an Orders row, an ICO card, a notice. The rail itself keeps its numbered circles."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <StageTable direction="quad" />
            <StageTable direction="bar" />
          </div>
          <div className="mt-6 border-t border-line pt-4">
            <p className="t-label mb-3">In context: Orders rows</p>
            <div className="divide-y divide-line">
              {MOCK_ORDERS.map((o) => (
                <div key={o.name} className="flex min-h-16 items-center gap-3 py-3">
                  <span className={o.failed ? "text-loss-text" : "text-text"}>
                    <StageMark stage={o.stage} failed={o.failed} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-list-title block text-text">{o.name}</span>
                    <span className="t-label block">{o.sub}</span>
                  </span>
                  <span className="num t-price-row shrink-0 text-text">{o.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Item>
      </div>
    </section>
  );
}

const MOCK_NOTICES: { state: RuleState; label: string; time: string }[] = [
  { state: "halted", label: "Trading halted · unusual activity", time: "7 Nov 2026, 14:32 IST" },
  { state: "oneway", label: "v5 One-way · moves away from 0.90 stop at 5%", time: "7 Nov 2026, 11:04 IST" },
  { state: "watch", label: "v4 Under watch · ±5% of 0.90", time: "7 Nov 2026, 09:12 IST" },
  { state: "normal", label: "v3 Open · ±20% · ref listing price", time: "6 Nov 2026, 14:48 IST" },
  { state: "listing", label: "Listed at 1.10 · ±5% band", time: "6 Nov 2026, 13:48 IST" },
];

const MOCK_ORDERS = [
  { name: "Kesar Agro Foods", sub: "Applications open · closes in 42m", stage: 2, failed: false, value: "8.00" },
  { name: "Tara Textiles", sub: "Final price 1.10 · shares ready to collect", stage: 3, failed: false, value: "12.00" },
  { name: "Acme Tools", sub: "Trading since 6 Nov", stage: 4, failed: false, value: "15.52" },
  { name: "Lotus Ceramics", sub: "Not listed · refund open", stage: 3, failed: true, value: "10.00" },
];

/** Every state at every size, in its own tone and in plain grey (the worst case). */
function GlyphTable({ direction }: { direction: "band" | "mark" }) {
  return (
    // The ladder is wider than a phone, so it scrolls inside its own box
    // rather than widening the page (UI.md: the body never scrolls sideways).
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="t-caption py-2 text-left font-normal">State</th>
            {SIZES.map((s) => (
              <th key={s} className="t-caption py-2 text-left font-normal">
                {s}px
              </th>
            ))}
            <th className="t-caption py-2 text-left font-normal">16px grey</th>
            <th className="t-caption py-2 text-left font-normal">24px grey</th>
          </tr>
        </thead>
        <tbody>
          {RULE_STATES.map((s) => (
            <tr key={s} className="border-b border-line last:border-0">
              <td className="py-3 pr-4">
                <span className={`t-change-sm ${RULE_TONE[s]}`}>{RULE_WORD[s]}</span>
              </td>
              {SIZES.map((px) => (
                <td key={px} className="py-3 pr-4">
                  <span className={RULE_TONE[s]}>
                    <RuleGlyph state={s} size={px} direction={direction} />
                  </span>
                </td>
              ))}
              <td className="py-3 pr-4 text-text-2">
                <RuleGlyph state={s} size={16} direction={direction} />
              </td>
              <td className="py-3 text-text-2">
                <RuleGlyph state={s} size={24} direction={direction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageTable({ direction }: { direction: "quad" | "bar" }) {
  const rows: { stage: number; failed?: boolean; label: string }[] = [
    ...STAGES.map((label, i) => ({ stage: i + 1, label })),
    { stage: 3, failed: true, label: "Not listed" },
  ];
  return (
    <div>
      <p className="t-label mb-3">
        direction “{direction}”{direction === "quad" ? " (recommended)" : ""}
      </p>
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-4 py-3">
            <span className="t-change-sm w-28 shrink-0 text-text">{r.label}</span>
            {SIZES.map((px) => (
              <span key={px} className={r.failed ? "text-loss-text" : "text-text"}>
                <StageMark stage={r.stage} failed={r.failed} size={px} direction={direction} />
              </span>
            ))}
            <span className="ml-auto text-text-2">
              <StageMark stage={r.stage} failed={r.failed} size={16} direction={direction} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A mock of ui.tsx RuleStrip with the glyph where the 8px square sits today. */
function MockStrip({ state }: { state: RuleState }) {
  const text: Record<RuleState, string> = {
    listing: "Trades allowed between 1.045 and 1.155.",
    normal: "Trades allowed between 0.88 and 1.32.",
    watch: "Extra checks today. Prices can move at most 5% from 0.90.",
    oneway: "Trades away from 0.90 can go at most 5% from it. Trades toward it go through within 20%.",
    halted: "Buying and selling are off until the exchange lifts it.",
  };
  return (
    <div className="flex min-h-12 items-center gap-3 bg-surface-2 px-4 py-2">
      <span className={`shrink-0 ${RULE_TONE[state]}`}>
        <RuleGlyph state={state} size={20} />
      </span>
      <p className="t-caption min-w-0 flex-1 text-text">
        <span className={`font-medium ${RULE_TONE[state]}`}>{RULE_WORD[state]}</span> {text[state]}
      </p>
      <span className="t-caption shrink-0">Details</span>
    </div>
  );
}

/** A mock of ui.tsx StatusChip with the glyph leading the word. */
function MockChip({ state }: { state: RuleState }) {
  return (
    <span
      className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] leading-4 font-medium ${
        state === "halted" ? "border-loss text-loss-text" : state === "watch" || state === "oneway" ? "border-line text-warn" : "border-line text-text-2"
      }`}
    >
      <RuleGlyph state={state} size={14} />
      {RULE_WORD[state]}
    </span>
  );
}

function Item({
  name,
  file,
  data,
  screen,
  children,
  className,
  shot,
}: {
  name: string;
  file: string;
  data: string;
  screen: string;
  children: ReactNode;
  className?: string;
  /** Hook for the comparison-sheet screenshot script. Does nothing in the page. */
  shot?: string;
}) {
  return (
    <section className={className} data-shot={shot}>
      <h2 className="t-section-title">{name}</h2>
      <p className="t-caption mt-1">
        <span className="t-mono text-text-2">{file}</span>
      </p>
      <p className="t-caption mt-1">Data: {data}</p>
      <p className="t-caption mt-1">Screen: {screen}</p>
      <div className="mt-4 border-t border-line pt-4">{children}</div>
    </section>
  );
}
