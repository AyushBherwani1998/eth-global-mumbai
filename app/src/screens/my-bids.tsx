"use client";

import Link from "next/link";
import { useState } from "react";
import { Gavel, Undo2, Wallet } from "lucide-react";
import { TabHeader } from "@/components/shell";
import { Button, Card, Empty, Pill, StatusChip, TickerAvatar, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { blockNo, blocksToDuration, dateTimeIST, lotFixed, shares, usdc } from "@/lib/format";
import { BIDS, COMMITTED, CURRENT_BLOCK, OFFER, getIpo, hrefFor, type Bid, type BidState, type Ipo } from "@/lib/mock";
import type { Tone } from "@/lib/policy";
import { BottomSpacer } from "./common";

const stateMeta: Record<BidState, { label: string; tone: Tone | "muted" }> = {
  active: { label: "Active", tone: "brand" },
  outbid: { label: "Outbid", tone: "warn" },
  partial: { label: "Partial", tone: "warn" },
  filled: { label: "Filled", tone: "gain" },
  exited: { label: "Refunded", tone: "muted" },
  claimed: { label: "Claimed", tone: "gain" },
  refundable: { label: "Refundable", tone: "warn" },
};

type Override = Partial<Record<number, BidState>>;

function useBidActions() {
  const { sendTx } = useApp();
  const [over, setOver] = useState<Override>({});
  const act = async (bid: Bid, kind: "exit" | "exitPartial" | "claim") => {
    const ipo = getIpo(bid.ticker)!;
    const title =
      kind === "claim"
        ? `Claim ${shares(bid.filledShares)} ${ipo.symbol}`
        : kind === "exitPartial"
          ? `Exit partial bid #${bid.id} · refund ${usdc(bid.refund)} USDC`
          : `Exit bid #${bid.id} · refund ${usdc(bid.refund)} USDC`;
    const r = await sendTx({ title, success: kind === "claim" ? "Shares claimed" : "Refund sent" });
    if (r.ok) setOver((o) => ({ ...o, [bid.id]: kind === "claim" ? "claimed" : kind === "exitPartial" ? "filled" : "exited" }));
  };
  return { over, setOver, act };
}

export function BidRow({ bid, ipo, state, onAction }: { bid: Bid; ipo: Ipo; state?: BidState; onAction?: (k: "exit" | "exitPartial" | "claim") => void }) {
  const s = state ?? bid.state;
  const meta = stateMeta[s];
  const ended = (ipo.endBlock ?? 0) <= CURRENT_BLOCK || ipo.phase === "listed";
  const claimOpen = ipo.phase === "listed" || (ipo.claimBlock ?? Infinity) <= CURRENT_BLOCK;
  return (
    <div className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="num text-[15px] font-medium text-strong">
            {usdc(bid.budget)} USDC <span className="text-muted">up to</span> {lotFixed(bid.maxPrice)}
            <span className="text-xs text-muted"> / lot</span>
          </p>
          <p className="num text-xs text-muted">
            #{bid.id} · block {blockNo(bid.submittedBlock)} · {dateTimeIST(bid.submittedAt)}
          </p>
        </div>
        <Pill tone={meta.tone}>{meta.label}</Pill>
      </div>
      {(bid.filledShares > 0 || bid.refund > 0) && (
        <p className="num mt-1.5 text-[13px]">
          {bid.filledShares > 0 && (
            <span className="text-strong">
              {shares(bid.filledShares)} shares filled{bid.refund > 0 && s !== "outbid" ? " · " : ""}
            </span>
          )}
          {bid.refund > 0 && s !== "exited" && s !== "claimed" && <span className="text-warn">{usdc(bid.refund)} USDC refundable</span>}
          {s === "exited" && <span className="text-muted">{usdc(bid.refund)} USDC refunded</span>}
        </p>
      )}
      {onAction && (
        <div className="mt-2 flex gap-2">
          {s === "outbid" && !ended && <p className="text-xs text-muted">Below clearing. Exit opens when the auction ends.</p>}
          {s === "outbid" && ended && (
            <Button tone="neutral" variant="outline" className="py-2 text-sm" onClick={() => onAction("exit")}>
              Exit bid
            </Button>
          )}
          {s === "refundable" && (
            <Button tone="neutral" variant="outline" className="py-2 text-sm" onClick={() => onAction("exit")}>
              <Undo2 className="size-4" /> Exit bid
            </Button>
          )}
          {s === "partial" && (
            <Button tone="neutral" variant="outline" className="py-2 text-sm" onClick={() => onAction("exitPartial")}>
              Exit partial
            </Button>
          )}
          {s === "filled" && claimOpen && (
            <Button className="py-2 text-sm" onClick={() => onAction("claim")}>
              Claim shares
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function MyBidsScreen() {
  const { connected, connect } = useApp();
  const { over, setOver, act } = useBidActions();
  const { sendTx } = useApp();

  if (!connected)
    return (
      <>
        <TabHeader title="My bids" />
        <Empty
          icon={<Wallet className="size-6" />}
          title="Connect a wallet"
          body="Your bids are read from the auction's BidSubmitted logs for your address."
          action={<Button onClick={connect}>Connect</Button>}
        />
      </>
    );

  const tickers = [...new Set(BIDS.map((b) => b.ticker))];
  const stateOf = (b: Bid) => over[b.id] ?? b.state;
  const claimable = BIDS.filter((b) => stateOf(b) === "filled");

  return (
    <>
      <TabHeader title="My bids" />
      <main className="px-4">
        {tickers.length === 0 ? (
          <Empty icon={<Gavel className="size-6" />} title="You haven't applied to any IPO" body="Live auctions are on the IPOs tab." />
        ) : (
          <>
            {claimable.length > 1 && (
              <Card className="mb-4 flex items-center gap-3 p-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-strong">{claimable.length} allotments ready</p>
                  <p className="text-xs text-muted">One transaction with claimTokensBatch</p>
                </div>
                <Button
                  className="py-2 text-sm"
                  onClick={async () => {
                    const r = await sendTx({ title: `Claim all (${claimable.length} bids)`, success: "All shares claimed" });
                    if (r.ok) setOver((o) => ({ ...o, ...Object.fromEntries(claimable.map((b) => [b.id, "claimed"])) }));
                  }}
                >
                  Claim all
                </Button>
              </Card>
            )}
            <div className="space-y-4">
              {tickers.map((t) => {
                const ipo = getIpo(t)!;
                const bids = BIDS.filter((b) => b.ticker === t);
                return <AuctionGroup key={t} ipo={ipo} bids={bids} stateOf={stateOf} act={act} setOver={setOver} />;
              })}
            </div>
          </>
        )}
        <BottomSpacer />
      </main>
    </>
  );
}

function AuctionGroup({
  ipo,
  bids,
  stateOf,
  act,
  setOver,
}: {
  ipo: Ipo;
  bids: Bid[];
  stateOf: (b: Bid) => BidState;
  act: (b: Bid, k: "exit" | "exitPartial" | "claim") => void;
  setOver: React.Dispatch<React.SetStateAction<Override>>;
}) {
  const { sendTx } = useApp();
  const filled = bids.reduce((s, b) => s + b.filledShares, 0);
  const refundable = bids
    .filter((b) => !["exited", "claimed", "filled"].includes(stateOf(b)))
    .reduce((s, b) => s + b.refund, 0);
  const notGraduated = ipo.phase === "refunding";
  const live = ipo.phase === "live";
  const openRefunds = bids.filter((b) => stateOf(b) === "refundable");

  return (
    <Card>
      <Link href={hrefFor(ipo)} className="flex items-center gap-3 border-b border-line p-3">
        <TickerAvatar ipo={ipo} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-strong">{ipo.name}</p>
          <p className="num text-xs text-muted">
            {live ? "Clearing now" : "Cleared at"} {lotFixed(ipo.clearingPrice!)} USDC / lot
            {live && ` · ends in ~${blocksToDuration(ipo.endBlock! - CURRENT_BLOCK)}`}
          </p>
        </div>
        <StatusChip ipo={ipo} />
      </Link>
      {notGraduated && (
        <div className="flex items-center gap-3 border-b border-line bg-warn-soft p-3">
          <p className="flex-1 text-[13px] text-warn">
            Raise ended below {OFFER.requiredRaise} USDC. Every bid is refundable.
          </p>
          {openRefunds.length > 0 && (
            <Button
              tone="neutral"
              className="py-1.5 text-sm"
              onClick={async () => {
                const r = await sendTx({ title: `Exit all ${ipo.symbol} bids`, success: "Refunds sent" });
                if (r.ok) setOver((o) => ({ ...o, ...Object.fromEntries(openRefunds.map((b) => [b.id, "exited"])) }));
              }}
            >
              Exit all
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 border-b border-line p-3 text-center">
        <Stat k="Committed" v={`${usdc(COMMITTED[ipo.ticker] ?? 0)}`} sub="USDC" />
        <Stat k="Filled" v={shares(filled)} sub="shares" />
        <Stat k="Refundable" v={usdc(refundable)} sub="USDC" tone={refundable > 0 ? "warn" : undefined} />
      </div>
      <div className="divide-y divide-line">
        {bids.map((b) => (
          <BidRow key={b.id} bid={b} ipo={ipo} state={stateOf(b)} onAction={(k) => act(b, k)} />
        ))}
      </div>
    </Card>
  );
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: "warn" }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{k}</p>
      <p className={cx("num text-[15px] font-semibold", tone === "warn" ? "text-warn" : "text-strong")}>{v}</p>
      <p className="text-[11px] text-muted">{sub}</p>
    </div>
  );
}
