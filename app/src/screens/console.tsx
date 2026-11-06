"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ExternalLink, Terminal } from "lucide-react";
import { DetailBar } from "@/components/shell";
import { CircuitBanner } from "@/components/circuit-banner";
import { PriceChart } from "@/components/time-chart";
import { Button, Card, CopyAddress, FilterChip, KV, Pill, TickerAvatar, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { blockNo, lotFixed, shortAddr, shortHash, shares, timeIST, txUrl, usdc } from "@/lib/format";
import { CONSOLE, OFFER, USDC_ADDRESS, ensName, getClearing, getIpo, getMarket, type Ipo, type Mode, type Policy } from "@/lib/mock";
import { modeInfo } from "@/lib/policy";
import { BottomSpacer } from "./common";

type StepId = "create" | "ticker" | "policy" | "launch" | "monitor" | "graduate" | "demo";
const STEPS: { id: StepId; title: string }[] = [
  { id: "create", title: "Create listing" },
  { id: "ticker", title: "Register ENS ticker" },
  { id: "policy", title: "Publish policy (CRE)" },
  { id: "launch", title: "Launch auction" },
  { id: "monitor", title: "Monitor" },
  { id: "graduate", title: "Graduate" },
  { id: "demo", title: "Demo controls" },
];

type ConsoleData = {
  step: StepId;
  steps: Record<string, { done: boolean; tx?: string; [k: string]: unknown }>;
  bids?: { owner: string; budget: number; maxPrice: number; state: string; reason?: string }[];
  runnerLog: { time: string; line: string }[];
};

const q96 = (lotPrice: number) => (lotPrice / 1000) * 1e6 / 1e18 * 2 ** 96;
const sci = (n: number) => n.toExponential(3).replace("e+", " × 10^");

export function ConsoleScreen({ ticker }: { ticker: string }) {
  const { isIssuerFor, connected } = useApp();
  const ipo = getIpo(ticker)!;

  if (!connected || !isIssuerFor.includes(ticker))
    return (
      <>
        <DetailBar fallback="/console" />
        <div className="py-6">
          <p className="t-list-title text-text">This console is for the owner of {ensName(ticker)}</p>
          <p className="t-body mt-1 text-text-2">Sign in with the wallet {shortAddr(ipo.records.addr)} to manage this listing.</p>
        </div>
      </>
    );

  return <IssuerConsole ipo={ipo} data={(CONSOLE as unknown as Record<string, ConsoleData>)[ticker]} />;
}

function IssuerConsole({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const { isIssuerFor } = useApp();
  const [open, setOpen] = useState<StepId>(data.step);
  const currentIdx = STEPS.findIndex((s) => s.id === data.step);

  return (
    <>
      <DetailBar fallback="/console" />
      <main>
        <h1 className="t-page-title mb-3">Console</h1>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {isIssuerFor.map((t) => (
            <Link key={t} href={`/console/${t}`}>
              <FilterChip active={t === ipo.ticker}>{getIpo(t)!.symbol}</FilterChip>
            </Link>
          ))}
        </div>
        <Card className="mt-3 flex items-center gap-3 p-3">
          <TickerAvatar ipo={ipo} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-text">{ipo.name}</p>
            <p className="text-[13px] text-text-2">{ensName(ipo.ticker)}</p>
          </div>
          <Pill tone={CONSOLE.runnerOnline ? "gain" : "loss"} dot={CONSOLE.runnerOnline}>
            {CONSOLE.runnerOnline ? "Runner online" : "Runner offline"}
          </Pill>
        </Card>

        <ol className="mt-4">
          {STEPS.map((s, i) => {
            const done = s.id === "demo" ? false : data.steps[s.id]?.done;
            const reachable = i <= currentIdx || done;
            const isOpen = open === s.id;
            return (
              <li key={s.id} className="relative pl-10">
                {i < STEPS.length - 1 && <span className={cx("absolute top-8 bottom-0 left-[13px] w-0.5", done ? "bg-gain" : "bg-line")} />}
                <span
                  className={cx(
                    "absolute top-3 left-0 flex size-7 items-center justify-center rounded-full text-[13px] font-medium",
                    done ? "bg-gain text-white" : i === currentIdx ? "bg-strong text-bg" : "bg-surface-2 text-text-2",
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <button
                  disabled={!reachable}
                  onClick={() => setOpen(isOpen ? ("" as StepId) : s.id)}
                  className="flex w-full items-center justify-between py-3.5 text-left disabled:opacity-50"
                >
                  <span className={cx("text-[15px] font-medium", i === currentIdx ? "text-text" : "text-text")}>{s.title}</span>
                  <ChevronDown className={cx("size-4 text-text-2 transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="pb-4">
                    {s.id === "create" && <CreateStep ipo={ipo} />}
                    {s.id === "ticker" && <TickerStep ipo={ipo} data={data} />}
                    {s.id === "policy" && <PolicyStep ipo={ipo} data={data} />}
                    {s.id === "launch" && <LaunchStep data={data} />}
                    {s.id === "monitor" && <MonitorStep ipo={ipo} data={data} />}
                    {s.id === "graduate" && <GraduateStep ipo={ipo} data={data} />}
                    {s.id === "demo" && <DemoStep ipo={ipo} data={data} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <BottomSpacer />
      </main>
    </>
  );
}

function TxLink({ tx, label = "Sepolia tx" }: { tx?: string; label?: string }) {
  if (!tx) return null;
  return (
    <a href={txUrl(tx)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-gain-text">
      {label} {shortHash(tx)} <ExternalLink className="size-3" />
    </a>
  );
}

function CreateStep({ ipo }: { ipo: Ipo }) {
  const { sendTx } = useApp();
  return (
    <Card className="p-3">
      <div className="divide-y divide-line">
        <KV k="Token" v={`${ipo.name} (${ipo.symbol})`} />
        <KV k="Total supply" v={shares(OFFER.totalSupply)} sub={`${shares(OFFER.auctioned)} auction · ${shares(OFFER.lpReserve)} LP`} />
        <KV k="Issue price" v={`${lotFixed(OFFER.issuePrice)} USDC / lot`} />
        <KV k="Range" v={`80% → ${lotFixed(OFFER.floorPrice)} · 190% → ${lotFixed(OFFER.capPrice)}`} />
        <KV k="Per-applicant cap" v={`${OFFER.perApplicantCap} USDC`} />
        <KV k="Raise to LP" v={`${OFFER.lpPercent}%`} />
        <KV k="Graduation" v={`50% of target · ${OFFER.requiredRaise} of ${OFFER.targetRaise} USDC`} />
        <KV k="Eligibility" v={ipo.eligibility === "human" ? "One human, one application" : "Open"} sub={ipo.eligibility === "human" ? "WorldPassModule" : "AllowAllModule"} />
        <KV k="Quote currency" v="Sepolia USDC" sub={<CopyAddress value={USDC_ADDRESS} />} />
        <KV k="Unsold → " v="Issuer treasury" />
      </div>
      <div className="mt-2 rounded-[8px] bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-text-2">
        <p>floorPriceQ96 ≈ {sci(q96(OFFER.floorPrice))}</p>
        <p>capPriceQ96 &nbsp;≈ {sci(q96(OFFER.capPrice))}</p>
        <p>requiredCurrencyRaised = {OFFER.requiredRaise}e6</p>
        <p>token order: USDC is currency0 (predicted)</p>
      </div>
      <Button tone="neutral" variant="outline" className="mt-3 w-full" onClick={() => sendTx({ title: "Save draft", success: "Draft saved locally", delayMs: 400 })}>
        Save draft
      </Button>
    </Card>
  );
}

function TickerStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const { sendTx } = useApp();
  const st = data.steps.ticker;
  return (
    <Card className="p-3">
      <p className="text-[14px]">
        <b>{ensName(ipo.ticker)}</b> <span className="text-gain-text">· registered</span>
      </p>
      <div className="mt-2 divide-y divide-line">
        {(["addr", "auction", "pool", "hook", "policy"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between py-2">
            <code className="text-[13px] text-text-2">{k === "addr" ? "addr" : `listingday.${k}`}</code>
            <CopyAddress value={ipo.records[k]} label={ipo.records[k] && ipo.records[k]!.length > 42 ? `${ipo.records[k]!.slice(0, 8)}…` : undefined} />
          </div>
        ))}
        <div className="flex items-center justify-between py-2">
          <code className="text-[13px] text-text-2">listingday.status</code>
          <span className="text-[13px] text-text-2">{ipo.status} · receiver-owned</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone="neutral" variant="outline" className="py-2 text-[14px]" onClick={() => sendTx({ title: "Save ENS records", success: "Records saved" })}>
          Save records
        </Button>
        <Button tone="neutral" variant="outline" className="py-2 text-[14px]" disabled={!!st.roleGranted}>
          {st.roleGranted ? "Status role granted ✓" : "Grant status role"}
        </Button>
        <Button
          tone="loss"
          variant="outline"
          className="col-span-2 py-2 text-[14px]"
          onClick={() =>
            sendTx({
              title: "Receiver tries to set url",
              revert: "EACUnauthorizedAccountRoles",
              revertDetail: "The receiver only holds ROLE_SET_TEXT for listingday.status. This is the expected denial.",
            })
          }
        >
          Test role denial (receiver → url)
        </Button>
      </div>
      <TxLink tx={st.tx as string | undefined} label="Register tx" />
    </Card>
  );
}

function RunnerLog({ lines }: { lines: { time: string; line: string }[] }) {
  if (!lines.length) return null;
  return (
    <div className="t-mono mt-3 rounded-[8px] bg-surface-2 p-3 text-text">
      <p className="mb-1 flex items-center gap-1.5 text-text-2">
        <Terminal className="size-3.5" /> CRE runner
      </p>
      {lines.map((l, i) => (
        <p key={i}>
          <span className="text-text-2">{timeIST(l.time).replace(" IST", "")}</span> {l.line}
        </p>
      ))}
    </div>
  );
}

function PolicyStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const m = getMarket(ipo.ticker);
  return (
    <Card className="p-3">
      <div className="divide-y divide-line">
        <KV k="Version" v={`v${data.steps.policy.version}`} />
        <KV k="Reference price" v={`${lotFixed(m?.policy.referencePrice ?? ipo.clearingPrice ?? 1)} USDC / lot`} />
        <KV k="Normal band" v="±20%" />
        <KV k="Surveillance band" v="±5%" />
        <KV k="Listing-day band" v="±5% around clearing" />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gain-text">
        <Check className="size-4" /> Published. ENS status is now <b>{ipo.status}</b>
      </p>
      <TxLink tx={data.steps.policy.tx as string | undefined} label="CRE report" />
      <RunnerLog lines={data.runnerLog} />
    </Card>
  );
}

function LaunchStep({ data }: { data: ConsoleData }) {
  return (
    <Card className="p-3">
      <p className="text-[14px]">
        LiquidityLauncher multicall: <code className="text-[13px]">createToken</code> + <code className="text-[13px]">distribute</code> →
        LBPStrategy → CCA. Then writes <code className="text-[13px]">listingday.auction</code> and status <code>auction</code>.
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gain-text">
        <Check className="size-4" /> Launched
      </p>
      <TxLink tx={data.steps.launch.tx as string | undefined} label="Launch tx" />
    </Card>
  );
}

function MonitorStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const s = data.steps.monitor as Record<string, number | boolean>;
  const series = getClearing(ipo.ticker);
  const last = series[series.length - 1];
  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[14px] text-text-2">Clearing</p>
        <p className="num text-lg font-medium text-text">{lotFixed(last.price)} USDC / lot</p>
      </div>
      <PriceChart data={series.map((p) => ({ time: p.time, value: p.price }))} kind="clearing" baseline={OFFER.issuePrice} height={140} digits={2} readout={false} />
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Mini k="Raised" v={`${usdc(last.raised, 1)}`} sub={`/ ${OFFER.requiredRaise} needed`} />
        <Mini k="Bids" v={String(s.bidCount)} />
        <Mini k="Humans" v={String(s.uniqueHumans)} />
        <Mini k="Passes issued" v={String(s.passesIssued)} />
        <Mini k="2nd-wallet denials" v={String(s.secondWalletDenials)} tone="loss" />
        <Mini k="Rejected bids" v={String(s.rejectedBids)} tone="loss" />
      </div>
      {data.bids && (
        <div className="mt-3">
          <p className="mb-1 text-[13px] font-medium tracking-wide text-text-2 uppercase">Recent bids</p>
          <ul className="divide-y divide-line">
            {data.bids.map((b, i) => (
              <li key={i} className="num flex items-center justify-between py-2 text-[13px]">
                <span className="font-mono text-text-2">{b.owner}</span>
                <span className="text-text">
                  {usdc(b.budget)} @ ≤{lotFixed(b.maxPrice)}
                </span>
                <Pill tone={b.state === "active" ? "brand" : b.state === "outbid" ? "warn" : "loss"}>{b.reason ?? b.state}</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Mini({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "loss" }) {
  return (
    <div className="rounded-[8px] bg-surface-2 px-2 py-2">
      <p className="text-[13px] text-text-2">{k}</p>
      <p className={cx("num font-medium", tone === "loss" ? "text-loss-text" : "text-text")}>{v}</p>
      {sub && <p className="text-[13px] text-text-2">{sub}</p>}
    </div>
  );
}

function GraduateStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const { sendTx } = useApp();
  const g = data.steps.graduate as Record<string, unknown>;
  if (!g.done)
    return (
      <Card className="p-3">
        <p className="text-[14px] text-text-2">
          Opens after block {blockNo(ipo.endBlock!)}. Graduates if raised ≥ {OFFER.requiredRaise} USDC; otherwise refunds open
          and there&apos;s nothing to migrate.
        </p>
        <Button className="mt-3 w-full" disabled>
          Migrate to v4 pool
        </Button>
      </Card>
    );
  return (
    <Card className="p-3">
      <div className="divide-y divide-line">
        <KV k="Graduated" v={g.graduated ? "Yes" : "No"} />
        <KV k="Clearing price" v={`${lotFixed(g.clearingPrice as number)} USDC / lot`} />
        <KV k="Unsold shares" v={`${g.unsold} → treasury`} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-gain-text">
        <Check className="size-4" /> Pool opened at clearing · ENS pool + status written
      </p>
      <div className="flex flex-col">
        <TxLink tx={g.migrateTx as string} label="migrate()" />
        <TxLink tx={g.ensTx as string} label="ENS write" />
      </div>
      <Button tone="neutral" variant="outline" className="mt-3 w-full" onClick={() => sendTx({ title: "Sweep unsold tokens", success: "Nothing left to sweep" })}>
        Sweep unsold → treasury
      </Button>
    </Card>
  );
}

function DemoStep({ ipo, data }: { ipo: Ipo; data: ConsoleData }) {
  const { sendTx } = useApp();
  const m = getMarket(ipo.ticker);
  const [policy, setPolicy] = useState<Policy | undefined>(m?.policy);
  const [ref, setRef] = useState(String(m?.policy.referencePrice ?? ""));
  const [log, setLog] = useState(data.runnerLog);
  const [running, setRunning] = useState(false);

  if (!policy) return <p className="text-[14px] text-text-2">Demo controls open after graduation.</p>;

  const ensStatus = (p: Policy) => (p.halted ? "halted" : p.mode === "surveillance" || p.mode === "directional" ? "surveillance" : "listed");

  const run = (next: Policy, what: string) => {
    if (!CONSOLE.runnerOnline) return;
    setRunning(true);
    const now = () => new Date().toISOString();
    const tx = `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("")}`;
    const steps = [
      `Editing exchange JSON: ${ipo.ticker} → ${what}`,
      "cre workflow simulate --broadcast --non-interactive --trigger-index 0",
      `Report signed · v${next.version}`,
      `Broadcast tx ${shortHash(tx)} · ReportProcessed result=true`,
      `ENS ${ensName(ipo.ticker)} listingday.status = ${ensStatus(next)}`,
    ];
    steps.forEach((line, i) => {
      setTimeout(() => {
        setLog((l) => [...l, { time: now(), line }]);
        if (i === 3) setPolicy({ ...next, since: now(), asOf: now(), creTx: tx });
        if (i === steps.length - 1) setRunning(false);
      }, 500 + i * 650);
    });
  };

  const setMode = (mode: Mode, halted = false) => {
    const bandBps = mode === "listing" || mode === "surveillance" ? 500 : 2000;
    run({ ...policy, version: policy.version + 1, mode, halted, bandBps }, halted ? "halt" : `mode=${mode}`);
  };

  return (
    <div>
      <CircuitBanner ticker={ipo.ticker} policy={policy} />
      <Card className="mt-3 p-3">
        <p className="text-[13px] font-medium tracking-wide text-text-2 uppercase">Reference price</p>
        <div className="mt-2 flex gap-2">
          <input
            inputMode="decimal"
            value={ref}
            onChange={(e) => setRef(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num w-full rounded-[8px] border border-line-strong bg-transparent px-3 text-[15px] font-medium text-text outline-none focus:border-text"
            aria-label="Reference price, USDC per lot"
          />
          <Button
            tone="neutral"
            className="shrink-0 py-2 text-[14px]"
            disabled={running}
            onClick={() => run({ ...policy, version: policy.version + 1, referencePrice: Number(ref) }, `ref=${ref}`)}
          >
            Update reference
          </Button>
        </div>

        <p className="mt-4 text-[13px] font-medium tracking-wide text-text-2 uppercase">Circuit mode</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ["Normal", () => setMode("normal"), "gain"],
              ["Surveillance", () => setMode("surveillance"), "neutral"],
              ["Directional", () => setMode("directional"), "neutral"],
              ["Halt", () => setMode(policy.mode, true), "loss"],
            ] as const
          ).map(([label, fn, tone]) => (
            <Button key={label} tone={tone} variant="outline" className="py-2 text-[14px]" disabled={running} onClick={fn}>
              {label}
            </Button>
          ))}
          <Button
            tone="brand"
            variant="outline"
            className="col-span-2 py-2 text-[14px]"
            disabled={running || !policy.halted}
            onClick={() => run({ ...policy, version: policy.version + 1, halted: false, mode: policy.mode === "halted" ? "normal" : policy.mode }, "resume")}
          >
            Resume trading
          </Button>
        </div>
        <p className="mt-2 text-[13px] text-text-2">
          Current: {modeInfo(policy).copy} · policy v{policy.version}
        </p>

        <Button
          tone="neutral"
          variant="outline"
          className="mt-4 w-full"
          onClick={() =>
            sendTx({ title: `Remove ${ipo.symbol}/USDC LP`, success: policy.halted ? "LP removed while halted: exits stay open" : "LP removed" })
          }
        >
          Remove LP
        </Button>
        {!CONSOLE.runnerOnline && (
          <p className="mt-2 text-[13px] text-loss-text">Runner offline: the CRE CLI only runs on the demo laptop.</p>
        )}
        <RunnerLog lines={log} />
      </Card>
    </div>
  );
}
