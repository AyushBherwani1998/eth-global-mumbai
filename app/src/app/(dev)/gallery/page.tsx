import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BandMeter, DemandLadder, ExchangeNotices, LifecycleRail, MarketStatus, StatGrid, SubscriptionMeter } from "@/components/rich";
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
          screen="IPO phase of the company page, above the chart; and the console Listing header."
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
          screen="IPO phase of the company page, under the chart; and the IPO card in the Markets list."
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
          screen="IPO phase of the company page, Overview tab; and the console Monitor step."
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

      <p className="t-caption mt-8">
        Prices are USDC per 1,000 shares. Sample data only — nothing on this page is read from a live endpoint.
      </p>
    </main>
  );
}

function Item({
  name,
  file,
  data,
  screen,
  children,
  className,
}: {
  name: string;
  file: string;
  data: string;
  screen: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
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
