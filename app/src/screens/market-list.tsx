"use client";

// Markets, Stocks chip (UX.md 3.1): index strip, "Most traded" cards, the
// "All stocks" table, today's rule changes and the disclaimer. Listed
// companies only; IPOs live on the other chip. Every price is USDC per 1,000
// shares.
//
// Data comes from the backend: GET /v1/listings for what exists, then
// /v1/market/:ticker and /v1/market/:ticker/swaps for each listed company.
// Whatever the API returns is the whole list; there is no other source.
//
// The desktop list is a table, not a two-ended row: on a wide screen the span
// between the name and the price carries the facts that make this exchange
// different from a share list anywhere else -- the rule in force today and the
// prices it allows -- plus the day's range and the liquidity behind the quote.

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { TickerMark } from "@/components/company/logos";
import { Sparkline } from "@/components/sparkline";
import { Change, Card, CompanyCard, IndexCard, ListRow, PromoCard, SectionTitle, Skeleton, Table, TickerLogo, type Column } from "@/components/ui";
import { SkeletonCards, SkeletonList } from "@/components/states";
import { changeDigits } from "@/components/company/num";
import { changeVs, dateIST, lotFixed, shares as fmtShares, timeIST, usdc } from "@/lib/format";
import { COPY, dayOpenOf, eventDetail, eventWords, flagFor, hrefFor, isListed, isOpen, lastPriceOf, nowSeconds, pricePoints } from "@/lib/adapt";
import { ApiErrorCard } from "@/lib/api-state";
import { merge2, useListings, useQuotes, type Quote } from "@/lib/live";
import type { Listing } from "@/lib/api";

const DASH = "—";

type Row = {
  listing: Listing;
  quote: Quote | undefined;
  /** Null when the pool has never traded and has no listing price. */
  last: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  points: { time: number; value: number }[];
  flag?: { text: string; tone: "warn" | "loss" };
};

export function StocksBody() {
  const listings = useListings();
  const all = listings.data?.listings ?? [];
  const listed = all.filter(isListed);
  const quotes = useQuotes(listed.map((l) => l.ticker));
  const { error, loading, retry, refreshing } = merge2(listings, quotes);

  const nowSec = nowSeconds(listings.data?.now);
  const rows: Row[] = listed
    .map((listing) => {
      const quote = quotes.data?.find((q) => q.ticker === listing.ticker);
      const points = pricePoints(quote?.market ?? null);
      const last = lastPriceOf(quote?.market ?? null) ?? listing.clearingPrice;
      const today = points.filter((p) => p.time >= nowSec - 24 * 3600);
      const window = today.length > 1 ? today : points;
      return {
        listing,
        quote,
        last,
        open: dayOpenOf(points, nowSec) ?? last,
        low: window.length ? Math.min(...window.map((p) => p.value)) : null,
        high: window.length ? Math.max(...window.map((p) => p.value)) : null,
        points,
        flag: flagFor(quote?.market ?? null),
      };
    })
    .sort((a, b) => a.listing.name.localeCompare(b.listing.name));

  const openIpos = all.filter(isOpen).length;
  const priced = rows.filter((r) => r.last !== null && r.open !== null);

  // Composite: today's move of every listed company, based at 1,000.
  const sumLast = priced.reduce((s, r) => s + (r.last as number), 0);
  const sumOpen = priced.reduce((s, r) => s + (r.open as number), 0);
  const index = sumOpen > 0 ? (sumLast / sumOpen) * 1000 : null;
  const indexChange = index === null ? null : changeVs(index, 1000);
  const indexPoints = indexSeries(priced);

  // "Most traded": the listed companies with the most trades today.
  const traded = [...rows].sort((a, b) => (b.quote?.market.trades.length ?? 0) - (a.quote?.market.trades.length ?? 0)).slice(0, 4);

  if (error && rows.length === 0) return <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />;

  if (loading && rows.length === 0)
    return (
      <>
        <div className="mt-4 flex gap-4">
          <Skeleton h={68} className="flex-1 rounded-[10px]" />
          <Skeleton h={68} className="flex-1 rounded-[10px]" />
        </div>
        <SectionTitle>All stocks</SectionTitle>
        <SkeletonList rows={5} />
      </>
    );

  if (rows.length === 0)
    return (
      <Card className="mt-4 p-4">
        <p className="t-list-title text-text">No companies listed yet</p>
        <p className="t-body mt-1 text-text-2">Companies show up here the day their IPO lists.</p>
      </Card>
    );

  return (
    <>
      {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <IndexCard
          label="Thamba SME"
          value={index === null ? COPY.noPrice : index.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          change={
            indexChange ? (
              <Change abs={indexChange.abs} rel={indexChange.rel} digits={changeDigits(indexChange.abs)} />
            ) : (
              <span className="t-change-sm text-text-2">no trades yet</span>
            )
          }
          spark={indexPoints.length > 1 ? <Sparkline points={indexPoints} width={72} height={32} fill up={(indexChange?.abs ?? 0) >= 0} /> : undefined}
        />
        <IndexCard
          href="/?tab=ipo"
          label="IPOs open"
          value={String(openIpos)}
          change={<span className="t-change-sm text-text-2">{openIpos === 0 ? "none right now" : "taking applications"}</span>}
        />
      </div>

      {/* With one company on the exchange this would only repeat the list below. */}
      {rows.length > 1 && (
        <>
          <SectionTitle>Most traded</SectionTitle>
          {loading && !quotes.data ? (
            <SkeletonCards count={Math.min(4, rows.length)} className="grid-cols-2 lg:grid-cols-4" />
          ) : (
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
              {traded.map((r) => {
                const ch = r.last !== null && r.open ? changeVs(r.last, r.open) : null;
                return (
                  <CompanyCard
                    key={r.listing.ticker}
                    href={hrefFor(r.listing)}
                    logo={<TickerLogo ipo={r.listing} size={36} />}
                    name={r.listing.name}
                    price={r.last === null ? COPY.noPrice : lotFixed(r.last)}
                    change={ch ? <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} /> : undefined}
                    sub={
                      <>
                        <TickerMark ticker={r.listing.ticker} symbol={r.listing.symbol} /> · {ruleWords(r)}
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <SectionTitle>All stocks</SectionTitle>

      {/* Phone: two lines, the rule on the second so it is never hidden. */}
      <div className="divide-y divide-line lg:hidden">
        {rows.map((r) => {
          const ch = r.last !== null && r.open ? changeVs(r.last, r.open) : null;
          return (
            <ListRow
              key={r.listing.ticker}
              href={hrefFor(r.listing)}
              logo={<TickerLogo ipo={r.listing} size={40} />}
              title={r.listing.name}
              sub={
                <>
                  <TickerMark ticker={r.listing.ticker} symbol={r.listing.symbol} /> · {ruleWords(r)}
                </>
              }
              flag={r.flag}
              sparkline={r.points.length > 1 ? <Sparkline points={r.points} width={72} height={28} up={(ch?.abs ?? 0) >= 0} /> : undefined}
              right={r.last === null ? COPY.noPrice : lotFixed(r.last)}
              rightSub={ch ? <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} /> : undefined}
            />
          );
        })}
      </div>

      {/* Tablet: the rule and its limits, without the day range or liquidity. */}
      <div className="hidden lg:block xl:hidden">
        <Table columns={columns(false)} rows={rows} rowKey={(r) => r.listing.ticker} href={(r) => hrefFor(r.listing)} />
      </div>
      {/* Desktop: the full set. */}
      <div className="hidden xl:block">
        <Table columns={columns(true)} rows={rows} rowKey={(r) => r.listing.ticker} href={(r) => hrefFor(r.listing)} />
      </div>

      <RuleChanges rows={rows} />

      <PromoCard
        className="mt-5"
        href="/about"
        icon={<BookOpen />}
        title="Why a price can be turned away"
        sub="Every company trades inside limits the exchange sets each day. Here is how they work."
      />

      <p className="t-caption mt-6">
        Prices in USDC per 1,000 shares. Change is since today&apos;s open. Sepolia test network, not a regulated product.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function columns(full: boolean): Column<Row>[] {
  const out: Column<Row>[] = [
    {
      key: "company",
      label: "Company",
      width: full ? "26%" : "32%",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.listing} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.listing.name}</span>
            <span className="t-label block truncate">
              <TickerMark ticker={r.listing.ticker} symbol={r.listing.symbol} />
              {r.listing.listedAt ? ` · Listed ${dateIST(r.listing.listedAt)}` : ""}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "spark",
      label: "",
      width: "84px",
      render: (r) =>
        r.points.length > 1 ? (
          <Sparkline points={r.points} width={72} height={28} up={(r.last ?? 0) >= (r.open ?? 0)} />
        ) : (
          <span className="t-label">{DASH}</span>
        ),
    },
    {
      key: "price",
      label: "Price",
      align: "right",
      width: "10%",
      render: (r) => (r.last === null ? DASH : lotFixed(r.last)),
    },
    {
      key: "today",
      label: "Today",
      align: "right",
      width: "13%",
      render: (r) => {
        if (r.last === null || !r.open) return <span className="t-label">{DASH}</span>;
        const ch = changeVs(r.last, r.open);
        return <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} />;
      },
    },
  ];

  if (full)
    out.push({
      key: "range",
      label: "Day range",
      align: "right",
      width: "13%",
      render: (r) => (r.low === null || r.high === null ? DASH : `${lotFixed(r.low, 3)} – ${lotFixed(r.high, 3)}`),
    });

  out.push(
    {
      key: "rule",
      label: "Rule today",
      width: full ? "14%" : "16%",
      render: (r) => (
        <span className={r.flag?.tone === "loss" ? "text-loss-text" : r.flag ? "text-warn" : undefined}>{ruleWords(r)}</span>
      ),
    },
    {
      key: "limits",
      label: "Allowed today",
      align: "right",
      width: full ? "14%" : "16%",
      render: (r) => {
        const m = r.quote?.market;
        if (!m) return DASH;
        if (!m.band) return <span className="t-label">No trading</span>;
        return `${lotFixed(m.band.low, 3)} – ${lotFixed(m.band.high, 3)}`;
      },
    },
  );

  if (full)
    out.push({
      key: "liquidity",
      label: "Available",
      align: "right",
      width: "14%",
      render: (r) => {
        const m = r.quote?.market;
        if (!m) return DASH;
        return (
          <span className="block">
            {usdc(m.liquidity.usdc)} USDC
            <span className="t-label block">{fmtShares(m.liquidity.shares)} shares</span>
          </span>
        );
      },
    });

  return out;
}

/** The rule in force, in two or three words. */
function ruleWords(r: Row): string {
  const m = r.quote?.market;
  if (!m) return r.listing.listedAt ? `Listed ${dateIST(r.listing.listedAt)}` : "On the market";
  const width = `±${m.policy.bandBps / 100}%`;
  switch (m.mode) {
    case "halted":
      return "Halted";
    case "listing":
      return `Listing day ${width}`;
    case "surveillance":
      return `Under watch ${width}`;
    case "directional":
      return "One-way day";
    default:
      return `Normal ${width}`;
  }
}

// ---------------------------------------------------------------------------
// Today's rule changes: the exchange's own notice board, from the policy
// reports each company's hook is enforcing (GET /v1/market/:ticker `events`).
// ---------------------------------------------------------------------------

function RuleChanges({ rows }: { rows: Row[] }) {
  const notices = rows
    .flatMap((r) =>
      (r.quote?.market.events ?? []).map((e) => ({
        id: `${r.listing.ticker}-${e.tx}-${e.time}`,
        listing: r.listing,
        at: Date.parse(e.time),
        headline: eventWords(e.kind),
        detail: eventDetail(e.label),
      })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);

  if (notices.length === 0) return null;

  return (
    <>
      <SectionTitle>Latest rule changes</SectionTitle>
      <ul className="divide-y divide-line">
        {notices.map((n) => (
          <li key={n.id}>
            <Link href={hrefFor(n.listing)} className="flex min-h-14 items-center gap-3 py-3">
              <TickerLogo ipo={n.listing} size={28} />
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate text-text">
                  {n.listing.name}: {n.headline.toLowerCase()}
                </span>
                <span className="t-label block truncate">{n.detail}</span>
              </span>
              <span className="t-label shrink-0">{timeIST(n.at / 1000)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function indexSeries(rows: Row[]): { value: number; time: number }[] {
  const series = rows.map((r) => r.points).filter((p) => p.length > 1);
  if (series.length === 0) return [];
  const n = Math.min(...series.map((s) => s.length));
  const base = series[0][0]?.value || 1;
  const points: { value: number; time: number }[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const prices of series) sum += prices[i].value;
    points.push({ value: (sum / series.length / base) * 1000, time: series[0][i].time });
  }
  return points;
}
