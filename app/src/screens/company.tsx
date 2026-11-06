"use client";

// One company page for every phase (UX.md 3.3 and 3.4): listed, IPO open,
// IPO upcoming and IPO closed without a listing. Same route, same header,
// same company block; only the middle of the page changes.
// Protocol words live in the Details tab and nowhere else.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { BadgeCheck, ExternalLink, Wallet } from "lucide-react";
import { ActionBar, DetailBar, ShareButton, TwoColumn } from "@/components/shell";
import { CircuitBanner, ruleCopy } from "@/components/circuit-banner";
import { useApp } from "@/components/providers";
import { ErrorCard } from "@/components/states";
import { ChartSkeleton } from "@/components/chart/skeleton";
import { useMockLoad } from "@/components/company/load";
import { TickerMark, markVar } from "@/components/company/logos";
import { changeDigits, countdown } from "@/components/company/num";
import { FullscreenChart, PriceChart, RANGE_OPTIONS, RANGE_WORDS, RangeChips, sliceRange, type ChartLine, type ChartRange, type HoverPoint } from "@/components/time-chart";
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
  TextLink,
  TickerLogo,
  UnderlineTabs,
  cx,
} from "@/components/ui";
import { useBlockCountdown } from "@/lib/hooks";
import { BLOCK_SECONDS, changeVs, dateTimeIST, lotFixed, perShare, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import {
  COMMITTED,
  CURRENT_BLOCK,
  NOW,
  OFFER,
  PORTFOLIO,
  bidsFor,
  ensName,
  getClearing,
  type Ipo,
  type Market,
  type Policy,
  type Rejected,
} from "@/lib/mock";
import { band, bandDigits } from "@/lib/policy";
import { useApplyForm, ApplySheet } from "./bid-sheet";
import { TradeSheet, useTradeForm, type TradeSide } from "./trade-sheet";
import { WorldSheet, type WorldState } from "./world-sheet";

const NOW_SEC = new Date(NOW).getTime() / 1000;

export function CompanyScreen({ ipo, market }: { ipo: Ipo; market?: Market }) {
  if (market) return <ListedCompany ipo={ipo} market={market} />;
  return <IpoCompany ipo={ipo} />;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function CompanyHead({ ipo, note, onDetails }: { ipo: Ipo; note?: ReactNode; onDetails: () => void }) {
  return (
    <div className="pt-2">
      <div className="flex items-center justify-between gap-3">
        <TickerLogo ipo={ipo} size={40} />
        <ShareButton title={ipo.name} />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h1 className="text-[20px] leading-7 text-text">{ipo.name}</h1>
        <span className="t-caption mt-0.5 shrink-0 rounded-[10px] border border-line px-2.5 py-1 font-medium text-text-2">{ipo.sector}</span>
      </div>
      <p className="t-label mt-1 flex flex-wrap items-center gap-x-2">
        <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} />
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
  );
}

function PriceBlock({ label, value, digits = 2, children }: { label?: string; value: number; digits?: number; children?: ReactNode }) {
  return (
    <div className="mt-4">
      {label && <p className="t-label">{label}</p>}
      <p className="num t-price-large text-text">{lotFixed(value, digits)}</p>
      {children}
    </div>
  );
}

function UnitLine() {
  return <p className="t-caption mt-1">Prices in USDC per 1,000 shares</p>;
}

function EnsRows({ ipo }: { ipo: Ipo }) {
  const rows: [string, string | null][] = [
    ["Company account", ipo.records.addr],
    ["Share token", ipo.records.token],
    ["IPO auction", ipo.records.auction],
    ["Trading rule hook", ipo.records.hook],
    ["Policy contract", ipo.records.policy],
    ["Pool id", ipo.records.pool],
  ];
  return (
    <div className="pt-2">
      <div className="divide-y divide-line">
        <KV k="Name on ENS" v={ensName(ipo.ticker)} mono />
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-12 items-center justify-between gap-3 py-2.5">
            <span className="t-label shrink-0">{k}</span>
            <CopyAddress value={v} label={v && v.length > 42 ? `${v.slice(0, 10)}…${v.slice(-6)}` : undefined} />
          </div>
        ))}
        <KV k="Ticker status" v={ipo.status} mono />
        <KV k="Who can apply" v={ipo.eligibility === "human" ? "human (one per person)" : "open"} mono />
      </div>
      <p className="t-caption mt-2">
        Only the exchange may write the ticker status; every other record belongs to the company.
      </p>
      <a
        href={`https://sepolia.app.ens.domains/${ensName(ipo.ticker)}`}
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
  if (r.reason === "WrongDirection") return `Would have moved the price away from ${lotFixed(policy.referencePrice)}.`;
  const above = r.priceAfter > hi;
  return `Would have moved the price to ${r.priceAfter.toFixed(3)}, ${above ? "above" : "below"} today's limit of ${lotFixed(above ? hi : lo, d)}.`;
}

// ---------------------------------------------------------------------------
// Listed company (UX.md 3.3)
// ---------------------------------------------------------------------------

type ListedTab = "overview" | "trades" | "rejected" | "details";

function ListedCompany({ ipo, market }: { ipo: Ipo; market: Market }) {
  const { connected } = useApp();
  const { loading, error, retry, retrying } = useMockLoad();
  const [range, setRange] = useState<ChartRange>("1D");
  const [chartType, setChartType] = useChartType();
  const [tab, setTab] = useState<ListedTab>("overview");
  const [hover, setHover] = useState<HoverPoint>(null);
  const [sheet, setSheet] = useState<TradeSide | null>(null);
  const [side, setSide] = useState<TradeSide>("buy");
  const [expanded, setExpanded] = useState(false);
  const [extraRejected, setExtraRejected] = useState<Rejected[]>([]);

  const policy = market.policy;
  const halted = policy.halted || policy.mode === "halted";
  const last = market.prices[market.prices.length - 1].value;
  const shown = hover?.value ?? last;
  const rule = ruleCopy(policy);

  const data = useMemo(() => sliceRange(market.prices, range, NOW_SEC), [market.prices, range]);
  const base = data[0].value;
  const change = changeVs(shown, base);
  const rejected = useMemo(() => [...extraRejected, ...market.rejected], [extraRejected, market.rejected]);
  const rejectTimes = useMemo(() => rejected.map((r) => new Date(r.time).getTime() / 1000), [rejected]);
  const holding = PORTFOLIO.holdings.find((h) => h.ticker === ipo.ticker);
  const owned = (holding?.shares ?? 0) + (holding?.unclaimedShares ?? 0);

  const daySeries = useMemo(() => sliceRange(market.prices, "1D", NOW_SEC), [market.prices]);
  const dayLow = Math.min(...daySeries.map((d) => d.value));
  const dayHigh = Math.max(...daySeries.map((d) => d.value));

  const openSheet = (s: TradeSide) => {
    setSide(s);
    setSheet(s);
  };

  // Open / high / low / close of the window shown, for the Bars summary row.
  const win = useMemo(() => {
    const vals = data.map((d) => d.value);
    return { open: data[0].value, high: Math.max(...vals), low: Math.min(...vals), close: data[data.length - 1].value };
  }, [data]);

  const chart = (height: number, fullscreen = false) => (
    <PriceChart
      data={data}
      kind="market"
      type={chartType}
      baseline={base}
      reference={market.reference}
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
      <TwoColumn
        panel={
          <OrderPanel
            ipo={ipo}
            market={market}
            last={last}
            side={side}
            setSide={setSide}
            onRejected={(r) => setExtraRejected((x) => [r, ...x])}
          />
        }
      >
        <main>
          <CompanyHead ipo={ipo} onDetails={() => setTab("details")} />

          {loading ? (
            <ChartSkeleton className="mt-2" height={280} />
          ) : error ? (
            <ErrorCard
              className="mt-4"
              title="We couldn't load prices privately"
              body="Your private connection didn't answer. Check your internet and try again."
              onRetry={retry}
              retrying={retrying}
            />
          ) : (
            <>
              <PriceBlock value={shown}>
                <p className="mt-1 flex flex-wrap items-baseline gap-2">
                  <Change abs={change.abs} rel={change.rel} digits={changeDigits(change.abs)} size="lg" />
                  <span className="t-body text-text-2">{hover ? dateTimeIST(hover.time) : RANGE_WORDS[range]}</span>
                </p>
                <UnitLine />
              </PriceBlock>

              <div className="mt-4">
                <CircuitBanner ticker={ipo.ticker} policy={policy} />
              </div>

              <div className="mt-4">{chart(280)}</div>

              {chartType === "bars" && (
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

              <div className="mt-4">
                {connected ? (
                  <PromoCard
                    href="/portfolio"
                    icon={<Wallet />}
                    title={owned > 0 ? `You own ${shares(owned)} shares · worth ${usdc((owned * last) / 1000)} USDC` : "You don't own any shares yet"}
                    sub={
                      owned > 0
                        ? holding && holding.unclaimedShares > 0
                          ? `${shares(holding.unclaimedShares)} shares ready to collect in Orders`
                          : `Today ${change.abs >= 0 ? "+" : "-"}${Math.abs((owned * change.abs) / 1000).toFixed(2)} USDC`
                        : "Buy shares and they show up here"
                    }
                  />
                ) : (
                  <PromoCard icon={<Wallet />} title="Sign in to see your shares" sub="Your shares and today's change show up here." />
                )}
              </div>

              <div className="mt-6">
                <UnderlineTabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: "overview", label: "Overview" },
                    { id: "trades", label: "Trades" },
                    { id: "rejected", label: "Rejected", count: rejected.length },
                    { id: "details", label: "Details" },
                  ]}
                />
              </div>

              {tab === "overview" && (
                <div className="pt-3">
                  <p className="t-body text-text">{ipo.description}</p>
                  <DayRange low={dayLow} high={dayHigh} price={last} />
                  <div className="mt-4 divide-y divide-line">
                    <KV k="Listing price" v={lotFixed(ipo.clearingPrice ?? OFFER.issuePrice)} sub={ipo.listedAt ? `Listed ${dateTimeIST(ipo.listedAt)}` : undefined} />
                    <KV k="Issue price" v={lotFixed(OFFER.issuePrice)} />
                    <KV k="Trading rule today" v={rule ? rule.label : "Normal trading"} sub={rule ? rule.text : "Trades go through at any price the market reaches."} />
                    <KV k="Available to trade" v={`${usdc(market.liquidity.usdc)} USDC + ${shares(market.liquidity.shares)} shares`} />
                  </div>
                  <h2 className="t-section-title mt-6 mb-2">Rule history</h2>
                  <ul className="divide-y divide-line">
                    {[...market.events].reverse().map((e) => (
                      <li key={e.time} className="py-3">
                        <p className="t-body text-text">{e.label}</p>
                        <p className="t-caption">{dateTimeIST(e.time)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tab === "trades" && (
                <ul className="divide-y divide-line">
                  {market.trades.map((t) => (
                    <li key={t.tx + t.time} className="flex min-h-16 items-center justify-between gap-4 py-3">
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
              )}

              {tab === "rejected" && (
                <div className="pt-3">
                  <p className="t-body text-text-2">
                    Trades the rule turned away today. Nothing was charged for them.
                  </p>
                  <ul className="mt-2 divide-y divide-line">
                    {rejected.map((r) => (
                      <li key={r.tx} className="py-3">
                        <p className="t-list-title text-loss-text">
                          Rejected · {r.side === "buy" ? "buy" : "sell"} {usdc(r.usdc)} USDC
                        </p>
                        <p className="t-body text-text">{rejectSentence(r, policy)}</p>
                        <p className="t-caption">
                          {dateTimeIST(r.time)} ·{" "}
                          <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="text-text-2 underline underline-offset-2">
                            Receipt {shortHash(r.tx)}
                          </a>
                        </p>
                      </li>
                    ))}
                    {rejected.length === 0 && <EmptyState title="Nothing was turned away" body="Every trade today went through." />}
                  </ul>
                </div>
              )}

              {tab === "details" && (
                <>
                  <EnsRows ipo={ipo} />
                  <div className="mt-2 divide-y divide-line">
                    <KV k="Token order" v={market.usdcIsCurrency0 ? "USDC is currency0 · buys are zeroForOne" : "Shares are currency0"} mono />
                    <KV k="Policy version" v={`v${policy.version} · mode ${policy.mode}`} mono />
                    <KV k="Reference price" v={`${lotFixed(policy.referencePrice)} · band ${policy.bandBps} bps`} mono />
                    <KV k="Report receipt" v={<TextLink href={txUrl(policy.creTx)}>{shortHash(policy.creTx)} on Etherscan</TextLink>} />
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </TwoColumn>

      <ActionBar>
        <Button variant="sell" size="bar" className="flex-1" disabled={halted} onClick={() => openSheet("sell")}>
          {halted ? "Trading halted" : "Sell"}
        </Button>
        <Button variant="buy" size="bar" className="flex-1" disabled={halted} onClick={() => openSheet("buy")}>
          {halted ? "Trading halted" : "Buy"}
        </Button>
      </ActionBar>

      <TradeSheet
        key={sheet ?? "closed"}
        ipo={ipo}
        market={market}
        open={sheet !== null}
        side={side}
        setSide={setSide}
        onClose={() => setSheet(null)}
        onRejected={(r) => setExtraRejected((x) => [r, ...x])}
      />

      <FullscreenChart
        open={expanded}
        onClose={() => setExpanded(false)}
        title={`${ipo.name} · ${lotFixed(shown)}`}
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

/** Desktop sticky panel (UX.md 3.3): price, Buy | Sell, then the trade form. */
function OrderPanel({
  ipo,
  market,
  last,
  side,
  setSide,
  onRejected,
}: {
  ipo: Ipo;
  market: Market;
  last: number;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  onRejected: (r: Rejected) => void;
}) {
  const { body, footer } = useTradeForm({ ipo, market, side, setSide, onRejected });
  return (
    <Card className="p-5">
      <p className="t-label">Price</p>
      <p className="num t-price-large text-text">{lotFixed(last)}</p>
      <p className="t-caption">USDC per 1,000 shares</p>
      {body}
      <div className="mt-5">{footer}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// IPO phases (UX.md 3.4)
// ---------------------------------------------------------------------------

type IpoTab = "overview" | "application" | "details";

function IpoCompany({ ipo }: { ipo: Ipo }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<IpoTab>("overview");
  const [view, setView] = useState<"price" | "raise">("price");
  const [hover, setHover] = useState<HoverPoint>(null);
  const [applyOpen, setApplyOpen] = useState(params.get("apply") === "1" && ipo.phase === "live");
  const [worldOpen, setWorldOpen] = useState(false);
  // One sheet at a time: the verify sheet replaces the apply sheet and hands
  // it back on close (two open sheets also trip the body scroll lock).
  const [resumeApply, setResumeApply] = useState(false);
  const [worldState, setWorldState] = useState<WorldState>("unverified");
  const series = getClearing(ipo.ticker);
  const { seconds } = useBlockCountdown(ipo.phase === "draft" ? ipo.startBlock : ipo.endBlock);
  const myBids = bidsFor(ipo.ticker);
  const applied = COMMITTED[ipo.ticker] ?? 0;

  const open = ipo.phase === "live";
  const draft = ipo.phase === "draft";
  const price = ipo.clearingPrice ?? OFFER.issuePrice;
  const shown = view === "price" && hover ? hover.value : price;
  const ch = changeVs(shown, OFFER.issuePrice);
  const raised = ipo.raised ?? 0;
  const opensAt = NOW_SEC + ((ipo.startBlock ?? CURRENT_BLOCK) - CURRENT_BLOCK) * BLOCK_SECONDS;

  const chartData = useMemo(() => series.map((p) => ({ time: p.time, value: view === "price" ? p.price : p.raised })), [series, view]);
  const lines = useMemo<ChartLine[]>(
    () =>
      view === "price"
        ? [
            { price: OFFER.floorPrice, label: `Lowest ${lotFixed(OFFER.floorPrice)}` },
            { price: OFFER.capPrice, label: `Highest ${lotFixed(OFFER.capPrice)}` },
          ]
        : [{ price: OFFER.requiredRaise, label: `Lists at ${usdc(OFFER.requiredRaise, 0)}` }],
    [view],
  );

  const note = open ? (
    <span className="text-gain-text">IPO open</span>
  ) : draft ? (
    <span>IPO upcoming</span>
  ) : (
    <span>Not listed</span>
  );

  const openVerify = (fromApply: boolean) => {
    if (fromApply) {
      setApplyOpen(false);
      setResumeApply(true);
    }
    setWorldOpen(true);
  };
  const closeVerify = () => {
    setWorldOpen(false);
    if (resumeApply) {
      setResumeApply(false);
      setApplyOpen(true);
    }
  };

  const applyPanel = <ApplyPanel ipo={ipo} price={price} seconds={seconds} worldState={worldState} onVerify={() => openVerify(false)} />;

  return (
    <>
      <DetailBar />
      <TwoColumn panel={open ? applyPanel : <PhasePanel ipo={ipo} price={price} seconds={seconds} applied={applied} />}>
        <main>
          <CompanyHead ipo={ipo} note={note} onDetails={() => setTab("details")} />

          {draft ? (
            <>
              <PriceBlock label="Issue price" value={OFFER.issuePrice}>
                <p className="num t-body mt-1 text-text-2">
                  Price range {lotFixed(OFFER.floorPrice)} to {lotFixed(OFFER.capPrice)} · opens {dateTimeIST(opensAt)}
                </p>
                <UnitLine />
              </PriceBlock>

              <Card className="mt-4 p-4">
                <p className="t-list-title text-text">Applications open in {countdown(seconds)}</p>
                <RangeScale />
              </Card>
            </>
          ) : (
            <>
              <PriceBlock label={open ? "Current price" : "Final price"} value={shown}>
                <p className="mt-1 flex flex-wrap items-baseline gap-2">
                  <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} size="lg" />
                  <span className="t-body text-text-2">{hover ? dateTimeIST(hover.time) : "vs issue price"}</span>
                </p>
                {open && (
                  <p className="t-body mt-1 text-text">
                    Closes in <span className={seconds < 3600 ? "text-warn" : undefined}>{countdown(seconds)}</span>
                  </p>
                )}
                <UnitLine />
              </PriceBlock>

              {series.length > 0 && (
                <>
                  <div className="mt-4">
                    <PriceChart
                      data={chartData}
                      kind={view === "price" ? "clearing" : "raised"}
                      baseline={view === "price" ? OFFER.issuePrice : undefined}
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
                <p className="t-list-title text-text">
                  {usdc(raised, 1)} of {usdc(OFFER.targetRaise, 0)} USDC raised
                </p>
                <ProgressBar className="mt-3" value={raised} max={OFFER.targetRaise} marker={OFFER.requiredRaise} />
                <p className="t-caption mt-2">
                  Subscribed{" "}
                  <span className="font-medium" style={{ color: markVar(ipo.ticker) }}>
                    {(raised / OFFER.targetRaise).toFixed(2)}
                  </span>{" "}
                  times · {ipo.applicants} people ·{" "}
                  {raised >= OFFER.requiredRaise ? "past the minimum to list" : `lists if it reaches ${usdc(OFFER.requiredRaise, 0)} USDC`}
                </p>
                {ipo.phase === "refunding" && (
                  <p className="t-body mt-3 text-text">
                    This IPO did not reach {usdc(OFFER.requiredRaise, 0)} USDC. Every application is refundable.
                  </p>
                )}
              </Card>

              {open && ipo.eligibility === "human" && (
                <div className="mt-4 flex min-h-14 items-center gap-3 border-y border-line py-3">
                  <span className="t-body min-w-0 flex-1 text-text">
                    {worldState === "verified" ? "Verified for this IPO" : "One application per person"}
                  </span>
                  {worldState !== "verified" && (
                    <Button variant="secondary" onClick={() => openVerify(false)}>
                      Verify
                    </Button>
                  )}
                </div>
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
              <p className="t-body text-text">{ipo.description}</p>
              <div className="mt-4 divide-y divide-line">
                <KV k="Shares on offer" v={shares(OFFER.auctioned)} />
                <KV k="Issue price" v={lotFixed(OFFER.issuePrice)} sub={`${perShare(OFFER.issuePrice)} USDC per share`} />
                <KV k="Price range" v={`${lotFixed(OFFER.floorPrice)} to ${lotFixed(OFFER.capPrice)}`} />
                <KV k="Most one person can apply with" v={`${usdc(OFFER.perApplicantCap, 0)} USDC`} />
                <KV k="Minimum raise to list" v={`${usdc(OFFER.requiredRaise, 0)} USDC`} sub={`Target ${usdc(OFFER.targetRaise, 0)} USDC`} />
                <KV k="One application per person" v={ipo.eligibility === "human" ? "Yes" : "No"} />
                <KV k="Opens" v={dateTimeIST(opensAt)} />
                <KV
                  k="Closes"
                  v={ipo.endBlock ? dateTimeIST(NOW_SEC + (ipo.endBlock - CURRENT_BLOCK) * BLOCK_SECONDS) : "Not scheduled"}
                />
              </div>
            </div>
          )}

          {tab === "application" && (
            <div className="pt-3">
              {myBids.length === 0 ? (
                <EmptyState
                  title="You have not applied yet"
                  body={open ? "Applications are open until this IPO closes." : "This IPO is closed."}
                  action={open ? { label: "Apply now", onClick: () => setApplyOpen(true) } : undefined}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {myBids.map((b) => (
                    <li key={b.id} className="flex min-h-16 items-center justify-between gap-4 py-3">
                      <span>
                        <span className="t-list-title block text-text">
                          {usdc(b.budget)} USDC up to {lotFixed(b.maxPrice)}
                        </span>
                        <span className="t-label block">{dateTimeIST(b.submittedAt)}</span>
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
              <EnsRows ipo={ipo} />
              <Details className="mt-2" title="Auction detail" defaultOpen>
                <div className="divide-y divide-line">
                  <KV k="Start block" v={String(ipo.startBlock ?? "—")} mono />
                  <KV k="End block" v={String(ipo.endBlock ?? "—")} mono />
                  <KV k="Claim from block" v={String(ipo.claimBlock ?? "—")} mono />
                  <KV k="Price limit (cap)" v={`${lotFixed(OFFER.capPrice)} = 190% of issue`} mono />
                  <KV k="Raise to liquidity" v={`${OFFER.lpPercent}% seeds the pool at the final price`} mono />
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
            Opens in {countdown(seconds)}
          </Button>
        </ActionBar>
      )}
      {ipo.phase === "refunding" && applied > 0 && (
        <ActionBar>
          <Link href="/orders" className="flex flex-1">
            <Button variant="buy" size="bar" className="w-full">
              Refund {usdc(applied)} USDC
            </Button>
          </Link>
        </ActionBar>
      )}

      <ApplySheet ipo={ipo} open={applyOpen} onClose={() => setApplyOpen(false)} worldState={worldState} onVerify={() => openVerify(true)} />
      <WorldSheet open={worldOpen} onClose={closeVerify} state={worldState} setState={setWorldState} company={ipo.name} />
    </>
  );
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

/** The 0.80 / 1.00 / 1.90 scale shown while an IPO has not opened yet. */
function RangeScale() {
  const pos = ((OFFER.issuePrice - OFFER.floorPrice) / (OFFER.capPrice - OFFER.floorPrice)) * 100;
  return (
    <div className="mt-8 mb-2">
      <div className="relative h-px bg-line">
        <span aria-hidden className="absolute -top-1.5 left-0 h-3 w-px bg-line-strong" />
        <span aria-hidden className="absolute -top-1.5 h-3 w-px bg-text" style={{ left: `${pos}%` }} />
        <span aria-hidden className="absolute -top-1.5 right-0 h-3 w-px bg-line-strong" />
        <span className="num t-caption absolute top-3 whitespace-nowrap text-text" style={{ left: `${pos}%`, transform: "translateX(-50%)" }}>
          Issue {lotFixed(OFFER.issuePrice)}
        </span>
      </div>
      <div className="num t-caption mt-3 flex justify-between">
        <span>{lotFixed(OFFER.floorPrice)}</span>
        <span>{lotFixed(OFFER.capPrice)}</span>
      </div>
    </div>
  );
}

/** Desktop panel while an IPO is open: price, then the Apply form. */
function ApplyPanel({
  ipo,
  price,
  seconds,
  worldState,
  onVerify,
}: {
  ipo: Ipo;
  price: number;
  seconds: number;
  worldState: WorldState;
  onVerify: () => void;
}) {
  const { body, footer } = useApplyForm({ ipo, worldState, onVerify });
  return (
    <Card className="p-5">
      <p className="t-label">Current price</p>
      <p className="num t-price-large text-text">{lotFixed(price)}</p>
      <p className="t-caption">
        USDC per 1,000 shares · closes in <span className={seconds < 3600 ? "text-warn" : undefined}>{countdown(seconds)}</span>
      </p>
      {body}
      <div className="mt-5">{footer}</div>
    </Card>
  );
}

/** Desktop panel for the phases with no form: upcoming and closed. */
function PhasePanel({ ipo, price, seconds, applied }: { ipo: Ipo; price: number; seconds: number; applied: number }) {
  const draft = ipo.phase === "draft";
  return (
    <Card className="p-5">
      <p className="t-label">{draft ? "Issue price" : "Final price"}</p>
      <p className="num t-price-large text-text">{lotFixed(draft ? OFFER.issuePrice : price)}</p>
      <p className="t-caption">USDC per 1,000 shares</p>
      {draft ? (
        <Button variant="buy" size="bar" className="mt-5 w-full" disabled>
          Opens in {countdown(seconds)}
        </Button>
      ) : applied > 0 ? (
        <Link href="/orders" className="mt-5 block">
          <Button variant="buy" size="bar" className="w-full">
            Refund {usdc(applied)} USDC
          </Button>
        </Link>
      ) : (
        <p className="t-body mt-4 text-text-2">This IPO is closed. Nothing to do here.</p>
      )}
    </Card>
  );
}
