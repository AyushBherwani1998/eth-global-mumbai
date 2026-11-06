"use client";

// Apply for an IPO (UX.md 3.5): one amount, one price choice, plain derived
// lines, the one-person check and three one-sentence wallet steps. The same
// form is the bottom sheet on phone and the sticky panel on desktop.

import { useState, type ReactNode } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/providers";
import { TickerMark } from "@/components/company/logos";
import { AmountField, Button, Details, KV, Sheet, Slider, Stepper, TextLink, TickerLogo, cx } from "@/components/ui";
import { lotFixed, perShare, shares, usdc } from "@/lib/format";
import { COMMITTED, FAUCET_URL, OFFER, WALLET, type Ipo } from "@/lib/mock";

type Opts = {
  ipo: Ipo;
  onDone?: () => void;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  worldState?: unknown;
  /** @deprecated World ID is dropped; listings are open. Accepted and ignored. */
  onVerify?: () => void;
};

type Warning = { text: string; fix: string; blocking: boolean; revert?: string };

export function useApplyForm({ ipo, onDone }: Opts): { body: ReactNode; footer: ReactNode } {
  const { usdcBalance, sendTx } = useApp();
  const price = ipo.clearingPrice ?? OFFER.issuePrice;
  const committed = COMMITTED[ipo.ticker] ?? 0;
  const capLeft = Math.max(0, OFFER.perApplicantCap - committed);

  const [amount, setAmount] = useState(String(Math.min(5, capLeft || 5)));
  const [mode, setMode] = useState<"cutoff" | "limit">("cutoff");
  const [limit, setLimit] = useState(Math.min(OFFER.capPrice, Math.max(OFFER.floorPrice, Number(price.toFixed(2)))));
  const [usdcAllowed, setUsdcAllowed] = useState(WALLET.allowances.usdcToPermit2);
  const [allowance, setAllowance] = useState((WALLET.allowances.permit2ToAuction as Record<string, number>)[ipo.ticker] ?? 0);
  const [busy, setBusy] = useState(false);

  const a = Number(amount) || 0;
  const maxPrice = mode === "cutoff" ? OFFER.capPrice : limit;

  const warnings: Warning[] = [];
  if (a > capLeft)
    warnings.push({
      text: `That's more than your ${usdc(capLeft)} USDC remaining for this IPO.`,
      fix: `Enter ${usdc(capLeft)} or less.`,
      blocking: true,
      revert: "CapExceeded",
    });
  if (a > usdcBalance)
    warnings.push({ text: `That's more than your balance of ${usdc(usdcBalance)} USDC.`, fix: "Get free test USDC or lower the amount.", blocking: true });
  if (mode === "limit" && limit < price)
    warnings.push({ text: "Your limit is below today's price.", fix: "Raise it, or your money may come back as a refund.", blocking: false });

  const blocked = warnings.some((w) => w.blocking);
  const revert = warnings.find((w) => w.blocking && w.revert)?.revert;

  const step = !usdcAllowed ? 1 : allowance < a ? 2 : 3;
  const steps = [
    { title: "Allow USDC", sub: "Allow this app to use your USDC. One-time, you can turn it off later." },
    { title: `Allow ${usdc(a)}`, sub: `Allow this IPO to take up to ${usdc(a)} USDC from you.` },
    { title: "Apply", sub: "Place your application. It can't be cancelled: your USDC stays with the IPO until it closes." },
  ];

  const run = async () => {
    setBusy(true);
    if (step === 1) {
      const r = await sendTx({ title: "Allowing this app to use your USDC", success: "This app can now use your USDC" });
      if (r.ok) setUsdcAllowed(true);
    } else if (step === 2) {
      const r = await sendTx({ title: `Allowing this IPO to take ${usdc(a)} USDC`, success: "Allowed" });
      if (r.ok) setAllowance(a);
    } else {
      const r = await sendTx({
        title: "Placing your application",
        success: `Application placed · ${usdc(a)} USDC`,
        revert,
        revertTitle:
          revert === "CapExceeded"
            ? `Rejected: you can put at most ${usdc(OFFER.perApplicantCap, 0)} USDC into this IPO. Enter ${usdc(capLeft)} or less.`
            : revert === "NotEligible"
              ? "Rejected: your one-person check has expired. Verify again and try once more."
              : undefined,
      });
      if (r.ok) onDone?.();
    }
    setBusy(false);
  };

  const label =
    step === 1 ? "Allow USDC" : step === 2 ? `Allow ${usdc(a)} USDC` : blocked ? "Not allowed yet" : `Apply for ${usdc(a)} USDC`;

  const body = (
    <>
      <AmountField
        className="mt-1"
        label="Amount"
        value={amount}
        onChange={setAmount}
        unit="USDC"
        onMax={() => setAmount(String(Math.min(usdcBalance, capLeft)))}
        helper={
          a > usdcBalance ? (
            <>
              You have {usdc(usdcBalance)} USDC ·{" "}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-gain-text">
                Get free test USDC
              </a>
            </>
          ) : (
            `Up to ${usdc(OFFER.perApplicantCap, 0)} USDC per wallet · ${usdc(capLeft)} left for you`
          )
        }
      />

      <div className="mt-5" role="radiogroup" aria-label="Price you pay">
        <p className="t-label-sm mb-1 text-text">Price you pay</p>
        <PriceOption
          selected={mode === "cutoff"}
          onSelect={() => setMode("cutoff")}
          title="At cut-off (recommended)"
          helper={`You pay whatever price the IPO closes at, never more than ${lotFixed(OFFER.capPrice)}.`}
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
              min={OFFER.floorPrice}
              max={OFFER.capPrice}
              step={0.01}
              value={limit}
              onChange={setLimit}
              ticks={[{ label: `Lowest ${lotFixed(OFFER.floorPrice)}` }, { label: `Now ${lotFixed(price)}` }, { label: `Highest ${lotFixed(OFFER.capPrice)}` }]}
            />
          </div>
        )}
      </div>

      <div className="mt-4 divide-y divide-line">
        <KV k="Shares at today's price" v={`about ${shares((a / price) * 1000)}`} sub={`Today's price ${lotFixed(price)} per 1,000 shares`} />
        <KV k="Money paid in" v={`${usdc(a)} USDC`} sub="Moves to the IPO now. After it closes, settle to get back whatever didn't buy shares." />
      </div>

      <div className="mt-4 flex min-h-14 items-center gap-3 border-t border-line pt-3">
        <ShieldCheck className="size-5 shrink-0 text-text-2" aria-hidden />
        <span className="t-body min-w-0 flex-1 text-text-2">
          Anyone can apply. Each wallet can put in up to {usdc(OFFER.perApplicantCap)} USDC for this IPO.
        </span>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {warnings.map((w) => (
            <p key={w.text} className={cx("t-body flex items-start gap-2", w.blocking ? "text-loss-text" : "text-warn")}>
              <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
              <span>
                {w.text} <span className="text-text">{w.fix}</span>
              </span>
            </p>
          ))}
        </div>
      )}

      <Details className="mt-4">
        <div className="divide-y divide-line">
          <KV k="Your price limit" v={`${lotFixed(maxPrice)} per 1,000 shares`} sub={`= ${perShare(maxPrice)} USDC per share`} />
          <KV k="Auction contract" v={ipo.records.auction ? `${ipo.records.auction.slice(0, 10)}…${ipo.records.auction.slice(-6)}` : "Not set yet"} mono />
          <KV k="One-person check" v="Sent with the application as hookData" />
        </div>
      </Details>
    </>
  );

  const footer = (
    <>
      <p className="t-caption mb-2">Your wallet will ask you up to 3 times.</p>
      <Stepper className="mb-3" steps={steps} current={step} />
      <Button
        variant="buy"
        size="bar"
        className="w-full"
        busy={busy}
        disabled={busy || a <= 0 || (step === 3 && blocked)}
        onClick={run}
      >
        {busy ? "Check your wallet app" : label}
      </Button>
      {step === 3 && blocked && revert && (
        <p className="mt-2 text-center">
          <TextLink onClick={run}>Send anyway to see it rejected</TextLink>
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
  ipo: Ipo;
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
          <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {ipo.sector}
        </span>
      </div>
      {body}
    </Sheet>
  );
}

/** @deprecated legacy name; use ApplySheet. */
export const BidSheet = ApplySheet;
