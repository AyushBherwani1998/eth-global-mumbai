"use client";

// Issuer console, one listing (UX.md 3.9). Three sections, in this order:
//   Listing      the lifecycle stepper, plain-English step names (issuer)
//   Trading rule read-only policy state, plus the commands that change it
//   Developer    collapsed: addresses, Q96 maths, receipts
//
// Nothing in this screen writes to a chain and nothing in it drives Chainlink
// CRE. CRE runs from the command line for the demo (cre/README.md), so every
// step that needs a transaction shows the command instead of a button that
// would only pretend. The trading rule comes from `GET /v1/policy/:ticker`
// (services/api/README.md) or says plainly that it could not be read.

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { CommandBlock, ConsoleShell, ConsoleSignIn, GateLine, NotTheOwner } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { modeWords, usePolicy, type PolicyView } from "@/components/console/policy";
import { apiConfigured, errorTitle } from "@/lib/api";
import { ErrorCard, SkeletonList } from "@/components/states";
import { PriceChart } from "@/components/time-chart";
import { TickerMark } from "@/components/company/logos";
import { Button, Card, CopyAddress, Details, KV, ProgressBar, SectionTitle, TextLink, TickerLogo, cx, statusLabel } from "@/components/ui";
import { blockNo, dateTimeIST, lotFixed, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { CONSOLE, CURRENT_BLOCK, OFFER, USDC_ADDRESS, ensName, getClearing, getIpo, getMarket, type Ipo } from "@/lib/mock";

// ---------------------------------------------------------------------------
// Lifecycle steps. Ids match mock/console.json; the titles are plain English.
// ---------------------------------------------------------------------------

type StepId = "create" | "ticker" | "policy" | "launch" | "monitor" | "graduate";
const STEPS: { id: StepId; title: string; sub: string }[] = [
  {
    id: "create",
    title: "Create the listing",
    sub: "Shares, issue price and the rules of the sale.",
  },
  {
    id: "ticker",
    title: "Register the name",
    sub: "Your company name on Thamba, and what it points to.",
  },
  {
    id: "policy",
    title: "Publish the trading rule",
    sub: "The price limits the exchange will enforce.",
  },
  {
    id: "launch",
    title: "Open the IPO",
    sub: "People can apply from this moment.",
  },
  {
    id: "monitor",
    title: "Watch applications",
    sub: "Price, money raised and who applied.",
  },
  {
    id: "graduate",
    title: "List on the market",
    sub: "Opens trading at the final price.",
  },
];

type ConsoleData = {
  step: StepId | "demo";
  steps: Record<string, { done: boolean; tx?: string; [k: string]: unknown }>;
  bids?: {
    owner: string;
    budget: number;
    maxPrice: number;
    state: string;
    reason?: string;
  }[];
};

const q96 = (lotPrice: number) => (((lotPrice / 1000) * 1e6) / 1e18) * 2 ** 96;
const sci = (n: number) => n.toExponential(3).replace("e+", " × 10^");

export function ConsoleScreen({ ticker }: { ticker: string }) {
  const { ready, connected, listings } = useIssuerSession();
  const ipo = getIpo(ticker)!;

  if (!ready) return <SkeletonList rows={4} className="pt-6" />;
  if (!connected) return <ConsoleSignIn />;
  if (!listings.includes(ticker)) return <NotTheOwner ticker={ticker} />;

  return <IssuerConsole ipo={ipo} data={(CONSOLE as unknown as Record<string, ConsoleData>)[ticker]} />;
}

// ---------------------------------------------------------------------------
// Shell: header, live card, three sections, desktop three columns.
// ---------------------------------------------------------------------------

function IssuerConsole({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const firstOpen = (STEPS.find((s) => s.id === data.step)?.id ?? STEPS.find((s) => !data.steps[s.id]?.done)?.id ?? "graduate") as StepId;
  const [open, setOpen] = useState<StepId | null>(firstOpen);
  const market = getMarket(ipo.ticker);

  const stepContent = (id: StepId) => {
    switch (id) {
      case "create":
        return <CreateStep ipo={ipo} />;
      case "ticker":
        return <TickerStep ipo={ipo} />;
      case "policy":
        return <PolicyStep ipo={ipo} data={data} />;
      case "launch":
        return <LaunchStep data={data} />;
      case "monitor":
        return <MonitorStep ipo={ipo} data={data} />;
      case "graduate":
        return <GraduateStep ipo={ipo} data={data} />;
    }
  };

  const live = <LiveCard ipo={ipo} />;
  const liveInset = <LiveCard ipo={ipo} inset />;

  return (
    <ConsoleShell>
      <div>
        <header className="flex items-start gap-3 border-b border-line py-5">
          <TickerLogo ipo={ipo} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="t-page-title text-text">{ipo.name}</h1>
            <p className="t-label truncate">
              <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {ensName(ipo.ticker)} · {statusLabel(ipo)}
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
                    <StepCircle done={!!data.steps[s.id]?.done} n={i + 1} current={open === s.id} />
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
                      <StepCircle done={!!data.steps[s.id]?.done} n={i + 1} current={isOpen} />
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
                <p className="t-section-title text-text">{STEPS.find((s) => s.id === open)!.title}</p>
                <p className="t-label mb-3">{STEPS.find((s) => s.id === open)!.sub}</p>
                {stepContent(open)}
              </div>
            )}

            <TradingRulePanel ipo={ipo} />

            <SectionTitle>Developer</SectionTitle>
            <Details title="Addresses, maths and receipts">
              <DeveloperPanel ipo={ipo} data={data} />
            </Details>
          </div>

          {/* Desktop right rail */}
          <aside className="hidden lg:sticky lg:top-20 lg:block">
            <p className="t-section-title mb-2 text-text">Live</p>
            {liveInset}
            {market ? (
              <Card className="mt-3 p-4">
                <p className="t-label">Price today</p>
                <PriceChart data={market.prices.slice(-120)} kind="market" height={140} digits={2} readout={false} labels={false} />
              </Card>
            ) : getClearing(ipo.ticker).length > 0 ? (
              <Card className="mt-3 p-4">
                <p className="t-label">Price so far</p>
                <PriceChart
                  data={getClearing(ipo.ticker).map((p) => ({
                    time: p.time,
                    value: p.price,
                  }))}
                  kind="clearing"
                  baseline={OFFER.issuePrice}
                  height={140}
                  digits={2}
                  readout={false}
                  labels={false}
                />
              </Card>
            ) : null}
          </aside>
        </div>

        <p className="t-caption mt-8 border-t border-line pt-4">
          Prices and amounts in USDC per 1,000 shares. The listing figures on this page are sample data, not live chain
          reads. The trading rule is read from the chain when the backend is connected.
        </p>
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

function LiveCard({ ipo, inset }: { ipo: Ipo; inset?: boolean }) {
  const market = getMarket(ipo.ticker);
  const last = market ? market.prices[market.prices.length - 1].value : ipo.clearingPrice;
  const raised = ipo.raised ?? 0;
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
        <ProgressBar value={raised} max={OFFER.targetRaise} marker={OFFER.requiredRaise} />
        <p className="num t-label mt-2">
          {usdc(raised)} of {OFFER.targetRaise} USDC raised · lists at {OFFER.requiredRaise}
        </p>
      </div>
      <p className="t-caption mt-3">Sample data.</p>
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

function CreateStep({ ipo }: { ipo: Ipo }) {
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
        <KV k="Shares in total" v={shares(OFFER.totalSupply)} />
        <KV k="Shares offered in the IPO" v={shares(OFFER.auctioned)} sub={`${shares(OFFER.lpReserve)} kept for the market`} />
        <KV k="Issue price" v={`${lotFixed(OFFER.issuePrice)} per 1,000 shares`} />
        <KV k="Price range" v={`${lotFixed(OFFER.floorPrice)} to ${lotFixed(OFFER.capPrice)}`} />
        <KV k="Most one wallet can apply with" v={`${OFFER.perApplicantCap} USDC`} sub="Counted per wallet, across all of its applications" />
        <KV k="Share of the raise kept as liquidity" v={`${OFFER.lpPercent}%`} />
        <KV k="Minimum raise to list" v={`${OFFER.requiredRaise} of ${OFFER.targetRaise} USDC`} />
        <KV k="Who can apply" v="Anyone with a wallet" sub="No identity check, no KYC" />
        <KV k="Money is taken in" v="Sepolia test USDC" />
      </div>
      <RunsFromTheCommandLine command="cd contracts && make deploy" note="Writes the listing into contracts/deployments/<network>.json." />
    </Card>
  );
}

const RECORD_LABEL: Record<string, string> = {
  addr: "Share token",
  auction: "IPO contract",
  pool: "Market",
  hook: "Rule enforcer",
  policy: "Rule publisher",
};

function TickerStep({ ipo }: { ipo: Ipo }) {
  return (
    <Card className="p-4">
      <p className="t-body text-text">{ensName(ipo.ticker)}</p>
      <p className="t-label mt-1">People find this company by that name, and the app reads every address below from it.</p>
      <div className="mt-3 divide-y divide-line">
        {(["addr", "auction", "pool", "hook", "policy"] as const).map((k) => (
          <KV key={k} k={RECORD_LABEL[k]} v={<CopyAddress value={ipo.records[k]} />} />
        ))}
        <KV k="Trading status" v={ipo.status} sub="Set by the exchange, not by you" />
      </div>
      <RunsFromTheCommandLine
        command="cd contracts && make ens-sepolia"
        note="Registers the name, writes the records, and lets the exchange write the trading status."
      />
      <p className="mt-2">
        <TextLink href={`https://sepolia.app.ens.domains/${ensName(ipo.ticker)}`}>View in the ENS app</TextLink>
      </p>
    </Card>
  );
}

function PolicyStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const m = getMarket(ipo.ticker);
  const ref = m?.policy.referencePrice ?? ipo.clearingPrice ?? OFFER.issuePrice;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Reference price" v={`${lotFixed(ref)} per 1,000 shares`} />
        <KV k="Normal day" v="Trades within 20% of the reference price" />
        <KV k="Under watch" v="Trades within 5% of the reference price" />
        <KV k="Listing day" v="Trades within 5% of the price the IPO closed at" />
      </div>
      <p className="t-body mt-3 text-text-2">
        The rule in force right now, and the commands that change it, are under &ldquo;Trading rule&rdquo; further down this page.
      </p>
      {typeof data.steps.policy?.tx === "string" && (
        <p className="mt-1">
          <TextLink href={txUrl(data.steps.policy.tx as string)}>View receipt</TextLink>
        </p>
      )}
    </Card>
  );
}

function LaunchStep({ data }: { data: ConsoleData }) {
  const done = !!data.steps.launch?.done;
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Shares on offer" v={shares(OFFER.auctioned)} />
        <KV k="Issue price" v={lotFixed(OFFER.issuePrice)} />
        <KV k="Price range" v={`${lotFixed(OFFER.floorPrice)} to ${lotFixed(OFFER.capPrice)}`} />
        <KV k="Minimum raise to list" v={`${OFFER.requiredRaise} USDC`} />
      </div>
      {done && (
        <>
          <p className="t-body mt-3 text-text">The IPO is open. The contract address is written to your name.</p>
          {typeof data.steps.launch?.tx === "string" && (
            <p className="mt-1">
              <TextLink href={txUrl(data.steps.launch.tx as string)}>View receipt</TextLink>
            </p>
          )}
        </>
      )}
      <RunsFromTheCommandLine command="cd contracts && make launch" note="Opens the sale and writes the IPO contract address to the name." />
    </Card>
  );
}

function MonitorStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const s = (data.steps.monitor ?? {}) as Record<string, number | boolean>;
  const series = getClearing(ipo.ticker);
  const last = series[series.length - 1];
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
            baseline={OFFER.issuePrice}
            height={140}
            digits={2}
            readout={false}
            labels={false}
          />
        </>
      )}
      <div className="mt-3 divide-y divide-line">
        <KV k="Raised" v={`${usdc(last ? last.raised : (ipo.raised ?? 0))} USDC`} sub={`${OFFER.requiredRaise} needed to list`} />
        <KV k="Applications" v={String(s.bidCount ?? ipo.bidCount ?? 0)} />
        <KV k="Wallets that applied" v={String(ipo.applicants ?? 0)} />
        <KV k="Applications rejected" v={String(s.rejectedBids ?? 0)} sub="Over the per-wallet limit, or priced above the cap" />
      </div>
      {data.bids && (
        <div className="mt-4">
          <p className="t-list-title text-text">Applications</p>
          <ul className="mt-1 divide-y divide-line">
            {data.bids.map((b, i) => (
              <li key={i} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <span className="num t-mono truncate text-text-2">{b.owner}</span>
                <span className="num t-body text-text">
                  {usdc(b.budget)} up to {lotFixed(b.maxPrice)}
                </span>
                <span
                  className={cx(
                    "t-change-sm shrink-0",
                    b.state === "rejected" ? "text-loss-text" : b.state === "outbid" ? "text-text-2" : "text-gain-text",
                  )}
                >
                  {b.state === "rejected" ? "Rejected" : b.state === "outbid" ? "Below the price" : "Likely allotted"}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-caption mt-2">Sample data.</p>
        </div>
      )}
    </Card>
  );
}

function GraduateStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const g = (data.steps.graduate ?? {}) as Record<string, unknown>;
  if (!g.done)
    return (
      <Card className="p-4">
        <p className="t-body text-text">
          Opens when the IPO closes at block {blockNo(ipo.endBlock ?? CURRENT_BLOCK)}. The shares list if the IPO raised at least{" "}
          {OFFER.requiredRaise} USDC; otherwise every application is refunded and there is nothing to list.
        </p>
        <RunsFromTheCommandLine command="cd contracts && make settle" note="Only works once the IPO has closed." />
      </Card>
    );
  return (
    <Card className="p-4">
      <div className="divide-y divide-line">
        <KV k="Reached the minimum" v={g.graduated ? "Yes" : "No"} />
        <KV k="Final price" v={`${lotFixed(g.clearingPrice as number)} per 1,000 shares`} />
        <KV k="Unsold shares" v={`${shares(Number(g.unsold ?? 0))} returned to your treasury`} />
      </div>
      <p className="t-body mt-3 text-text">The market is open at the final price, and the market address is written to your name.</p>
      {typeof g.migrateTx === "string" && (
        <p className="mt-1">
          <TextLink href={txUrl(g.migrateTx)}>View receipt</TextLink>
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trading rule: read-only policy state, and the commands that change it.
// ---------------------------------------------------------------------------

function TradingRulePanel({ ipo }: { ipo: Ipo }) {
  const { data, error, loading, refreshing, retry, updatedAt } = usePolicy(ipo.ticker);

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

function DeveloperPanel({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  return (
    <div>
      <div className="divide-y divide-line">
        <KV k="floorPriceQ96" v={sci(q96(OFFER.floorPrice))} mono />
        <KV k="capPriceQ96" v={sci(q96(OFFER.capPrice))} mono />
        <KV k="requiredCurrencyRaised" v={`${OFFER.requiredRaise}e6`} mono />
        <KV k="Token order" v="USDC is currency0 · buys are zeroForOne" mono />
        <KV k="Quote currency" v={<CopyAddress value={USDC_ADDRESS} />} />
        <KV k="Auction" v={<CopyAddress value={ipo.records.auction} />} />
        <KV k="Pool" v={<CopyAddress value={ipo.records.pool} />} />
        <KV k="Hook" v={<CopyAddress value={ipo.records.hook} />} />
        <KV k="Policy" v={<CopyAddress value={ipo.records.policy} />} />
        <KV k="Backend" v={apiConfigured() ? "Configured" : "Not configured"} sub="services/api, read only" />
        {Object.entries(data.steps).map(([k, v]) =>
          typeof v?.tx === "string" ? <KV key={k} k={`${k} tx`} v={<TextLink href={txUrl(v.tx)}>{shortHash(v.tx)}</TextLink>} /> : null,
        )}
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
