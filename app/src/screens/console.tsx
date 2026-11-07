"use client";

// Issuer console, one listing (UX.md 3.9). Three sections, in this order:
//   Listing      the lifecycle stepper, plain-English step names (issuer)
//   Trading rule read-only policy state, plus the commands that change it
//   Developer    collapsed: addresses, Q96 maths, receipts
//
// Nothing in this screen writes to a chain and nothing in it drives Chainlink
// CRE. CRE runs from the command line for the demo (cre/README.md), so every
// step that needs a transaction shows the command instead of a button that
// would only pretend. Every figure is read from the exchange server:
// GET /v1/listings/:ticker (offer, records, phase), /v1/auction/:ticker and
// /clearing (the sale), /v1/bids?ticker= (applications), /v1/ens/:ticker,
// /v1/policy/:ticker and, once listed, /v1/market/:ticker. Which steps are done
// comes from that state (components/console/lifecycle.ts), not from a fixture.

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { CommandBlock, ConsoleShell, ConsoleSignIn, GateLine, NotTheOwner } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { modeWords, usePolicy, type PolicyView } from "@/components/console/policy";
import { STEP_ORDER, currentStep, lifecycle, type StepId } from "@/components/console/lifecycle";
import { apiConfigured, errorTitle, type Auction, type Bid, type ClearingPoint, type ListingDetail, type MarketView } from "@/lib/api";
import { ApiErrorCard } from "@/lib/api-state";
import { ErrorCard, SkeletonList } from "@/components/states";
import { PriceChart } from "@/components/time-chart";
import { TickerMark } from "@/components/company/logos";
import { Button, Card, CopyAddress, Details, KV, ProgressBar, SectionTitle, TextLink, TickerLogo, cx, statusLabel } from "@/components/ui";
import { addrUrl, blockNo, dateTimeIST, lotFixed, shares, shortAddr, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { pricePoints } from "@/lib/adapt";
import { useAuction, useClearing, useEns, useListing, useListings, useMarket, useTickerBids } from "@/lib/live";

// ---------------------------------------------------------------------------
// Lifecycle steps. The titles are plain English.
// ---------------------------------------------------------------------------

const STEP_COPY: Record<StepId, { title: string; sub: string }> = {
  create: { title: "Create the listing", sub: "Shares, issue price and the rules of the sale." },
  ticker: { title: "Register the name", sub: "Your company name on Thamba, and what it points to." },
  policy: { title: "Publish the trading rule", sub: "The price limits the exchange will enforce." },
  launch: { title: "Open the ICO", sub: "People can apply from this moment." },
  monitor: { title: "Watch applications", sub: "Price, money raised and who applied." },
  graduate: { title: "List on the market", sub: "Opens trading at the final price." },
};
const STEPS = STEP_ORDER.map((id) => ({ id, ...STEP_COPY[id] }));

export function ConsoleScreen({ ticker }: { ticker: string }) {
  const { ready, connected, listings } = useIssuerSession();

  if (!ready) return <SkeletonList rows={4} className="pt-6" />;
  if (!connected) return <ConsoleSignIn />;
  if (!listings.includes(ticker)) return <NotTheOwner ticker={ticker} />;

  return <IssuerConsoleLoader ticker={ticker} />;
}

type Reads = {
  ipo: ListingDetail;
  auction: Auction | null;
  series: ClearingPoint[];
  market: MarketView | null;
  bids: Bid[] | null;
  currentBlock: number | null;
};

function IssuerConsoleLoader({ ticker }: { ticker: string }) {
  const listing = useListing(ticker);
  const listings = useListings();
  const auction = useAuction(ticker);
  const clearing = useClearing(ticker);
  const bids = useTickerBids(ticker);
  const ens = useEns(ticker);
  const policy = usePolicy(ticker);
  const ipo = listing.data;
  const market = useMarket(ipo?.phase === "listed" ? ticker : null);

  if (!ipo)
    return (
      <ConsoleShell>
        {listing.error ? <ApiErrorCard className="mt-6" error={listing.error} onRetry={listing.retry} retrying={listing.refreshing} /> : <SkeletonList rows={4} className="pt-6" />}
      </ConsoleShell>
    );

  const done = lifecycle(ipo, { ensResolved: ens.data?.resolved ?? null, policyVersion: policy.data?.version ?? null });
  return (
    <IssuerConsole
      done={done}
      reads={{
        ipo,
        auction: auction.data,
        series: clearing.data?.series ?? [],
        market: market.data,
        bids: bids.data?.bids ?? null,
        currentBlock: listings.data?.currentBlock ?? auction.data?.currentBlock ?? null,
      }}
      creTx={policy.data?.creTx ?? null}
    />
  );
}

// ---------------------------------------------------------------------------
// Shell: header, live card, three sections, desktop three columns.
// ---------------------------------------------------------------------------

function IssuerConsole({ done, reads, creTx }: { done: Record<StepId, boolean>; reads: Reads; creTx: string | null }) {
  const { ipo, market, series } = reads;
  const [open, setOpen] = useState<StepId | null>(currentStep(done) ?? "graduate");
  const marketPoints = pricePoints(market);

  const stepContent = (id: StepId) => {
    switch (id) {
      case "create":
        return <CreateStep ipo={ipo} />;
      case "ticker":
        return <TickerStep ipo={ipo} />;
      case "policy":
        return <PolicyStep ipo={ipo} market={market} creTx={creTx} />;
      case "launch":
        return <LaunchStep ipo={ipo} done={done.launch} />;
      case "monitor":
        return <MonitorStep reads={reads} />;
      case "graduate":
        return <GraduateStep reads={reads} done={done.graduate} />;
    }
  };

  const live = <LiveCard ipo={ipo} market={market} />;
  const liveInset = <LiveCard ipo={ipo} market={market} inset />;

  return (
    <ConsoleShell>
      <div>
        <header className="flex items-start gap-3 border-b border-line py-5">
          <TickerLogo ipo={ipo} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="t-page-title text-text">{ipo.name}</h1>
            <p className="t-label truncate">
              <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {ipo.ensName} · {statusLabel(ipo)}
            </p>
          </div>
        </header>
        <GateLine className="mt-3" />

        <div className="mt-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_300px] lg:items-start lg:gap-6 xl:grid-cols-[240px_minmax(0,1fr)_360px] xl:gap-8">
          {/* Desktop step rail */}
          <nav className="hidden lg:block" aria-label="Listing steps">
            <p className="t-section-title mb-2 text-text">Listing</p>
            <ol className="divide-y divide-line">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(s.id)}
                    aria-current={open === s.id ? "step" : undefined}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                  >
                    <StepCircle done={done[s.id]} n={i + 1} current={open === s.id} />
                    <span className={cx("t-body flex-1", open === s.id ? "text-text" : "text-text-2")}>{s.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {/* Centre column */}
          <div className="min-w-0">
            <div className="lg:hidden">{live}</div>

            <div className="lg:hidden">
              <SectionTitle>Listing</SectionTitle>
              <p className="t-label -mt-2">What you, the company, do to bring the shares to market.</p>
            </div>

            {/* Phone: accordion */}
            <ol className="mt-2 divide-y divide-line lg:hidden">
              {STEPS.map((s, i) => {
                const isOpen = open === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      aria-expanded={isOpen}
                      className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                    >
                      <StepCircle done={done[s.id]} n={i + 1} current={isOpen} />
                      <span className="min-w-0 flex-1">
                        <span className="t-list-title block text-text">{s.title}</span>
                        <span className="t-label block">{s.sub}</span>
                      </span>
                      <ChevronDown className={cx("size-5 shrink-0 text-text-2 transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && <div className="pb-4">{stepContent(s.id)}</div>}
                  </li>
                );
              })}
            </ol>

            {/* Desktop: the step the rail selected */}
            {open && (
              <div className="hidden lg:block">
                <p className="t-section-title text-text">{STEP_COPY[open].title}</p>
                <p className="t-label mb-3">{STEP_COPY[open].sub}</p>
                {stepContent(open)}
              </div>
            )}

            <TradingRulePanel ticker={ipo.ticker} />

            <SectionTitle>Developer</SectionTitle>
            <Details title="Addresses, maths and receipts">
              <DeveloperPanel reads={reads} creTx={creTx} />
            </Details>
          </div>

          {/* Desktop right rail */}
          <aside className="hidden lg:sticky lg:top-20 lg:block">
            <p className="t-section-title mb-2 text-text">Live</p>
            {liveInset}
            {marketPoints.length > 1 ? (
              <Card className="mt-3 p-4">
                <p className="t-label">Price</p>
                <PriceChart data={marketPoints.slice(-120)} kind="market" height={140} digits={2} readout={false} labels={false} />
              </Card>
            ) : series.length > 1 ? (
              <Card className="mt-3 p-4">
                <p className="t-label">Price so far</p>
                <PriceChart
                  data={series.map((p) => ({ time: p.time, value: p.price }))}
                  kind="clearing"
                  baseline={ipo.offer.issuePrice}
                  height={140}
                  digits={2}
                  readout={false}
                  labels={false}
                />
              </Card>
            ) : null}
          </aside>
        </div>

        <p className="t-caption mt-8 border-t border-line pt-4">Prices and amounts in USDC per 1,000 shares, read from the exchange server.</p>
      </div>
    </ConsoleShell>
  );
}

function StepCircle({ done, n, current }: { done: boolean; n: number; current: boolean }) {
  return (
    <span
      className={cx(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none font-medium",
        done ? "bg-text text-bg" : current ? "border-[1.5px] border-text text-text" : "border border-line text-text-2",
      )}
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  );
}

function LiveCard({ ipo, market, inset }: { ipo: ListingDetail; market: MarketView | null; inset?: boolean }) {
  const last = market?.price ?? ipo.clearingPrice;
  const offer = ipo.offer;
  return (
    <Card className={cx("p-4", !inset && "mt-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="t-label">{ipo.phase === "live" ? "Current price" : "Last price"}</p>
        <p className="num t-list-title text-text">{last !== null ? `${lotFixed(last)} USDC` : "Not priced yet"}</p>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="t-label">Phase</p>
        <p className="t-list-title text-text">{statusLabel(ipo)}</p>
      </div>
      <div className="mt-4">
        {ipo.raised !== null ? (
          <>
            <ProgressBar value={ipo.raised} max={offer.targetRaise} marker={offer.requiredRaise} />
            <p className="num t-label mt-2">
              {usdc(ipo.raised)} of {offer.targetRaise} USDC raised · lists at {offer.requiredRaise}
            </p>
          </>
        ) : (
          <p className="t-label">Money raised is not available from this node. Lists at {offer.requiredRaise} USDC.</p>
        )}
      </div>
    </Card>
  );
}

/** Every listing step runs from the demo laptop, so each one says so once. */
function RunsFromTheCommandLine({ command, note }: { command: string; note?: string }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="t-body text-text">This step runs from the command line, not from this browser.</p>
      <CommandBlock command={command} note={note} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listing steps
// ---------------------------------------------------------------------------

function CreateStep({ ipo }: { ipo: ListingDetail }) {
  const o = ipo.offer;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV
          k="Company"
          v={
            <>
              {ipo.name} (<TickerMark ticker={ipo.ticker} symbol={ipo.symbol} />)
            </>
          }
        />
        <KV k="Shares in total" v={shares(o.totalSupply)} />
        <KV k="Shares offered in the ICO" v={shares(o.auctioned)} sub={`${shares(o.lpReserve)} kept for the market`} />
        <KV k="Issue price" v={`${lotFixed(o.issuePrice)} per 1,000 shares`} />
        <KV k="Price range" v={`${lotFixed(o.floorPrice)} to ${lotFixed(o.capPrice)}`} />
        <KV k="Most one wallet can apply with" v={`${o.perApplicantCap} USDC`} sub="Counted per wallet, across all of its applications" />
        <KV k="Share of the raise kept as liquidity" v={`${o.lpPercent}%`} />
        <KV k="Minimum raise to list" v={`${o.requiredRaise} of ${o.targetRaise} USDC`} />
        <KV k="Who can apply" v="Anyone with a wallet" sub="No identity check, no KYC" />
        <KV k="Money is taken in" v="Sepolia test USDC" />
      </div>
      <RunsFromTheCommandLine command="cd contracts && make deploy" note="Writes the listing into contracts/deployments/<network>.json." />
    </Card>
  );
}

const RECORD_LABEL: Record<string, string> = {
  addr: "Share token",
  auction: "ICO contract",
  pool: "Market",
  hook: "Rule enforcer",
  policy: "Rule publisher",
};

function TickerStep({ ipo }: { ipo: ListingDetail }) {
  return (
    <Card className="p-4">
      <p className="t-body text-text">{ipo.ensName}</p>
      <p className="t-label mt-1">People find this company by that name, and the app reads every address below from it.</p>
      <div className="mt-3 divide-y divide-line">
        {(["addr", "auction", "pool", "hook", "policy"] as const).map((k) => (
          <KV key={k} k={RECORD_LABEL[k]} v={ipo.records[k] ? <CopyAddress value={ipo.records[k]} /> : "Not published yet"} />
        ))}
        <KV k="Trading status" v={ipo.status} sub="Set by the exchange, not by you" />
      </div>
      <RunsFromTheCommandLine
        command="cd contracts && make ens-sepolia"
        note="Registers the name, writes the records, and lets the exchange write the trading status."
      />
      <p className="mt-2">
        <TextLink href={`https://sepolia.app.ens.domains/${ipo.ensName}`}>View in the ENS app</TextLink>
      </p>
    </Card>
  );
}

function PolicyStep({ ipo, market, creTx }: { ipo: ListingDetail; market: MarketView | null; creTx: string | null }) {
  const ref = market?.policy.referencePrice ?? ipo.clearingPrice ?? ipo.offer.issuePrice;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Reference price" v={`${lotFixed(ref)} per 1,000 shares`} />
        <KV k="Normal day" v="Trades within 20% of the reference price" />
        <KV k="Under watch" v="Trades within 5% of the reference price" />
        <KV k="Listing day" v="Trades within 5% of the price the ICO closed at" />
      </div>
      <p className="t-body mt-3 text-text-2">
        The rule in force right now, and the commands that change it, are under &ldquo;Trading rule&rdquo; further down this page.
      </p>
      {creTx && (
        <p className="mt-1">
          <TextLink href={txUrl(creTx)}>View the latest report&apos;s receipt</TextLink>
        </p>
      )}
    </Card>
  );
}

function LaunchStep({ ipo, done }: { ipo: ListingDetail; done: boolean }) {
  const o = ipo.offer;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Shares on offer" v={shares(o.auctioned)} />
        <KV k="Issue price" v={lotFixed(o.issuePrice)} />
        <KV k="Price range" v={`${lotFixed(o.floorPrice)} to ${lotFixed(o.capPrice)}`} />
        <KV k="Minimum raise to list" v={`${o.requiredRaise} USDC`} />
      </div>
      {done && <p className="t-body mt-3 text-text">The ICO has opened. The contract address is written to your name.</p>}
      <RunsFromTheCommandLine command="cd contracts && make launch" note="Opens the sale and writes the ICO contract address to the name." />
    </Card>
  );
}

function bidWord(b: Bid, clearing: number | null): { text: string; tone: "gain" | "muted" } {
  switch (b.status) {
    case "claimed":
      return { text: "Shares collected", tone: "gain" };
    case "refunded":
      return { text: "Refunded", tone: "muted" };
    case "exited":
      return { text: "Settled", tone: "gain" };
    case "awaitingExit":
      return { text: "Waiting to settle", tone: "muted" };
    default:
      return clearing !== null && clearing <= b.maxPrice ? { text: "Likely allotted", tone: "gain" } : { text: "Below the price", tone: "muted" };
  }
}

function MonitorStep({ reads }: { reads: Reads }) {
  const { ipo, series, bids, auction } = reads;
  const last = series[series.length - 1];
  const raised = last?.raised ?? ipo.raised;
  return (
    <Card className="p-4">
      {last && (
        <>
          <div className="flex items-baseline justify-between">
            <p className="t-label">Price now</p>
            <p className="num t-list-title text-text">{lotFixed(last.price)} per 1,000 shares</p>
          </div>
          <PriceChart
            data={series.map((p) => ({ time: p.time, value: p.price }))}
            kind="clearing"
            baseline={ipo.offer.issuePrice}
            height={140}
            digits={2}
            readout={false}
            labels={false}
          />
        </>
      )}
      <div className="mt-3 divide-y divide-line">
        <KV k="Raised" v={raised === null ? "Not available from this node" : `${usdc(raised)} USDC`} sub={`${ipo.offer.requiredRaise} needed to list`} />
        <KV k="Applications" v={String(auction?.bidCount ?? ipo.bidCount)} />
        <KV k="Wallets that applied" v={String(auction?.applicants ?? ipo.applicants)} />
      </div>
      <p className="t-caption mt-2">An application the ICO turns away (over the per-wallet limit, or priced above the cap) never lands, so it leaves no record to count.</p>
      {bids && bids.length > 0 && (
        <div className="mt-4">
          <p className="t-list-title text-text">Applications</p>
          <ul className="mt-1 divide-y divide-line">
            {bids.map((b) => {
              const w = bidWord(b, ipo.clearingPrice);
              return (
                <li key={b.key} className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2">
                  <a href={addrUrl(b.owner)} target="_blank" rel="noreferrer" title={b.owner} className="num t-mono min-w-0 text-text-2 underline underline-offset-2">{shortAddr(b.owner)}</a>
                  <span className="num t-body text-text">
                    {usdc(b.budget)} up to {lotFixed(b.maxPrice)}
                  </span>
                  <span className={cx("t-change-sm shrink-0", w.tone === "gain" ? "text-gain-text" : "text-text-2")}>{w.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function GraduateStep({ reads, done }: { reads: Reads; done: boolean }) {
  const { ipo, auction, currentBlock } = reads;
  if (!done)
    return (
      <Card className="p-4">
        <p className="t-body text-text">
          {ipo.phase === "refunding"
            ? `The ICO raised less than ${ipo.offer.requiredRaise} USDC, so every application is refunded and there is nothing to list.`
            : `Opens when the ICO closes${ipo.endBlock !== null ? ` at block ${blockNo(ipo.endBlock)}` : ""}${
                ipo.endBlock !== null && currentBlock !== null && currentBlock < ipo.endBlock ? ` (${ipo.endBlock - currentBlock} blocks from now)` : ""
              }. The shares list if the ICO raised at least ${ipo.offer.requiredRaise} USDC; otherwise every application is refunded and there is nothing to list.`}
        </p>
        <RunsFromTheCommandLine command="cd contracts && make settle" note="Only works once the ICO has closed." />
      </Card>
    );
  const unsold = auction && auction.totalCleared !== null ? Math.max(0, auction.totalSupply - auction.totalCleared) : null;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Reached the minimum" v={ipo.graduated === null ? "Not known" : ipo.graduated ? "Yes" : "No"} />
        <KV k="Final price" v={ipo.clearingPrice === null ? "Not known" : `${lotFixed(ipo.clearingPrice)} per 1,000 shares`} />
        <KV k="Unsold shares" v={unsold === null ? "Not known" : `${shares(unsold)} returned to your treasury`} />
        {ipo.listedAt && <KV k="Listed" v={dateTimeIST(ipo.listedAt)} />}
      </div>
      <p className="t-body mt-3 text-text">The market is open at the final price, and the market address is written to your name.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trading rule: read-only policy state, and the commands that change it.
// ---------------------------------------------------------------------------

function TradingRulePanel({ ticker }: { ticker: string }) {
  const { data, error, loading, refreshing, retry, updatedAt } = usePolicy(ticker);

  return (
    <>
      <SectionTitle>Trading rule</SectionTitle>
      <p className="t-label -mt-2">
        The limits the exchange is enforcing on your share right now. This panel only reads. Nothing here changes the rule.
      </p>

      {data && <PolicyRows p={data} updatedAt={updatedAt} refreshing={refreshing} onRetry={retry} />}

      {!data && loading && (
        <Card className="mt-3 p-4">
          <p className="t-body text-text-2">Reading the published rule…</p>
        </Card>
      )}

      {!data && error && (
        <ErrorCard
          className="mt-3"
          title={errorTitle(error)}
          body={error.sentence}
          onRetry={error.retryable ? retry : undefined}
          retrying={refreshing}
        />
      )}

      <Card className="mt-3 p-4">
        <p className="t-list-title text-text">Changing the rule runs from the command line</p>
        <p className="t-body mt-1 text-text-2">
          Chainlink CRE publishes the rule. It runs on the demo laptop, not in this browser: it reads the exchange&apos;s
          policy, signs a report and writes it on chain. Two steps, then the panel above shows what landed.
        </p>
        <CommandBlock
          label="1. Set the rule on the exchange"
          command={`curl -X POST $EXCHANGE/policy -H "x-api-key: $SECRET" -d '{"mode":"surveillance"}'`}
          note="$EXCHANGE is the mock exchange, http://127.0.0.1:8787 by default. It takes halted, mode, refPricePoints and bands."
        />
        <CommandBlock
          label="2. Publish it with Chainlink CRE"
          command="cd cre && cre workflow simulate ./listing-policy --target staging-settings --trigger-index 0 --broadcast"
          note="The report is signed and written to the policy contract. The hook enforces it on the next trade."
        />
      </Card>
    </>
  );
}

function PolicyRows({
  p,
  updatedAt,
  refreshing,
  onRetry,
}: {
  p: PolicyView;
  updatedAt: number | null;
  refreshing: boolean;
  onRetry: () => void;
}) {
  const limits = p.band ? `${lotFixed(p.band.low)} to ${lotFixed(p.band.high)} per 1,000 shares` : "Not set until the shares list";
  return (
    <Card className="mt-3 p-4">
      <div className="divide-y divide-line">
        <KV k="Rule in force" v={modeWords(p)} />
        <KV k="Trading limits" v={limits} />
        <KV k="Trading halted" v={p.halted ? "Yes" : "No"} />
        <KV k="Reference price" v={p.referencePrice !== null ? `${lotFixed(p.referencePrice)} per 1,000 shares` : "Not set"} />
        <KV k="In force since" v={p.since ? dateTimeIST(p.since) : "Not published yet"} />
        <KV
          k="Published rule is out of date"
          v={p.stale ? "Yes, trading is halted until the next report" : "No"}
          sub={p.staleAt ? `Goes out of date ${dateTimeIST(p.staleAt)}` : undefined}
        />
      </div>
      <Details title="Details" className="mt-3">
        <div className="divide-y divide-line">
          <KV k="Policy version" v={`v${p.version}`} mono />
          <KV k="Mode" v={p.mode} mono />
          <KV k="Band" v={`${p.bandBps} bps`} mono />
          <KV k="Hook phase" v={p.hookPhase} mono />
          <KV k="Receiver status" v={p.receiverStatus ?? "unset"} mono />
          <KV k="Report as of" v={p.asOf ? dateTimeIST(p.asOf) : "unset"} />
          <KV k="CRE report" v={p.creTx ? <TextLink href={txUrl(p.creTx)}>{shortHash(p.creTx)}</TextLink> : "No report yet"} />
        </div>
        <p className="t-caption mt-2">Read from GET /v1/policy/{p.ticker}.</p>
      </Details>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" className="w-full sm:w-auto sm:min-w-[160px]" onClick={onRetry} busy={refreshing}>
          Check again
        </Button>
        {updatedAt && <span className="t-label">Read {timeIST(new Date(updatedAt).toISOString())}</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Developer (collapsed): protocol words live here and nowhere else.
// ---------------------------------------------------------------------------

function DeveloperPanel({ reads, creTx }: { reads: Reads; creTx: string | null }) {
  const { ipo, auction, market } = reads;
  const usdcAddress = ipo.external.usdc ?? null;
  return (
    <div>
      <div className="divide-y divide-line">
        {auction && <KV k="floorPriceQ96" v={auction.raw.floorPriceQ96} mono />}
        {auction && <KV k="capPriceQ96" v={auction.raw.capPriceQ96} mono />}
        {auction && <KV k="requiredCurrencyRaised" v={auction.raw.requiredCurrencyRaised} mono />}
        {market && <KV k="Token order" v={market.usdcIsCurrency0 ? "USDC is currency0 · buys are zeroForOne" : "Shares are currency0"} mono />}
        {usdcAddress && <KV k="Quote currency" v={<CopyAddress value={usdcAddress} />} />}
        <KV k="Auction" v={ipo.records.auction ? <CopyAddress value={ipo.records.auction} /> : "Not set yet"} />
        <KV k="Pool" v={ipo.records.pool ? <CopyAddress value={ipo.records.pool} /> : "Not set yet"} />
        <KV k="Hook" v={ipo.records.hook ? <CopyAddress value={ipo.records.hook} /> : "Not set yet"} />
        <KV k="Policy" v={ipo.records.policy ? <CopyAddress value={ipo.records.policy} /> : "Not set yet"} />
        <KV k="Backend" v={apiConfigured() ? "Configured" : "Not configured"} sub="services/api, read only" />
        {creTx && <KV k="Latest CRE report tx" v={<TextLink href={txUrl(creTx)}>{shortHash(creTx)}</TextLink>} />}
      </div>

      <p className="t-list-title mt-4 text-text">Role denial, and sweeping unsold tokens</p>
      <p className="t-body mt-1 text-text-2">
        Both run against the contracts from the command line. The role denial is the expected failure: the policy
        receiver holds the status role only, so writing any other record reverts.
      </p>
      <CommandBlock command="cd contracts && forge script script/ens/EnsStatusRole.s.sol --rpc-url $SEPOLIA_RPC_URL" />
    </div>
  );
}
