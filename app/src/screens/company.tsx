"use client";

// One company page for every phase (UX.md 3.3 and 3.4): listed, IPO open,
// IPO upcoming and IPO closed without a listing. Same route, same header,
// same company block; only the middle of the page changes.
// Protocol words live in the Details tab and nowhere else.
//
// Data: GET /v1/listings/:ticker for the company and its offer, then either
// /v1/market/:ticker (listed: price, trades, reference/band steps, halt spans)
// or /v1/auction/:ticker + /clearing (every IPO phase), plus /v1/portfolio
// (shares held) and /v1/bids?owner= for this wallet's own applications.
// Nothing on this page comes from a fixture.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, ExternalLink, Wallet } from "lucide-react";
import { ActionBar, DetailBar, ShareButton, TwoColumn } from "@/components/shell";
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
import { COPY, dayOpenOf, eventDetail, eventWords, lastPriceOf, orCopy, pricePoints, seriesNow, sharesHeld, toMarket, toPolicy, tradeGate, withHalts, type TradeGate } from "@/lib/adapt";
import { ApiErrorCard, DemoDataStrip } from "@/lib/api-state";
import type { Auction, ClearingResponse, ListingDetail, MarketView } from "@/lib/api";
import { merge2, useAuction, useBids, useClearing, useListing, useMarket } from "@/lib/live";
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
 * Logo, name, status and the verified ENS name. There is no sector line:
 * nothing on chain carries a sector, and the app does not keep a private list
 * of invented ones.
 */
function CompanyHead({
  listing,
  note,
  onDetails,
  aside,
}: {
  listing: ListingDetail;
  note?: ReactNode;
  onDetails: () => void;
  /** Price block. Sits beside the name from lg up, below it on a phone. */
  aside?: ReactNode;
}) {
  return (
    <div className="pt-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-6">
      <div className="lg:col-start-1">
      <div className="flex items-center justify-between gap-3">
        <TickerLogo ipo={listing} size={40} />
        <span className="lg:hidden">
          <ShareButton title={listing.name} />
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h1 className="text-[20px] leading-7 text-text">{listing.name}</h1>
        <span className="mt-0.5 shrink-0 lg:hidden">
          <StatusChip ipo={listing} />
        </span>
      </div>
      <p className="t-label mt-1 flex flex-wrap items-center gap-x-2">
        <TickerMark ticker={listing.ticker} symbol={listing.symbol} />
        <span aria-hidden>·</span>
        <button type="button" onClick={onDetails} className="t-label inline-flex items-center gap-1 text-gain-text">
          <BadgeCheck className="size-4" aria-hidden /> Verified
        </button>
        {note && (
          <>
            <span aria-hidden>·</span>
            {note}
          </>
        )}
      </p>
      </div>
      {aside !== undefined && <div className="lg:col-start-2 lg:text-right">{aside}</div>}
      <div className="hidden lg:col-start-2 lg:row-start-1 lg:flex lg:items-center lg:justify-end lg:gap-3">
        <StatusChip ipo={listing} />
        <ShareButton title={listing.name} />
      </div>
    </div>
  );
}

function PriceBlock({ label, value, digits = 2, children, inHead }: { label?: string; value: number | null; digits?: number; children?: ReactNode; inHead?: boolean }) {
  return (
    <div className={cx("mt-4", inHead && "lg:mt-0")}>
      {label && <p className="t-label">{label}</p>}
      <p className={cx("t-price-large text-text", value !== null && "num")}>{value === null ? COPY.noPrice : lotFixed(value, digits)}</p>
      {children}
    </div>
  );
}

function UnitLine() {
  return <p className="t-caption mt-1">Prices in USDC per 1,000 shares</p>;
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
  const { connected, portfolio } = useApp();
  const marketRead = useMarket(listing.ticker);
  const { error, loading, retry, refreshing } = marketRead;

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
  const policy = toPolicy(marketView?.policy);
  const market = useMemo(() => toMarket(marketView), [marketView]);
  const gate = tradeGate(marketView);

  const points = useMemo(() => pricePoints(marketView), [marketView]);
  // The pool's own clock: the last point it produced. Never the machine clock.
  const nowSec = seriesNow(points, marketView?.policy.asOf ?? listing.listedAt);
  const last = lastPriceOf(marketView);
  const shown = hover?.value ?? last;

  // Halt windows have no trades of their own; mark them on the chart up to the server's head time.
  const chartPoints = useMemo(
    () => (marketView ? withHalts(points, marketView.haltSpans, marketView.reference.at(-1)?.time ?? nowSec) : points),
    [marketView, points, nowSec],
  );
  const data = useMemo(() => (chartPoints.length > 1 ? sliceRange(chartPoints, range, nowSec) : chartPoints), [chartPoints, range, nowSec]);
  const base = data[0]?.value ?? null;
  const change = shown !== null && base !== null ? changeVs(shown, base) : null;
  const rejectTimes = useMemo(() => seenRejected.map((r) => new Date(r.time).getTime() / 1000), [seenRejected]);

  // Wallet balance plus shares won but not collected yet: bought shares count even with no application.
  const toCollect = portfolio.data?.holdings.find((h) => h.ticker === listing.ticker)?.unclaimedShares ?? 0;
  const owned = sharesHeld(portfolio.data, listing.ticker) + toCollect;

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
      <RangeChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} className="lg:flex-1" />
      <div className="mt-1 flex items-center justify-between lg:mt-0">
        <ChartTypeToggle value={chartType} onChange={setChartType} />
        <ExpandButton onClick={() => setExpanded(true)} />
      </div>
    </>
  );

  return (
    <>
      <DetailBar />
      <DemoDataStrip className="-mx-5" />
      <TwoColumn
        panel={<OrderPanel listing={listing} market={market} gate={gate} side={side} setSide={setSide} onRejected={(r) => setSeenRejected((x) => [r, ...x])} />}
      >
        <main>
          <CompanyHead
            listing={listing}
            onDetails={() => setTab("details")}
            aside={
              marketView ? (
                <PriceBlock value={shown} inHead>
                  <p className="mt-1 flex flex-wrap items-baseline gap-2 lg:justify-end">
                    {change && <Change abs={change.abs} rel={change.rel} digits={changeDigits(change.abs)} size="lg" />}
                    <span className="t-body text-text-2">{hover ? dateTimeIST(hover.time) : change ? RANGE_WORDS[range] : "No trades in this pool yet"}</span>
                  </p>
                  <UnitLine />
                </PriceBlock>
              ) : undefined
            }
          />

          {loading && !marketView ? (
            <ChartSkeleton className="mt-2" height={280} />
          ) : error && !marketView ? (
            <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />
          ) : (
            <>
              {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

              {policy && (
                <div className="mt-4">
                  <CircuitBanner ticker={listing.ticker} policy={policy} />
                </div>
              )}

              {data.length > 1 ? (
                <>
                  <div className="mt-4">{chart(280)}</div>

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

                  <div className="dotted-line mt-3 pt-2 lg:flex lg:items-center lg:gap-4">{chartControls}</div>
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

              <div className="mt-4">
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
                          : "In your wallet"
                        : "Shares you buy, or get from an IPO, show up here"
                    }
                  />
                ) : (
                  <PromoCard icon={<Wallet />} title="Sign in to see your shares" sub="Your shares and what they are worth show up here." />
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
                  {dayLow !== null && dayHigh !== null && last !== null && <DayRange low={dayLow} high={dayHigh} price={last} />}
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
                  {marketView && marketView.trades.length > 0 ? (
                    <ul className="divide-y divide-line">
                      {marketView.trades.map((t) => (
                        <li key={`${t.tx}-${t.time}`} className="flex min-h-16 items-center justify-between gap-4 py-3">
                          <span>
                            <span className={cx("t-list-title block", t.side === "buy" ? "text-gain-text" : "text-loss-text")}>
                              {t.side === "buy" ? "Bought" : "Sold"} {shares(t.shares)} shares
                            </span>
                            <span className="t-label block">{timeIST(t.time)}</span>
                          </span>
                          <span className="num text-right">
                            <span className="t-list-title block text-text">{lotFixed(t.avgPrice, 3)}</span>
                            <span className="t-label block">{usdc(t.usdc)} USDC · average price</span>
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
                    {marketView?.policy.coolOffUntil && marketView.haltCause === "coolingOff" && (
                      <KV k="Cooling off until" v={dateTimeIST(marketView.policy.coolOffUntil)} />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </TwoColumn>

      <ActionBar>
        <Button variant="sell" size="bar" className="flex-1" disabled={!gate.open || !market} onClick={() => openSheet("sell")}>
          {gate.open ? "Sell" : gateWord(gate)}
        </Button>
        <Button variant="buy" size="bar" className="flex-1" disabled={!gate.open || !market} onClick={() => openSheet("buy")}>
          {gate.open ? "Buy" : gateWord(gate)}
        </Button>
      </ActionBar>

      {market && gate.open && (
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
            <RangeChipRow value={range} onChange={setRange} options={RANGE_OPTIONS} className="lg:flex-1" />
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

/** Short button word for a closed gate. */
function gateWord(gate: TradeGate): string {
  if (gate.open) return "";
  return gate.cause === "report" ? "Trading halted" : gate.cause === "coolingOff" ? "Cooling off" : gate.cause === "notListed" ? "Not trading yet" : "Trading paused";
}

/** Desktop sticky panel (UX.md 3.3): price, Buy | Sell, then the trade form. */
function OrderPanel({
  listing,
  market,
  gate,
  side,
  setSide,
  onRejected,
}: {
  listing: ListingDetail;
  market: ReturnType<typeof toMarket>;
  gate: TradeGate;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  onRejected: (r: Rejected) => void;
}) {
  if (!market)
    return (
      <Card className="p-5">
        <p className="t-label">Price</p>
        <p className="t-price-large text-text">{COPY.noPrice}</p>
        <p className="t-body mt-3 text-text-2">Buying and selling open once this company&apos;s pool has a price and a trading rule.</p>
      </Card>
    );
  if (!gate.open)
    return (
      <Card className="p-5">
        <p className="t-list-title text-text">{gate.title}</p>
        <p className="t-body mt-2 text-text-2">{gate.body}</p>
        {gate.until && <p className="t-label mt-2">Until {dateTimeIST(gate.until)}</p>}
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
  const [applyOpen, setApplyOpen] = useState(params.get("apply") === "1" && listing.phase === "live");

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

  const note = open ? (
    <span className="text-gain-text">IPO open</span>
  ) : draft ? (
    <span>IPO upcoming</span>
  ) : listing.phase === "cleared" ? (
    <span>IPO closed</span>
  ) : (
    <span>Not listed</span>
  );

  const applyPanel = <ApplyPanel listing={listing} price={price} seconds={seconds} />;

  return (
    <>
      <DetailBar />
      <DemoDataStrip className="-mx-5" />
      <TwoColumn panel={open ? applyPanel : <PhasePanel listing={listing} price={price} seconds={seconds} applied={applied} />}>
        <main>
          <CompanyHead listing={listing} note={note} onDetails={() => setTab("details")} />

          {error && !auction && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}
          {loading && !auction && <ChartSkeleton className="mt-2" height={280} />}

          {auction && (
            <>
              {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

              {draft ? (
                <>
                  <PriceBlock label="Issue price" value={offer.issuePrice}>
                    <p className="num t-body mt-1 text-text-2">
                      Price range {lotFixed(offer.floorPrice)} to {lotFixed(offer.capPrice)}
                      {seconds !== null ? ` · opens in ${countdown(seconds)}` : ""}
                    </p>
                    <UnitLine />
                  </PriceBlock>

                  <Card className="mt-4 p-4">
                    <p className="t-list-title text-text">
                      {seconds === null ? "Applications have not been scheduled yet" : `Applications open in ${countdown(seconds)}`}
                    </p>
                    <RangeScale offer={offer} />
                  </Card>
                </>
              ) : (
                <>
                  <PriceBlock label={open ? "Current price" : "Final price"} value={shown}>
                    <p className="mt-1 flex flex-wrap items-baseline gap-2">
                      {ch && <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} size="lg" />}
                      <span className="t-body text-text-2">{hover ? dateTimeIST(hover.time) : ch ? "vs issue price" : "No bids yet"}</span>
                    </p>
                    {open && seconds !== null && (
                      <p className="t-body mt-1 text-text">
                        Closes in <span className={seconds < 3600 ? "text-warn" : undefined}>{countdown(seconds)}</span>
                      </p>
                    )}
                    <UnitLine />
                  </PriceBlock>

                  {chartData.length > 1 && (
                    <>
                      <div className="mt-4">
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
                          times · {listing.applicants} {listing.applicants === 1 ? "wallet" : "wallets"} ·{" "}
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
                <KV k="Applications so far" v={`${listing.applicants} ${listing.applicants === 1 ? "wallet" : "wallets"}`} />
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
                <EmptyState title="Sign in to see your application" body="Applications are tied to the wallet that placed them." />
              ) : myBids.length === 0 ? (
                <EmptyState
                  title="You have not applied yet"
                  body={open ? "Applications are open until this IPO closes." : "This IPO is closed."}
                  action={open ? { label: "Apply now", onClick: () => setApplyOpen(true) } : undefined}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {myBids.map((b) => (
                    <li key={b.key} className="flex min-h-16 items-center justify-between gap-4 py-3">
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
          <Button variant="buy" size="bar" className="flex-1" onClick={() => setApplyOpen(true)}>
            Apply
          </Button>
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
function DayRange({ low, high, price }: { low: number; high: number; price: number }) {
  const span = high - low || 1;
  const pct = Math.max(0, Math.min(100, ((price - low) / span) * 100));
  return (
    <div className="mt-4">
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
