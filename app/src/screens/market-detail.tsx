"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Wallet } from "lucide-react";
import { ActionBar, DetailBar, ShareButton, TwoColumn } from "@/components/shell";
import { CircuitBanner } from "@/components/circuit-banner";
import { PriceChart, RangeChips, sliceRange, type ChartRange } from "@/components/time-chart";
import { Button, Card, Change, CopyAddress, KV, Pill, Tabs, cx } from "@/components/ui";
import { changeVs, dateTimeIST, lotFixed, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { NOW, OFFER, PORTFOLIO, dayOpen, type Ipo, type Market, type Rejected } from "@/lib/mock";
import { modeInfo } from "@/lib/policy";
import { TickerTitle } from "./common";
import { EnsPanel } from "./ipo-detail";
import { TradeSheet } from "./trade-sheet";


export function MarketDetailScreen({ ipo, market }: { ipo: Ipo; market: Market }) {
  const [range, setRange] = useState<ChartRange>("1D");
  const [tab, setTab] = useState<"overview" | "trades" | "rejected" | "ens">("overview");
  const [hover, setHover] = useState<{ value: number; time: number } | null>(null);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [extraRejected, setExtraRejected] = useState<Rejected[]>([]);

  const policy = market.policy;
  const last = market.prices[market.prices.length - 1].value;
  const shown = hover?.value ?? last;
  const info = modeInfo(policy);
  const rejected = useMemo(() => [...extraRejected, ...market.rejected], [extraRejected, market.rejected]);
  const holding = PORTFOLIO.holdings.find((h) => h.ticker === ipo.ticker);

  const nowSec = new Date(NOW).getTime() / 1000;
  const data = useMemo(() => sliceRange(market.prices, range, nowSec), [market.prices, range, nowSec]);
  // Baseline: day open on 1D, the first point of the range otherwise (UX.md 3.11).
  const base = range === "1D" ? (dayOpen(ipo.ticker) ?? data[0].value) : data[0].value;
  const change = changeVs(shown, base);
  const rejectTimes = useMemo(() => rejected.map((r) => new Date(r.time).getTime() / 1000), [rejected]);

  const open = (s: "buy" | "sell") => {
    setSide(s);
    setSheet(s);
  };

  return (
    <>
      <DetailBar right={<ShareButton title={ipo.name} />} />
      <TwoColumn
        panel={
          <Card className="p-5">
            <p className="t-label">Price</p>
            <p className="num t-price-large text-text">{lotFixed(last)}</p>
            <p className="t-caption">USDC per lot</p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Button variant="sell" size="bar" disabled={policy.halted || policy.mode === "halted"} onClick={() => open("sell")}>
                Sell
              </Button>
              <Button variant="buy" size="bar" disabled={policy.halted || policy.mode === "halted"} onClick={() => open("buy")}>
                Buy
              </Button>
            </div>
            {(policy.halted || policy.mode === "halted") && <p className="t-body mt-3 text-text-2">Trading is paused. You can still withdraw liquidity.</p>}
          </Card>
        }
      >
      <main>
        <TickerTitle ipo={ipo} />
        <p className="num t-price-large mt-3 text-text">
          {lotFixed(shown)} <span className="t-body text-text-2">USDC per lot</span>
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <Change abs={change.abs} rel={change.rel} size="lg" />
            <span className="t-body text-text-2">{hover ? dateTimeIST(hover.time) : range === "1D" ? "Today" : range === "1W" ? "This week" : "Since listing"}</span>
          </span>
          <span className="t-label-sm rounded-[10px] border border-line px-2.5 py-1 text-text-2">{ipo.sector}</span>
        </div>

        <div className="mt-4">
          <CircuitBanner ticker={ipo.ticker} policy={policy} />
        </div>

        <div className="mt-4">
          <PriceChart
            data={data}
            kind="market"
            baseline={base}
            reference={market.reference}
            rejects={rejectTimes}
            digits={3}
            height={280}
            onHover={setHover}
          />
        </div>

        <div className="dotted-line mt-2 flex items-center justify-between pt-3">
          <RangeChips value={range} onChange={setRange} />
        </div>

        <Link href={holding ? "/portfolio" : "/orders"} className="mt-4 block">
          <Card className="flex items-center gap-3 p-3.5">
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-text-2">
              <Wallet className="size-5" />
            </span>
            <span className="flex-1">
              {holding ? (
                <>
                  <span className="block text-[15px] font-medium text-text">
                    You hold {shares(holding.shares + holding.unclaimedShares)} {ipo.symbol}
                  </span>
                  <span className="num block text-[13px] text-text-2">
                    Worth {usdc(((holding.shares + holding.unclaimedShares) * last) / 1000)} USDC
                    {holding.unclaimedShares > 0 && ` · ${shares(holding.unclaimedShares)} unclaimed`}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[15px] font-medium text-text">Got an allotment?</span>
                  <span className="block text-[13px] text-text-2">Collect your IPO shares in Orders</span>
                </>
              )}
            </span>
            <ChevronRight className="size-5 text-text-2" />
          </Card>
        </Link>

        <div className="mt-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "trades", label: "Trades" },
              { id: "rejected", label: "Rejected", count: rejected.length },
              { id: "ens", label: "ENS" },
            ]}
          />
        </div>

        {tab === "overview" && (
          <div className="pt-2">
            <div className="divide-y divide-line">
              <KV k="Rule in force" v={info.label} sub={info.copy} />
              <KV k="Reference price" v={`${lotFixed(policy.referencePrice)} USDC / lot`} sub={`Policy v${policy.version} via CRE`} />
              <KV k="Clearing price" v={`${lotFixed(ipo.clearingPrice!)} USDC / lot`} sub={`Listed ${dateTimeIST(ipo.listedAt!)}`} />
              <KV k="Issue price" v={`${lotFixed(OFFER.issuePrice)} USDC / lot`} />
              <KV k="Pool liquidity" v={`${usdc(market.liquidity.usdc)} USDC`} sub={`${shares(market.liquidity.shares)} ${ipo.symbol}`} />
              <KV k="Token order" v={market.usdcIsCurrency0 ? "USDC is currency0" : `${ipo.symbol} is currency0`} sub="Buys are zeroForOne" />
              <div className="flex items-center justify-between py-2.5">
                <span className="text-[14px] text-text-2">Pool ID</span>
                <CopyAddress value={ipo.records.pool} label={ipo.records.pool ? `${ipo.records.pool.slice(0, 8)}…${ipo.records.pool.slice(-4)}` : undefined} />
              </div>
            </div>
            <h3 className="mt-4 mb-2 text-[14px]">Circuit history</h3>
            <ol className="space-y-2.5 border-l border-line pl-4">
              {[...market.events].reverse().map((e) => (
                <li key={e.time} className="relative">
                  <span className={cx("absolute top-1.5 -left-[21px] size-2.5 rounded-full", e.kind === "halted" ? "bg-loss" : "bg-text")} />
                  <p className="text-[14px] text-text">{e.label}</p>
                  <p className="text-[13px] text-text-2">{dateTimeIST(e.time)}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {tab === "trades" && (
          <ul className="divide-y divide-line">
            {market.trades.map((t) => (
              <li key={t.tx + t.time} className="flex items-center justify-between py-2.5">
                <span>
                  <span className={cx("text-[14px] font-medium capitalize", t.side === "buy" ? "text-gain-text" : "text-loss-text")}>{t.side}</span>
                  <span className="block text-[13px] text-text-2">{timeIST(t.time)}</span>
                </span>
                <span className="num text-right text-[14px]">
                  <span className="text-text">{shares(t.shares)} sh</span>
                  <span className="block text-[13px] text-text-2">
                    {usdc(t.usdc)} USDC @ {t.price.toFixed(3)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === "rejected" && (
          <div className="pt-2">
            <p className="text-[13px] text-text-2">
              Reverted swaps emit no logs. These come from this app&apos;s own receipts and the demo script&apos;s published hashes.
            </p>
            <ul className="mt-2 divide-y divide-line">
              {rejected.map((r) => (
                <li key={r.tx} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px]">
                      <span className={cx("font-medium capitalize", r.side === "buy" ? "text-gain-text" : "text-loss-text")}>{r.side}</span>{" "}
                      <span className="num text-text">{usdc(r.usdc)} USDC</span>
                    </span>
                    <Pill tone="loss">{r.reason}</Pill>
                  </div>
                  <p className="text-[13px] text-text">{r.detail}</p>
                  <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-text-2">
                    {dateTimeIST(r.time)} · {shortHash(r.tx)} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "ens" && <EnsPanel ipo={ipo} />}
      </main>
      </TwoColumn>

      <ActionBar>
        <Button variant="sell" size="bar" className="flex-1" disabled={policy.halted || policy.mode === "halted"} onClick={() => open("sell")}>
          {policy.halted || policy.mode === "halted" ? "Trading halted" : "Sell"}
        </Button>
        <Button variant="buy" size="bar" className="flex-1" disabled={policy.halted || policy.mode === "halted"} onClick={() => open("buy")}>
          {policy.halted || policy.mode === "halted" ? "Trading halted" : "Buy"}
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
    </>
  );
}

