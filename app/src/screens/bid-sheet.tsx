"use client";

// Apply for an IPO (UX.md 3.5): one amount, one price choice, plain derived
// lines, the per-wallet limit and the wallet steps. The same form is the
// bottom sheet on phone and the sticky panel on desktop.
//
// Live: the offer (price range, per-wallet cap) from GET /v1/listings/:ticker,
// what this wallet has left under the cap from GET /v1/eligibility, the USDC
// balance from GET /v1/portfolio, and the steps and verdict from
// POST /v1/prepare/bid (the server simulates the bid with its approvals, so
// "auction over" or "above your cap" shows before anything is sent).

import { useState, type ReactNode } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/providers";
import { TickerMark } from "@/components/company/logos";
import { AmountField, Button, Details, KV, Sheet, Slider, Stepper, TickerLogo, cx } from "@/components/ui";
import { lotFixed, perShare, shares, usdc } from "@/lib/format";
import { FAUCET_URL, type Ipo } from "@/lib/mock";
import { api, type BidDetails, type Offer } from "@/lib/api";
import { bidRoom } from "@/lib/adapt";
import { useEligibility } from "@/lib/live";
import { useQuote } from "@/lib/use-quote";
import { USDC_DECIMALS, formatRaw, parseAmount, priceToPoints } from "@/lib/units";
import type { TxProgress } from "@/lib/tx";

type ApplyIpo = Ipo & { offer?: Offer };

type Opts = {
  ipo: ApplyIpo;
  onDone?: () => void;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  worldState?: unknown;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  onVerify?: () => void;
};

type Warning = { text: string; fix: string; blocking: boolean };

export function useApplyForm({ ipo, onDone }: Opts): { body: ReactNode; footer: ReactNode } {
  const { connected, connect, address, usdcBalance, portfolio, runTx, canSign, txBusy, demoData } = useApp();
  const offer = ipo.offer ?? null;
  const price = ipo.clearingPrice ?? offer?.issuePrice ?? null;
  const eligibility = useEligibility(connected ? ipo.ticker : null, connected ? address : null);
  const room = bidRoom(eligibility.data);
  const capLeft = room.known ? room.remaining : null;
  const from = address as `0x${string}`;

  const [amount, setAmount] = useState("5");
  const [mode, setMode] = useState<"cutoff" | "limit">("cutoff");
  const [limitChoice, setLimit] = useState<number | null>(null);
  const limit = offer ? Math.min(offer.capPrice, Math.max(offer.floorPrice, limitChoice ?? Number((price ?? offer.issuePrice).toFixed(2)))) : 0;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TxProgress | null>(null);

  const parsed = parseAmount(amount, USDC_DECIMALS);
  const a = parsed.ok ? parsed.value : 0;
  const maxPrice = offer ? (mode === "cutoff" ? offer.capPrice : limit) : null;
  const maxPricePoints = maxPrice === null ? null : priceToPoints(maxPrice);

  const key = connected && parsed.ok && maxPricePoints !== null ? `${ipo.ticker}:${from}:${parsed.raw}:${maxPricePoints}` : null;
  const quote = useQuote(key, () =>
    api.prepareBid({ ticker: ipo.ticker, owner: from, budgetRaw: parsed.ok ? parsed.raw.toString() : "0", maxPricePoints: maxPricePoints ?? 0 }),
  );
  const prepared = quote.status === "ready" && quote.value.details?.raw ? quote.value : null;
  const simError = prepared?.simulate.ok === false ? prepared.simulate.error : null;

  const balanceRaw = portfolio.data?.balances.raw.usdc;
  const warnings: Warning[] = [];
  if (room.known && room.atCap)
    warnings.push({ text: `You've put the most one wallet can into this IPO (${usdc(room.cap)} USDC).`, fix: "There's nothing more to apply for.", blocking: true });
  else if (capLeft !== null && a > capLeft)
    warnings.push({ text: `That's more than your ${usdc(capLeft)} USDC remaining for this IPO.`, fix: `Enter ${usdc(capLeft)} or less.`, blocking: true });
  if (parsed.ok && balanceRaw !== undefined && parsed.raw > BigInt(balanceRaw))
    warnings.push({ text: `That's more than your balance of ${usdc(usdcBalance ?? 0)} USDC.`, fix: "Get free test USDC or lower the amount.", blocking: true });
  if (mode === "limit" && price !== null && limit < price)
    warnings.push({ text: "Your limit is below today's price.", fix: "Raise it, or your money may come back as a refund.", blocking: false });
  if (simError) warnings.push({ text: `Not allowed: ${simError.message}`, fix: "", blocking: true });
  for (const w of prepared?.details.warnings ?? []) warnings.push({ text: w, fix: "", blocking: false });

  const blocked = warnings.some((w) => w.blocking);
  const approvals = prepared ? prepared.steps.filter((s) => s.needed && s.kind !== "submitBid") : [];
  const steps = [
    ...approvals.map((s) => ({ title: s.description, sub: "A one-time approval in your wallet so the IPO can take your USDC." })),
    { title: "Apply", sub: "Place your application. It can't be cancelled: your USDC stays with the IPO until it closes." },
  ];
  const current = busy && progress && progress.phase !== "preparing" ? Math.min(steps.length, progress.index + 1) : 1;

  const run = async () => {
    if (!parsed.ok || maxPricePoints === null || busy || txBusy) return;
    const budgetRaw = parsed.raw.toString();
    setBusy(true);
    try {
      const r = await runTx<BidDetails>({
        title: "Placing your application",
        success: `Application placed · ${usdc(a)} USDC`,
        failTitle: "Your application wasn't placed",
        prepare: () => api.prepareBid({ ticker: ipo.ticker, owner: from, budgetRaw, maxPricePoints }),
        onProgress: setProgress,
      });
      if (r.ok) onDone?.();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const status = !connected
    ? null
    : !offer
      ? "Loading the offer"
      : !parsed.ok
        ? amount.trim()
          ? parsed.error
          : "Enter an amount"
        : quote.status === "loading" && !prepared
          ? "Checking with the exchange…"
          : quote.status === "error"
            ? ((quote.error as { sentence?: string })?.sentence ?? "The exchange couldn't check this. Try again.")
            : quote.status === "ready" && !prepared
              ? demoData
                ? "Applications need the live exchange server, not demo data."
                : "The exchange sent nothing to sign for this."
              : null;

  const label = blocked ? "Not allowed" : `Apply for ${usdc(a)} USDC`;
  const maxApply = () => {
    if (balanceRaw === undefined) return;
    let raw = BigInt(balanceRaw);
    if (eligibility.data?.raw.remaining) raw = raw < BigInt(eligibility.data.raw.remaining) ? raw : BigInt(eligibility.data.raw.remaining);
    setAmount(formatRaw(raw, USDC_DECIMALS));
  };

  const body = (
    <>
      <AmountField
        className="mt-1"
        label="Amount"
        value={amount}
        onChange={setAmount}
        unit="USDC"
        onMax={balanceRaw !== undefined ? maxApply : undefined}
        helper={
          usdcBalance !== null && a > usdcBalance ? (
            <>
              You have {usdc(usdcBalance)} USDC ·{" "}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-gain-text">
                Get free test USDC
              </a>
            </>
          ) : room.known ? (
            `Up to ${usdc(room.cap, 0)} USDC per wallet · ${usdc(room.remaining)} left for you`
          ) : offer ? (
            `Up to ${usdc(offer.perApplicantCap, 0)} USDC per wallet`
          ) : undefined
        }
      />

      {offer && (
        <div className="mt-5" role="radiogroup" aria-label="Price you pay">
          <p className="t-label-sm mb-1 text-text">Price you pay</p>
          <PriceOption
            selected={mode === "cutoff"}
            onSelect={() => setMode("cutoff")}
            title="At cut-off (recommended)"
            helper={`You pay whatever price the IPO closes at, never more than ${lotFixed(offer.capPrice)}.`}
          />
          <PriceOption
            selected={mode === "limit"}
            onSelect={() => setMode("limit")}
            title="Set my own limit"
            helper="If the price ends above your limit, you get no shares and can take your money back after the IPO closes."
          />
          {mode === "limit" && (
            <div className="mt-2">
              <p className="num t-list-title text-text">Up to {lotFixed(limit)}</p>
              <Slider
                label="Your price limit"
                min={offer.floorPrice}
                max={offer.capPrice}
                step={0.01}
                value={limit}
                onChange={setLimit}
                ticks={[
                  { label: `Lowest ${lotFixed(offer.floorPrice)}` },
                  ...(price !== null ? [{ label: `Now ${lotFixed(price)}` }] : []),
                  { label: `Highest ${lotFixed(offer.capPrice)}` },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-4 divide-y divide-line">
        {price !== null && <KV k="Shares at today's price" v={`about ${shares((a / price) * 1000)}`} sub={`Today's price ${lotFixed(price)} per 1,000 shares`} />}
        <KV k="Money paid in" v={`${usdc(a)} USDC`} sub="Moves to the IPO now. After it closes, settle to get back whatever didn't buy shares." />
      </div>

      <div className="mt-4 flex min-h-14 items-center gap-3 border-t border-line pt-3">
        <ShieldCheck className="size-5 shrink-0 text-text-2" aria-hidden />
        <span className="t-body min-w-0 flex-1 text-text-2">
          Anyone can apply.{" "}
          {room.known ? `Each wallet can put in up to ${usdc(room.cap)} USDC for this IPO.` : offer ? `Each wallet can put in up to ${usdc(offer.perApplicantCap)} USDC for this IPO.` : ""}
        </span>
      </div>

      {status && <p className="t-label mt-3">{status}</p>}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.map((w) => (
            <p key={w.text} className={cx("t-body flex items-start gap-2", w.blocking ? "text-loss-text" : "text-warn")}>
              <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
              <span>
                {w.text} {w.fix && <span className="text-text">{w.fix}</span>}
              </span>
            </p>
          ))}
        </div>
      )}

      <Details className="mt-4">
        <div className="divide-y divide-line">
          {maxPrice !== null && <KV k="Your price limit" v={`${lotFixed(maxPrice)} per 1,000 shares`} sub={`= ${perShare(maxPrice)} USDC per share`} />}
          <KV k="Auction contract" v={ipo.records.auction ? `${ipo.records.auction.slice(0, 10)}…${ipo.records.auction.slice(-6)}` : "Not set yet"} mono />
          {simError && <KV k="Reason code" v={simError.name} mono />}
          {prepared && <KV k="Checked with" v={`${prepared.simulate.method} at block ${prepared.simulate.block}`} mono />}
        </div>
      </Details>
    </>
  );

  const canSend = connected && canSign && !!prepared && !blocked && !busy && !txBusy;
  const footer = (
    <>
      {prepared && <p className="t-caption mb-2">Your wallet will ask you {steps.length === 1 ? "once" : `${steps.length} times`}.</p>}
      {steps.length > 1 && <Stepper className="mb-3" steps={steps} current={current} />}
      {!connected ? (
        <Button variant="buy" size="bar" className="w-full" onClick={connect}>
          Sign in to apply
        </Button>
      ) : (
        <Button variant="buy" size="bar" className="w-full" busy={busy} disabled={!canSend} onClick={run}>
          {busy ? "Check your wallet app" : label}
        </Button>
      )}
      {connected && !canSign && (
        <p className="t-label mt-2 text-center">
          {demoData ? "This is demo data, so nothing can be sent." : "This sign-in can look but not send. Sign in with a wallet to apply."}
        </p>
      )}
    </>
  );

  return { body, footer };
}

function PriceOption({ selected, onSelect, title, helper }: { selected: boolean; onSelect: () => void; title: string; helper: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex min-h-14 w-full items-start gap-3 py-2 text-left"
    >
      <span
        aria-hidden
        className={cx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-[5px] border-text" : "border-line-strong")}
      />
      <span className="min-w-0 flex-1">
        <span className="t-body block text-text">{title}</span>
        <span className="t-caption block">{helper}</span>
      </span>
    </button>
  );
}

/** Bottom sheet on phone (UX.md 3.5). On desktop the same form is the sticky panel. */
export function ApplySheet({
  ipo,
  open,
  onClose,
}: {
  ipo: ApplyIpo;
  open: boolean;
  onClose: () => void;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  worldState?: unknown;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  onVerify?: () => void;
}) {
  const { body, footer } = useApplyForm({ ipo, onDone: onClose });
  return (
    <Sheet open={open} onClose={onClose} title={`Apply for ${ipo.name}`} footer={footer}>
      <div className="flex items-center gap-3 pb-1">
        <TickerLogo ipo={ipo} size={36} />
        <span className="t-label">
          <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} />
          {ipo.sector ? ` · ${ipo.sector}` : ""}
        </span>
      </div>
      {body}
    </Sheet>
  );
}

/** @deprecated legacy name; use ApplySheet. */
export const BidSheet = ApplySheet;
