"use client";

import Link from "next/link";
import { PrivacyBadge, TabHeader } from "@/components/shell";
import { Card, Change, Pill, TickerAvatar, modeTone } from "@/components/ui";
import { changeVs, lotFixed } from "@/lib/format";
import { IPOS, OFFER, getMarket, type PricePoint } from "@/lib/mock";
import { modeInfo } from "@/lib/policy";
import { BottomSpacer } from "./common";

export function Sparkline({ points, width = 84, height = 32 }: { points: PricePoint[]; width?: number; height?: number }) {
  const pts = points.slice(-72);
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (pts.length - 1)) * width).toFixed(1)},${(height - ((p.value - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--gain)" : "var(--loss)"} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function MarketListScreen() {
  const listed = IPOS.filter((i) => i.phase === "listed");
  return (
    <>
      <TabHeader title="Market" />
      <main className="px-4">
        <PrivacyBadge />
        <p className="mt-3 text-sm text-muted">
          Each listed SME trades in a Uniswap v4 pool. Its ListingHook reverts any swap that lands outside the rule in
          force.
        </p>
        <Card className="mt-4 divide-y divide-line">
          {listed.map((i) => {
            const m = getMarket(i.ticker)!;
            const last = m.prices[m.prices.length - 1].value;
            const ch = changeVs(last, OFFER.issuePrice);
            const info = modeInfo(m.policy);
            return (
              <Link key={i.ticker} href={`/market/${i.ticker}`} className="flex items-center gap-3 p-3">
                <TickerAvatar ipo={i} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-strong">{i.name}</p>
                  <Pill tone={modeTone(m.policy.halted ? "halted" : m.policy.mode)}>{info.label}</Pill>
                </div>
                <Sparkline points={m.prices} />
                <div className="w-[84px] text-right">
                  <p className="num text-[15px] font-medium text-strong">{lotFixed(last, 3)}</p>
                  <Change abs={ch.abs} rel={ch.rel} digits={3} className="block text-[11px]" />
                </div>
              </Link>
            );
          })}
        </Card>
        <p className="mt-3 text-xs text-muted">Prices in USDC per 1,000-share lot. Change is vs the 1.00 issue price.</p>
        <BottomSpacer />
      </main>
    </>
  );
}
