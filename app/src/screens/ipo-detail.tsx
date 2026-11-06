"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, Bookmark, CheckCircle2, ChevronRight, ExternalLink, ScanFace, Share2, ShieldCheck } from "lucide-react";
import { ActionBar, DetailHeader, IconButton } from "@/components/shell";
import { TimeChart, type ChartLine } from "@/components/time-chart";
import { Button, Card, Change, CopyAddress, KV, Pill, Progress, Segmented, StatusChip, Tabs, cx } from "@/components/ui";
import { useBlockCountdown } from "@/lib/hooks";
import { blockNo, blocksToDuration, changeVs, dateTimeIST, lotFixed, perShare, secondsToDuration, shares, usdc } from "@/lib/format";
import { CURRENT_BLOCK, OFFER, bidsFor, ensName, getClearing, type Ipo } from "@/lib/mock";
import { BidSheet } from "./bid-sheet";
import { BidRow } from "./my-bids";
import { TickerTitle } from "./common";
import { WorldSheet, type WorldState } from "./world-sheet";

export function IpoDetailScreen({ ipo }: { ipo: Ipo }) {
  const series = getClearing(ipo.ticker);
  const [view, setView] = useState<"price" | "raise">("price");
  const [tab, setTab] = useState<"overview" | "ens" | "bids">("overview");
  const [bidOpen, setBidOpen] = useState(false);
  const [worldOpen, setWorldOpen] = useState(false);
  const [worldState, setWorldState] = useState<WorldState>("verified");
  const [hover, setHover] = useState<{ value: number; time: number } | null>(null);
  const [watch, setWatch] = useState(false);
  const { seconds } = useBlockCountdown(ipo.phase === "draft" ? ipo.startBlock : ipo.endBlock);
  const myBids = bidsFor(ipo.ticker);

  const clearing = ipo.clearingPrice;
  const shown = view === "price" && hover ? hover.value : clearing;
  const ch = shown ? changeVs(shown, OFFER.issuePrice) : null;
  const graduatedThreshold = (ipo.raised ?? 0) >= OFFER.requiredRaise;

  const chartData = useMemo(
    () => series.map((p) => ({ time: p.time, value: view === "price" ? p.price : p.raised })),
    [series, view],
  );
  const lines = useMemo<ChartLine[]>(
    () =>
      view === "price"
        ? [
            { price: OFFER.floorPrice, color: "muted", style: "dotted", title: `Floor ${lotFixed(OFFER.floorPrice)}` },
            { price: OFFER.issuePrice, color: "muted", style: "dashed", title: `Issue ${lotFixed(OFFER.issuePrice)}` },
          ]
        : [{ price: OFFER.requiredRaise, color: "gain", style: "dashed", title: `Graduates at ${OFFER.requiredRaise}` }],
    [view],
  );

  return (
    <>
      <DetailHeader
        actions={
          <>
            <IconButton label="Price alert" active={watch} onClick={() => setWatch((w) => !w)}>
              <Bell className="size-[22px]" />
            </IconButton>
            <IconButton label="Watchlist">
              <Bookmark className="size-[22px]" />
            </IconButton>
            <IconButton label="Share" onClick={() => navigator.share?.({ title: ipo.name, url: location.href }).catch(() => {})}>
              <Share2 className="size-[22px]" />
            </IconButton>
          </>
        }
      />
      <main className="px-4">
        <TickerTitle ipo={ipo} />

        {clearing ? (
          <>
            <p className="mt-3 text-xs text-muted">
              {view === "price" && hover ? dateTimeIST(hover.time) : ipo.phase === "refunding" ? "Final clearing price" : "Current clearing price"}
            </p>
            <p className="num text-[26px] font-bold tracking-tight text-strong">
              {lotFixed(shown!)} <span className="text-sm font-medium text-muted">USDC / lot</span>
            </p>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="text-[13px]">
                <Change abs={ch!.abs} rel={ch!.rel} /> <span className="text-muted">vs issue · {perShare(shown!)} / share</span>
              </span>
              <StatusChip ipo={ipo} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs text-muted">Issue price</p>
            <p className="num text-[26px] font-bold tracking-tight text-strong">
              {lotFixed(OFFER.issuePrice)} <span className="text-sm font-medium text-muted">USDC / lot</span>
            </p>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-[13px] text-muted">
                Range {lotFixed(OFFER.floorPrice)}–{lotFixed(OFFER.capPrice)} USDC / lot
              </span>
              <StatusChip ipo={ipo} />
            </div>
          </>
        )}

        {series.length > 0 ? (
          <div className="mt-3 -mx-1">
            <TimeChart
              data={chartData}
              kind={view === "price" ? "step" : "line"}
              color={view === "price" ? "brand" : "gain"}
              lines={lines}
              digits={view === "price" ? 2 : 1}
              height={200}
              onHover={setHover}
            />
          </div>
        ) : (
          <div className="mt-3 flex h-[200px] items-center justify-center rounded-[12px] bg-subtle text-sm text-muted">
            Auction starts at block {blockNo(ipo.startBlock!)}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-dashed border-line-strong pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gain">CCA</span>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: "price", label: "Clearing" },
                { id: "raise", label: "Raised" },
              ]}
            />
          </div>
          <span className="num text-[13px] text-muted">
            {ipo.phase === "live" && `Ends in ${secondsToDuration(seconds)}`}
            {ipo.phase === "draft" && `Starts in ~${secondsToDuration(seconds)}`}
            {ipo.phase === "refunding" && `Ended at block ${blockNo(ipo.endBlock!)}`}
          </span>
        </div>

        {ipo.raised !== undefined && (
          <Card className="mt-4 p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-strong">Raise progress</p>
              <p className="num text-sm text-strong">
                {usdc(ipo.raised, 1)} <span className="text-muted">/ {OFFER.targetRaise} USDC</span>
              </p>
            </div>
            <div className="mt-2.5">
              <Progress value={ipo.raised} max={OFFER.targetRaise} marker={OFFER.requiredRaise} tone={graduatedThreshold ? "gain" : "warn"} />
            </div>
            <p className={cx("mt-2 flex items-center gap-1.5 text-[13px]", graduatedThreshold ? "text-gain" : "text-muted")}>
              {graduatedThreshold && <CheckCircle2 className="size-4" />}
              {graduatedThreshold
                ? `Graduation threshold met (${OFFER.requiredRaise} USDC)`
                : ipo.phase === "refunding"
                  ? `Ended below the ${OFFER.requiredRaise} USDC threshold. Every bid is refundable.`
                  : `Graduates at ${OFFER.requiredRaise} of ${OFFER.targetRaise} USDC`}
            </p>
            <p className="num mt-1 text-xs text-muted">
              {ipo.bidCount} bids · {ipo.applicants} {ipo.eligibility === "human" ? "verified humans" : "wallets"}
            </p>
          </Card>
        )}

        {ipo.eligibility === "human" && ipo.phase !== "refunding" && (
          <button onClick={() => setWorldOpen(true)} className="mt-3 w-full text-left">
            <Card className="flex items-center gap-3 p-3.5">
              <span className={cx("flex size-10 items-center justify-center rounded-full", worldState === "verified" ? "bg-gain-soft text-gain" : "bg-subtle text-muted")}>
                {worldState === "verified" ? <ShieldCheck className="size-5" /> : <ScanFace className="size-5" />}
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold text-strong">One application per person</span>
                <span className="block text-[13px] text-muted">
                  {worldState === "verified" ? "You're verified with World ID" : "Verify with World ID before bidding"}
                </span>
              </span>
              <ChevronRight className="size-5 text-muted" />
            </Card>
          </button>
        )}

        <div className="mt-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "ens", label: "ENS" },
              { id: "bids", label: "My bids", count: myBids.length },
            ]}
          />
        </div>

        {tab === "overview" && (
          <div className="pt-3">
            <p className="text-sm">{ipo.description}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill>{ipo.sector}</Pill>
              <Pill>{ipo.city}</Pill>
              <Pill tone={ipo.eligibility === "human" ? "gain" : "muted"}>{ipo.eligibility === "human" ? "1 per human" : "Open to all wallets"}</Pill>
            </div>
            <div className="mt-3 divide-y divide-line">
              <KV k="Total supply" v={`${shares(OFFER.totalSupply)} shares`} />
              <KV k="Auctioned" v={shares(OFFER.auctioned)} sub={`LP reserve ${shares(OFFER.lpReserve)}`} />
              <KV k="Issue price" v={`${lotFixed(OFFER.issuePrice)} USDC / lot`} sub={`${perShare(OFFER.issuePrice)} USDC / share`} />
              <KV k="Price range" v={`${lotFixed(OFFER.floorPrice)}–${lotFixed(OFFER.capPrice)} USDC / lot`} sub="80–190% of issue" />
              <KV k="Per-applicant cap" v={`${OFFER.perApplicantCap} USDC`} />
              <KV k="Raise to LP" v={`${OFFER.lpPercent}%`} sub="Seeds the Uniswap v4 pool at the clearing price" />
              <KV k="Start block" v={blockNo(ipo.startBlock!)} />
              <KV
                k="End block"
                v={blockNo(ipo.endBlock!)}
                sub={ipo.endBlock! > CURRENT_BLOCK ? `in ~${blocksToDuration(ipo.endBlock! - CURRENT_BLOCK)}` : "ended"}
              />
              <KV k="Claim from block" v={blockNo(ipo.claimBlock!)} />
              <KV k="Unsold shares" v="Go to issuer treasury" />
            </div>
          </div>
        )}

        {tab === "ens" && <EnsPanel ipo={ipo} />}

        {tab === "bids" && (
          <div className="pt-3">
            {myBids.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">You haven&apos;t bid on {ipo.symbol} yet.</p>
            ) : (
              <Card className="divide-y divide-line">
                {myBids.map((b) => (
                  <BidRow key={b.id} bid={b} ipo={ipo} />
                ))}
              </Card>
            )}
          </div>
        )}
      </main>

      <ActionBar>
        {ipo.phase === "live" && (
          <Button className="flex-1" onClick={() => setBidOpen(true)}>
            Place bid
          </Button>
        )}
        {ipo.phase === "draft" && (
          <Button className="flex-1" disabled>
            Auction not started · ~{secondsToDuration(seconds)}
          </Button>
        )}
        {ipo.phase === "refunding" && (
          <Link href="/bids" className="flex flex-1">
            <Button tone="neutral" className="flex-1">
              Refunds open · go to My bids
            </Button>
          </Link>
        )}
        {ipo.phase === "listed" && (
          <Link href={`/market/${ipo.ticker}`} className="flex flex-1">
            <Button className="flex-1">Listed at {lotFixed(ipo.clearingPrice!)} · View market</Button>
          </Link>
        )}
      </ActionBar>

      <BidSheet
        ipo={ipo}
        open={bidOpen}
        onClose={() => setBidOpen(false)}
        worldState={worldState}
        onVerify={() => setWorldOpen(true)}
      />
      <WorldSheet open={worldOpen} onClose={() => setWorldOpen(false)} state={worldState} setState={setWorldState} symbol={ipo.symbol} />
    </>
  );
}

/** "Resolved from ENS" panel: the ENS judging evidence, kept one tap away. */
export function EnsPanel({ ipo }: { ipo: Ipo }) {
  const rows: [string, string | null][] = [
    ["addr (issuer)", ipo.records.addr],
    ["token", ipo.records.token],
    ["listingday.auction", ipo.records.auction],
    ["listingday.hook", ipo.records.hook],
    ["listingday.policy", ipo.records.policy],
    ["listingday.pool", ipo.records.pool],
  ];
  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 rounded-[12px] bg-gain-soft px-3 py-2 text-[13px] text-gain">
        <CheckCircle2 className="size-4" /> Resolved from ENS · {ensName(ipo.ticker)}
      </div>
      <div className="mt-2 divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-2.5">
            <code className="text-[13px] text-muted">{k}</code>
            <CopyAddress value={v} label={v && v.length > 42 ? `${v.slice(0, 8)}…${v.slice(-4)}` : undefined} />
          </div>
        ))}
        <div className="flex items-center justify-between py-2.5">
          <code className="text-[13px] text-muted">listingday.status</code>
          <span className="text-[13px] font-semibold text-strong">{ipo.status}</span>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <code className="text-[13px] text-muted">listingday.eligibility</code>
          <span className="text-[13px] font-semibold text-strong">{ipo.eligibility}</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Only the CRE receiver may write <code>listingday.status</code>; every other record is the issuer&apos;s.
      </p>
      <a
        href={`https://sepolia.app.ens.domains/${ensName(ipo.ticker)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand"
      >
        View in ENS app <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
