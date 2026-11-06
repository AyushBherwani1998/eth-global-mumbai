"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, KV, Segmented, Sheet, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { lotFixed, shares, usdc } from "@/lib/format";
import { PORTFOLIO, type Ipo, type Market, type Rejected } from "@/lib/mock";
import { band, bandDigits, quote } from "@/lib/policy";

/** Trade sheet (screens.md §4): Quoter quote + band pre-check before swapping. */
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
  side: "buy" | "sell";
  setSide: (s: "buy" | "sell") => void;
  onClose: () => void;
  onRejected: (r: Rejected) => void;
}) {
  const { usdcBalance, sendTx } = useApp();
  const held = PORTFOLIO.holdings.find((h) => h.ticker === ipo.ticker)?.shares ?? 0;
  const [amount, setAmount] = useState(side === "buy" ? "1" : "1000");
  const [slippage, setSlippage] = useState<"0.5" | "1" | "2">("0.5");
  const [shareApproved, setShareApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  const a = Number(amount) || 0;
  const q = useMemo(() => quote({ side, amount: a, liquidity: market.liquidity, policy: market.policy }), [side, a, market]);
  const minOut = q.out * (1 - Number(slippage) / 100);
  const balance = side === "buy" ? usdcBalance : held;
  const { lo, hi } = band(market.policy.referencePrice, market.policy.bandBps);
  const d = bandDigits(market.policy.referencePrice, market.policy.bandBps);
  const needsApprove = side === "sell" && !shareApproved;

  const submit = async () => {
    setBusy(true);
    if (needsApprove) {
      const r = await sendTx({ title: `Enable ${ipo.symbol} for Permit2`, success: `${ipo.symbol} enabled` });
      if (r.ok) setShareApproved(true);
      setBusy(false);
      return;
    }
    const v = q.verdict;
    const r = await sendTx({
      title: side === "buy" ? `Buy ${ipo.symbol} with ${usdc(a)} USDC` : `Sell ${shares(a)} ${ipo.symbol}`,
      success: side === "buy" ? `Bought ${shares(q.out)} ${ipo.symbol}` : `Sold for ${usdc(q.out)} USDC`,
      revert: v.ok ? undefined : v.reason,
      revertDetail: v.ok ? undefined : v.text.replace("Would revert: ", ""),
    });
    if (!r.ok && !v.ok)
      onRejected({
        time: new Date().toISOString(),
        side,
        usdc: side === "buy" ? a : q.out,
        priceAfter: q.priceAfter,
        reason: v.reason,
        detail: v.text.replace("Would revert: ", ""),
        tx: r.tx,
      });
    if (r.ok) onClose();
    setBusy(false);
  };

  const v = q.verdict;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${side === "buy" ? "Buy" : "Sell"} ${ipo.symbol}`}
      footer={
        <Button
          tone={!v.ok && !needsApprove ? "loss" : side === "buy" ? "gain" : "loss"}
          variant={!v.ok && !needsApprove ? "outline" : "solid"}
          className="w-full"
          disabled={a <= 0 || busy}
          onClick={submit}
        >
          {busy
            ? "Waiting for wallet…"
            : needsApprove
              ? `Enable ${ipo.symbol}`
              : !v.ok
                ? "Submit anyway (will revert)"
                : side === "buy"
                  ? "Swap · Buy"
                  : "Swap · Sell"}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-1 rounded-full bg-subtle p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount(s === "buy" ? "1" : "1000");
            }}
            className={cx(
              "rounded-full py-2 text-sm font-semibold capitalize transition-colors",
              side === s ? (s === "buy" ? "bg-gain text-white" : "bg-loss text-white") : "text-muted",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <label className="mt-3 block rounded-[12px] border border-line-strong p-3 focus-within:border-gain">
        <span className="flex justify-between text-xs text-muted">
          <span>You pay</span>
          <span className="num">
            Balance {side === "buy" ? `${usdc(usdcBalance)} USDC` : `${shares(held)} ${ipo.symbol}`}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num w-full bg-transparent text-[24px] font-semibold text-strong outline-none"
          />
          <span className="text-sm font-semibold text-strong">{side === "buy" ? "USDC" : ipo.symbol}</span>
          <button onClick={() => setAmount(String(balance))} className="rounded-full bg-gain-soft px-2 py-0.5 text-xs font-semibold text-gain">
            Max
          </button>
        </span>
      </label>

      <div className="mt-3 divide-y divide-line">
        <KV
          k="You receive (Quoter)"
          v={side === "buy" ? `≈ ${shares(q.out)} ${ipo.symbol}` : `≈ ${usdc(q.out, 4)} USDC`}
          sub={`min ${side === "buy" ? shares(minOut) : usdc(minOut, 4)} at ${slippage}% slippage`}
        />
        <KV k="Price after swap" v={`${q.priceAfter.toFixed(3)} USDC / lot`} />
        <KV
          k="Price impact"
          v={<span className={Math.abs(q.impactPct) > 3 ? "text-warn" : undefined}>{q.impactPct.toFixed(2)}%</span>}
        />
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-muted">Slippage</span>
          <Segmented
            size="sm"
            value={slippage}
            onChange={setSlippage}
            options={[
              { id: "0.5", label: "0.5%" },
              { id: "1", label: "1%" },
              { id: "2", label: "2%" },
            ]}
          />
        </div>
      </div>

      <div
        className={cx(
          "mt-3 flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[13px]",
          v.ok ? "bg-gain-soft text-gain" : "bg-loss-soft text-loss",
        )}
      >
        {v.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
        <span>
          {v.ok ? (
            <>
              Within band ✓{" "}
              {market.policy.mode !== "directional" && (
                <span className="opacity-80">
                  ({lotFixed(lo, d)}–{lotFixed(hi, d)})
                </span>
              )}
            </>
          ) : (
            v.text
          )}
        </span>
      </div>
      {!v.ok && (
        <p className="mt-2 text-xs text-muted">
          You can still submit. The ListingHook will revert it onchain and it shows up as a red marker on the chart.
        </p>
      )}
    </Sheet>
  );
}
