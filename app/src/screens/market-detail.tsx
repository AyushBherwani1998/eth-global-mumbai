"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, Bookmark, ChevronRight, ExternalLink, Search, Wallet } from "lucide-react";
import { ActionBar, DetailHeader, IconButton } from "@/components/shell";
import { CircuitBanner } from "@/components/circuit-banner";
import { TimeChart, type ChartLine, type ChartMarker } from "@/components/time-chart";
import { Button, Card, Change, CopyAddress, KV, Pill, Segmented, Tabs, cx } from "@/components/ui";
import { changeVs, dateTimeIST, lotFixed, perShare, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { NOW, OFFER, PORTFOLIO, type Ipo, type Market, type Rejected } from "@/lib/mock";
import { band, bandDigits, modeInfo } from "@/lib/policy";
import { TickerTitle } from "./common";
import { EnsPanel } from "./ipo-detail";
import { TradeSheet } from "./trade-sheet";

type Range = "1H" | "4H" | "1D" | "ALL";
const WINDOW: Record<Range, number> = { "1H": 3600, "4H": 4 * 3600, "1D": 86400, ALL: Infinity };

export function MarketDetailScreen({ ipo, market }: { ipo: Ipo; market: Market }) {
  const [range, setRange] = useState<Range>("1D");
  const [tab, setTab] = useState<"overview" | "trades" | "rejected" | "ens">("overview");
  const [hover, setHover] = useState<{ value: number; time: number } | null>(null);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [extraRejected, setExtraRejected] = useState<Rejected[]>([]);

  const policy = market.policy;
  const last = market.prices[market.prices.length - 1].value;
  const shown = hover?.value ?? last;
  const vsIssue = changeVs(shown, OFFER.issuePrice);
  const vsClearing = changeVs(last, ipo.clearingPrice!);
  const vsRef = changeVs(last, policy.referencePrice);
  const info = modeInfo(policy);
  const d = bandDigits(policy.referencePrice, policy.bandBps);
  const { lo, hi } = band(policy.referencePrice, policy.bandBps);
  const rejected = useMemo(() => [...extraRejected, ...market.rejected], [extraRejected, market.rejected]);
  const holding = PORTFOLIO.holdings.find((h) => h.ticker === ipo.ticker);

  const nowSec = new Date(NOW).getTime() / 1000;
  const data = useMemo(() => {
    const from = nowSec - WINDOW[range];
    const pts = market.prices.filter((p) => p.time >= from).map((p) => ({ time: p.time, value: p.value }));
    // Rejected swaps the user just sent land "now"; extend the line so the marker has a place.
    return pts.length > 1 ? pts : market.prices.slice(-2).map((p) => ({ time: p.time, value: p.value }));
  }, [market.prices, range, nowSec]);

  const lines = useMemo<ChartLine[]>(() => {
    if (policy.halted || policy.mode === "directional") return [];
    return [
      { price: hi, color: "loss", style: "dotted", title: `Upper ${lotFixed(hi, d)}` },
      { price: lo, color: "loss", style: "dotted", title: `Lower ${lotFixed(lo, d)}` },
    ];
  }, [policy, hi, lo, d]);

  const markers = useMemo<ChartMarker[]>(
    () => [
      ...rejected.map((r) => ({
        time: Math.min(new Date(r.time).getTime() / 1000, data[data.length - 1].time),
        kind: "reject" as const,
        text: "×",
      })),
      ...market.events.map((e) => ({
        time: new Date(e.time).getTime() / 1000,
        kind: e.kind === "halted" ? ("halt" as const) : ("event" as const),
      })),
    ],
    [rejected, market.events, data],
  );

  const open = (s: "buy" | "sell") => {
    setSide(s);
    setSheet(s);
  };

  return (
    <>
      <DetailHeader
        actions={
          <>
            <IconButton label="Price alert">
              <Bell className="size-[22px]" />
            </IconButton>
            <IconButton label="Watchlist">
              <Bookmark className="size-[22px]" />
            </IconButton>
            <Link href="/" aria-label="Search tickers" className="rounded-full p-2.5 text-strong hover:bg-subtle">
              <Search className="size-[22px]" />
            </Link>
          </>
        }
        fallback="/market"
      />
      <main className="px-4">
        <TickerTitle ipo={ipo} />
        <p className="mt-3 text-xs text-muted">{hover ? dateTimeIST(hover.time) : "Last pool price"}</p>
        <p className="num text-[26px] font-bold tracking-tight text-strong">
          {lotFixed(shown, 3)} <span className="text-sm font-medium text-muted">USDC / lot</span>
        </p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-[13px]">
            <Change abs={vsIssue.abs} rel={vsIssue.rel} digits={3} /> <span className="text-muted">vs issue</span>
          </span>
          <span className="rounded-[6px] border border-line px-2 py-0.5 text-xs text-fg">{ipo.sector}</span>
        </div>
        <p className="num mt-0.5 text-xs text-muted">
          {perShare(shown)} / share · vs clearing {vsClearing.up ? "+" : ""}
          {vsClearing.rel.toFixed(2)}% · vs ref {vsRef.up ? "+" : ""}
          {vsRef.rel.toFixed(2)}%
        </p>

        <div className="mt-3">
          <CircuitBanner ticker={ipo.ticker} policy={policy} />
        </div>

        <div className="-mx-1 mt-2">
          <TimeChart
            data={data}
            kind="baseline"
            baseValue={policy.referencePrice}
            reference={market.reference}
            lines={lines}
            markers={markers}
            digits={3}
            height={230}
            onHover={setHover}
          />
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-line-strong pt-3">
          <span className="text-[13px] font-semibold text-gain">v4 POOL</span>
          <Segmented
            value={range}
            onChange={setRange}
            options={(["1H", "4H", "1D", "ALL"] as Range[]).map((r) => ({ id: r, label: r }))}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <Legend swatch={<span className="h-0.5 w-3 bg-gain" />} label="Pool price" />
          <Legend swatch={<span className="h-0 w-3 border-t border-dashed border-brand" />} label={`Ref ${lotFixed(policy.referencePrice)}`} />
          {lines.length > 0 && <Legend swatch={<span className="h-0 w-3 border-t border-dotted border-loss" />} label="Band" />}
          <Legend swatch={<span className="text-loss">▼</span>} label="Rejected attempts seen by this app" />
        </div>

        <Link href={holding ? "/portfolio" : "/bids"} className="mt-4 block">
          <Card className="flex items-center gap-3 p-3.5">
            <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-muted">
              <Wallet className="size-5" />
            </span>
            <span className="flex-1">
              {holding ? (
                <>
                  <span className="block text-[15px] font-semibold text-strong">
                    You hold {shares(holding.shares + holding.unclaimedShares)} {ipo.symbol}
                  </span>
                  <span className="num block text-[13px] text-muted">
                    Worth {usdc(((holding.shares + holding.unclaimedShares) * last) / 1000)} USDC
                    {holding.unclaimedShares > 0 && ` · ${shares(holding.unclaimedShares)} unclaimed`}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[15px] font-semibold text-strong">Got an allotment?</span>
                  <span className="block text-[13px] text-muted">Claim your IPO shares in My bids</span>
                </>
              )}
            </span>
            <ChevronRight className="size-5 text-muted" />
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
                <span className="text-sm text-muted">Pool ID</span>
                <CopyAddress value={ipo.records.pool} label={ipo.records.pool ? `${ipo.records.pool.slice(0, 8)}…${ipo.records.pool.slice(-4)}` : undefined} />
              </div>
            </div>
            <h3 className="mt-4 mb-2 text-sm">Circuit history</h3>
            <ol className="space-y-2.5 border-l border-line pl-4">
              {[...market.events].reverse().map((e) => (
                <li key={e.time} className="relative">
                  <span className={cx("absolute top-1.5 -left-[21px] size-2.5 rounded-full", e.kind === "halted" ? "bg-loss" : "bg-brand")} />
                  <p className="text-sm text-strong">{e.label}</p>
                  <p className="text-xs text-muted">{dateTimeIST(e.time)}</p>
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
                  <span className={cx("text-sm font-semibold capitalize", t.side === "buy" ? "text-gain" : "text-loss")}>{t.side}</span>
                  <span className="block text-xs text-muted">{timeIST(t.time)}</span>
                </span>
                <span className="num text-right text-sm">
                  <span className="text-strong">{shares(t.shares)} sh</span>
                  <span className="block text-xs text-muted">
                    {usdc(t.usdc)} USDC @ {t.price.toFixed(3)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === "rejected" && (
          <div className="pt-2">
            <p className="text-xs text-muted">
              Reverted swaps emit no logs. These come from this app&apos;s own receipts and the demo script&apos;s published hashes.
            </p>
            <ul className="mt-2 divide-y divide-line">
              {rejected.map((r) => (
                <li key={r.tx} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      <span className={cx("font-semibold capitalize", r.side === "buy" ? "text-gain" : "text-loss")}>{r.side}</span>{" "}
                      <span className="num text-strong">{usdc(r.usdc)} USDC</span>
                    </span>
                    <Pill tone="loss">{r.reason}</Pill>
                  </div>
                  <p className="text-[13px] text-fg">{r.detail}</p>
                  <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted">
                    {dateTimeIST(r.time)} · {shortHash(r.tx)} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "ens" && <EnsPanel ipo={ipo} />}
      </main>

      <ActionBar>
        <Button tone="loss" className="flex-1" onClick={() => open("sell")}>
          Sell
        </Button>
        <Button tone="gain" className="flex-1" onClick={() => open("buy")}>
          Buy
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

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}
