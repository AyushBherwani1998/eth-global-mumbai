"use client";

// Orders (UX.md 3.7): everything the wallet has asked the market to do.
// Two tabs: IPO applications (grouped by company, plain state words and the
// verbs Refund / Collect shares / Settle) and Trades (including rejected
// attempts with a one-sentence reason). Desktop renders the same data as tables.

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppBar } from "@/components/shell";
import { useApp } from "@/components/providers";
import { OfflineStrip } from "@/components/states";
import { TickerMark } from "@/components/company/logos";
import { Button, Card, EmptyState, SectionTitle, Table, TextLink, TickerLogo, UnderlineTabs, cx, type Column } from "@/components/ui";
import { blocksToCountdown, dateTimeIST, lotFixed, shares, shortHash, txUrl, usdc } from "@/lib/format";
import { BIDS, CURRENT_BLOCK, IPOS, getIpo, getMarket, type Bid, type BidState, type Ipo, type Policy } from "@/lib/mock";
import { SURVEILLANCE_BAND_BPS, band, bandDigits, bandText } from "@/lib/policy";
import { BottomSpacer } from "./common";

// ---------------------------------------------------------------------------
// Application status words and verbs (UX.md 3.7 and the glossary in 6).
// ---------------------------------------------------------------------------

type Verb = "refund" | "collect" | "settle";
type Status = {
  word: string;
  tone?: "gain" | "warn" | "loss";
  verb?: Verb;
  note?: string;
};

function statusOf(bid: Bid, ipo: Ipo, state: BidState): Status {
  const ended = ipo.phase !== "live";
  const claimOpen = ipo.phase === "listed" || (ipo.claimBlock ?? Infinity) <= CURRENT_BLOCK;
  switch (state) {
    case "claimed":
      return { word: "Collected", tone: "gain" };
    case "exited":
      return { word: "Refunded" };
    case "refundable":
      return { word: "Refund available", tone: "warn", verb: "refund" };
    case "partial":
      return {
        word: "Partly allotted",
        tone: "warn",
        verb: "settle",
        note: "Settle collects your shares and refunds the rest.",
      };
    case "filled":
      return claimOpen
        ? { word: "Allotted", tone: "gain", verb: "collect" }
        : {
            word: "Allotted",
            tone: "gain",
            note: "You can collect these shares once the IPO settles.",
          };
    case "outbid":
      return ended
        ? { word: "Refund available", tone: "warn", verb: "refund" }
        : {
            word: "Below the price",
            note: "Your maximum is under the current price. You can still be allotted if the price falls.",
          };
    case "active":
    default:
      return (ipo.clearingPrice ?? 0) <= bid.maxPrice
        ? { word: "Likely allotted", tone: "gain" }
        : {
            word: "Below the price",
            note: "Your maximum is under the current price. You can still be allotted if the price falls.",
          };
  }
}

const VERB_LABEL: Record<Verb, string> = {
  refund: "Refund",
  collect: "Collect shares",
  settle: "Settle",
};

function groupSub(ipo: Ipo) {
  if (ipo.phase === "live")
    return `Current price ${lotFixed(ipo.clearingPrice ?? 0)} · closes in ${blocksToCountdown((ipo.endBlock ?? CURRENT_BLOCK) - CURRENT_BLOCK)}`;
  if (ipo.phase === "listed") return `Listed at ${lotFixed(ipo.clearingPrice ?? 0)}`;
  return "Not listed · refunds open";
}

// ---------------------------------------------------------------------------
// Trades and rejected attempts, newest first.
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  ipo: Ipo;
  at: number; // ms
  title: string;
  reason?: string;
  rejected: boolean;
  tx: string;
};

/** Plain sentence for a turned-away trade (never the protocol error name). */
function rejectReason(reason: string, detail: string, priceAfter: number, policy: Policy): string {
  const limitInDetail = detail.match(/([\d.]+)\s*$/)?.[1];
  if (reason === "Halted") return "Trading was halted at the time.";
  if (reason === "DirectionalWidening")
    return `This would have moved the price to ${lotFixed(priceAfter, 3)}, further from ${lotFixed(policy.referencePrice)} than the ${bandText(policy.referencePrice, SURVEILLANCE_BAND_BPS)} allowed then.`;
  const d = bandDigits(policy.referencePrice, policy.bandBps);
  const edge = limitInDetail ?? lotFixed(band(policy.referencePrice, policy.bandBps).hi, d);
  const over = detail.includes("above");
  return `This would have moved the price to ${lotFixed(priceAfter, 3)}, ${over ? "above" : "below"} the limit of ${edge} in force then.`;
}

function useOrderRows(): OrderRow[] {
  return useMemo(() => {
    const out: OrderRow[] = [];
    for (const ipo of IPOS) {
      const m = getMarket(ipo.ticker);
      if (!m) continue;
      for (const t of m.trades.slice(0, 3)) {
        out.push({
          id: `${ipo.ticker}-t-${t.tx}`,
          ipo,
          at: t.time * 1000,
          title: `${t.side === "buy" ? "Bought" : "Sold"} ${shares(t.shares)} shares at ${lotFixed(t.price)}`,
          rejected: false,
          tx: t.tx,
        });
      }
      for (const r of m.rejected) {
        out.push({
          id: `${ipo.ticker}-r-${r.tx}`,
          ipo,
          at: Date.parse(r.time),
          title: `${r.side === "buy" ? "Buy" : "Sell"} for ${usdc(r.usdc)} USDC`,
          reason: rejectReason(r.reason, r.detail, r.priceAfter, m.policy),
          rejected: true,
          tx: r.tx,
        });
      }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 14);
  }, []);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Tab = "applications" | "trades";
type Override = Partial<Record<number, BidState>>;

const TABS: { id: Tab; label: string }[] = [
  { id: "applications", label: "IPO applications" },
  { id: "trades", label: "Trades" },
];

export function OrdersScreen() {
  const { connected, connect, sendTx } = useApp();
  const [over, setOver] = useState<Override>({});
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const trades = useOrderRows();

  const stateOf = (b: Bid) => over[b.id] ?? b.state;
  const groups = useMemo(() => {
    const tickers = [...new Set(BIDS.map((b) => b.ticker))];
    return tickers.map((t) => ({
      ipo: getIpo(t)!,
      bids: BIDS.filter((b) => b.ticker === t),
    }));
  }, []);

  const collectable = BIDS.filter((b) => {
    const ipo = getIpo(b.ticker)!;
    return statusOf(b, ipo, stateOf(b)).verb === "collect";
  });
  const refundable = BIDS.filter((b) => {
    const ipo = getIpo(b.ticker)!;
    return statusOf(b, ipo, stateOf(b)).verb === "refund";
  });
  const [tab, setTab] = useState<Tab>(collectable.length || refundable.length ? "applications" : "trades");

  if (!connected)
    return (
      <>
        <AppBar title="Orders" />
        <OfflineStrip className="-mx-5" />
        <main>
          <EmptyState title="Sign in to see your orders" body="Your IPO applications and your trades show up here." />
          <Button className="mt-1" onClick={connect}>
            Sign in
          </Button>
          <BottomSpacer />
        </main>
      </>
    );

  const act = async (bid: Bid, verb: Verb) => {
    const ipo = getIpo(bid.ticker)!;
    setBusy(bid.id);
    const r = await sendTx(
      verb === "collect"
        ? {
            title: `Collecting ${shares(bid.filledShares)} ${ipo.name} shares`,
            success: `Collected ${shares(bid.filledShares)} shares`,
          }
        : verb === "settle"
          ? {
              title: "Settling your application",
              success: `Shares collected and ${usdc(bid.refund)} USDC refunded`,
            }
          : {
              title: "Refunding your application",
              success: `${usdc(bid.refund)} USDC refunded`,
            },
    );
    setBusy(null);
    if (r.ok)
      setOver((o) => ({
        ...o,
        [bid.id]: verb === "collect" ? "claimed" : verb === "settle" ? "claimed" : "exited",
      }));
  };

  const actAll = async (verb: "collect" | "refund") => {
    const list = verb === "collect" ? collectable : refundable;
    setBusy("all");
    const r = await sendTx(
      verb === "collect"
        ? {
            title: "Collecting all your shares",
            success: `Collected shares from ${list.length} applications`,
          }
        : {
            title: "Refunding all your applications",
            success: `${usdc(list.reduce((s, b) => s + b.refund, 0))} USDC refunded`,
          },
    );
    setBusy(null);
    if (r.ok)
      setOver((o) => ({
        ...o,
        ...Object.fromEntries(list.map((b) => [b.id, verb === "collect" ? "claimed" : "exited"])),
      }));
  };

  return (
    <>
      <AppBar title="Orders" />
      <OfflineStrip className="-mx-5" />
      <main>
        <div className="lg:hidden">
          <UnderlineTabs className="mt-1" tabs={TABS} value={tab} onChange={setTab} />
        </div>
        <div className="hidden lg:block">
          <UnderlineTabs className="mt-1" tabs={TABS} value={tab} onChange={setTab} equal={false} />
        </div>

        {tab === "applications" ? (
          <>
            {collectable.length > 0 ? (
              <ActionCard
                title={`${collectable.length} ${collectable.length === 1 ? "allotment" : "allotments"} ready`}
                body="One confirmation collects every share you have been allotted."
                label="Collect all"
                busy={busy === "all"}
                onClick={() => actAll("collect")}
              />
            ) : refundable.length > 0 ? (
              <ActionCard
                title={`${usdc(refundable.reduce((s, b) => s + b.refund, 0))} USDC ready to come back`}
                body="One confirmation refunds every application that was not allotted."
                label="Refund all"
                busy={busy === "all"}
                onClick={() => actAll("refund")}
              />
            ) : null}

            {groups.length === 0 ? (
              <EmptyState
                title="No applications yet"
                body="IPOs that are open now are under Markets, IPO."
                action={{ label: "See open IPOs", href: "/?tab=ipo" }}
              />
            ) : (
              <>
                <div className="lg:hidden">
                  {groups.map(({ ipo, bids }) => (
                    <ApplicationGroup key={ipo.ticker} ipo={ipo} bids={bids} stateOf={stateOf} busy={busy} onAct={act} />
                  ))}
                </div>
                <div className="hidden lg:block">
                  <ApplicationTable groups={groups} stateOf={stateOf} busy={busy} onAct={act} />
                </div>
              </>
            )}
            <p className="t-caption mt-6">Amounts are in USDC. A price such as 1.40 is the most you agreed to pay for 1,000 shares.</p>
          </>
        ) : (
          <>
            {trades.length === 0 ? (
              <EmptyState
                title="No trades yet"
                body="Buy or sell on a company page and the order shows up here."
                action={{ label: "See companies", href: "/" }}
              />
            ) : (
              <>
                <div className="lg:hidden">
                  <SectionTitle>Recent orders</SectionTitle>
                  <div className="divide-y divide-line">
                    {trades.map((t) => (
                      <TradeRow key={t.id} row={t} />
                    ))}
                  </div>
                </div>
                <div className="hidden lg:block">
                  <SectionTitle>Recent orders</SectionTitle>
                  <TradeTable rows={trades} />
                </div>
              </>
            )}
            <p className="t-caption mt-6">Rejected orders cost you nothing. The exchange turned them away before they reached the market.</p>
          </>
        )}
        <BottomSpacer />
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ActionCard({ title, body, label, onClick, busy }: { title: string; body: string; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <Card className="mt-4 p-4 lg:flex lg:items-center lg:gap-6">
      <div className="min-w-0 flex-1">
        <p className="t-list-title text-text">{title}</p>
        <p className="t-label mt-0.5">{body}</p>
      </div>
      <Button className="mt-3 w-full lg:mt-0 lg:w-auto lg:shrink-0" onClick={onClick} busy={busy} disabled={busy}>
        {busy ? "Check your wallet app" : label}
      </Button>
    </Card>
  );
}

function StatusWord({ s }: { s: Status }) {
  return (
    <span
      className={cx(
        "t-change-sm",
        s.tone === "gain" ? "text-gain-text" : s.tone === "warn" ? "text-warn" : s.tone === "loss" ? "text-loss-text" : "text-text-2",
      )}
    >
      {s.word}
    </span>
  );
}

function ApplicationGroup({
  ipo,
  bids,
  stateOf,
  busy,
  onAct,
}: {
  ipo: Ipo;
  bids: Bid[];
  stateOf: (b: Bid) => BidState;
  busy: number | "all" | null;
  onAct: (b: Bid, v: Verb) => void;
}) {
  const applied = bids.reduce((s, b) => s + b.budget, 0);
  const allotted = bids.reduce((s, b) => s + (stateOf(b) === "exited" ? 0 : b.filledShares), 0);
  const refundable = bids.reduce((s, b) => (["exited", "claimed"].includes(stateOf(b)) ? s : s + b.refund), 0);
  return (
    <section className="mt-6">
      <Link href={`/stock/${ipo.ticker}`} className="flex min-h-16 items-center gap-3 py-2">
        <TickerLogo ipo={ipo} size={40} />
        <span className="min-w-0 flex-1">
          <span className="t-list-title block truncate text-text">{ipo.name}</span>
          <span className="num t-label block truncate">
            <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {groupSub(ipo)}
          </span>
        </span>
      </Link>
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat k="Applied" v={`${usdc(applied)} USDC`} />
          <Stat k="Shares allotted" v={shares(allotted)} />
          <Stat k="Refundable" v={`${usdc(refundable)} USDC`} />
        </div>
      </Card>
      <div className="divide-y divide-line">
        {bids.map((b) => {
          const s = statusOf(b, ipo, stateOf(b));
          return (
            <div key={b.id} className="py-3">
              <div className="flex min-h-12 items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="num t-body block text-text">
                    {usdc(b.budget)} USDC up to {lotFixed(b.maxPrice)}
                  </span>
                  <span className="t-label block">{dateTimeIST(b.submittedAt)}</span>
                </span>
                <StatusWord s={s} />
              </div>
              {s.note && <p className="t-label mt-1">{s.note}</p>}
              {s.verb && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  busy={busy === b.id}
                  disabled={busy === b.id}
                  onClick={() => onAct(b, s.verb!)}
                >
                  {busy === b.id ? "Check your wallet app" : VERB_LABEL[s.verb]}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="t-label">{k}</p>
      <p className="num t-list-title mt-0.5 text-text">{v}</p>
    </div>
  );
}

type FlatBid = { bid: Bid; ipo: Ipo; status: Status };

function ApplicationTable({
  groups,
  stateOf,
  busy,
  onAct,
}: {
  groups: { ipo: Ipo; bids: Bid[] }[];
  stateOf: (b: Bid) => BidState;
  busy: number | "all" | null;
  onAct: (b: Bid, v: Verb) => void;
}) {
  const rows: FlatBid[] = groups.flatMap(({ ipo, bids }) => bids.map((bid) => ({ bid, ipo, status: statusOf(bid, ipo, stateOf(bid)) })));
  const columns: Column<FlatBid>[] = [
    {
      key: "company",
      label: "Company",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.ipo} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.ipo.name}</span>
            <span className="num t-label block truncate">
              <TickerMark ticker={r.ipo.ticker} symbol={r.ipo.symbol} /> · {groupSub(r.ipo)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "applied",
      label: "Applied",
      align: "right",
      render: (r) => `${usdc(r.bid.budget)} USDC`,
    },
    {
      key: "max",
      label: "Up to",
      align: "right",
      render: (r) => lotFixed(r.bid.maxPrice),
    },
    {
      key: "placed",
      label: "Placed",
      render: (r) => <span className="t-label">{dateTimeIST(r.bid.submittedAt)}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusWord s={r.status} />,
    },
    {
      key: "action",
      label: "Action",
      align: "right",
      render: (r) =>
        r.status.verb ? (
          <Button variant="secondary" size="sm" busy={busy === r.bid.id} disabled={busy === r.bid.id} onClick={() => onAct(r.bid, r.status.verb!)}>
            {busy === r.bid.id ? "Check your wallet app" : VERB_LABEL[r.status.verb]}
          </Button>
        ) : (
          <span className="t-label">—</span>
        ),
    },
  ];
  return <Table columns={columns} rows={rows} rowKey={(r) => String(r.bid.id)} className="mt-4" />;
}

function TradeRow({ row }: { row: OrderRow }) {
  return (
    <div className="flex min-h-16 items-start gap-3 py-3">
      <TickerLogo ipo={row.ipo} size={40} />
      <span className="min-w-0 flex-1">
        <span className="t-list-title block truncate text-text">{row.ipo.name}</span>
        <span className="num t-label block">
          <TickerMark ticker={row.ipo.ticker} symbol={row.ipo.symbol} /> · {row.title}
        </span>
        {row.reason && <span className="t-label block text-text-2">{row.reason}</span>}
        <span className="t-caption block">{dateTimeIST(row.at / 1000)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        {row.rejected && <span className="t-change-sm text-loss-text">Rejected</span>}
        <TextLink href={txUrl(row.tx)}>Receipt</TextLink>
      </span>
    </div>
  );
}

function TradeTable({ rows }: { rows: OrderRow[] }) {
  const columns: Column<OrderRow>[] = [
    {
      key: "company",
      label: "Company",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.ipo} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.ipo.name}</span>
            <span className="t-label block">
              <TickerMark ticker={r.ipo.ticker} symbol={r.ipo.symbol} />
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "order",
      label: "Order",
      render: (r) => (
        <span className="num block">
          {r.title}
          {r.reason && <span className="t-label block text-text-2">{r.reason}</span>}
        </span>
      ),
    },
    {
      key: "time",
      label: "Time",
      render: (r) => <span className="t-label">{dateTimeIST(r.at / 1000)}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) =>
        r.rejected ? <span className="t-change-sm text-loss-text">Rejected</span> : <span className="t-change-sm text-gain-text">Done</span>,
    },
    {
      key: "receipt",
      label: "Receipt",
      align: "right",
      render: (r) => <TextLink href={txUrl(r.tx)}>{shortHash(r.tx)}</TextLink>,
    },
  ];
  return <Table columns={columns} rows={rows} rowKey={(r) => r.id} className="mt-4" />;
}
