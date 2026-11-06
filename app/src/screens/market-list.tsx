"use client";

// Markets, Stocks chip (UX.md 3.1): index strip, "Most traded" cards, the
// "All stocks" rows and the disclaimer. Listed companies only; IPOs live on
// the other chip. Every price is USDC per 1,000 shares.

import { Change, Card, CompanyCard, IndexCard, ListRow, SectionTitle, Skeleton, TickerLogo } from "@/components/ui";
import { ErrorCard, SkeletonCards, SkeletonList } from "@/components/states";
import { useMockLoad } from "@/components/company/load";
import { changeDigits } from "@/components/company/num";
import { changeVs, lotFixed } from "@/lib/format";
import { IPOS, dayOpen, getMarket, hrefFor, type Ipo, type Market } from "@/lib/mock";

type Row = { ipo: Ipo; market: Market; last: number; open: number; flag?: { text: string; tone: "warn" | "loss" } };

function rows(): Row[] {
  return IPOS.filter((i) => i.phase === "listed")
    .map((ipo) => {
      const market = getMarket(ipo.ticker)!;
      const last = market.prices[market.prices.length - 1].value;
      const open = dayOpen(ipo.ticker) ?? last;
      const halted = market.policy.halted || market.policy.mode === "halted";
      const watch = !halted && (market.policy.mode === "surveillance" || market.policy.mode === "directional");
      return {
        ipo,
        market,
        last,
        open,
        flag: halted ? { text: "Halted", tone: "loss" as const } : watch ? { text: "Watch", tone: "warn" as const } : undefined,
      };
    })
    .sort((a, b) => a.ipo.name.localeCompare(b.ipo.name));
}

export function StocksBody() {
  const { loading, error, retry, retrying } = useMockLoad();
  const all = rows();
  const openIpos = IPOS.filter((i) => i.phase === "live").length;

  // Composite: today's move of every listed company, based at 1,000.
  const sumLast = all.reduce((s, r) => s + r.last, 0);
  const sumOpen = all.reduce((s, r) => s + r.open, 0);
  const index = sumOpen > 0 ? (sumLast / sumOpen) * 1000 : 1000;
  const indexChange = changeVs(index, 1000);

  // "Most traded": the four listed companies with the most trades today.
  const traded = [...all].sort((a, b) => b.market.trades.length - a.market.trades.length).slice(0, 4);

  if (loading)
    return (
      <>
        <div className="mt-4 flex gap-4">
          <Skeleton h={68} className="flex-1 rounded-[10px]" />
          <Skeleton h={68} className="flex-1 rounded-[10px]" />
        </div>
        <SectionTitle>Most traded</SectionTitle>
        <SkeletonCards count={4} className="grid-cols-2 lg:grid-cols-3" />
        <SectionTitle>All stocks</SectionTitle>
        <SkeletonList rows={5} />
      </>
    );

  if (error)
    return (
      <ErrorCard
        className="mt-4"
        title="We couldn't load prices privately"
        body="Your private connection didn't answer. Check your internet and try again."
        onRetry={retry}
        retrying={retrying}
      />
    );

  if (all.length === 0)
    return (
      <Card className="mt-4 p-4">
        <p className="t-list-title text-text">No companies listed yet</p>
        <p className="t-body mt-1 text-text-2">Companies show up here the day their IPO lists.</p>
      </Card>
    );

  return (
    <>
      <div className="mt-4 flex gap-4">
        <IndexCard
          label="Listing Day SME"
          value={index.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          change={<Change abs={indexChange.abs} rel={indexChange.rel} digits={changeDigits(indexChange.abs)} />}
        />
        <IndexCard
          href="/?tab=ipo"
          label="IPOs open"
          value={String(openIpos)}
          change={<span className="t-change-sm text-text-2">taking applications</span>}
        />
      </div>

      <SectionTitle>Most traded</SectionTitle>
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
        {traded.map((r) => {
          const ch = changeVs(r.last, r.open);
          return (
            <CompanyCard
              key={r.ipo.ticker}
              href={hrefFor(r.ipo)}
              logo={<TickerLogo ipo={r.ipo} size={36} />}
              name={r.ipo.name}
              price={lotFixed(r.last)}
              change={<Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} />}
              sub={r.flag ? (r.flag.tone === "loss" ? "Trading halted" : "Under watch today") : r.ipo.sector}
            />
          );
        })}
      </div>

      <SectionTitle>All stocks</SectionTitle>
      <div className="divide-y divide-line">
        {all.map((r) => {
          const ch = changeVs(r.last, r.open);
          return (
            <ListRow
              key={r.ipo.ticker}
              href={hrefFor(r.ipo)}
              logo={<TickerLogo ipo={r.ipo} size={40} />}
              title={r.ipo.name}
              sub={r.ipo.sector}
              flag={r.flag}
              right={lotFixed(r.last)}
              rightSub={<Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} />}
            />
          );
        })}
      </div>

      <p className="t-caption mt-6">
        Prices in USDC per 1,000 shares. Change is since today&apos;s open. NSE-inspired mock, not a regulated product.
      </p>
    </>
  );
}
