"use client";

// Issuer console, one listing (UX.md 3.9). Three sections, in this order:
//   Listing      the lifecycle stepper, plain-English step names (issuer)
//   Exchange desk  reference price, rule mode, halt / resume, liquidity (operator)
//   Developer    collapsed: runner log, tx hashes, Q96 maths, addresses
// Own header: Back, logo, name, ENS name, runner status. Desktop: three columns.

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { useApp } from "@/components/providers";
import { ConsoleShell, ConsoleSignIn, RunnerStatus } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { CircuitBanner } from "@/components/circuit-banner";
import { PriceChart } from "@/components/time-chart";
import { TickerMark } from "@/components/company/logos";
import { Button, Card, CopyAddress, Details, KV, ProgressBar, SectionTitle, TextLink, TickerLogo, cx, statusLabel } from "@/components/ui";
import { blockNo, dateTimeIST, lotFixed, shares, shortHash, timeIST, txUrl, usdc } from "@/lib/format";
import { CONSOLE, CURRENT_BLOCK, OFFER, USDC_ADDRESS, ensName, getClearing, getIpo, getMarket, type Ipo, type Mode, type Policy } from "@/lib/mock";
import { SURVEILLANCE_BAND_BPS, band, bandDigits, bandText } from "@/lib/policy";

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
  runnerLog: { time: string; line: string }[];
};

const q96 = (lotPrice: number) => (((lotPrice / 1000) * 1e6) / 1e18) * 2 ** 96;
const sci = (n: number) => n.toExponential(3).replace("e+", " × 10^");

export function ConsoleScreen({ ticker }: { ticker: string }) {
  const { session } = useIssuerSession();
  const ipo = getIpo(ticker)!;

  if (!session) return <ConsoleSignIn />;

  if (!session.listings.includes(ticker))
    return (
      <ConsoleShell>
        <h1 className="t-page-title mt-6">{ipo.name}</h1>
        <p className="t-body mt-2 text-text-2">
          This console is for the owner of {ensName(ticker)}. Sign out and connect the wallet that owns that name to manage this listing.
        </p>
      </ConsoleShell>
    );

  return <IssuerConsole ipo={ipo} data={(CONSOLE as unknown as Record<string, ConsoleData>)[ticker]} />;
}

// ---------------------------------------------------------------------------
// Shell: header, live card, three sections, desktop three columns.
// ---------------------------------------------------------------------------

function IssuerConsole({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const firstOpen = (STEPS.find((s) => s.id === data.step)?.id ?? STEPS.find((s) => !data.steps[s.id]?.done)?.id ?? "graduate") as StepId;
  const [open, setOpen] = useState<StepId | null>(firstOpen);
  const [deskLog, setDeskLog] = useState(data.runnerLog);
  const market = getMarket(ipo.ticker);
  const online = CONSOLE.runnerOnline;

  const stepContent = (id: StepId) => {
    switch (id) {
      case "create":
        return <CreateStep ipo={ipo} />;
      case "ticker":
        return <TickerStep ipo={ipo} data={data} />;
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
        <header className="flex items-start gap-3 pt-6">
          <TickerLogo ipo={ipo} size={40} />
          <div className="min-w-0 flex-1">
            <h1 className="t-page-title text-text">{ipo.name}</h1>
            <p className="t-label truncate">
              <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {ensName(ipo.ticker)} · {statusLabel(ipo)}
            </p>
          </div>
          <RunnerStatus className="shrink-0 pt-1" />
        </header>
        {!online && <p className="t-label mt-1">Exchange actions need the CRE runner on the demo laptop.</p>}

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)_360px] lg:items-start lg:gap-6">
          {/* Desktop step rail */}
          <nav className="hidden lg:block" aria-label="Listing steps">
            <p className="t-section-title mt-6 mb-3">Listing</p>
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
              <p className="t-label">What you, the company, do to bring the shares to market.</p>
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
                <p className="t-list-title mt-4 text-text">{STEPS.find((s) => s.id === open)!.title}</p>
                <p className="t-label mb-3">{STEPS.find((s) => s.id === open)!.sub}</p>
                {stepContent(open)}
              </div>
            )}

            <ExchangeDesk ipo={ipo} online={online} onLog={(l) => setDeskLog((cur) => [...cur, l])} />

            <SectionTitle>Developer</SectionTitle>
            <Details title="Runner log, addresses and maths">
              <DeveloperPanel ipo={ipo} data={data} log={deskLog} />
            </Details>
          </div>

          {/* Desktop right rail */}
          <aside className="hidden lg:sticky lg:top-20 lg:block">
            {liveInset}
            {market ? (
              <Card className="mt-4 p-4">
                <p className="t-label">Price today</p>
                <PriceChart data={market.prices.slice(-120)} kind="market" height={140} digits={2} readout={false} labels={false} />
              </Card>
            ) : getClearing(ipo.ticker).length > 0 ? (
              <Card className="mt-4 p-4">
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
            <Card className="mt-4 p-4">
              <p className="t-label">Last runner lines</p>
              <div className="t-mono mt-2 space-y-1 text-text">
                {deskLog.slice(-5).map((l, i) => (
                  <p key={i} className="truncate">
                    <span className="text-text-2">{timeIST(l.time).replace(" IST", "")}</span> {l.line}
                  </p>
                ))}
                {deskLog.length === 0 && <p className="t-label">Nothing yet.</p>}
              </div>
            </Card>
          </aside>
        </div>
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
    <>
      <Card className="mt-4 p-4">
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
      </Card>
      {market &&
        (inset ? (
          <div className="mt-4 overflow-hidden px-5">
            <CircuitBanner ticker={ipo.ticker} policy={market.policy} />
          </div>
        ) : (
          <CircuitBanner ticker={ipo.ticker} policy={market.policy} className="mt-4" />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Listing steps
// ---------------------------------------------------------------------------

function CreateStep({ ipo }: { ipo: Ipo }) {
  const { sendTx } = useApp();
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
        <KV k="Most one person can apply with" v={`${OFFER.perApplicantCap} USDC`} />
        <KV k="Share of the raise kept as liquidity" v={`${OFFER.lpPercent}%`} />
        <KV k="Minimum raise to list" v={`${OFFER.requiredRaise} of ${OFFER.targetRaise} USDC`} />
        <KV k="One application per person" v={ipo.eligibility === "human" ? "On" : "Off"} sub="Fixed once the IPO opens" />
        <KV k="Money is taken in" v="Sepolia test USDC" />
      </div>
      <Button
        variant="secondary"
        className="mt-4 w-full sm:w-auto sm:min-w-[160px]"
        onClick={() =>
          sendTx({
            title: "Saving your draft",
            success: "Draft saved",
            delayMs: 400,
          })
        }
      >
        Save draft
      </Button>
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

function TickerStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const { sendTx } = useApp();
  const st = data.steps.ticker;
  return (
    <Card className="p-4">
      <p className="t-body text-text">
        {ensName(ipo.ticker)} <span className="text-gain-text">is registered to you</span>
      </p>
      <p className="t-label mt-1">People find this company by that name, and the app reads every address below from it.</p>
      <div className="mt-3 divide-y divide-line">
        {(["addr", "auction", "pool", "hook", "policy"] as const).map((k) => (
          <KV key={k} k={RECORD_LABEL[k]} v={<CopyAddress value={ipo.records[k]} />} />
        ))}
        <KV k="Trading status" v={ipo.status} sub="Set by the exchange, not by you" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          variant="secondary"
          onClick={() =>
            sendTx({
              title: "Saving the name records",
              success: "Records saved",
            })
          }
        >
          Save records
        </Button>
        <Button variant="secondary" disabled={!!st.roleGranted}>
          {st.roleGranted ? "Exchange can write the status" : "Let the exchange write the status"}
        </Button>
      </div>
      <p className="t-label mt-2">The exchange needs that permission to mark this share as under watch or halted.</p>
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
      <p className="t-body mt-3 text-text">Published. The exchange now writes the trading status onto your name.</p>
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
      {done ? (
        <>
          <p className="t-body mt-3 text-text">The IPO is open. The contract address is written to your name.</p>
          {typeof data.steps.launch?.tx === "string" && (
            <p className="mt-1">
              <TextLink href={txUrl(data.steps.launch.tx as string)}>View receipt</TextLink>
            </p>
          )}
        </>
      ) : (
        <Button className="mt-4 w-full sm:w-auto sm:min-w-[160px]">Open the IPO</Button>
      )}
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
        <KV k="People" v={String(s.uniqueHumans ?? ipo.applicants ?? 0)} />
        <KV k="Verifications issued" v={String(s.passesIssued ?? 0)} />
        <KV k="Second-account attempts turned away" v={String(s.secondWalletDenials ?? 0)} />
        <KV k="Applications rejected" v={String(s.rejectedBids ?? 0)} />
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
        <Button className="mt-4 w-full sm:w-auto sm:min-w-[160px]" disabled>
          Open the market
        </Button>
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
// Exchange desk (operator): reference price, rule mode, halt, liquidity.
// ---------------------------------------------------------------------------

type DeskPhase = {
  label: string;
  done?: boolean;
  tx?: string;
  status?: string;
} | null;

function ExchangeDesk({ ipo, online, onLog }: { ipo: Ipo; online: boolean; onLog: (l: { time: string; line: string }) => void }) {
  const { sendTx } = useApp();
  const m = getMarket(ipo.ticker);
  const [policy, setPolicy] = useState<Policy | undefined>(m?.policy);
  const [ref, setRef] = useState(String(m?.policy.referencePrice ?? ""));
  const [phase, setPhase] = useState<DeskPhase>(null);
  const [running, setRunning] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  if (!policy)
    return (
      <>
        <SectionTitle>Exchange desk</SectionTitle>
        <p className="t-body text-text-2">These controls open once the shares are listed on the market.</p>
      </>
    );

  const tickerStatus = (p: Policy) => (p.halted ? "halted" : p.mode === "surveillance" || p.mode === "directional" ? "under watch" : "listed");

  const run = (next: Policy, what: string) => {
    if (!online || running) return;
    setRunning(true);
    const now = () => new Date().toISOString();
    const tx = `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
    const lines = [
      `Editing exchange JSON: ${ipo.ticker} → ${what}`,
      "cre workflow simulate --broadcast --non-interactive --trigger-index 0",
      `Report signed · v${next.version}`,
      `Broadcast tx ${shortHash(tx)} · ReportProcessed result=true`,
      `ENS ${ensName(ipo.ticker)} listingday.status = ${tickerStatus(next)}`,
    ];
    setPhase({ label: "Signing the exchange notice" });
    lines.forEach((line, i) => {
      setTimeout(
        () => {
          onLog({ time: now(), line });
          if (i === 1) setPhase({ label: "Broadcasting the notice" });
          if (i === 3) setPolicy({ ...next, since: now(), asOf: now(), creTx: tx });
          if (i === lines.length - 1) {
            setPhase({
              label: "Applied",
              done: true,
              tx,
              status: tickerStatus(next),
            });
            setRunning(false);
          }
        },
        500 + i * 600,
      );
    });
  };

  const setMode = (mode: Mode, halted = false) => {
    const bandBps = mode === "listing" || mode === "surveillance" ? 500 : 2000;
    run({ ...policy, version: policy.version + 1, mode, halted, bandBps }, halted ? "halt" : `mode=${mode}`);
  };

  const d = bandDigits(policy.referencePrice, policy.bandBps);
  const { lo, hi } = band(policy.referencePrice, policy.bandBps);
  const ruleNow = policy.halted
    ? "Trading is halted."
    : policy.mode === "directional"
      ? `Trades toward ${lotFixed(policy.referencePrice)} go through between ${lotFixed(lo, d)} and ${lotFixed(hi, d)}; moves away from it stop at ${bandText(policy.referencePrice, SURVEILLANCE_BAND_BPS)}.`
      : `Trades allowed between ${lotFixed(lo, d)} and ${lotFixed(hi, d)}.`;

  const controls: {
    label: string;
    consequence: string;
    onClick: () => void;
    variant?: "secondary" | "danger";
    disabled?: boolean;
  }[] = [
    {
      label: "Normal day",
      consequence: "Trades within 20% of the reference price go through.",
      onClick: () => setMode("normal"),
    },
    {
      label: "Under watch",
      consequence: "Tightens the limit to 5% around the reference price.",
      onClick: () => setMode("surveillance"),
    },
    {
      label: "One-way day",
      consequence: "Trades that push the price further from the reference stop at 5% from it. Trades toward it go through within 20%.",
      onClick: () => setMode("directional"),
    },
    {
      label: "Halt trading",
      consequence: "Stops buying and selling at once. Liquidity can still be withdrawn.",
      onClick: () => setMode(policy.mode, true),
      variant: "danger",
    },
  ];

  return (
    <>
      <SectionTitle>Exchange desk</SectionTitle>
      <p className="t-label">What the exchange does to keep trading orderly. Every action is published to everyone.</p>

      <Card className="mt-3 p-4">
        <p className="t-list-title text-text">Reference price</p>
        <p className="t-label mt-0.5">Today&apos;s limits are measured from this price. {ruleNow}</p>
        <div className="mt-3 flex gap-3">
          <input
            inputMode="decimal"
            value={ref}
            onChange={(e) => setRef(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Reference price in USDC per 1,000 shares"
            className="field num t-input-value h-12 w-full min-w-0 rounded-[10px] bg-transparent px-3 text-text"
          />
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={!online || running || !ref}
            onClick={() =>
              run(
                {
                  ...policy,
                  version: policy.version + 1,
                  referencePrice: Number(ref),
                },
                `ref=${ref}`,
              )
            }
          >
            Update
          </Button>
        </div>
      </Card>

      <Card className="mt-3 p-4">
        <p className="t-list-title text-text">Trading rule</p>
        <p className="t-label mt-0.5">In force now: {ruleNow}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {controls.map((c) => (
            <div key={c.label}>
              <Button variant={c.variant ?? "secondary"} className="w-full sm:w-auto sm:min-w-[160px]" disabled={!online || running} onClick={c.onClick}>
                {c.label}
              </Button>
              <p className="t-label mt-1">{c.consequence}</p>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              className="w-full sm:w-auto sm:min-w-[160px]"
              disabled={!online || running || !policy.halted}
              onClick={() =>
                run(
                  {
                    ...policy,
                    version: policy.version + 1,
                    halted: false,
                    mode: policy.mode === "halted" ? "normal" : policy.mode,
                  },
                  "resume",
                )
              }
            >
              Resume trading
            </Button>
            <p className="t-label mt-1">Lets buying and selling start again. Only available while trading is halted.</p>
          </div>
        </div>
        {phase && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="t-body text-text">{phase.done ? `Applied · ticker status now: ${phase.status}` : `${phase.label}…`}</p>
            {phase.tx && (
              <p className="mt-1">
                <TextLink href={txUrl(phase.tx)}>View receipt</TextLink>
              </p>
            )}
          </div>
        )}
        {!online && <p className="t-label mt-3 text-loss-text">Exchange actions need the CRE runner on the demo laptop.</p>}
      </Card>

      <Card className="mt-3 p-4">
        <p className="t-list-title text-text">Liquidity in the market</p>
        <p className="t-label mt-0.5">{m ? `${usdc(m.liquidity.usdc)} USDC + ${shares(m.liquidity.shares)} shares` : "Not open yet"}</p>
        <Button
          variant="secondary"
          className="mt-3 w-full sm:w-auto sm:min-w-[200px]"
          disabled={withdrawn}
          onClick={async () => {
            const r = await sendTx({
              title: "Withdrawing liquidity",
              success: "Liquidity withdrawn",
            });
            if (r.ok) setWithdrawn(true);
          }}
        >
          {withdrawn ? "Withdrawn" : "Withdraw liquidity"}
        </Button>
        <p className="t-label mt-2">Takes the USDC and shares back out of the market. Works even while trading is halted.</p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Developer (collapsed): protocol words live here and nowhere else.
// ---------------------------------------------------------------------------

function DeveloperPanel({ ipo, data, log }: { ipo: Ipo; data: ConsoleData; log: { time: string; line: string }[] }) {
  const { sendTx } = useApp();
  const m = getMarket(ipo.ticker);
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
        {m && <KV k="Policy version" v={`v${m.policy.version} · ${modeWord(m.policy)}`} mono />}
        {m && <KV k="Report receipt" v={<TextLink href={txUrl(m.policy.creTx)}>{shortHash(m.policy.creTx)}</TextLink>} />}
        {Object.entries(data.steps).map(([k, v]) =>
          typeof v?.tx === "string" ? <KV key={k} k={`${k} tx`} v={<TextLink href={txUrl(v.tx)}>{shortHash(v.tx)}</TextLink>} /> : null,
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          variant="danger"
          onClick={() =>
            sendTx({
              title: "Receiver tries to set url",
              revert: "EACUnauthorizedAccountRoles",
              revertTitle: "The exchange could not write that record",
              revertDetail: "The receiver only holds ROLE_SET_TEXT for listingday.status. This denial is the expected result.",
            })
          }
        >
          Test role denial
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            sendTx({
              title: "Sweeping unsold tokens",
              success: "Nothing left to sweep",
            })
          }
        >
          Sweep unsold tokens
        </Button>
      </div>

      <p className="t-list-title mt-4 text-text">Runner log</p>
      <div className="t-mono mt-2 rounded-[8px] bg-surface-2 p-3 text-text">
        {log.length === 0 && <p className="text-text-2">No lines yet.</p>}
        {log.map((l, i) => (
          <p key={i}>
            <span className="text-text-2">{timeIST(l.time).replace(" IST", "")}</span> {l.line}
          </p>
        ))}
      </div>
      {m && <p className="t-caption mt-2">Last report {dateTimeIST(m.policy.asOf)}.</p>}
    </div>
  );
}

function modeWord(p: Policy) {
  return p.halted ? "halted" : p.mode;
}
