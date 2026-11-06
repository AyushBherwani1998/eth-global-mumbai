"use client";

// One company page for every phase (UX.md 3.3 and 3.4): listed, IPO open,
// IPO upcoming and IPO closed without a listing. Same route, same header,
// same company block; only the middle of the page changes.
// Protocol words live in the Details tab and nowhere else.
//
// Data: GET /v1/listings/:ticker for the company and its offer, then either
// /v1/market/:ticker + /swaps (listed) or /v1/auction/:ticker + /clearing
// (every IPO phase), plus /v1/bids?owner= for this wallet's own applications.
// Nothing on this page comes from a fixture.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, ExternalLink, Wallet } from "lucide-react";
import { ActionBar, DetailBar, ShareButton, SignInButton, SignInCard, TwoColumn } from "@/components/shell";
import { CircuitBanner, ruleCopy } from "@/components/circuit-banner";
import { useApp } from "@/components/providers";
import { ChartSkeleton } from "@/components/chart/skeleton";
import { TickerMark, markVar } from "@/components/company/logos";
import { changeDigits, countdown } from "@/components/company/num";
import {
  FullscreenChart,
  PriceChart,
  RANGE_OPTIONS,
  RANGE_WORDS,
  RangeChips,
  sliceRange,
  type ChartLine,
  type ChartRange,
  type HoverPoint,
} from "@/components/time-chart";
import { ChartTypeToggle, ExpandButton, RangeChipRow, useChartType } from "@/components/chart/controls";
import {
  Button,
  Card,
  Change,
  CopyAddress,
  Details,
  EmptyState,
  KV,
  ProgressBar,
  PromoCard,
  StatusChip,
  TextLink,
  TickerLogo,
  UnderlineTabs,
  cx,
} from "@/components/ui";
import { useCountdown, blocksAsSeconds } from "@/lib/hooks";
import { BLOCK_SECONDS, changeVs, dateTimeIST, lotFixed, perShare, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { COPY, dayOpenOf, eventDetail, eventWords, lastPriceOf, orCopy, pricePoints, seriesNow, toMarket, toPolicy } from "@/lib/adapt";
import { ApiErrorCard } from "@/lib/api-state";
import type { Auction, ClearingResponse, ListingDetail, MarketView, SwapsResponse } from "@/lib/api";
import { merge2, useAuction, useBids, useClearing, useListing, useMarket, useSwaps } from "@/lib/live";
import type { Policy, Rejected } from "@/lib/mock";
import { SURVEILLANCE_BAND_BPS, band, bandDigits, bandText } from "@/lib/policy";
import { useApplyForm, ApplySheet } from "./bid-sheet";
import { TradeSheet, useTradeForm, type TradeSide } from "./trade-sheet";

export function CompanyScreen({ ticker }: { ticker: string }) {
  const listing = useListing(ticker);
  const l = listing.data;

  if (!l)
    return (
      <>
        <DetailBar />
        <main>
          {listing.error ? (
            <ApiErrorCard className="mt-4" error={listing.error} onRetry={listing.retry} retrying={listing.refreshing} />
          ) : (
            <ChartSkeleton className="mt-6" height={280} />
          )}
        </main>
      </>
    );

  if (l.phase === "listed") return <ListedCompany listing={l} />;
  return <IpoCompany listing={l} />;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Company identity, price and today's facts.
 *
 * Phone is the layout Groww uses and the one the owner signed off: mark, name,
 * ticker, price, change, all on one left edge. It is identical in all three
 * desktop variants below and does not change.
 *
 * Desktop is the open question, so it is built three ways and switched with
 * `?head=1|2|3` (variant 1 ships). Every one of them has to leave no element
 * floating: the price belongs to the name, and the status chip, Share and the
 * facts each have a home with an edge shared with something.
 */
export type HeadVariant = 1 | 2 | 3;

type HeadPrice = {
  /** "Current price" / "Final price". Listed shares carry no label. */
  label?: string;
  value: string;
  num?: boolean;
  change?: ReactNode;
  /** "Last 24 hours", "vs issue price". */
  note?: ReactNode;
  /** "Closes in 41m 49s". */
  extra?: ReactNode;
};

type HeadFact = { k: string; v: string };

const UNIT_LINE = "Prices in USDC per 1,000 shares";

function VerifiedLine({ listing, onDetails, className }: { listing: ListingDetail; onDetails: () => void; className?: string }) {
  return (
    <p className={cx("t-label flex flex-wrap items-center gap-x-2", className)}>
      <TickerMark ticker={listing.ticker} symbol={listing.symbol} />
      <span aria-hidden>·</span>
      <button type="button" onClick={onDetails} className="t-label inline-flex items-center gap-1 text-gain-text">
        <BadgeCheck className="size-4" aria-hidden /> Verified
      </button>
    </p>
  );
}

function ChangeLine({ price, className }: { price: HeadPrice; className?: string }) {
  return (
    <p className={cx("flex items-baseline gap-2 whitespace-nowrap", className)}>
      {price.change}
      {/* The note swaps between a range word and a timestamp as the pointer
          moves across the chart. Both sit in a grid column that sizes to its
          content, so letting it resize would shift the name beside it on every
          hover. The slot is reserved for the longer of the two and the text
          cannot wrap, so nothing moves. */}
      {price.note && (
        <span className="t-body min-w-[14ch] text-text-2 tabular-nums">{price.note}</span>
      )}
    </p>
  );
}

/**
 * Variant 1 ships. 2 and 3 stay reachable at `?head=2` / `?head=3` only so the
 * owner can flip between them live; delete the two losers once the call is
 * final. See the comparison at /tmp/header-variants.png.
 */
function headVariant(raw: string | null): HeadVariant {
  return raw === "2" ? 2 : raw === "3" ? 3 : 1;
}

function CompanyHead({
  listing,
  onDetails,
  price,
  facts,
  variant = 1,
}: {
  listing: ListingDetail;
  onDetails: () => void;
  price?: HeadPrice;
  facts?: HeadFact[];
  variant?: HeadVariant;
}) {
  const bigPrice = price && (
    <p className={cx("t-price-large min-w-[5ch] text-text tabular-nums", price.num && "num")}>{price.value}</p>
  );
  const share = <ShareButton title={listing.name} />;
  const chip = <StatusChip ipo={listing} />;

  return (
    <>
      {/* Phone. Unchanged in every variant. */}
      <div className="pt-2 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <TickerLogo ipo={listing} size={40} />
          {share}
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className="text-[20px] leading-7 font-medium text-text">{listing.name}</h1>
          <span className="mt-0.5 shrink-0">{chip}</span>
        </div>
        <VerifiedLine listing={listing} onDetails={onDetails} className="mt-1" />
        {price && (
          <div className="mt-4">
            {price.label && <p className="t-label">{price.label}</p>}
            {bigPrice}
            <ChangeLine price={price} className="mt-1" />
            {price.extra}
            <p className="t-caption mt-1">{UNIT_LINE}</p>
          </div>
        )}
      </div>

      {/* 1. Price on the name's line: mark, name, number read left to right as
             one sentence; ticker and change sit under their own halves; the
             facts run the full width underneath so nothing is an island. */}
      {variant === 1 && (
        <div className="hidden pt-2 lg:block">
          <div className="flex items-start gap-5">
            <TickerLogo ipo={listing} size={44} className="mt-1 shrink-0" />
            <div className="grid min-w-0 flex-1 grid-cols-[auto_auto] items-baseline justify-start gap-x-10">
              <h1 className="text-[26px] leading-9 font-medium text-text">{listing.name}</h1>
              {bigPrice}
              <VerifiedLine listing={listing} onDetails={onDetails} className="mt-1" />
              {price && <ChangeLine price={price} className="mt-1" />}
              {/* Anything else about the price stays in the price's own column,
                  so the cluster never spills back to the page edge. */}
              <span />
              <span>{price?.extra}</span>
              <span />
              <p className="t-caption mt-1">{UNIT_LINE}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {chip}
              {share}
            </div>
          </div>
          {facts && facts.length > 0 && (
            <dl className="mt-5 flex items-stretch divide-x divide-line border-t border-line pt-4">
              {facts.map((f) => (
                <div key={f.k} className="min-w-0 flex-1 px-8 first:pl-0 last:pr-0">
                  <dt className="t-label">{f.k}</dt>
                  <dd className="num t-list-title mt-0.5 text-text">{f.v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* 2. The phone stack scaled up, with the right half given a real edge:
             a ruled column holding the status, Share and the day's facts, so
             the two halves share a border instead of floating apart. */}
      {variant === 2 && (
        <div className="hidden items-stretch gap-10 pt-2 lg:flex">
          <div className="min-w-0 flex-1">
            <TickerLogo ipo={listing} size={48} />
            <h1 className="mt-3 text-[26px] leading-9 font-medium text-text">{listing.name}</h1>
            <VerifiedLine listing={listing} onDetails={onDetails} className="mt-1" />
            {price && (
              <div className="mt-4">
                {price.label && <p className="t-label">{price.label}</p>}
                {bigPrice}
                <ChangeLine price={price} className="mt-1" />
                {price.extra}
                <p className="t-caption mt-1">{UNIT_LINE}</p>
              </div>
            )}
          </div>
          <div className="flex w-[320px] shrink-0 flex-col border-l border-line pl-8">
            <div className="flex items-center justify-end gap-3">
              {chip}
              {share}
            </div>
            {facts && facts.length > 0 && (
              <dl className="mt-auto divide-y divide-line border-t border-line">
                {facts.map((f) => (
                  <div key={f.k} className="flex min-h-11 items-center justify-between gap-4 py-2">
                    <dt className="t-label">{f.k}</dt>
                    <dd className="num t-body text-text">{f.v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}

      {/* 3. One band, ruled top and bottom and divided into cells, which is the
             layout language the brand already uses (design/brand/TOKENS.md).
             Identity and price fill the first cell, each fact gets its own,
             and Share closes the row: every edge is shared, nothing floats. */}
      {variant === 3 && (
        <div className="mt-2 hidden border-y border-line lg:block">
          <div className="flex items-stretch divide-x divide-line">
            <div className="min-w-0 flex-1 py-5 pr-8">
              <div className="flex items-start gap-4">
                <TickerLogo ipo={listing} size={44} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h1 className="text-[26px] leading-9 font-medium text-text">{listing.name}</h1>
                    {chip}
                  </div>
                  <VerifiedLine listing={listing} onDetails={onDetails} className="mt-0.5" />
                </div>
              </div>
              {price && (
                <div className="mt-4">
                  {price.label && <p className="t-label">{price.label}</p>}
                  {bigPrice}
                  <ChangeLine price={price} className="mt-1" />
                  {price.extra}
                  <p className="t-caption mt-1">{UNIT_LINE}</p>
                </div>
              )}
            </div>
            {(facts ?? []).map((f) => (
              <div key={f.k} className="flex w-[200px] shrink-0 flex-col justify-end py-5 pl-8">
                <dt className="t-label">{f.k}</dt>
                <dd className="num t-list-title mt-0.5 text-text">{f.v}</dd>
              </div>
            ))}
            <div className="flex shrink-0 items-end py-5 pl-8">{share}</div>
          </div>
        </div>
      )}
    </>
  );
}




function Description({ listing }: { listing: ListingDetail }) {
  return <p className="t-body text-text">{listing.description ?? COPY.noDescription}</p>;
}

function EnsRows({ listing }: { listing: ListingDetail }) {
  const rows: [string, string | null][] = [
    ["Share token", listing.records.addr],
    ["IPO auction", listing.records.auction],
    ["Trading rule hook", listing.records.hook],
    ["Policy contract", listing.records.policy],
    ["Pool id", listing.records.pool],
  ];
  return (
    <div className="pt-2">
      <div className="divide-y divide-line">
        <KV k="Name on ENS" v={listing.ensName} mono />
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
            <span className="t-label shrink-0">{k}</span>
            <CopyAddress value={v} label={v && v.length > 42 ? `${v.slice(0, 10)}…${v.slice(-6)}` : undefined} />
          </div>
        ))}
        <KV k="Ticker status" v={listing.status} mono />
        <KV k="Where that came from" v={listing.statusSource} mono />
        <KV k="Who can apply" v={listing.eligibility === "human" ? "human (one per person)" : "open"} mono />
      </div>
      <p className="t-caption mt-2">Only the exchange may write the ticker status; every other record belongs to the company.</p>
      <a
        href={`https://sepolia.app.ens.domains/${listing.ensName}`}
        target="_blank"
        rel="noreferrer"
        className="prose-link t-change-sm inline-flex items-center gap-1 text-gain-text"
      >
        View in the ENS app <ExternalLink className="size-4" />
      </a>
    </div>
  );
}

function rejectSentence(r: Rejected, policy: Policy) {
  if (r.reason === "Halted") return "Trading was halted at the time.";
  const d = bandDigits(policy.referencePrice, policy.bandBps);
  const { lo, hi } = band(policy.referencePrice, policy.bandBps);
  if (r.reason === "DirectionalWidening")
    return `Would have moved the price to ${r.priceAfter.toFixed(3)}, further from ${lotFixed(policy.referencePrice)} than ${bandText(policy.referencePrice, SURVEILLANCE_BAND_BPS)}.`;
  const above = r.priceAfter > hi;
  return `Would have moved the price to ${r.priceAfter.toFixed(3)}, ${above ? "above" : "below"} today's limit of ${lotFixed(above ? hi : lo, d)}.`;
}

// ---------------------------------------------------------------------------
// Listed company (UX.md 3.3)
// ---------------------------------------------------------------------------

type ListedTab = "overview" | "trades" | "rejected" | "details";

function ListedCompany({ listing }: { listing: ListingDetail }) {
  const params = useSearchParams();
  const { connected, address } = useApp();
  const marketRead = useMarket(listing.ticker);
  const swapsRead = useSwaps(listing.ticker);
  const bidsRead = useBids(connected ? address : null, listing.ticker);
  const { error, loading, retry, refreshing } = merge2(marketRead, swapsRead);

  const [range, setRange] = useState<ChartRange>("1D");
  const [chartType, setChartType] = useChartType();
  const [tab, setTab] = useState<ListedTab>("overview");
  const [hover, setHover] = useState<HoverPoint>(null);
  const [sheet, setSheet] = useState<TradeSide | null>(null);
  const [side, setSide] = useState<TradeSide>("buy");
  const [expanded, setExpanded] = useState(false);
  // Reverted swaps leave no log, so the only ones the app can show are the
  // ones it watched fail in this session.
  const [seenRejected, setSeenRejected] = useState<Rejected[]>([]);

  const marketView: MarketView | null = marketRead.data;
  const swaps: SwapsResponse | null = swapsRead.data;
  const policy = toPolicy(marketView?.policy);
  const market = useMemo(() => toMarket(marketView, swaps), [marketView, swaps]);
  const halted = marketView ? marketView.mode === "halted" || marketView.policy.halted : false;

  const points = useMemo(() => pricePoints(swaps), [swaps]);
  // The pool's own clock: the last point it produced. Never the machine clock.
  const nowSec = seriesNow(points, marketView?.policy.asOf ?? listing.listedAt);
  const last = lastPriceOf(marketView, swaps);
  const shown = hover?.value ?? last;

  const data = useMemo(() => (points.length > 1 ? sliceRange(points, range, nowSec) : points), [points, range, nowSec]);
  const base = data[0]?.value ?? null;
  const change = shown !== null && base !== null ? changeVs(shown, base) : null;
  const rejectTimes = useMemo(() => seenRejected.map((r) => new Date(r.time).getTime() / 1000), [seenRejected]);

  const owned = useMemo(() => {
    const mine = bidsRead.data?.bids ?? [];
    return mine.reduce((s, b) => s + (b.claimed || b.actions.claim ? (b.filledShares ?? 0) : 0), 0);
  }, [bidsRead.data]);
  const toCollect = useMemo(
    () => (bidsRead.data?.bids ?? []).reduce((s, b) => s + (b.actions.claim ? (b.filledShares ?? 0) : 0), 0),
    [bidsRead.data],
  );

  const daySeries = useMemo(() => (points.length > 1 ? sliceRange(points, "1D", nowSec) : points), [points, nowSec]);
  const dayLow = daySeries.length ? Math.min(...daySeries.map((d) => d.value)) : null;
  const dayHigh = daySeries.length ? Math.max(...daySeries.map((d) => d.value)) : null;
  const dayOpen = dayOpenOf(points, nowSec);

  const openSheet = (s: TradeSide) => {
    setSide(s);
    setSheet(s);
  };

  const win = useMemo(() => {
    if (data.length === 0) return null;
    const vals = data.map((d) => d.value);
    return { open: data[0].value, high: Math.max(...vals), low: Math.min(...vals), close: data[data.length - 1].value };
  }, [data]);

  const chart = (height: number, fullscreen = false) => (
    <PriceChart
      data={data}
      kind="market"
      type={chartType}
      baseline={base ?? undefined}
      reference={market?.reference}
      rejects={rejectTimes}
      digits={3}
      height={height}
      onHover={setHover}
      readout={fullscreen}
      axes={fullscreen}
      detail={fullscreen}
    />
  );

  const chartControls = (
    <>
      <RangeChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} className="lg:w-[412px] lg:shrink-0" />
      <div className="mt-1 flex items-center justify-between lg:mt-0">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        <ExpandButton onClick={() => setExpanded(true)} />
      </div>
    </>
  );

  return (
    <>
      <DetailBar />
      <TwoColumn
        panel={<OrderPanel listing={listing} market={market} last={last} side={side} setSide={setSide} onRejected={(r) => setSeenRejected((x) => [r, ...x])} />}
      >
        <main>
          <CompanyHead
            listing={listing}
            variant={headVariant(params.get("head"))}
            onDetails={() => setTab("details")}
            price={
              marketView
                ? {
                    value: shown === null ? COPY.noPrice : lotFixed(shown),
                    num: shown !== null,
                    change: change ? <Change abs={change.abs} rel={change.rel} digits={changeDigits(change.abs)} size="lg" /> : undefined,
                    note: hover ? dateTimeIST(hover.time) : change ? RANGE_WORDS[range] : "No trades in this pool yet",
                  }
                : undefined
            }
            facts={[
              {
                k: "Today's range",
                v: dayLow !== null && dayHigh !== null ? `${lotFixed(dayLow)} to ${lotFixed(dayHigh)}` : COPY.noPrice,
              },
              { k: "Available to trade", v: marketView ? `${usdc(marketView.liquidity.usdc)} USDC` : COPY.noPrice },
            ]}
          />

          {loading && !marketView ? (
            <ChartSkeleton className="mt-2" height={280} />
          ) : error && !marketView ? (
            <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />
          ) : (
            <>
              {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

              {policy && (
                <div className="mt-6">
                  <CircuitBanner ticker={listing.ticker} policy={policy} />
                </div>
              )}

              {data.length > 1 ? (
                <>
                  <div className="mt-6">{chart(280)}</div>

                  {chartType === "bars" && win && (
                    <dl className="num mt-2 grid grid-cols-4 gap-2 text-[13px] leading-[18px]">
                      {([
                        ["Open", win.open],
                        ["High", win.high],
                        ["Low", win.low],
                        ["Close", win.close],
                      ] as const).map(([k, v]) => (
                        <div key={k}>
                          <dt className="t-caption">{k}</dt>
                          <dd className="text-text">{lotFixed(v, 3)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="dotted-line mt-3 pt-2 lg:flex lg:items-center lg:justify-between lg:gap-6">{chartControls}</div>
                </>
              ) : (
                <Card className="mt-4 p-4">
                  <p className="t-list-title text-text">No trades yet</p>
                  <p className="t-body mt-1 text-text-2">
                    The chart starts as soon as this company&apos;s shares change hands. It listed at{" "}
                    {orCopy(marketView?.listingPrice ?? listing.clearingPrice, (p) => lotFixed(p), COPY.noClearing)}.
                  </p>
                </Card>
              )}

              <div className="mt-6">
                {connected ? (
                  <PromoCard
                    href="/portfolio"
                    icon={<Wallet />}
                    title={
                      owned > 0
                        ? last !== null
                          ? `You own ${shares(owned)} shares · worth ${usdc((owned * last) / 1000)} USDC`
                          : `You own ${shares(owned)} shares`
                        : "You don't own any shares yet"
                    }
                    sub={
                      owned > 0
                        ? toCollect > 0
                          ? `${shares(toCollect)} shares ready to collect in Orders`
                          : "Shares you got from the IPO"
                        : "Shares you get from an IPO show up here"
                    }
                  />
                ) : (
                  <SignInCard
                    quiet
                    title="Your shares in this company"
                    body={`Sign in and what you hold in ${listing.name}, and what it is worth today, shows up here.`}
                  />
                )}
              </div>

              <div className="mt-6">
                <UnderlineTabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: "overview", label: "Overview" },
                    { id: "trades", label: "Trades" },
                    { id: "rejected", label: "Rejected", count: seenRejected.length },
                    { id: "details", label: "Details" },
                  ]}
                />
              </div>

              {tab === "overview" && (
                <div className="pt-3">
                  <Description listing={listing} />
                  {dayLow !== null && dayHigh !== null && last !== null && (
                    <DayRange low={dayLow} high={dayHigh} price={last} />
                  )}
                  <div className="mt-4 divide-y divide-line">
                    <KV
                      k="Listing price"
                      v={orCopy(marketView?.listingPrice ?? listing.clearingPrice, (p) => lotFixed(p), COPY.noClearing)}
                      sub={listing.listedAt ? `Listed ${dateTimeIST(listing.listedAt)}` : COPY.noListed}
                    />
                    <KV k="Issue price" v={lotFixed(listing.offer.issuePrice)} />
                    <KV k="Trading rule today" v={ruleWord(policy)} sub={ruleSentence(policy)} />
                    <KV
                      k="Available to trade"
                      v={marketView ? `${usdc(marketView.liquidity.usdc)} USDC + ${shares(marketView.liquidity.shares)} shares` : COPY.noPrice}
                    />
                    <KV k="Change since today's open" v={last !== null && dayOpen ? `${lotFixed(last - dayOpen, 3)}` : COPY.noPrice} />
                  </div>
                  <h2 className="t-section-title mt-6 mb-2">Rule history</h2>
                  {marketView && marketView.events.length > 0 ? (
                    <ul className="divide-y divide-line">
                      {[...marketView.events].reverse().map((e) => (
                        <li key={`${e.time}-${e.tx}`} className="py-3">
                          <p className="t-body text-text">{eventWords(e.kind)}</p>
                          <p className="t-caption">
                            {dateTimeIST(e.time)} · {eventDetail(e.label)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="t-body text-text-2">The trading rule has not changed since this company listed.</p>
                  )}
                </div>
              )}

              {tab === "trades" && (
                <>
                  {swaps && swaps.trades.length > 0 ? (
                    <ul className="divide-y divide-line">
                      {swaps.trades.map((t) => (
                        <li key={`${t.tx}-${t.time}`} className="flex min-h-16 items-center justify-between gap-4 py-3">
                          <span>
                            <span className={cx("t-list-title block", t.side === "buy" ? "text-gain-text" : "text-loss-text")}>
                              {t.side === "buy" ? "Bought" : "Sold"} {shares(t.shares)} shares
                            </span>
                            <span className="t-label block">{timeIST(t.time)}</span>
                          </span>
                          <span className="num text-right">
                            <span className="t-list-title block text-text">{lotFixed(t.price, 3)}</span>
                            <span className="t-label block">{usdc(t.usdc)} USDC</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No trades yet" body="Every trade in this company shows up here as soon as one goes through." />
                  )}
                </>
              )}

              {tab === "rejected" && (
                <div className="pt-3">
                  <p className="t-body text-text-2">
                    A trade the rule turns away never reaches the market, so it leaves no record. These are the ones this app watched happen.
                  </p>
                  <ul className="mt-2 divide-y divide-line">
                    {seenRejected.map((r) => (
                      <li key={r.tx} className="py-3">
                        <p className="t-list-title text-loss-text">
                          Rejected · {r.side === "buy" ? "buy" : "sell"} {usdc(r.usdc)} USDC
                        </p>
                        {policy && <p className="t-body text-text">{rejectSentence(r, policy)}</p>}
                        <p className="t-caption">
                          {dateTimeIST(r.time)} ·{" "}
                          <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="text-text-2 underline underline-offset-2">
                            Receipt {shortHash(r.tx)}
                          </a>
                        </p>
                      </li>
                    ))}
                    {seenRejected.length === 0 && <EmptyState title="Nothing was turned away" body="Every trade you have seen went through." />}
                  </ul>
                </div>
              )}

              {tab === "details" && (
                <>
                  <EnsRows listing={listing} />
                  <div className="mt-2 divide-y divide-line">
                    <KV
                      k="Token order"
                      v={marketView?.usdcIsCurrency0 ? "USDC is currency0 · buys are zeroForOne" : "Shares are currency0"}
                      mono
                    />
                    {marketView && <KV k="Policy version" v={`v${marketView.policy.version} · mode ${marketView.policy.mode}`} mono />}
                    {marketView && (
                      <KV
                        k="Reference price"
                        v={
                          marketView.policy.referencePrice === null
                            ? COPY.noBand
                            : `${lotFixed(marketView.policy.referencePrice)} · band ${marketView.policy.bandBps} bps`
                        }
                        mono
                      />
                    )}
                    <KV
                      k="Report receipt"
                      v={
                        marketView?.policy.creTx ? (
                          <TextLink href={txUrl(marketView.policy.creTx)}>{shortHash(marketView.policy.creTx)} on Etherscan</TextLink>
                        ) : (
                          COPY.noReport
                        )
                      }
                    />
                    {marketView?.policy.stale && <KV k="Published rule is out of date" v="Trading is halted until the next report" />}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </TwoColumn>

      {/* Signed out the bar is the sign-in itself: one tap, one dialog. Two
          buttons that both did the same thing would be a choice that isn't one. */}
      <ActionBar>
        {!connected && halted ? (
          <Button variant="buy" size="bar" className="w-full" disabled>
            Trading halted
          </Button>
        ) : !connected ? (
          <SignInButton label="Sign in to buy or sell" size="bar" className="w-full" />
        ) : (
          <>
            <Button variant="sell" size="bar" className="flex-1" disabled={halted || !market} onClick={() => openSheet("sell")}>
              {halted ? "Trading halted" : "Sell"}
            </Button>
            <Button variant="buy" size="bar" className="flex-1" disabled={halted || !market} onClick={() => openSheet("buy")}>
              {halted ? "Trading halted" : "Buy"}
            </Button>
          </>
        )}
      </ActionBar>

      {market && (
        <TradeSheet
          key={sheet ?? "closed"}
          ipo={listing}
          market={market}
          open={sheet !== null}
          side={side}
          setSide={setSide}
          onClose={() => setSheet(null)}
          onRejected={(r) => setSeenRejected((x) => [r, ...x])}
        />
      )}

      <FullscreenChart
        open={expanded}
        onClose={() => setExpanded(false)}
        title={`${listing.name} · ${shown === null ? COPY.noPrice : lotFixed(shown)}`}
        chart={(h) => chart(h, true)}
        footer={
          <div className="lg:flex lg:items-center lg:gap-4">
            <RangeChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} className="lg:w-[412px] lg:shrink-0" />
            <div className="mt-1 flex justify-start lg:mt-0">
              <ChartTypeToggle value={chartType} onChange={setChartType} />
            </div>
          </div>
        }
      />
    </>
  );
}

function ruleWord(policy: Policy | null): string {
  if (!policy) return "Not set yet";
  return ruleCopy(policy)?.label ?? "Normal trading";
}

function ruleSentence(policy: Policy | null): string {
  if (!policy) return "The trading limits are published once the shares list.";
  return ruleCopy(policy)?.text ?? "Trades go through at any price the market reaches.";
}

/** Desktop sticky panel (UX.md 3.3): price, Buy | Sell, then the trade form. */
function OrderPanel({
  listing,
  market,
  side,
  setSide,
  onRejected,
}: {
  listing: ListingDetail;
  market: ReturnType<typeof toMarket>;
  last: number | null;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  onRejected: (r: Rejected) => void;
}) {
  const { connected } = useApp();
  if (!connected)
    return (
      <SignInCard
        title="Buy and sell here"
        body={`Sign in and the buy and sell form opens in this panel. ${listing.name}'s price and today's limits are the same either way.`}
        label="Sign in to buy or sell"
      />
    );
  if (!market)
    return (
      <Card className="p-5">
        <p className="t-label">Price</p>
        <p className="t-price-large text-text">{COPY.noPrice}</p>
        <p className="t-body mt-3 text-text-2">Buying and selling open once this company&apos;s pool has a price and a trading rule.</p>
      </Card>
    );
  return <OrderPanelForm listing={listing} market={market} side={side} setSide={setSide} onRejected={onRejected} />;
}

function OrderPanelForm({
  listing,
  market,
  side,
  setSide,
  onRejected,
}: {
  listing: ListingDetail;
  market: NonNullable<ReturnType<typeof toMarket>>;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  onRejected: (r: Rejected) => void;
}) {
  const { body, footer } = useTradeForm({ ipo: listing, market, side, setSide, onRejected });
  return (
    <Card className="p-5">
      {/* The price lives in the page header on desktop; repeating it here put
          two of the same number side by side. */}
      <p className="t-label">Buy or sell</p>
      {body}
      <div className="mt-5">{footer}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// IPO phases (UX.md 3.4)
// ---------------------------------------------------------------------------

type IpoTab = "overview" | "application" | "details";

function IpoCompany({ listing }: { listing: ListingDetail }) {
  const params = useSearchParams();
  const { connected, address } = useApp();
  const auctionRead = useAuction(listing.ticker);
  const clearingRead = useClearing(listing.ticker);
  const bidsRead = useBids(connected ? address : null, listing.ticker);
  const { error, loading, retry, refreshing } = merge2(auctionRead, clearingRead);

  const [tab, setTab] = useState<IpoTab>("overview");
  const [view, setView] = useState<"price" | "raise">("price");
  const [hover, setHover] = useState<HoverPoint>(null);
  const [applyOpen, setApplyOpen] = useState(params.get("apply") === "1" && listing.phase === "live" && connected);

  const auction: Auction | null = auctionRead.data;
  const clearing: ClearingResponse | null = clearingRead.data;
  const offer = listing.offer;
  const seconds = useCountdown(blocksAsSeconds(auction?.blocksRemaining));
  const myBids = bidsRead.data?.bids ?? [];
  const applied = bidsRead.data?.committed[listing.ticker] ?? 0;

  const open = listing.phase === "live";
  const draft = listing.phase === "draft";
  const price = listing.clearingPrice ?? auction?.clearingPrice ?? null;
  const shown = view === "price" && hover ? hover.value : price;
  const ch = shown !== null ? changeVs(shown, offer.issuePrice) : null;
  const raised = listing.raised ?? auction?.raised ?? null;

  const chartData = useMemo(
    () =>
      (clearing?.series ?? [])
        .filter((p) => (view === "price" ? true : p.raised !== null))
        .map((p) => ({ time: p.time, value: view === "price" ? p.price : (p.raised as number) })),
    [clearing, view],
  );
  const lines = useMemo<ChartLine[]>(
    () =>
      view === "price"
        ? [
            { price: offer.floorPrice, label: `Lowest ${lotFixed(offer.floorPrice)}` },
            { price: offer.capPrice, label: `Highest ${lotFixed(offer.capPrice)}` },
          ]
        : [{ price: offer.requiredRaise, label: `Lists at ${usdc(offer.requiredRaise, 0)}` }],
    [view, offer],
  );

  const applyPanel = <ApplyPanel listing={listing} price={price} seconds={seconds} />;

  // Same rule as a listed company: the price belongs to the identity, so it
  // sits in the header cluster under the name rather than starting a second
  // block at the page edge.
  const headPrice = !auction
    ? undefined
    : draft
      ? {
          label: "Issue price",
          value: lotFixed(offer.issuePrice),
          num: true,
          note: `Price range ${lotFixed(offer.floorPrice)} to ${lotFixed(offer.capPrice)}${seconds !== null ? ` · opens in ${countdown(seconds)}` : ""}`,
        }
      : {
          label: open ? "Current price" : "Final price",
          value: shown === null ? COPY.noClearing : lotFixed(shown),
          num: shown !== null,
          change: ch ? <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} size="lg" /> : undefined,
          note: hover ? dateTimeIST(hover.time) : ch ? "vs issue price" : "No bids yet",
          extra:
            open && seconds !== null ? (
              <p className="t-body mt-1 text-text">
                Closes in <span className={seconds < 3600 ? "text-warn" : undefined}>{countdown(seconds)}</span>
              </p>
            ) : undefined,
        };

  return (
    <>
      <DetailBar />
      <TwoColumn panel={open ? applyPanel : <PhasePanel listing={listing} price={price} seconds={seconds} applied={applied} />}>
        <main>
          <CompanyHead
            listing={listing}
            variant={headVariant(params.get("head"))}
            onDetails={() => setTab("details")}
            price={headPrice}
            facts={[
              { k: "Price range", v: `${lotFixed(offer.floorPrice)} to ${lotFixed(offer.capPrice)}` },
              { k: "Applications", v: `${listing.applicants} ${listing.applicants === 1 ? "person" : "people"}` },
            ]}
          />

          {error && !auction && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}
          {loading && !auction && <ChartSkeleton className="mt-2" height={280} />}

          {auction && (
            <>
              {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

              {draft ? (
                <>
                  <Card className="mt-6 p-4">
                    <p className="t-list-title text-text">
                      {seconds === null ? "Applications have not been scheduled yet" : `Applications open in ${countdown(seconds)}`}
                    </p>
                    <RangeScale offer={offer} />
                  </Card>
                </>
              ) : (
                <>
                  {chartData.length > 1 && (
                    <>
                      <div className="mt-6">
                        <PriceChart
                          data={chartData}
                          kind={view === "price" ? "clearing" : "raised"}
                          baseline={view === "price" ? offer.issuePrice : undefined}
                          lines={lines}
                          digits={view === "price" ? 2 : 1}
                          height={280}
                          onHover={setHover}
                        />
                      </div>
                      <div className="dotted-line mt-2 pt-3">
                        <RangeChips
                          value={view}
                          onChange={setView}
                          options={[
                            { id: "price", label: "Price" },
                            { id: "raise", label: "Subscription" },
                          ]}
                        />
                      </div>
                    </>
                  )}

                  <Card className="mt-4 p-4">
                    {raised === null ? (
                      <>
                        <p className="t-list-title text-text">How much has been applied for isn&apos;t available</p>
                        <p className="t-caption mt-1">This server can&apos;t read the raise at that point in time. The final figure still shows once the IPO closes.</p>
                      </>
                    ) : (
                      <>
                        <p className="t-list-title text-text">
                          {usdc(raised, 1)} of {usdc(offer.targetRaise, 0)} USDC raised
                        </p>
                        <ProgressBar className="mt-3" value={raised} max={offer.targetRaise} marker={offer.requiredRaise} />
                        <p className="t-caption mt-2">
                          Subscribed{" "}
                          <span className="font-medium" style={{ color: markVar(listing.ticker) }}>
                            {(raised / offer.targetRaise).toFixed(2)}
                          </span>{" "}
                          times · {listing.applicants} {listing.applicants === 1 ? "person" : "people"} ·{" "}
                          {raised >= offer.requiredRaise ? "past the minimum to list" : `lists if it reaches ${usdc(offer.requiredRaise, 0)} USDC`}
                        </p>
                      </>
                    )}
                    {listing.phase === "refunding" && (
                      <p className="t-body mt-3 text-text">
                        This IPO did not reach {usdc(offer.requiredRaise, 0)} USDC. Every application is refundable.
                      </p>
                    )}
                  </Card>
                </>
              )}
            </>
          )}

          <div className="mt-6">
            <UnderlineTabs
              value={tab}
              onChange={setTab}
              tabs={
                draft
                  ? [
                      { id: "overview" as IpoTab, label: "Overview" },
                      { id: "details" as IpoTab, label: "Details" },
                    ]
                  : [
                      { id: "overview" as IpoTab, label: "Overview" },
                      { id: "application" as IpoTab, label: "Your application", count: myBids.length },
                      { id: "details" as IpoTab, label: "Details" },
                    ]
              }
            />
          </div>

          {tab === "overview" && (
            <div className="pt-3">
              <Description listing={listing} />
              <div className="mt-4 divide-y divide-line">
                <KV k="Shares on offer" v={shares(offer.auctioned)} />
                <KV k="Issue price" v={lotFixed(offer.issuePrice)} sub={`${perShare(offer.issuePrice)} USDC per share`} />
                <KV k="Price range" v={`${lotFixed(offer.floorPrice)} to ${lotFixed(offer.capPrice)}`} />
                <KV k="Most one person can apply with" v={`${usdc(offer.perApplicantCap, 0)} USDC`} />
                <KV k="Minimum raise to list" v={`${usdc(offer.requiredRaise, 0)} USDC`} sub={`Target ${usdc(offer.targetRaise, 0)} USDC`} />
                <KV k="Who can apply" v={listing.eligibility === "human" ? "One application per person" : "Anyone with USDC"} />
                <KV k="Applications so far" v={`${listing.applicants} ${listing.applicants === 1 ? "person" : "people"}`} />
                <KV
                  k="How long applications stay open"
                  v={
                    listing.startBlock !== null && listing.endBlock !== null
                      ? secondsToWords((listing.endBlock - listing.startBlock) * BLOCK_SECONDS)
                      : COPY.noSchedule
                  }
                  sub={draft && seconds !== null ? `Opens in ${countdown(seconds)}` : open && seconds !== null ? `Closes in ${countdown(seconds)}` : undefined}
                />
              </div>
            </div>
          )}

          {tab === "application" && (
            <div className="pt-3">
              {!connected ? (
                <SignInCard
                  quiet
                  title="Your application for this IPO"
                  body="Sign in and what you applied for, the price you set and what is left to do show up here."
                />
              ) : myBids.length === 0 ? (
                <EmptyState
                  title="You have not applied yet"
                  body={open ? "Applications are open until this IPO closes." : "This IPO is closed."}
                  action={open ? { label: "Apply now", onClick: () => setApplyOpen(true) } : undefined}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {myBids.map((b) => (
                    <li key={`${b.ticker}:${b.id}`} className="flex min-h-16 items-center justify-between gap-4 py-3">
                      <span>
                        <span className="t-list-title block text-text">
                          {usdc(b.budget)} USDC up to {lotFixed(b.maxPrice)}
                        </span>
                        <span className="t-label block">{b.submittedAt ? dateTimeIST(b.submittedAt) : `Block ${b.submittedBlock}`}</span>
                      </span>
                      <TextLink href="/orders">See in Orders</TextLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "details" && (
            <>
              <EnsRows listing={listing} />
              <Details className="mt-2" title="Auction detail" defaultOpen>
                <div className="divide-y divide-line">
                  <KV k="Start block" v={listing.startBlock === null ? COPY.noSchedule : String(listing.startBlock)} mono />
                  <KV k="End block" v={listing.endBlock === null ? COPY.noSchedule : String(listing.endBlock)} mono />
                  <KV k="Claim from block" v={listing.claimBlock === null ? COPY.noSchedule : String(listing.claimBlock)} mono />
                  <KV k="Price limit (cap)" v={`${lotFixed(offer.capPrice)} = ${Math.round((offer.capPrice / offer.issuePrice) * 100)}% of issue`} mono />
                  <KV k="Raise to liquidity" v={`${offer.lpPercent}% seeds the pool at the final price`} mono />
                  <KV k="Auction contract" v={<CopyAddress value={listing.records.auction} />} />
                  <KV k="Unsold shares" v="Returned to the company treasury" mono />
                </div>
              </Details>
            </>
          )}
        </main>
      </TwoColumn>

      {open && (
        <ActionBar>
          {connected ? (
            <Button variant="buy" size="bar" className="flex-1" onClick={() => setApplyOpen(true)}>
              Apply
            </Button>
          ) : (
            <SignInButton label="Sign in to apply" size="bar" className="w-full" />
          )}
        </ActionBar>
      )}
      {draft && (
        <ActionBar>
          <Button variant="buy" size="bar" className="flex-1" disabled>
            {seconds === null ? "Not open yet" : `Opens in ${countdown(seconds)}`}
          </Button>
        </ActionBar>
      )}
      {listing.phase === "refunding" && applied > 0 && (
        <ActionBar>
          <Link href="/orders" className="flex flex-1">
            <Button variant="buy" size="bar" className="w-full">
              Refund {usdc(applied)} USDC
            </Button>
          </Link>
        </ActionBar>
      )}

      <ApplySheet ipo={listing} open={applyOpen} onClose={() => setApplyOpen(false)} worldState="verified" onVerify={() => {}} />
    </>
  );
}

/** "About 1 hour", "About 3 days": a window length a reader can picture. */
function secondsToWords(total: number): string {
  const h = total / 3600;
  if (h >= 48) return `About ${Math.round(h / 24)} days`;
  if (h >= 1.5) return `About ${Math.round(h)} hours`;
  if (h >= 0.9) return "About an hour";
  return `About ${Math.max(1, Math.round(total / 60))} minutes`;
}

/** Thin day range: low, high, and a marker on the last price. */
function DayRange({ low, high, price, className }: { low: number; high: number; price: number; className?: string }) {
  const span = high - low || 1;
  const pct = Math.max(0, Math.min(100, ((price - low) / span) * 100));
  return (
    <div className={cx("mt-4", className)}>
      <p className="t-label">Today&apos;s range</p>
      <div className="relative mt-3 h-1 bg-line">
        <span aria-hidden className="absolute top-1/2 size-2 -translate-y-1/2 bg-text" style={{ left: `calc(${pct}% - 4px)` }} />
      </div>
      <div className="num t-caption mt-2 flex justify-between text-text-2">
        <span>Low {lotFixed(low)}</span>
        <span>High {lotFixed(high)}</span>
      </div>
    </div>
  );
}

/** The floor / issue / cap scale shown while an IPO has not opened yet. */
function RangeScale({ offer }: { offer: ListingDetail["offer"] }) {
  const pos = ((offer.issuePrice - offer.floorPrice) / (offer.capPrice - offer.floorPrice)) * 100;
  return (
    <div className="mt-8 mb-2">
      <div className="relative h-px bg-line">
        <span aria-hidden className="absolute -top-1.5 left-0 h-3 w-px bg-line-strong" />
        <span aria-hidden className="absolute -top-1.5 h-3 w-px bg-text" style={{ left: `${pos}%` }} />
        <span aria-hidden className="absolute -top-1.5 right-0 h-3 w-px bg-line-strong" />
        <span className="num t-caption absolute top-3 whitespace-nowrap text-text" style={{ left: `${pos}%`, transform: "translateX(-50%)" }}>
          Issue {lotFixed(offer.issuePrice)}
        </span>
      </div>
      <div className="num t-caption mt-3 flex justify-between">
        <span>{lotFixed(offer.floorPrice)}</span>
        <span>{lotFixed(offer.capPrice)}</span>
      </div>
    </div>
  );
}

/** Desktop panel while an IPO is open: price, then the Apply form. */
function ApplyPanel({ listing, price, seconds }: { listing: ListingDetail; price: number | null; seconds: number | null }) {
  const { connected } = useApp();
  if (!connected)
    return (
      <SignInCard
        title="Apply for this IPO"
        body={`Sign in and the application form opens in this panel. ${listing.name}'s price range and how long it stays open are the same either way.`}
        label="Sign in to apply"
      />
    );
  return <ApplyPanelForm listing={listing} price={price} seconds={seconds} />;
}

function ApplyPanelForm({ listing, price, seconds }: { listing: ListingDetail; price: number | null; seconds: number | null }) {
  const { body, footer } = useApplyForm({ ipo: listing, worldState: "verified", onVerify: () => {} });
  return (
    <Card className="p-5">
      <p className="t-label">Current price</p>
      <p className={cx("t-price-large text-text", price !== null && "num")}>{price === null ? COPY.noClearing : lotFixed(price)}</p>
      <p className="t-caption">
        USDC per 1,000 shares
        {seconds !== null && (
          <>
            {" · closes in "}
            <span className={seconds < 3600 ? "text-warn" : undefined}>{countdown(seconds)}</span>
          </>
        )}
      </p>
      {body}
      <div className="mt-5">{footer}</div>
    </Card>
  );
}

/** Desktop panel for the phases with no form: upcoming and closed. */
function PhasePanel({
  listing,
  price,
  seconds,
  applied,
}: {
  listing: ListingDetail;
  price: number | null;
  seconds: number | null;
  applied: number;
}) {
  const draft = listing.phase === "draft";
  const value = draft ? listing.offer.issuePrice : price;
  return (
    <Card className="p-5">
      <p className="t-label">{draft ? "Issue price" : "Final price"}</p>
      <p className={cx("t-price-large text-text", value !== null && "num")}>{value === null ? COPY.noClearing : lotFixed(value)}</p>
      <p className="t-caption">USDC per 1,000 shares</p>
      {draft ? (
        <Button variant="buy" size="bar" className="mt-5 w-full" disabled>
          {seconds === null ? "Not open yet" : `Opens in ${countdown(seconds)}`}
        </Button>
      ) : applied > 0 && listing.phase === "refunding" ? (
        <Link href="/orders" className="mt-5 block">
          <Button variant="buy" size="bar" className="w-full">
            Refund {usdc(applied)} USDC
          </Button>
        </Link>
      ) : applied > 0 ? (
        <Link href="/orders" className="mt-5 block">
          <Button variant="secondary" size="bar" className="w-full">
            See your application
          </Button>
        </Link>
      ) : (
        <p className="t-body mt-4 text-text-2">This IPO is closed. Nothing to do here.</p>
      )}
    </Card>
  );
}
