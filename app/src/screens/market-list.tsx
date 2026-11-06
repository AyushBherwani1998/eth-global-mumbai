"use client";

// Stocks chip body (UX.md 3.1), stopgap: "All stocks" list rows with today's change.

import { Change, ListRow, SectionTitle, TickerLogo } from "@/components/ui";
import { changeVs, lotFixed } from "@/lib/format";
import { IPOS, dayOpen, getMarket, hrefFor } from "@/lib/mock";

export function StocksBody() {
  const listed = IPOS.filter((i) => i.phase === "listed");
  return (
    <>
      <SectionTitle>All stocks</SectionTitle>
      <div className="divide-y divide-line">
        {listed.map((i) => {
          const m = getMarket(i.ticker)!;
          const last = m.prices[m.prices.length - 1].value;
          const ch = changeVs(last, dayOpen(i.ticker) ?? last);
          const halted = m.policy.halted || m.policy.mode === "halted";
          const watch = !halted && (m.policy.mode === "surveillance" || m.policy.mode === "directional");
          return (
            <ListRow
              key={i.ticker}
              href={hrefFor(i)}
              logo={<TickerLogo ipo={i} size={40} />}
              title={i.name}
              sub={i.sector}
              flag={halted ? { text: "Halted", tone: "loss" } : watch ? { text: "Watch", tone: "warn" } : undefined}
              right={lotFixed(last)}
              rightSub={<Change abs={ch.abs} rel={ch.rel} />}
            />
          );
        })}
      </div>
      <p className="t-caption mt-6">Prices in USDC per lot of 1,000 shares. Change is since today&apos;s open. NSE-inspired mock, not a regulated product.</p>
    </>
  );
}
