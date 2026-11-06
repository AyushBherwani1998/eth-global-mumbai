"use client";

// Markets, IPO chip (UX.md 3.2): Open · Upcoming · Closed, one card per IPO,
// and a summary row when this wallet has applications. Plain English only;
// auction mechanics stay on the company page.

import Link from "next/link";
import { useState } from "react";
import { ListOrdered, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/providers";
import { ErrorCard } from "@/components/states";
import { useMockLoad } from "@/components/company/load";
import { changeDigits, countdown } from "@/components/company/num";
import { Button, Card, Change, EmptyState, ProgressBar, PromoCard, Segmented, Skeleton, TickerLogo } from "@/components/ui";
import { useBlockCountdown } from "@/lib/hooks";
import { BLOCK_SECONDS, changeVs, dateTimeIST, lotFixed, usdc } from "@/lib/format";
import { BIDS, COMMITTED, CURRENT_BLOCK, IPOS, NOW, OFFER, hrefFor, lastPrice, type Ipo } from "@/lib/mock";

type Seg = "open" | "upcoming" | "closed";

export function IpoBody() {
  const { loading, error, retry, retrying } = useMockLoad();
  const { connected } = useApp();
  const live = IPOS.filter((i) => i.phase === "live");
  const upcoming = IPOS.filter((i) => i.phase === "draft");
  const closed = IPOS.filter((i) => i.phase === "listed" || i.phase === "refunding");
  const [seg, setSeg] = useState<Seg>(live.length ? "open" : "upcoming");
  const applications = connected ? BIDS.length : 0;

  const list = seg === "open" ? live : seg === "upcoming" ? upcoming : closed;

  return (
    <>
      <Segmented
        className="mt-4"
        label="IPO status"
        value={seg}
        onChange={setSeg}
        options={[
          { id: "open", label: "Open" },
          { id: "upcoming", label: "Upcoming" },
          { id: "closed", label: "Closed" },
        ]}
      />

      {loading && (
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

      {!loading && error && (
        <ErrorCard
          className="mt-4"
          title="We couldn't load IPOs privately"
          body="Your private connection didn't answer. Check your internet and try again."
          onRetry={retry}
          retrying={retrying}
        />
      )}

      {!loading && !error && (
        <>
          {list.length === 0 && seg === "open" && (
            <EmptyState title="No IPOs open right now" body="See what is coming up next." action={{ label: "See upcoming IPOs", onClick: () => setSeg("upcoming") }} />
          )}
          {list.length === 0 && seg === "upcoming" && <EmptyState title="Nothing scheduled" body="New IPOs show up here when a company announces one." />}
          {list.length === 0 && seg === "closed" && <EmptyState title="No closed IPOs yet" body="Finished IPOs and their results show up here." />}

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {list.map((ipo) => (
              <IpoCard key={ipo.ticker} ipo={ipo} />
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

          <p className="t-caption mt-6">
            An IPO lists only if it raises at least {usdc(OFFER.requiredRaise, 0)} USDC, half its target. Otherwise every application is
            refunded.
          </p>
        </>
      )}
    </>
  );
}

function Head({ ipo }: { ipo: Ipo }) {
  return (
    <Link href={hrefFor(ipo)} className="flex items-center gap-3">
      <TickerLogo ipo={ipo} size={40} />
      <span className="min-w-0 flex-1">
        <span className="t-card-title block truncate text-text">{ipo.name}</span>
        <span className="t-label block truncate">{ipo.sector}</span>
      </span>
    </Link>
  );
}

function OnePerPerson({ ipo }: { ipo: Ipo }) {
  if (ipo.eligibility !== "human") return null;
  return (
    <p className="t-label mt-3 flex items-center gap-2">
      <ShieldCheck className="size-4 shrink-0 text-text-2" aria-hidden /> One application per person
    </p>
  );
}

function IpoCard({ ipo }: { ipo: Ipo }) {
  const applied = COMMITTED[ipo.ticker] ?? 0;
  if (ipo.phase === "live") return <OpenCard ipo={ipo} applied={applied} />;
  if (ipo.phase === "draft") return <UpcomingCard ipo={ipo} />;
  if (ipo.phase === "listed") return <ListedCard ipo={ipo} />;
  return <RefundCard ipo={ipo} applied={applied} />;
}

function OpenCard({ ipo, applied }: { ipo: Ipo; applied: number }) {
  const { seconds } = useBlockCountdown(ipo.endBlock);
  const raised = ipo.raised ?? 0;
  const subscribed = raised / OFFER.targetRaise;
  return (
    <Card className="p-4">
      <Head ipo={ipo} />
      <div className="mt-4 flex items-end justify-between gap-4">
        <span>
          <span className="t-label block">Current price</span>
          <span className="num t-section-title block text-text">{lotFixed(ipo.clearingPrice ?? OFFER.issuePrice)}</span>
        </span>
        <span className="text-right">
          <span className="t-label block">Closes in</span>
          <span className="num t-section-title block text-text">{countdown(seconds)}</span>
        </span>
      </div>
      <ProgressBar className="mt-3" value={raised} max={OFFER.targetRaise} marker={OFFER.requiredRaise} />
      <p className="t-caption mt-2">
        Subscribed {subscribed.toFixed(2)} times · lists if it reaches {usdc(OFFER.requiredRaise, 0)} USDC
      </p>
      {applied > 0 && <p className="t-body mt-3 text-text">You applied {usdc(applied)} USDC</p>}
      {applied > 0 ? (
        <Link href="/orders" className="mt-3 block">
          <Button variant="secondary" className="w-full">
            View application
          </Button>
        </Link>
      ) : (
        <Link href={`${hrefFor(ipo)}?apply=1`} className="mt-3 block">
          <Button variant="secondary" className="w-full">
            Apply
          </Button>
        </Link>
      )}
      <OnePerPerson ipo={ipo} />
    </Card>
  );
}

function UpcomingCard({ ipo }: { ipo: Ipo }) {
  const opensAt = new Date(NOW).getTime() / 1000 + (ipo.startBlock! - CURRENT_BLOCK) * BLOCK_SECONDS;
  return (
    <Card className="p-4">
      <Head ipo={ipo} />
      <p className="t-body mt-4 text-text">Opens {dateTimeIST(opensAt)}</p>
      <p className="num t-body text-text">
        Price range {lotFixed(OFFER.floorPrice)} to {lotFixed(OFFER.capPrice)}
      </p>
      <p className="t-caption mt-1">Up to {usdc(OFFER.perApplicantCap, 0)} USDC per person</p>
      <OnePerPerson ipo={ipo} />
    </Card>
  );
}

function ListedCard({ ipo }: { ipo: Ipo }) {
  const now = lastPrice(ipo.ticker);
  const ch = now && ipo.clearingPrice ? changeVs(now, ipo.clearingPrice) : null;
  return (
    <Card className="p-4">
      <Head ipo={ipo} />
      <p className="num t-body mt-4 text-text">
        Listed at {lotFixed(ipo.clearingPrice ?? OFFER.issuePrice)}
        {now ? ` · now ${lotFixed(now)}` : ""} {ch && <Change abs={ch.abs} rel={ch.rel} digits={changeDigits(ch.abs)} />}
      </p>
      <p className="t-caption mt-1">This IPO is closed. The company trades on the Stocks tab.</p>
      <Link href={hrefFor(ipo)} className="mt-3 block">
        <Button variant="secondary" className="w-full">
          See the company
        </Button>
      </Link>
    </Card>
  );
}

function RefundCard({ ipo, applied }: { ipo: Ipo; applied: number }) {
  return (
    <Card className="p-4">
      <Head ipo={ipo} />
      <p className="t-body mt-4 text-text">Did not reach the minimum · refunds open</p>
      <p className="t-caption mt-1">
        It raised {usdc(ipo.raised ?? 0)} of the {usdc(OFFER.requiredRaise, 0)} USDC it needed, so every application is refundable.
      </p>
      {applied > 0 && (
        <Link href="/orders" className="mt-3 block">
          <Button variant="secondary" className="w-full">
            Refund {usdc(applied)} USDC
          </Button>
        </Link>
      )}
    </Card>
  );
}
