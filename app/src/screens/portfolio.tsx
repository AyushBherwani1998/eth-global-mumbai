"use client";

// Portfolio (UX.md 3.8): what I own, what it's worth, how it did today.
//
// Everything here is something the backend can actually answer, from
// GET /v1/portfolio/:address: wallet balances (USDC, ETH), shares held (the
// token balance, so shares bought on the market count even with no IPO
// application), shares ready to collect, and the mark price and value. Today's
// move comes from the GET /v1/market/:ticker price points. There is no cost basis anywhere on chain, so
// there is no "invested", no "since you bought" and no average price, and the
// pool's own LP position is not attributable to a wallet, so the liquidity and
// fee cards are gone with it.

import Link from "next/link";
import { useMemo } from "react";

import { AppBar, AppSettingsRows, SignInCard } from "@/components/shell";
import { useApp } from "@/components/providers";
import { OfflineStrip, SkeletonList } from "@/components/states";
import { CompanyLogo, TickerMark, logoColor, markVar } from "@/components/company/logos";
import { Sparkline } from "@/components/sparkline";
import { Card, Change, Details, EmptyState, KV, ListRow, SectionTitle, Table, TextLink, TickerLogo, cx, type Column } from "@/components/ui";
import { lotFixed, shares, shortAddr, usdc } from "@/lib/format";
import { COPY, dayOpenOf, holdingRows, isListed, lastPriceOf, nowSeconds, orCopy, pricePoints } from "@/lib/adapt";
import { ApiErrorCard } from "@/lib/api-state";
import { FAUCET_URL } from "@/lib/mock";
import type { Listing } from "@/lib/api";
import { merge2, useListings, useQuotes } from "@/lib/live";
import { BottomSpacer } from "./common";

type Holding = {
  ticker: string;
  listing: Listing | undefined;
  /** Shares in the wallet (token balance). */
  held: number;
  /** Shares won and waiting to be collected. */
  waiting: number;
  /** Applications not settled yet: their share count is unknown until then. */
  pending: number;
  last: number | null;
  value: number | null;
  points: { time: number; value: number }[];
  today: { abs: number; rel: number } | null;
};

const toneClass = (n: number) => (n >= 0 ? "text-gain-text" : "text-loss-text");

function holdingSub(r: Holding): string {
  const parts = [`${shares(r.held + r.waiting)} shares`];
  if (r.waiting > 0) parts.push(`${shares(r.waiting)} to collect`);
  if (r.pending > 0) parts.push(`${r.pending} ${r.pending === 1 ? "application" : "applications"} to settle`);
  return parts.join(" · ");
}

/**
 * Totals band (UI.md 2.12, UX.md 3.8): the hero of the page. Every figure is
 * one the exchange can answer: what the shares are worth now, how many are
 * waiting to be collected, and the spendable USDC in the wallet.
 */
function TotalsBand({
  totalValue,
  waiting,
  cash,
  today,
}: {
  totalValue: number;
  waiting: number;
  cash: number | null;
  today: { abs: number; rel: number } | null;
}) {
  const cells: { label: string; value: string; tone?: number }[] = [
    { label: "Ready to collect", value: waiting > 0 ? `${shares(waiting)} shares` : "Nothing waiting" },
    { label: "USDC available", value: orCopy(cash, usdc, "Loading") },
  ];
  return (
    <Card className="mt-3 p-0">
      <div className="lg:flex lg:items-stretch">
        <div className="min-w-0 p-4 lg:w-[38%] lg:shrink-0 lg:p-6">
          <p className="t-label">Value of your shares</p>
          <p className="num t-price-large mt-1 text-text">{usdc(totalValue)} USDC</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="t-label">Today</span>
            {today ? <Change abs={today.abs} rel={today.rel} size="lg" /> : <span className="t-body text-text-2">{COPY.noPrice}</span>}
          </p>
        </div>
        <div className="grid grid-cols-2 border-t border-line lg:flex-1 lg:border-t-0">
          {cells.map((c, i) => (
            <div
              key={c.label}
              className={cx("min-w-0 p-4 lg:flex lg:flex-col lg:justify-center lg:p-6", i === 1 && "text-right", "lg:border-l lg:border-line")}
            >
              <p className="t-label">{c.label}</p>
              <p className={cx("num t-list-title mt-1", c.tone === undefined ? "text-text" : toneClass(c.tone))}>{c.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line px-4 py-3 lg:px-6">
        <p className="t-label">Prices in USDC per 1,000 shares. Value uses the last traded price.</p>
      </div>
    </Card>
  );
}

function Allocation({ rows, total }: { rows: Holding[]; total: number }) {
  const base = total || 1;
  return (
    <section>
      <SectionTitle>Where the value sits</SectionTitle>
      <div className="flex h-2 overflow-hidden bg-line" aria-hidden>
        {rows.map((r) => (
          <span key={r.ticker} style={{ width: `${((r.value ?? 0) / base) * 100}%`, background: logoColor(r.ticker) }} />
        ))}
      </div>
      <ul className="mt-2">
        {rows.map((r) => (
          <li key={r.ticker} className="flex h-12 items-center gap-3">
            <CompanyLogo ticker={r.ticker} size={20} />
            <span className="t-body min-w-0 flex-1 truncate text-text">{r.listing?.name ?? r.ticker.toUpperCase()}</span>
            <span className="num t-body font-medium" style={{ color: markVar(r.ticker) }}>
              {Math.round(((r.value ?? 0) / base) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PortfolioScreen() {
  const { connected, connect, usdcBalance, ethBalance, address, ensName, portfolio } = useApp();

  const listings = useListings();
  const all = useMemo(() => listings.data?.listings ?? [], [listings.data]);
  const quotes = useQuotes(all.filter(isListed).map((l) => l.ticker));
  const { error, loading, retry, refreshing } = merge2(listings, portfolio);
  const nowSec = nowSeconds(listings.data?.now);

  const rows: Holding[] = useMemo(
    () =>
      holdingRows(portfolio.data)
        .map((h) => {
          const listing = all.find((l) => l.ticker === h.ticker);
          const quote = quotes.data?.find((q) => q.ticker === h.ticker);
          const points = pricePoints(quote?.market ?? null);
          const last = h.price ?? lastPriceOf(quote?.market ?? null);
          const open = dayOpenOf(points, nowSec) ?? last;
          const qty = h.shares + h.unclaimedShares;
          return {
            ticker: h.ticker,
            listing,
            held: h.shares,
            waiting: h.unclaimedShares,
            pending: h.pendingBids,
            last,
            value: h.value,
            points,
            today: last !== null && open ? { abs: (qty * (last - open)) / 1000, rel: ((last - open) / open) * 100 } : null,
          };
        })
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [portfolio.data, quotes.data, all, nowSec],
  );

  // Signed out this page has nothing of its own to show, so it says exactly
  // what fills it, in the words the signed-in page uses for those same
  // sections, and offers one way to get there. Appearance and About sit at the
  // foot: they are the only settings that work without an account, and
  // Portfolio is the "you" tab, one tap from the nav on every screen.
  if (!connected)
    return (
      <>
        <AppBar title="Portfolio" />
        <OfflineStrip className="-mx-5" />
        <main className="lg:max-w-[640px]">
          <SignInCard
            className="mt-4"
            title="Your investments live here"
            body="Sign in and this page fills in with everything you hold, priced at the last trade."
            points={[
              "The value of your shares, and how it moved today",
              "Every company you hold, with its price and today's change",
              "Shares waiting to be collected from an IPO",
              "Your USDC available to spend",
            ]}
          />
          <p className="t-body mt-6 text-text-2">
            Nothing to sign in for yet? <TextLink href="/">See the companies listed today</TextLink>
          </p>
          <AppSettingsRows className="mt-8" />
          <BottomSpacer />
        </main>
      </>
    );

  const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const todayAbs = rows.reduce((s, r) => s + (r.today?.abs ?? 0), 0);
  const anyToday = rows.some((r) => r.today !== null);
  const todayRel = totalValue - todayAbs > 0 ? (todayAbs / (totalValue - todayAbs)) * 100 : 0;
  const waiting = rows.reduce((s, r) => s + r.waiting, 0);
  const lowCash = usdcBalance !== null && usdcBalance < 20;

  const cash = (
    <>
      <SectionTitle>Cash</SectionTitle>
      <Card className="p-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="t-body text-text">USDC available</p>
          <p className="num t-list-title text-text">{orCopy(usdcBalance, usdc, "Loading")}</p>
        </div>
        <p className="t-label mt-1">This is what you can spend on shares and IPO applications.</p>
        {lowCash && (
          <p className="mt-1">
            <TextLink href={FAUCET_URL}>Get free test USDC</TextLink>
          </p>
        )}
        <Details className="mt-3">
          <div className="divide-y divide-line">
            <KV k="ETH for network fees" v={orCopy(ethBalance, (n) => n.toFixed(4), "Loading")} />
            <KV k="Signed in as" v={ensName ?? shortAddr(address)} />
          </div>
        </Details>
      </Card>
    </>
  );

  if (loading && rows.length === 0)
    return (
      <>
        <AppBar title="Portfolio" />
        <OfflineStrip className="-mx-5" />
        <main>
          {error ? <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} /> : <SkeletonList rows={3} className="mt-4" />}
          <BottomSpacer />
        </main>
      </>
    );

  if (rows.length === 0)
    return (
      <>
        <AppBar title="Portfolio" />
        <OfflineStrip className="-mx-5" />
        <main>
          {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}
          <EmptyState
            title="Nothing here yet"
            body="Shares you buy, or get from an IPO once you collect them, show up here."
            action={{ label: "See companies", href: "/" }}
          />
          <div className="mt-2 lg:max-w-[400px]">{cash}</div>
          <BottomSpacer />
        </main>
      </>
    );

  const holdingColumns: Column<Holding>[] = [
    {
      key: "company",
      label: "Company",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.listing ?? { ticker: r.ticker }} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.listing?.name ?? r.ticker.toUpperCase()}</span>
            <span className="num t-label block">
              {r.listing && <TickerMark ticker={r.ticker} symbol={r.listing.symbol} />} {r.listing ? "· " : ""}
              {holdingSub(r)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "spark",
      label: "",
      width: "80px",
      align: "right",
      // An <svg> is display:block under preflight, so text-align cannot move
      // it. The wrapper is what actually puts it on the column's right edge.
      render: (r) =>
        r.points.length > 1 ? (
          <span className="flex justify-end">
            <Sparkline points={r.points} width={72} height={28} up={(r.today?.abs ?? 0) >= 0} />
          </span>
        ) : null,
    },
    { key: "price", label: "Price", align: "right", render: (r) => (r.last === null ? COPY.noPrice : lotFixed(r.last)) },
    { key: "value", label: "Value", align: "right", render: (r) => (r.value === null ? COPY.noPrice : usdc(r.value)) },
    {
      key: "today",
      label: "Today",
      align: "right",
      render: (r) => (r.today ? <Change abs={r.today.abs} rel={r.today.rel} /> : <span className="t-label">{COPY.noPrice}</span>),
    },
  ];

  return (
    <>
      <AppBar title="Portfolio" />
      <OfflineStrip className="-mx-5" />
      <main>
        {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

        <SectionTitle>Your investments ({rows.length})</SectionTitle>
        <TotalsBand totalValue={totalValue} waiting={waiting} cash={usdcBalance} today={anyToday ? { abs: todayAbs, rel: todayRel } : null} />

        {waiting > 0 && (
          <Link href="/orders" className="mt-3 block">
            <Card className="flex min-h-14 items-center gap-3 p-4" interactive>
              <p className="t-body flex-1 text-text">
                <span className="text-warn">{shares(waiting)} shares waiting.</span> Collect them in Orders.
              </p>
              <span className="t-change-sm shrink-0 text-gain-text">Open Orders</span>
            </Card>
          </Link>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0">
            <SectionTitle>Your shares ({rows.length})</SectionTitle>
            <div className="divide-y divide-line lg:hidden">
              {rows.map((r) => (
                <ListRow
                  key={r.ticker}
                  href={`/stock/${r.ticker}`}
                  logo={<TickerLogo ipo={r.listing ?? { ticker: r.ticker }} size={40} />}
                  title={r.listing?.name ?? r.ticker.toUpperCase()}
                  sub={holdingSub(r)}
                  sparkline={r.points.length > 1 ? <Sparkline points={r.points} width={56} height={26} up={(r.today?.abs ?? 0) >= 0} /> : undefined}
                  right={r.value === null ? COPY.noPrice : usdc(r.value)}
                  rightSub={r.today ? <Change abs={r.today.abs} rel={r.today.rel} /> : undefined}
                />
              ))}
            </div>
            <div className="hidden lg:block">
              <Table columns={holdingColumns} rows={rows} rowKey={(r) => r.ticker} href={(r) => `/stock/${r.ticker}`} />
            </div>

            {rows.length > 1 && <Allocation rows={rows} total={totalValue} />}
          </div>

          <div className="min-w-0">{cash}</div>
        </div>

        <p className="t-caption mt-8 border-t border-line pt-4">
          Value uses the last traded price and includes shares waiting to be collected. Sepolia test network, not a regulated product.
        </p>
        <BottomSpacer />
      </main>
    </>
  );
}
