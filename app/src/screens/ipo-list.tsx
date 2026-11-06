"use client";

// Markets, IPO chip (UX.md 3.2): Open · Upcoming · Closed, one card per IPO,
// and a summary row when this wallet has applications. Plain English only;
// auction mechanics stay on the company page.
//
// Data: GET /v1/listings for what exists, GET /v1/auction/:ticker for each
// card's price range, raise targets and countdown, GET /v1/bids?owner= for
// what this wallet applied with.

import Link from "next/link";
import { useState } from "react";
import { ListOrdered } from "lucide-react";
import { useApp } from "@/components/providers";
import { useMemo } from "react";
import { TickerMark, markVar } from "@/components/company/logos";
import { changeDigits, countdown } from "@/components/company/num";
import { Button, Card, Change, EmptyState, ProgressBar, PromoCard, Segmented, Skeleton, TickerLogo, ViewSwap, holdPageHeight } from "@/components/ui";
import { useCountdown, blocksAsSeconds } from "@/lib/hooks";
import { changeVs, lotFixed, usdc } from "@/lib/format";
import { COPY, hrefFor, isClosed, isOpen, isUpcoming, orCopy } from "@/lib/adapt";
import { ApiErrorCard } from "@/lib/api-state";
import { api, POLL, type Auction, type Listing } from "@/lib/api";
import { merge2, useBids, useLive, useListings } from "@/lib/live";

const SEGS = ["open", "upcoming", "closed"] as const;
type Seg = (typeof SEGS)[number];

export function IpoBody() {
  const { connected, address } = useApp();
  const listings = useListings();
  const all = useMemo(() => listings.data?.listings ?? [], [listings.data]);

  const live = all.filter(isOpen);
  const upcoming = all.filter(isUpcoming);
  const closed = all.filter(isClosed);
  const [seg, setSeg] = useState<Seg | null>(null);
  const shown = seg ?? (live.length ? "open" : upcoming.length ? "upcoming" : "closed");
  const list = shown === "open" ? live : shown === "upcoming" ? upcoming : closed;

  // One auction read per card on screen, folded into one loading state.
  const tickers = list.map((l) => l.ticker).join(",");
  const auctions = useLive(
    tickers ? `auctions:${tickers}` : null,
    async () => {
      // One company without an auction yet must not blank the whole segment.
      const settled = await Promise.allSettled(tickers.split(",").map(async (t) => [t, await api.auction(t)] as const));
      const out: Record<string, Auction> = {};
      for (const r of settled) if (r.status === "fulfilled") out[r.value[0]] = r.value[1];
      return out;
    },
    POLL.auction,
  );

  const bids = useBids(connected ? address : null);
  const committed = bids.data?.committed ?? {};
  const applications = bids.data?.bids.length ?? 0;
  const { error, loading, retry, refreshing } = merge2(listings, auctions);

  // The segmented row holds the page height itself; a segment changed from
  // somewhere else (the empty state's "See upcoming IPOs") has to say so.
  const goSeg = (next: Seg) => {
    holdPageHeight();
    setSeg(next);
  };

  return (
    <>
      <Segmented
        className="mt-4"
        label="IPO status"
        value={shown}
        onChange={setSeg}
        options={[
          { id: "open", label: "Open" },
          { id: "upcoming", label: "Upcoming" },
          { id: "closed", label: "Closed" },
        ]}
      />

      <ViewSwap view={shown} order={SEGS}>
        {loading && list.length === 0 && (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton w={40} h={40} />
                  <span className="flex-1">
                    <Skeleton w="60%" h={22} />
                    <Skeleton w="40%" h={20} className="mt-1" />
                  </span>
                </div>
                <Skeleton h={48} className="mt-4" />
                <Skeleton h={48} className="mt-4 rounded-[10px]" />
              </Card>
            ))}
          </div>
        )}

        {error && <ApiErrorCard className="mt-4" error={error} onRetry={retry} retrying={refreshing} />}

        {!loading && !error && (
          <>
            {list.length === 0 && shown === "open" && (
              <EmptyState title="No IPOs open right now" body="See what is coming up next." action={{ label: "See upcoming IPOs", onClick: () => goSeg("upcoming") }} />
            )}
            {list.length === 0 && shown === "upcoming" && <EmptyState title="Nothing scheduled" body="New IPOs show up here when a company announces one." />}
            {list.length === 0 && shown === "closed" && <EmptyState title="No closed IPOs yet" body="Finished IPOs and their results show up here." />}
          </>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {list.map((listing) => (
            <IpoCard
              key={listing.ticker}
              listing={listing}
              auction={auctions.data?.[listing.ticker]}
              pending={auctions.loading}
              applied={committed[listing.ticker] ?? 0}
            />
          ))}
        </div>

        {applications > 0 && (
          <PromoCard
            className="mt-5"
            href="/orders"
            icon={<ListOrdered />}
            title={`Your applications · ${applications}`}
            sub="Track, collect shares or take a refund in Orders"
          />
        )}

        {list.length > 0 && (
          <p className="t-caption mt-6">
            An IPO lists only if it raises the minimum shown on its card. Otherwise every application is refunded.
          </p>
        )}
      </ViewSwap>
    </>
  );
}

function Head({ listing }: { listing: Listing }) {
  return (
    <Link href={hrefFor(listing)} className="flex items-center gap-3">
      <TickerLogo ipo={listing} size={40} />
      <span className="min-w-0 flex-1">
        <span className="t-card-title block truncate text-text">{listing.name}</span>
        <span className="t-label block truncate">
          <TickerMark ticker={listing.ticker} symbol={listing.symbol} /> · {listing.ensName}
        </span>
      </span>
    </Link>
  );
}

/**
 * `pending` means the auction read for this card has not landed yet, which is
 * not the same thing as the server having nothing to say. A card that cannot
 * tell the two apart tells the user the wrong one and then corrects itself a
 * moment later, which is the flicker a tab switch used to end in.
 */
function IpoCard({ listing, auction, pending, applied }: { listing: Listing; auction: Auction | undefined; pending: boolean; applied: number }) {
  const waiting = pending && !auction;
  if (listing.phase === "live") return <OpenCard listing={listing} auction={auction} waiting={waiting} applied={applied} />;
  if (listing.phase === "draft") return <UpcomingCard listing={listing} auction={auction} waiting={waiting} />;
  if (listing.phase === "listed" || listing.phase === "cleared") return <ListedCard listing={listing} auction={auction} />;
  return <RefundCard listing={listing} auction={auction} applied={applied} />;
}

function OpenCard({ listing, auction, waiting, applied }: { listing: Listing; auction: Auction | undefined; waiting: boolean; applied: number }) {
  const seconds = useCountdown(blocksAsSeconds(auction?.blocksRemaining));
  const raised = listing.raised ?? auction?.raised ?? null;
  const target = auction?.targetRaise ?? null;
  const required = auction?.requiredRaise ?? null;
  const price = listing.clearingPrice ?? auction?.floorPrice ?? null;

  return (
    <Card className="p-4">
      <Head listing={listing} />
      <div className="mt-4 flex items-end justify-between gap-4">
        <span>
          <span className="t-label block">Current price</span>
          <span className="num t-section-title block text-text">{orCopy(price, (p) => lotFixed(p), COPY.noClearing)}</span>
        </span>
        <span className="text-right">
          <span className="t-label block">Closes in</span>
          <span className={`num t-section-title block ${seconds !== null && seconds < 3600 ? "text-warn" : "text-text"}`}>
            {seconds !== null ? countdown(seconds) : waiting ? <Skeleton w={86} h={24} /> : COPY.noSchedule}
          </span>
        </span>
      </div>
      {raised !== null && target !== null ? (
        <>
          <ProgressBar className="mt-3" value={raised} max={target} marker={required ?? undefined} />
          <p className="t-caption mt-2">
            <span className="font-medium" style={{ color: markVar(listing.ticker) }}>
              {(raised / target).toFixed(1)}x
            </span>{" "}
            subscribed{required !== null ? ` · lists if it reaches ${usdc(required, 0)} USDC` : ""}
          </p>
        </>
      ) : waiting ? (
        // Same shape and the same height as the progress block it is standing
        // in for, so nothing below it moves when the real numbers arrive.
        <>
          <Skeleton h={4} className="mt-3 rounded-full" />
          <Skeleton w="70%" h={18} className="mt-2" />
        </>
      ) : (
        <p className="t-caption mt-3">How much has been applied for isn&apos;t available from this server yet.</p>
      )}
      {applied > 0 && <p className="t-body mt-3 text-text">You applied {usdc(applied)} USDC</p>}
      {applied > 0 ? (
        <Link href="/orders" className="mt-3 block">
          <Button variant="secondary" className="w-full">
            View application
          </Button>
        </Link>
      ) : (
        <Link href={`${hrefFor(listing)}?apply=1`} className="mt-3 block">
          <Button variant="secondary" className="w-full">
            Apply
          </Button>
        </Link>
      )}
    </Card>
  );
}

function UpcomingCard({ listing, auction, waiting }: { listing: Listing; auction: Auction | undefined; waiting: boolean }) {
  const seconds = useCountdown(blocksAsSeconds(auction?.blocksRemaining));
  if (waiting)
    return (
      <Card className="p-4">
        <Head listing={listing} />
        <Skeleton w="60%" h={20} className="mt-4" />
        <Skeleton w="80%" h={20} className="mt-1" />
        <Skeleton w="50%" h={18} className="mt-1" />
      </Card>
    );
  return (
    <Card className="p-4">
      <Head listing={listing} />
      <p className="t-body mt-4 text-text">{seconds === null ? "Opening date not set yet" : `Opens in ${countdown(seconds)}`}</p>
      {auction && (
        <p className="num t-body text-text">
          Price range {lotFixed(auction.floorPrice)} to {lotFixed(auction.capPrice)}
        </p>
      )}
      {auction && <p className="t-caption mt-1">Up to {usdc(auction.perApplicantCap, 0)} USDC per person</p>}
    </Card>
  );
}

function ListedCard({ listing, auction }: { listing: Listing; auction: Auction | undefined }) {
  const issue = auction?.issuePrice ?? null;
  const ch = listing.clearingPrice !== null && issue !== null ? changeVs(listing.clearingPrice, issue) : null;
  return (
    <Card className="p-4">
      <Head listing={listing} />
      <p className="num t-body mt-4 text-text">
        {listing.clearingPrice === null ? COPY.noClearing : `Listed at ${lotFixed(listing.clearingPrice)}`}{" "}
        {ch && <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} />}
      </p>
      <p className="t-caption mt-1">
        {listing.phase === "cleared"
          ? "This IPO is over. The company's shares are about to start trading."
          : "This IPO is closed. The company trades on the Stocks tab."}
      </p>
      <Link href={hrefFor(listing)} className="mt-3 block">
        <Button variant="secondary" className="w-full">
          See the company
        </Button>
      </Link>
    </Card>
  );
}

function RefundCard({ listing, auction, applied }: { listing: Listing; auction: Auction | undefined; applied: number }) {
  const raised = listing.raised ?? auction?.raised ?? null;
  const required = auction?.requiredRaise ?? null;
  return (
    <Card className="p-4">
      <Head listing={listing} />
      <p className="t-body mt-4 text-text">Did not reach the minimum · refunds open</p>
      {raised !== null && required !== null && (
        <p className="t-caption mt-1">
          It raised {usdc(raised)} of the {usdc(required, 0)} USDC it needed, so every application is refundable.
        </p>
      )}
      {applied > 0 && (
        <Link href="/orders" className="mt-3 block">
          <Button variant="secondary" className="w-full">
            Refund your {usdc(applied)} USDC
          </Button>
        </Link>
      )}
    </Card>
  );
}
