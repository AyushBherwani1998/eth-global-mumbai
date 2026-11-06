"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Briefcase, CircleDollarSign, Gavel, Info, Loader2, Search, SearchX, X } from "lucide-react";
import { BottomSpacer } from "@/screens/common";
import { PrivacyBadge, TabHeader, IconButton } from "@/components/shell";
import { CircuitBanner } from "@/components/circuit-banner";
import { Card, Change, FilterChip, Pill, Progress, SectionTitle, StatusChip, TickerAvatar, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { useBlockCountdown } from "@/lib/hooks";
import { blocksToDuration, changeVs, lotFixed, secondsToDuration } from "@/lib/format";
import { BIDS, CURRENT_BLOCK, FAUCET_URL, IPOS, OFFER, ensName, getMarket, hrefFor, lastPrice, type Ipo } from "@/lib/mock";

type Filter = "all" | "auction" | "listed" | "upcoming";

const isListed = (i: Ipo) => i.phase === "listed";

export function IpoListScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const { usdcBalance, connected } = useApp();

  const live = IPOS.filter((i) => i.phase === "live");
  const listed = IPOS.filter(isListed);
  const other = IPOS.filter((i) => i.phase === "draft" || i.phase === "refunding");
  const alerts = listed.filter((i) => i.status === "halted" || i.status === "surveillance");
  const activeBids = BIDS.filter((b) => b.state === "active").length;

  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <>
      <TabHeader
        title="IPOs"
        actions={
          <IconButton label="Search tickers" active={searchOpen} onClick={() => setSearchOpen((s) => !s)}>
            <Search className="size-[22px]" />
          </IconButton>
        }
      />
      <main className="px-4">
        <div className="flex flex-wrap items-center gap-2">
          <PrivacyBadge />
          <Pill tone="muted">Sepolia</Pill>
          {connected && usdcBalance < OFFER.perApplicantCap && (
            <a href={FAUCET_URL} target="_blank" rel="noreferrer">
              <Pill tone="brand">Get test USDC</Pill>
            </a>
          )}
        </div>

        {searchOpen && <EnsSearch onClose={() => setSearchOpen(false)} />}

        {/* Index-style strip (reference: NIFTY 50 / BANK NIFTY cards) */}
        <div className="no-scrollbar -mx-4 mt-4 flex gap-3 overflow-x-auto px-4">
          {listed.map((i) => {
            const p = lastPrice(i.ticker)!;
            const ch = changeVs(p, OFFER.issuePrice);
            return (
              <Link key={i.ticker} href={hrefFor(i)} className="shrink-0">
                <Card className="min-w-[156px] px-3 py-2.5">
                  <p className="text-xs font-semibold text-strong">{i.symbol}</p>
                  <p className="num mt-0.5 text-[13px]">
                    <span className="text-strong">{lotFixed(p, 3)}</span>{" "}
                    <Change abs={ch.abs} rel={ch.rel} digits={3} className="text-xs" />
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
          {(
            [
              ["all", "Explore"],
              ["auction", `Live auction · ${live.length}`],
              ["listed", "Listed"],
              ["upcoming", "Upcoming & closed"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <FilterChip key={id} active={filter === id} onClick={() => setFilter(id)}>
              {label}
            </FilterChip>
          ))}
        </div>

        {filter === "all" && alerts.length > 0 && (
          <div className="mt-4 space-y-2">
            {alerts.map((i) => (
              <div key={i.ticker} className="flex items-center gap-2">
                <TickerAvatar ipo={i} size={28} />
                <div className="min-w-0 flex-1">
                  <CircuitBanner ticker={i.ticker} policy={getMarket(i.ticker)!.policy} compact />
                </div>
              </div>
            ))}
          </div>
        )}

        {show("auction") && (
          <>
            <SectionTitle>Live auctions</SectionTitle>
            {live.length === 0 ? (
              <p className="text-sm text-muted">No live auctions right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {live.map((i) => (
                  <AuctionCard key={i.ticker} ipo={i} />
                ))}
              </div>
            )}
          </>
        )}

        {show("listed") && (
          <>
            <SectionTitle>Listed on Listing Day</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              {listed.map((i) => (
                <ListedCard key={i.ticker} ipo={i} />
              ))}
            </div>
          </>
        )}

        {show("upcoming") && (
          <>
            <SectionTitle>Upcoming &amp; closed</SectionTitle>
            <Card className="divide-y divide-line">
              {other.map((i) => (
                <OtherRow key={i.ticker} ipo={i} />
              ))}
            </Card>
          </>
        )}

        {filter === "all" && (
          <>
            <SectionTitle>Tools</SectionTitle>
            <div className="grid grid-cols-4 gap-3">
              <Tool href="/bids" label="My bids" badge={activeBids} icon={<Gavel className="size-7" />} />
              <Tool href="/portfolio" label="Portfolio" icon={<Briefcase className="size-7" />} />
              <Tool href={FAUCET_URL} external label="Get USDC" icon={<CircleDollarSign className="size-7" />} />
              <Tool href="/about" label="About" icon={<Info className="size-7" />} />
            </div>
          </>
        )}
        <p className="mt-6 text-center text-xs text-muted">
          Every ticker resolved from ENS under <b>listingday.eth</b>. NSE-inspired mock; not a regulated product.
        </p>
        <BottomSpacer />
      </main>
    </>
  );
}

function AuctionCard({ ipo }: { ipo: Ipo }) {
  const { seconds } = useBlockCountdown(ipo.endBlock);
  const ch = changeVs(ipo.clearingPrice!, OFFER.issuePrice);
  return (
    <Link href={hrefFor(ipo)}>
      <Card className="h-full p-3">
        <div className="flex items-start justify-between">
          <TickerAvatar ipo={ipo} />
          <Pill tone="brand" dot>
            {secondsToDuration(seconds)}
          </Pill>
        </div>
        <p className="mt-2.5 truncate text-[15px] font-medium text-strong">{ipo.name}</p>
        <p className="num mt-1 text-[15px] text-strong">
          {lotFixed(ipo.clearingPrice!)} <span className="text-xs text-muted">USDC/lot</span>
        </p>
        <Change abs={ch.abs} rel={ch.rel} className="text-[13px]" />
        <div className="mt-2.5">
          <Progress value={ipo.raised!} max={OFFER.targetRaise} marker={OFFER.requiredRaise} tone="brand" />
          <p className="num mt-1 text-[11px] text-muted">
            {ipo.raised} / {OFFER.requiredRaise} USDC to graduate
          </p>
        </div>
      </Card>
    </Link>
  );
}

function ListedCard({ ipo }: { ipo: Ipo }) {
  const p = lastPrice(ipo.ticker)!;
  const ch = changeVs(p, OFFER.issuePrice);
  return (
    <Link href={hrefFor(ipo)}>
      <Card className="h-full p-3">
        <div className="flex items-start justify-between">
          <TickerAvatar ipo={ipo} />
          {ipo.status !== "listed" && <StatusChip ipo={ipo} />}
        </div>
        <p className="mt-2.5 truncate text-[15px] font-medium text-strong">{ipo.name}</p>
        <p className="num mt-1 text-[15px] text-strong">
          {lotFixed(p, 3)} <span className="text-xs text-muted">USDC/lot</span>
        </p>
        <Change abs={ch.abs} rel={ch.rel} digits={3} className="text-[13px]" />
      </Card>
    </Link>
  );
}

function OtherRow({ ipo }: { ipo: Ipo }) {
  const refunding = ipo.phase === "refunding";
  return (
    <Link href={hrefFor(ipo)} className="flex items-center gap-3 p-3">
      <TickerAvatar ipo={ipo} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-strong">{ipo.name}</p>
        <p className="text-[13px] text-muted">
          {refunding
            ? `Raised ${ipo.raised} of ${OFFER.requiredRaise} USDC · every bid refundable`
            : `Starts in ~${blocksToDuration(ipo.startBlock! - CURRENT_BLOCK)} · range ${lotFixed(OFFER.floorPrice)}–${lotFixed(OFFER.capPrice)}`}
        </p>
      </div>
      <StatusChip ipo={ipo} />
    </Link>
  );
}

function Tool({ href, label, icon, badge, external }: { href: string; label: string; icon: React.ReactNode; badge?: number; external?: boolean }) {
  const body = (
    <span className="flex flex-col items-center gap-1.5">
      <span className="relative flex aspect-square w-full items-center justify-center rounded-[12px] bg-subtle text-gain">
        {icon}
        {!!badge && (
          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-gain text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="text-xs font-medium text-strong">{label}</span>
    </span>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <Link href={href}>{body}</Link>
  );
}

/** Live ENS resolution of `<label>.listingday.eth` (mocked with a short delay). */
function EnsSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "resolving" | "done">("idle");
  const { countRead } = useApp();
  const label = q.trim().toLowerCase().replace(/\.listingday\.eth$/, "");
  const hit = useMemo(() => IPOS.find((i) => i.ticker === label), [label]);

  useEffect(() => {
    if (!label) return;
    const t1 = setTimeout(() => setState("resolving"), 250);
    const t2 = setTimeout(() => {
      setState("done");
      countRead(2);
    }, 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [label, countRead]);
  const shown = label ? state : "idle";

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 rounded-[12px] border border-line-strong bg-card px-3 focus-within:border-brand">
        <Search className="size-4 text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setState("idle");
          }}
          placeholder="Type a ticker (e.g. acme)"
          className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <span className="text-sm text-muted">.listingday.eth</span>
        <button aria-label="Close search" onClick={onClose} className="text-muted">
          <X className="size-4" />
        </button>
      </div>
      {shown === "resolving" && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Resolving {ensName(label)} via Anon-RPC…
        </p>
      )}
      {shown === "done" && hit && (
        <Link href={hrefFor(hit)} className="mt-2 block">
          <Card className="flex items-center gap-3 p-3">
            <TickerAvatar ipo={hit} size={36} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-strong">{hit.name}</p>
              <p className="flex items-center gap-1 text-[13px] text-gain">
                <BadgeCheck className="size-3.5" /> Resolved from ENS · {ensName(hit.ticker)}
              </p>
            </div>
            <StatusChip ipo={hit} />
          </Card>
        </Link>
      )}
      {shown === "done" && !hit && (
        <p className={cx("mt-2 flex items-center gap-2 text-sm text-muted")}>
          <SearchX className="size-4" /> No ticker at {ensName(label)}
        </p>
      )}
    </div>
  );
}
