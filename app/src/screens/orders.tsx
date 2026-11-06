"use client";

// Orders (UX.md 3.7). Two tabs: IPO applications (this wallet's bids from
// GET /v1/bids?owner=, grouped by company, plain state words and the verbs
// Refund / Settle / Collect shares) and Market trades (every trade in the
// listed pools from GET /v1/market/:ticker/swaps, not filtered to this wallet:
// the pool only records the router as the sender, so per-wallet trade history
// is not available). Desktop renders the same data as tables.

import Link from "next/link";
import { useMemo, useState } from "react";

import { AppBar, SignInCard } from "@/components/shell";
import { useApp } from "@/components/providers";
import { OfflineStrip, SkeletonList } from "@/components/states";
import { TickerMark } from "@/components/company/logos";
import { Button, Card, EmptyState, SectionTitle, Table, TextLink, TickerLogo, UnderlineTabs, cx, type Column } from "@/components/ui";
import { dateTimeIST, lotFixed, shares, shortHash, txUrl, usdc } from "@/lib/format";
import { COPY, hrefFor, isListed } from "@/lib/adapt";
import { ApiErrorCard } from "@/lib/api-state";
import type { Bid, Listing } from "@/lib/api";
import { merge2, useBids, useListings, useQuotes } from "@/lib/live";
import { BottomSpacer } from "./common";

// ---------------------------------------------------------------------------
// Application status words and verbs (UX.md 3.7 and the glossary in 6).
// ---------------------------------------------------------------------------

type Verb = "refund" | "collect" | "settle";
type Status = { word: string; tone?: "gain" | "warn" | "loss"; verb?: Verb; note?: string };

/**
 * A bid ends in two transactions on the CCA: exit returns the unspent USDC and
 * fixes the shares won, then claim delivers them. The backend already works
 * out which one is available right now (`actions`), so this only has to pick
 * the words.
 */
function statusOf(bid: Bid, listing: Listing | undefined): Status {
  const refundOnly = listing?.phase === "refunding" || listing?.graduated === false;
  const canExit = bid.actions.exit !== null;
  const canClaim = bid.actions.claim;

  switch (bid.state) {
    case "claimed":
      return { word: "Claimed", tone: "gain" };
    case "exited":
      if (bid.filledShares === 0) return { word: "Refunded" };
      return canClaim
        ? { word: "Claimable", tone: "gain", verb: "collect", note: "Your unspent USDC is back. Collect your shares to finish." }
        : { word: "Exited", note: "Your unspent USDC is back. Your shares can be collected once the IPO opens claims." };
    case "refundable":
      return canExit
        ? { word: "Refund available", tone: "warn", verb: "refund" }
        : { word: "Refund available", tone: "warn", note: "The refund opens when the IPO closes." };
    case "partial":
      return canExit
        ? {
            word: "Partly allotted",
            tone: "warn",
            verb: refundOnly ? "refund" : "settle",
            note: "Settle returns the USDC that wasn't used. Then collect your shares.",
          }
        : { word: "Partly allotted", tone: "warn", note: "You can settle once the IPO closes." };
    case "filled":
      return canExit
        ? { word: "Allotted", tone: "gain", verb: "settle", note: "Settle first, then collect your shares." }
        : { word: "Allotted", tone: "gain", note: "You can settle once the IPO closes." };
    case "outbid":
      return canExit
        ? { word: "Refund available", tone: "warn", verb: "refund" }
        : { word: "Below the price", note: "Your maximum is under the current price. You can still be allotted if the price falls." };
    case "active":
    default:
      return listing?.clearingPrice !== null && listing !== undefined && listing.clearingPrice <= bid.maxPrice
        ? { word: "Likely allotted", tone: "gain" }
        : { word: "Below the price", note: "Your maximum is under the current price. You can still be allotted if the price falls." };
  }
}

const VERB_LABEL: Record<Verb, string> = { refund: "Refund", collect: "Collect shares", settle: "Settle" };

function groupSub(listing: Listing | undefined): string {
  if (!listing) return "This company is no longer on the exchange";
  if (listing.phase === "live") return listing.clearingPrice === null ? "IPO open" : `Current price ${lotFixed(listing.clearingPrice)} · IPO open`;
  if (listing.phase === "listed") return listing.clearingPrice === null ? "Listed" : `Listed at ${lotFixed(listing.clearingPrice)}`;
  if (listing.phase === "cleared") return "IPO closed · about to list";
  if (listing.phase === "refunding") return "Not listed · refunds open";
  return "IPO not open yet";
}

const bidKeyOf = (b: Bid) => `${b.ticker}:${b.id}`;

/** Amounts that only exist after the exit. */
const sharesOrCopy = (n: number | null) => (n === null ? COPY.afterSettle : `${shares(n)} shares`);

// ---------------------------------------------------------------------------
// Market trades across all wallets, newest first.
// ---------------------------------------------------------------------------

type OrderRow = { id: string; listing: Listing; at: number; title: string; tx: string };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type Tab = "applications" | "trades";
type Override = Partial<Record<string, "exited" | "claimed">>;

const TABS: { id: Tab; label: string }[] = [
  { id: "applications", label: "IPO applications" },
  { id: "trades", label: "Market trades" },
];

export function OrdersScreen() {
  const { connected, address, sendTx } = useApp();
  const [over, setOver] = useState<Override>({});
  const [busy, setBusy] = useState<string | "all" | null>(null);
  const [tab, setTab] = useState<Tab>("applications");

  const listings = useListings();
  const all = useMemo(() => listings.data?.listings ?? [], [listings.data]);
  const bids = useBids(connected ? address : null);
  const quotes = useQuotes(all.filter(isListed).map((l) => l.ticker));
  const { error, loading, retry, refreshing } = merge2(listings, bids);

  const listingOf = (t: string) => all.find((l) => l.ticker === t);

  // A settled or collected application keeps its new word until the next poll
  // confirms it on chain.
  const effective = (b: Bid): Bid => {
    const o = over[bidKeyOf(b)];
    if (!o) return b;
    return { ...b, state: o, claimed: o === "claimed", actions: { exit: null, claim: o === "exited" } };
  };

  const myBids = (bids.data?.bids ?? []).map(effective);

  const groups = useMemo(() => {
    const tickers = [...new Set(myBids.map((b) => b.ticker))];
    return tickers.map((t) => ({ ticker: t, listing: listingOf(t), bids: myBids.filter((b) => b.ticker === t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bids.data, over, all]);

  const trades: OrderRow[] = useMemo(() => {
    const out: OrderRow[] = [];
    for (const q of quotes.data ?? []) {
      const listing = all.find((l) => l.ticker === q.ticker);
      if (!listing) continue;
      for (const t of q.swaps.trades.slice(0, 6)) {
        out.push({
          id: `${q.ticker}-${t.tx}-${t.time}`,
          listing,
          at: t.time * 1000,
          title: `${t.side === "buy" ? "Buy" : "Sell"} · ${shares(t.shares)} shares at ${lotFixed(t.price)}`,
          tx: t.tx,
        });
      }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 14);
  }, [quotes.data, all]);

  // Same shape and the same words as the signed-out Portfolio: what this page
  // shows once you are in, named after its own two tabs, and one Sign in.
  if (!connected)
    return (
      <>
        <AppBar title="Orders" />
        <OfflineStrip className="-mx-5" />
        <main className="lg:max-w-[640px]">
          <SignInCard
            className="mt-4"
            title="Your orders live here"
            body="Sign in and this page fills in with everything you have placed, and what is left to do on each one."
            points={[
              "Every IPO application you have made, and where it stands",
              "Shares to collect and money to take back once an IPO closes",
              "Your buys and sells, with a receipt for each",
            ]}
          />
          <p className="t-body mt-6 text-text-2">
            Nothing to sign in for yet? <TextLink href="/">See the companies listed today</TextLink>
          </p>
          <BottomSpacer />
        </main>
      </>
    );

  const collectable = myBids.filter((b) => statusOf(b, listingOf(b.ticker)).verb === "collect");
  const refundable = myBids.filter((b) => statusOf(b, listingOf(b.ticker)).verb === "refund");

  const act = async (bid: Bid, verb: Verb) => {
    const listing = listingOf(bid.ticker);
    setBusy(bidKeyOf(bid));
    const r = await sendTx(
      verb === "collect"
        ? {
            title: `Collecting your ${listing?.name ?? bid.ticker} shares`,
            success: bid.filledShares === null ? "Shares collected" : `Collected ${shares(bid.filledShares)} shares`,
          }
        : verb === "settle"
          ? { title: "Settling your application", success: "Settled. Shares are ready to collect" }
          : { title: "Refunding your application", success: "Your USDC is on its way back" },
    );
    setBusy(null);
    if (r.ok) setOver((o) => ({ ...o, [bidKeyOf(bid)]: verb === "collect" ? "claimed" : "exited" }));
  };

  const actAll = async (verb: "collect" | "refund") => {
    const list = verb === "collect" ? collectable : refundable;
    setBusy("all");
    const r = await sendTx(
      verb === "collect"
        ? { title: "Collecting all your shares", success: `Collected shares from ${list.length} applications` }
        : { title: "Refunding all your applications", success: `${list.length} applications refunded` },
    );
    setBusy(null);
    if (r.ok) setOver((o) => ({ ...o, ...Object.fromEntries(list.map((b) => [bidKeyOf(b), verb === "collect" ? "claimed" : "exited"] as const)) }));
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

        {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

        {tab === "applications" ? (
          <>
            {collectable.length > 0 ? (
              <ActionCard
                title={`${collectable.length} ${collectable.length === 1 ? "allotment" : "allotments"} ready to collect`}
                body="One confirmation collects every share from applications you have settled."
                label="Collect all"
                busy={busy === "all"}
                onClick={() => actAll("collect")}
              />
            ) : refundable.length > 0 ? (
              <ActionCard
                title={`${refundable.length} ${refundable.length === 1 ? "application" : "applications"} can be refunded`}
                body="One confirmation returns the USDC from every application that was not allotted."
                label="Refund all"
                busy={busy === "all"}
                onClick={() => actAll("refund")}
              />
            ) : null}

            {loading && myBids.length === 0 ? (
              <SkeletonList rows={3} className="mt-4" />
            ) : groups.length === 0 ? (
              !error && (
                <EmptyState
                  title="No applications yet"
                  body="IPOs that are open now are under Markets, IPO."
                  action={{ label: "See open IPOs", href: "/?tab=ipo" }}
                />
              )
            ) : (
              <>
                <div className="lg:hidden">
                  {groups.map((g) => (
                    <ApplicationGroup key={g.ticker} ticker={g.ticker} listing={g.listing} bids={g.bids} busy={busy} onAct={act} />
                  ))}
                </div>
                <div className="hidden lg:block">
                  <ApplicationTable groups={groups} busy={busy} onAct={act} />
                </div>
              </>
            )}
            <p className="t-caption mt-6">Amounts are in USDC. A price such as 1.40 is the most you agreed to pay for 1,000 shares.</p>
          </>
        ) : (
          <>
            {quotes.loading && trades.length === 0 ? (
              <SkeletonList rows={4} className="mt-4" />
            ) : trades.length === 0 ? (
              <EmptyState title="No market trades yet" body="Trades in listed companies show up here." action={{ label: "See companies", href: "/" }} />
            ) : (
              <>
                <p className="t-label mt-4">Everyone&apos;s trades in these companies, not only yours. Your own trade history isn&apos;t available yet.</p>
                <div className="lg:hidden">
                  <SectionTitle>All market trades</SectionTitle>
                  <div className="divide-y divide-line">
                    {trades.map((t) => (
                      <TradeRow key={t.id} row={t} />
                    ))}
                  </div>
                </div>
                <div className="hidden lg:block">
                  <SectionTitle>All market trades</SectionTitle>
                  <TradeTable rows={trades} />
                </div>
              </>
            )}
            <p className="t-caption mt-6">
              A trade the rule turns away never reaches the market, so it leaves no record here. You see it only while you are placing it.
            </p>
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

type Group = { ticker: string; listing: Listing | undefined; bids: Bid[] };

function ApplicationGroup({
  ticker,
  listing,
  bids,
  busy,
  onAct,
}: Group & { busy: string | "all" | null; onAct: (b: Bid, v: Verb) => void }) {
  const applied = bids.reduce((s, b) => s + b.budget, 0);
  const allottedKnown = bids.filter((b) => b.filledShares !== null);
  const allotted = allottedKnown.reduce((s, b) => s + (b.filledShares ?? 0), 0);
  const pending = bids.length - allottedKnown.length;

  return (
    <section className="mt-6">
      <Link href={hrefFor({ ticker })} className="flex min-h-16 items-center gap-3 py-2">
        <TickerLogo ipo={listing ?? { ticker }} size={40} />
        <span className="min-w-0 flex-1">
          <span className="t-list-title block truncate text-text">{listing?.name ?? ticker.toUpperCase()}</span>
          <span className="num t-label block truncate">
            {listing && <TickerMark ticker={listing.ticker} symbol={listing.symbol} />} {listing ? "· " : ""}
            {groupSub(listing)}
          </span>
        </span>
      </Link>
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat k="Applied" v={`${usdc(applied)} USDC`} />
          <Stat k="Shares allotted" v={pending === bids.length ? COPY.afterSettle : shares(allotted)} />
        </div>
      </Card>
      <div className="divide-y divide-line">
        {bids.map((b) => {
          const s = statusOf(b, listing);
          const key = bidKeyOf(b);
          return (
            <div key={key} className="py-3">
              <div className="flex min-h-12 items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="num t-body block text-text">
                    {usdc(b.budget)} USDC up to {lotFixed(b.maxPrice)}
                  </span>
                  <span className="t-label block">{b.submittedAt ? dateTimeIST(b.submittedAt) : `Placed at block ${b.submittedBlock}`}</span>
                </span>
                <StatusWord s={s} />
              </div>
              {s.note && <p className="t-label mt-1">{s.note}</p>}
              {s.verb && (
                <Button variant="secondary" size="sm" className="mt-2" busy={busy === key} disabled={busy === key} onClick={() => onAct(b, s.verb as Verb)}>
                  {busy === key ? "Check your wallet app" : VERB_LABEL[s.verb]}
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

type FlatBid = { bid: Bid; listing: Listing | undefined; status: Status };

function ApplicationTable({ groups, busy, onAct }: { groups: Group[]; busy: string | "all" | null; onAct: (b: Bid, v: Verb) => void }) {
  const rows: FlatBid[] = groups.flatMap(({ listing, bids }) => bids.map((bid) => ({ bid, listing, status: statusOf(bid, listing) })));
  const columns: Column<FlatBid>[] = [
    {
      key: "company",
      label: "Company",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.listing ?? { ticker: r.bid.ticker }} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.listing?.name ?? r.bid.ticker.toUpperCase()}</span>
            <span className="num t-label block truncate">{groupSub(r.listing)}</span>
          </span>
        </span>
      ),
    },
    { key: "applied", label: "Applied", align: "right", render: (r) => `${usdc(r.bid.budget)} USDC` },
    { key: "max", label: "Up to", align: "right", render: (r) => lotFixed(r.bid.maxPrice) },
    { key: "allotted", label: "Allotted", align: "right", render: (r) => sharesOrCopy(r.bid.filledShares) },
    {
      key: "placed",
      label: "Placed",
      align: "right",
      render: (r) => <span className="t-label">{r.bid.submittedAt ? dateTimeIST(r.bid.submittedAt) : `Block ${r.bid.submittedBlock}`}</span>,
    },
    { key: "status", label: "Status", align: "right", render: (r) => <StatusWord s={r.status} /> },
    {
      key: "action",
      label: "Action",
      align: "right",
      render: (r) =>
        r.status.verb ? (
          <Button
            variant="secondary"
            size="sm"
            busy={busy === bidKeyOf(r.bid)}
            disabled={busy === bidKeyOf(r.bid)}
            onClick={() => onAct(r.bid, r.status.verb as Verb)}
          >
            {busy === bidKeyOf(r.bid) ? "Check your wallet app" : VERB_LABEL[r.status.verb]}
          </Button>
        ) : (
          <span className="t-label">Nothing to do</span>
        ),
    },
  ];
  return <Table columns={columns} rows={rows} rowKey={(r) => bidKeyOf(r.bid)} className="mt-4" />;
}

function TradeRow({ row }: { row: OrderRow }) {
  return (
    <div className="flex min-h-16 items-start gap-3 py-3">
      <TickerLogo ipo={row.listing} size={40} />
      <span className="min-w-0 flex-1">
        <span className="t-list-title block truncate text-text">{row.listing.name}</span>
        <span className="num t-label block">
          <TickerMark ticker={row.listing.ticker} symbol={row.listing.symbol} /> · {row.title}
        </span>
        <span className="t-caption block">{dateTimeIST(row.at / 1000)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
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
          <TickerLogo ipo={r.listing} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.listing.name}</span>
            <span className="t-label block">
              <TickerMark ticker={r.listing.ticker} symbol={r.listing.symbol} />
            </span>
          </span>
        </span>
      ),
    },
    { key: "order", label: "Order", render: (r) => <span className="num block">{r.title}</span> },
    { key: "time", label: "Time", align: "right", render: (r) => <span className="t-label">{dateTimeIST(r.at / 1000)}</span> },
    { key: "status", label: "Status", align: "right", render: () => <span className="t-change-sm text-gain-text">Done</span> },
    { key: "receipt", label: "Receipt", align: "right", render: (r) => <TextLink href={txUrl(r.tx)}>{shortHash(r.tx)}</TextLink> },
  ];
  return <Table columns={columns} rows={rows} rowKey={(r) => r.id} className="mt-4" />;
}
