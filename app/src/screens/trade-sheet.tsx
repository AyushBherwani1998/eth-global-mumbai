"use client";

// Buy / Sell (UX.md 3.6): one amount field, plain result lines, a rule-check
// row that says what is allowed and how to fix it, and a single primary action.
// The same form is the bottom sheet on phone and the sticky panel on desktop,
// so `useTradeForm` returns the body and the footer separately.

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useApp } from "@/components/providers";
import { AmountField, Button, Details, KV, Segmented, Sheet, Stepper, TextLink, TickerLogo, cx } from "@/components/ui";
import { lotFixed, shares, timeIST, usdc } from "@/lib/format";
import { PORTFOLIO, type Ipo, type Market, type Rejected } from "@/lib/mock";
import { band, bandDigits, quote } from "@/lib/policy";

export type TradeSide = "buy" | "sell";

type Opts = {
  ipo: Ipo;
  market: Market;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  /** Called after a successful trade (the sheet closes, the panel resets). */
  onDone?: () => void;
  onRejected?: (r: Rejected) => void;
};

/** Plain-English verdict: what happened and what to do about it. */
function ruleCheck(market: Market, priceAfter: number, ok: boolean, reason?: string) {
  const p = market.policy;
  const d = bandDigits(p.referencePrice, p.bandBps);
  const { lo, hi } = band(p.referencePrice, p.bandBps);
  if (ok) return { ok: true as const, text: `Allowed · within today's limits ${lotFixed(lo, d)} to ${lotFixed(hi, d)}`, fix: "" };
  if (reason === "Halted")
    return { ok: false as const, text: `Not allowed: trading is halted since ${timeIST(p.since)}.`, fix: "Try again after the exchange lifts the pause." };
  if (reason === "WrongDirection")
    return {
      ok: false as const,
      text: `Not allowed: today only trades toward ${lotFixed(p.referencePrice)} are allowed.`,
      fix: "Try the other side or wait for the rule to change.",
    };
  const above = priceAfter > hi;
  return {
    ok: false as const,
    text: `Not allowed: this trade would push the price to ${priceAfter.toFixed(3)}, ${above ? "above" : "below"} today's limit of ${lotFixed(above ? hi : lo, d)}.`,
    fix: "Try a smaller amount.",
  };
}

export function useTradeForm({ ipo, market, side, setSide, onDone, onRejected }: Opts): { body: ReactNode; footer: ReactNode } {
  const { usdcBalance, sendTx } = useApp();
  const held = PORTFOLIO.holdings.find((h) => h.ticker === ipo.ticker)?.shares ?? 0;
  const [amount, setAmount] = useState(side === "buy" ? "1" : "1000");
  const [slippage, setSlippage] = useState<"0.5" | "1" | "2">("0.5");
  const [sellAllowed, setSellAllowed] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastPrice = market.prices[market.prices.length - 1].value;
  const a = Number(amount) || 0;
  const q = useMemo(() => quote({ side, amount: a, liquidity: market.liquidity, policy: market.policy }), [side, a, market]);
  const check = ruleCheck(market, q.priceAfter, q.verdict.ok, q.verdict.ok ? undefined : q.verdict.reason);
  const minOut = q.out * (1 - Number(slippage) / 100);
  const needsPermission = side === "sell" && !sellAllowed;
  const shortOfMoney = side === "buy" ? a > usdcBalance : a > held;

  const switchSide = (s: TradeSide) => {
    setSide(s);
    setAmount(s === "buy" ? "1" : "1000");
  };

  const permission = async () => {
    setBusy(true);
    const r = await sendTx({ title: "Allow this app to sell your shares", success: "You can now sell these shares" });
    if (r.ok) setSellAllowed(true);
    setBusy(false);
  };

  const send = async () => {
    setBusy(true);
    const blocked = !q.verdict.ok;
    const r = await sendTx({
      title: side === "buy" ? `Buying ${ipo.name} shares` : `Selling ${ipo.name} shares`,
      success: side === "buy" ? `Bought ${shares(q.out)} shares` : `Sold ${shares(a)} shares for ${usdc(q.out)} USDC`,
      revert: blocked ? (q.verdict.ok ? undefined : q.verdict.reason) : undefined,
      revertTitle: blocked ? `Rejected: ${check.text.replace("Not allowed: ", "")} ${check.fix}` : undefined,
    });
    if (!r.ok && !q.verdict.ok)
      onRejected?.({
        time: new Date().toISOString(),
        side,
        usdc: side === "buy" ? a : q.out,
        priceAfter: q.priceAfter,
        reason: q.verdict.reason,
        detail: check.text.replace("Not allowed: ", ""),
        tx: r.tx,
      });
    if (r.ok) onDone?.();
    setBusy(false);
  };

  const body = (
    <>
      <Segmented
        className="mt-1"
        label="Buy or sell"
        value={side}
        onChange={switchSide}
        options={[
          { id: "buy", label: "Buy" },
          { id: "sell", label: "Sell" },
        ]}
      />

      <AmountField
        className="mt-4"
        label={side === "buy" ? "Amount in USDC" : "Number of shares"}
        value={amount}
        onChange={setAmount}
        unit={side === "buy" ? "USDC" : "shares"}
        onMax={() => setAmount(side === "buy" ? String(usdcBalance) : String(held))}
        error={
          shortOfMoney
            ? side === "buy"
              ? `You have ${usdc(usdcBalance)} USDC. Enter that or less.`
              : `You own ${shares(held)} shares. Enter that or less.`
            : undefined
        }
        helper={side === "buy" ? `You have ${usdc(usdcBalance)} USDC` : `You own ${shares(held)} shares`}
      />

      <div className="mt-4 divide-y divide-line">
        <KV
          k="You'll get about"
          v={side === "buy" ? `${shares(q.out)} shares` : `${usdc(q.out)} USDC`}
          sub={`At least ${side === "buy" ? shares(minOut) : usdc(minOut)} after ${slippage}% price movement`}
        />
        <KV k="Price after your trade" v={q.priceAfter.toFixed(3)} sub={`Price now ${lotFixed(lastPrice)}`} />
      </div>

      <div className={cx("mt-4 flex min-h-12 items-start gap-2 border-y border-line py-3", check.ok ? "text-gain-text" : "text-loss-text")}>
        {check.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span className="t-body">
          {check.text}
          {!check.ok && <span className="block text-text">{check.fix}</span>}
        </span>
      </div>

      <Details title="More options" className="mt-2">
        <div className="flex min-h-12 items-center justify-between gap-4 py-2">
          <span className="t-label">Price movement I accept</span>
          <Segmented
            value={slippage}
            onChange={setSlippage}
            label="Price movement I accept"
            options={[
              { id: "0.5", label: "0.5%" },
              { id: "1", label: "1%" },
              { id: "2", label: "2%" },
            ]}
          />
        </div>
        <div className="divide-y divide-line">
          <KV k="Effect on the price" v={`${q.impactPct >= 0 ? "+" : "-"}${Math.abs(q.impactPct).toFixed(2)}%`} />
        </div>
      </Details>

      <Details className="mt-2">
        <div className="divide-y divide-line">
          <KV k="Route" v="Universal Router · Uniswap v4 pool" />
          <KV k="Quote source" v="Quoter (exact in)" />
          <KV k="Pool id" v={ipo.records.pool ? `${ipo.records.pool.slice(0, 10)}…${ipo.records.pool.slice(-6)}` : "Not set yet"} mono />
          <KV k="Raw price after" v={q.priceAfter.toFixed(6)} mono />
          <KV k="Rule mirrored" v={`ListingHook.afterSwap · ${market.policy.mode}`} mono />
        </div>
      </Details>
    </>
  );

  const footer = (
    <>
      {side === "sell" && (
        <Stepper
          className="mb-3"
          current={needsPermission ? 1 : 2}
          steps={[
            { title: "Allow selling", sub: "Allow this app to sell your shares. One-time, you can turn it off later." },
            { title: "Confirm", sub: "Confirm the sale. The price you see is the price you get, within the movement you accept." },
          ]}
        />
      )}
      {needsPermission ? (
        <Button variant="sell" size="bar" className="w-full" busy={busy} disabled={busy || a <= 0} onClick={permission}>
          {busy ? "Check your wallet app" : "Allow this app to sell your shares"}
        </Button>
      ) : (
        <Button
          variant={side === "buy" ? "buy" : "sell"}
          size="bar"
          className="w-full"
          busy={busy}
          disabled={busy || a <= 0 || shortOfMoney || !check.ok}
          onClick={send}
        >
          {busy
            ? "Check your wallet app"
            : !check.ok
              ? "Not allowed today"
              : side === "buy"
                ? `Buy for ${usdc(a)} USDC`
                : `Sell ${shares(a)} shares`}
        </Button>
      )}
      {!check.ok && !needsPermission && (
        <p className="mt-2 text-center">
          <TextLink onClick={send}>Send anyway to see it rejected</TextLink>
        </p>
      )}
    </>
  );

  return { body, footer };
}

/** Bottom sheet on phone (UX.md 3.6). On desktop the same form is the sticky panel. */
export function TradeSheet({
  ipo,
  market,
  open,
  side,
  setSide,
  onClose,
  onRejected,
}: {
  ipo: Ipo;
  market: Market;
  open: boolean;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  onClose: () => void;
  onRejected?: (r: Rejected) => void;
}) {
  const { body, footer } = useTradeForm({ ipo, market, side, setSide, onDone: onClose, onRejected });
  return (
    <Sheet open={open} onClose={onClose} title={`${side === "buy" ? "Buy" : "Sell"} ${ipo.name}`} footer={footer}>
      <div className="flex items-center gap-3 pb-1">
        <TickerLogo ipo={ipo} size={36} />
        <span className="t-label">{ipo.sector}</span>
      </div>
      {body}
    </Sheet>
  );
}
