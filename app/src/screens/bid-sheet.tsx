"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, ScanFace, ShieldCheck } from "lucide-react";
import { Button, KV, Sheet, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { lotFixed, perShare, shares, usdc } from "@/lib/format";
import { COMMITTED, FAUCET_URL, OFFER, WALLET, type Ipo } from "@/lib/mock";
import type { WorldState } from "./world-sheet";

const SLIDER_MAX = 2.1; // past the 1.90 cap on purpose, so the demo can show BidAboveCap

/** Bid sheet (screens.md §2): budget + max price, 3-step approve flow. */
export function BidSheet({
  ipo,
  open,
  onClose,
  worldState,
  onVerify,
}: {
  ipo: Ipo;
  open: boolean;
  onClose: () => void;
  worldState: WorldState;
  onVerify: () => void;
}) {
  const { usdcBalance, sendTx } = useApp();
  const clearing = ipo.clearingPrice ?? OFFER.floorPrice;
  const committed = COMMITTED[ipo.ticker] ?? 0;
  const capLeft = Math.max(0, OFFER.perApplicantCap - committed);
  const [budget, setBudget] = useState(String(Math.min(5, capLeft)));
  const [maxPrice, setMaxPrice] = useState("1.40");
  const [usdcEnabled, setUsdcEnabled] = useState(WALLET.allowances.usdcToPermit2);
  const [allowance, setAllowance] = useState(
    (WALLET.allowances.permit2ToAuction as Record<string, number>)[ipo.ticker] ?? 0,
  );
  const [busy, setBusy] = useState(false);

  const b = Number(budget) || 0;
  const mp = Number(maxPrice) || 0;
  const needsHuman = ipo.eligibility === "human";
  const humanOk = !needsHuman || worldState === "verified" || worldState === "expired";

  const warnings: { text: string; revert?: string }[] = [];
  if (mp > OFFER.capPrice)
    warnings.push({ text: `Above the ${lotFixed(OFFER.capPrice)} cap. This bid will revert BidAboveCap.`, revert: "BidAboveCap" });
  if (b > capLeft) warnings.push({ text: `More than your ${usdc(capLeft)} USDC cap remaining. Will revert CapExceeded.`, revert: "CapExceeded" });
  if (mp > 0 && mp < clearing) warnings.push({ text: "Below the current clearing price. You'll be outbid unless it falls." });
  if (b > usdcBalance) warnings.push({ text: `Budget is more than your ${usdc(usdcBalance)} USDC balance.` });
  if (needsHuman && worldState === "expired")
    warnings.push({ text: "Your one-applicant pass has expired. This bid will revert NotEligible.", revert: "NotEligible" });
  const revert = warnings.find((w) => w.revert)?.revert;

  const step = !usdcEnabled ? 1 : allowance < b ? 2 : 3;
  const canSubmit = b > 0 && mp > 0 && humanOk && !busy;

  const run = async () => {
    setBusy(true);
    if (step === 1) {
      const r = await sendTx({ title: "Enable USDC", success: "USDC enabled for Permit2" });
      if (r.ok) setUsdcEnabled(true);
    } else if (step === 2) {
      const r = await sendTx({ title: `Approve ${usdc(b)} USDC for ${ipo.symbol} auction`, success: "Auction approved" });
      if (r.ok) setAllowance(b);
    } else {
      const r = await sendTx({
        title: `Bid ${usdc(b)} USDC up to ${lotFixed(mp)} / lot`,
        success: `Bid placed on ${ipo.symbol}`,
        revert,
        revertDetail:
          revert === "BidAboveCap"
            ? `Max price ${lotFixed(mp)} is above the ${lotFixed(OFFER.capPrice)} cap (190% of issue).`
            : revert === "CapExceeded"
              ? `Per-applicant cap is ${OFFER.perApplicantCap} USDC; ${usdc(committed)} already committed.`
              : revert === "NotEligible"
                ? "The one-applicant pass in hookData has expired."
                : undefined,
      });
      if (r.ok) onClose();
    }
    setBusy(false);
  };

  const label =
    step === 1
      ? "Enable USDC"
      : step === 2
        ? "Approve for this auction"
        : revert
          ? "Submit anyway (will revert)"
          : "Submit bid";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Bid on ${ipo.symbol}`}
      footer={
        <>
          <Steps step={step} />
          <Button tone={step === 3 && revert ? "loss" : "gain"} className="mt-3 w-full" disabled={!canSubmit} onClick={run}>
            {busy ? "Waiting for wallet…" : label}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget" suffix="USDC">
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num w-full bg-transparent text-[22px] font-semibold text-strong outline-none"
          />
          <button
            onClick={() => setBudget(String(Math.min(usdcBalance, capLeft)))}
            className="rounded-full bg-gain-soft px-2 py-0.5 text-xs font-semibold text-gain"
          >
            Max
          </button>
        </Field>
        <Field label="Max price" suffix="USDC / lot">
          <input
            inputMode="decimal"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            className={cx("num w-full bg-transparent text-[22px] font-semibold outline-none", mp > OFFER.capPrice ? "text-loss" : "text-strong")}
          />
        </Field>
      </div>
      <div className="mt-3">
        <input
          type="range"
          aria-label="Max price"
          min={OFFER.floorPrice}
          max={SLIDER_MAX}
          step={0.01}
          value={Math.min(SLIDER_MAX, Math.max(OFFER.floorPrice, mp))}
          onChange={(e) => setMaxPrice(Number(e.target.value).toFixed(2))}
          className="w-full"
        />
        <div className="num flex justify-between text-[11px] text-muted">
          <span>Floor {lotFixed(OFFER.floorPrice)}</span>
          <span>Clearing {lotFixed(clearing)}</span>
          <span className={cx(mp > OFFER.capPrice && "font-semibold text-loss")}>Cap {lotFixed(OFFER.capPrice)}</span>
        </div>
        <p className="num mt-1 text-xs text-muted">= {perShare(mp)} USDC per share</p>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {warnings.map((w) => (
            <p
              key={w.text}
              className={cx(
                "flex items-start gap-2 rounded-[8px] px-3 py-2 text-[13px]",
                w.revert ? "bg-loss-soft text-loss" : "bg-warn-soft text-warn",
              )}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {w.text}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 divide-y divide-line">
        <KV k="Shares if filled at your max" v={mp > 0 ? shares((b / mp) * 1000) : "—"} />
        <KV k="Shares at current clearing" v={shares((b / clearing) * 1000)} sub={`at ${lotFixed(clearing)} USDC / lot`} />
        <KV k="Cap remaining" v={`${usdc(capLeft)} of ${OFFER.perApplicantCap} USDC`} sub="Exits don't give cap back" />
        <KV
          k="USDC balance"
          v={`${usdc(usdcBalance)} USDC`}
          sub={
            b > usdcBalance ? (
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-medium text-brand">
                Get test USDC
              </a>
            ) : undefined
          }
        />
      </div>

      {needsHuman && (
        <button onClick={onVerify} className="mt-3 flex w-full items-center gap-3 rounded-[12px] border border-line p-3 text-left">
          <span className={cx("flex size-10 items-center justify-center rounded-full", worldState === "verified" ? "bg-gain-soft text-gain" : "bg-subtle text-muted")}>
            {worldState === "verified" ? <ShieldCheck className="size-5" /> : <ScanFace className="size-5" />}
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-strong">
              {worldState === "verified" ? "Verified: one applicant" : "Verify you're one applicant"}
            </span>
            <span className="block text-xs text-muted">
              {worldState === "verified"
                ? "Pass rides in hookData with this bid"
                : worldState === "denied"
                  ? "Denied: already applied with another wallet"
                  : worldState === "expired"
                    ? "Pass expired"
                    : "Required to bid on this IPO"}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted" />
        </button>
      )}
    </Sheet>
  );
}

function Field({ label, suffix, children }: { label: string; suffix: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-[12px] border border-line-strong p-3 focus-within:border-gain">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
      <span className="text-xs text-muted">{suffix}</span>
    </label>
  );
}

function Steps({ step }: { step: number }) {
  const items = ["Enable USDC", "Approve auction", "Submit bid"];
  return (
    <ol className="flex items-center gap-2" aria-label="Bid steps">
      {items.map((t, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={t} className="flex flex-1 items-center gap-1.5">
            <span
              className={cx(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                done ? "bg-gain text-white" : current ? "bg-strong text-bg" : "bg-subtle text-muted",
              )}
            >
              {done ? <Check className="size-3" /> : n}
            </span>
            <span className={cx("text-[11px] leading-tight", current ? "font-semibold text-strong" : "text-muted")}>{t}</span>
          </li>
        );
      })}
    </ol>
  );
}
