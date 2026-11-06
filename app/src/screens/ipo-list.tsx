"use client";

// IPO chip body (UX.md 3.2), stopgap: Open · Upcoming · Closed segments over the
// old cards and rows. The screen engineers replace this with the 3.2 card spec.

import { useState } from "react";
import { Change, CompanyCard, EmptyState, ListRow, Segmented, TickerLogo } from "@/components/ui";
import { useBlockCountdown } from "@/lib/hooks";
import { blocksToDuration, changeVs, lotFixed, secondsToDuration, usdc } from "@/lib/format";
import { CURRENT_BLOCK, IPOS, OFFER, hrefFor, lastPrice, type Ipo } from "@/lib/mock";

type Seg = "open" | "upcoming" | "closed";

export function IpoBody() {
  const live = IPOS.filter((i) => i.phase === "live");
  const upcoming = IPOS.filter((i) => i.phase === "draft");
  const closed = IPOS.filter((i) => i.phase === "listed" || i.phase === "refunding");
  const [seg, setSeg] = useState<Seg>(live.length ? "open" : "upcoming");

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

      {seg === "open" &&
        (live.length === 0 ? (
          <EmptyState title="No IPOs open right now" body="See what's coming up next." action={{ label: "See upcoming", onClick: () => setSeg("upcoming") }} />
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
            {live.map((i) => (
              <AuctionCard key={i.ticker} ipo={i} />
            ))}
          </div>
        ))}

      {seg === "upcoming" && (
        <div className="mt-2 divide-y divide-line">
          {upcoming.length === 0 && <EmptyState title="Nothing scheduled" body="New IPOs appear here when a company announces one." />}
          {upcoming.map((i) => (
            <ListRow
              key={i.ticker}
              href={hrefFor(i)}
              logo={<TickerLogo ipo={i} size={40} />}
              title={i.name}
              sub={`IPO opens in about ${blocksToDuration(i.startBlock! - CURRENT_BLOCK)}`}
              right={<span className="text-text-2">{`${lotFixed(OFFER.floorPrice)} to ${lotFixed(OFFER.capPrice)}`}</span>}
            />
          ))}
        </div>
      )}

      {seg === "closed" && (
        <div className="mt-2 divide-y divide-line">
          {closed.map((i) => {
            const p = lastPrice(i.ticker);
            const ch = p && i.clearingPrice ? changeVs(p, i.clearingPrice) : null;
            return (
              <ListRow
                key={i.ticker}
                href={hrefFor(i)}
                logo={<TickerLogo ipo={i} size={40} />}
                title={i.name}
                sub={i.phase === "listed" ? `Listed at ${lotFixed(i.clearingPrice!)}` : "Not listed · refunds open"}
                right={i.phase === "listed" && p ? lotFixed(p) : <span className="text-text-2">Closed</span>}
                rightSub={ch ? <Change abs={ch.abs} rel={ch.rel} /> : undefined}
              />
            );
          })}
        </div>
      )}

      <p className="t-caption mt-6">An IPO lists only if it raises at least {usdc(OFFER.requiredRaise, 0)} USDC. Otherwise every application is refunded.</p>
    </>
  );
}

function AuctionCard({ ipo }: { ipo: Ipo }) {
  const { seconds } = useBlockCountdown(ipo.endBlock);
  const ch = changeVs(ipo.clearingPrice!, OFFER.issuePrice);
  return (
    <CompanyCard
      href={hrefFor(ipo)}
      logo={<TickerLogo ipo={ipo} size={36} />}
      name={ipo.name}
      price={`Closes in ${secondsToDuration(seconds)}`}
      change={
        <span className="t-price-row text-text">
          {lotFixed(ipo.clearingPrice!)} <Change abs={ch.abs} rel={ch.rel} />
        </span>
      }
      sub={`${usdc(ipo.raised ?? 0, 1)} of ${OFFER.targetRaise} USDC raised`}
    />
  );
}
