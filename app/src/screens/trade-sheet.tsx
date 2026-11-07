"use client";

// Buy / Sell (UX.md 3.6): one amount field, plain result lines, a rule-check
// row that says what is allowed and how to fix it, and a single primary action.
// The same form is the bottom sheet on phone and the sticky panel on desktop,
// so `useTradeForm` returns the body and the footer separately.
//
// Every number here is the exchange server's (POST /v1/prepare/swap): the
// quote, the price after, the minimum you get, and whether the trading rule
// allows it (the server simulates the swap against the hook). There is no
// local estimate. Pressing the button prepares again with the minimum you were
// shown pinned, sends any approvals the server lists, then the swap
// (components/providers.tsx `runTx`).

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useApp } from "@/components/providers";
import { TickerMark } from "@/components/company/logos";
import { AmountField, Button, CopyAddress, Details, KV, Segmented, Sheet, Stepper, TickerLogo, cx } from "@/components/ui";
import { dateTimeIST, lotFixed, shares, usdc } from "@/lib/format";
import type { Ipo, Market, Rejected } from "@/lib/mock";
import { band, bandDigits } from "@/lib/policy";
import { api, type DecodedError, type Prepared, type SwapDetails } from "@/lib/api";
import { sharesHeld } from "@/lib/adapt";
import { useQuote } from "@/lib/use-quote";
import { SHARE_DECIMALS, USDC_DECIMALS, formatRaw, parseAmount, slippageToBps } from "@/lib/units";
import { approvalTitle, bandRejection } from "@/lib/trade-copy";
import type { TxProgress } from "@/lib/tx";

export type TradeSide = "buy" | "sell";

type Opts = {
  ipo: Ipo;
  market: Market;
  side: TradeSide;
  setSide: (s: TradeSide) => void;
  /** Called after a confirmed trade (the sheet closes, the panel resets). */
  onDone?: () => void;
  /** A sent swap that the network reverted. */
  onRejected?: (r: Rejected) => void;
};

type Verdict = { ok: true; text: string } | { ok: false; text: string; fix: string } | { ok: null; text: string };

/** Plain-English verdict from the server's quote and simulation: what happens and what to do about it. */
function verdictOf(market: Market, p: Prepared<SwapDetails>): Verdict {
  const pol = market.policy;
  const d = bandDigits(pol.referencePrice, pol.bandBps);
  const { lo, hi } = band(pol.referencePrice, pol.bandBps);
  const q = p.details.quote;
  const err: DecodedError | null = (!q.ok ? q.error : null) ?? (p.simulate.ok === false ? p.simulate.error : null);
  if (err) {
    const after = q.priceAfter;
    if ((err.name === "OutOfBand" || err.name === "DirectionalWidening") && after !== null) {
      return {
        ok: false,
        text: err.name === "DirectionalWidening"
          ? "Not allowed: this trade moves the price further from the reference, beyond today's tighter limit. Prices shown are rounded; the exchange checks the full on-chain price."
          : bandRejection(`${lotFixed(lo, d)} to ${lotFixed(hi, d)}`, after),
        fix: err.name === "DirectionalWidening" ? "Try a smaller amount or the other side." : "Try a smaller amount.",
      };
    }
    return { ok: false, text: `Not allowed: ${err.message}`, fix: "" };
  }
  if (p.simulate.ok === null) return { ok: null, text: "The exchange couldn't check this in advance. It checks again before your wallet sends it." };
  return { ok: true, text: `Allowed · within today's limits ${lotFixed(lo, d)} to ${lotFixed(hi, d)}` };
}

const pct = (bps: number | null) => (bps === null ? "No quote yet" : `${bps >= 0 ? "+" : "-"}${(Math.abs(bps) / 100).toFixed(2)}%`);

export function useTradeForm({ ipo, market, side, setSide, onDone, onRejected }: Opts): { body: ReactNode; footer: ReactNode } {
  const { connected, connect, address, portfolio, usdcBalance, runTx, canSign, txBusy } = useApp();
  const held = sharesHeld(portfolio.data, ipo.ticker);
  const holding = portfolio.data?.holdings.find((h) => h.ticker === ipo.ticker) ?? null;
  const [amount, setAmount] = useState(side === "buy" ? "1" : "1000");
  const [slippage, setSlippage] = useState<"0.5" | "1" | "2">("0.5");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TxProgress | null>(null);

  const decimals = side === "buy" ? USDC_DECIMALS : SHARE_DECIMALS;
  const parsed = parseAmount(amount, decimals);
  const slippageBps = slippageToBps(slippage);
  const from = address as `0x${string}`;

  // Exact balances (raw units) for the "more than you have" check; unknown until the portfolio loads.
  const balanceRaw = side === "buy" ? portfolio.data?.balances.raw.usdc : holding?.raw.balance;
  const shortOfMoney = parsed.ok && balanceRaw !== undefined && parsed.raw > BigInt(balanceRaw);

  const key = connected && parsed.ok ? `${ipo.ticker}:${from}:${side}:${parsed.raw}:${slippageBps}` : null;
  const quote = useQuote(key, () => api.prepareSwap({ ticker: ipo.ticker, from, side, amountRaw: parsed.ok ? parsed.raw.toString() : "0", slippageBps }));
  const prepared = quote.status === "ready" && quote.value.details?.quote ? quote.value : null;
  const verdict = prepared ? verdictOf(market, prepared) : null;
  const q = prepared?.details.quote ?? null;
  const approvals = prepared ? prepared.steps.filter((s) => s.needed && s.kind !== "swap") : [];

  const lastPrice = market.prices[market.prices.length - 1].value;

  const switchSide = (s: TradeSide) => {
    setSide(s);
    setAmount(s === "buy" ? "1" : "1000");
  };

  const send = async () => {
    if (!prepared || !parsed.ok || busy || txBusy) return;
    const amountRaw = parsed.raw.toString();
    // Pin the minimum the user was shown: a re-prepare after approvals reads a
    // fresh quote, and must not quietly accept a worse fill than this.
    const minOutRaw = prepared.details.raw.minOut;
    setBusy(true);
    try {
      const r = await runTx<SwapDetails>({
        title: side === "buy" ? `Buying ${ipo.name} shares` : `Selling ${ipo.name} shares`,
        success: side === "buy" ? `Bought ${ipo.name} shares` : `Sold ${ipo.name} shares`,
        failTitle: side === "buy" ? "Your purchase didn't go through" : "Your sale didn't go through",
        prepare: () => api.prepareSwap({ ticker: ipo.ticker, from, side, amountRaw, minOutRaw, slippageBps }),
        guard: (p) => (p.details.quote && !p.details.quote.ok ? (p.details.quote.error?.message ?? "The exchange won't take this trade right now.") : null),
        onProgress: setProgress,
      });
      if (r.ok) onDone?.();
      else if (r.reason === "reverted" && r.tx)
        onRejected?.({
          time: new Date().toISOString(),
          side,
          usdc: side === "buy" ? parsed.value : (q?.amountOut ?? 0),
          priceAfter: q?.priceAfter ?? lastPrice,
          reason: "Reverted",
          detail: r.message,
          tx: r.tx,
        });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const max = () => {
    const raw = side === "buy" ? portfolio.data?.balances.raw.usdc : holding?.raw.balance;
    if (raw !== undefined) setAmount(formatRaw(BigInt(raw), decimals));
  };

  const have =
    side === "buy"
      ? usdcBalance === null
        ? connected
          ? "Loading your balance"
          : "Sign in to see your balance"
        : `You have ${usdc(usdcBalance)} USDC`
      : portfolio.data
        ? `You own ${shares(held)} shares`
        : connected
          ? "Loading your shares"
          : "Sign in to see your shares";

  const quoteLine = (): ReactNode => {
    if (!connected) return <KV k="You'll get about" v="Sign in for a quote" />;
    if (!parsed.ok) return <KV k="You'll get about" v={amount.trim() ? parsed.error : "Enter an amount"} />;
    if (quote.status === "loading" && !prepared) return <KV k="You'll get about" v="Getting a quote…" />;
    if (quote.status === "error") return <KV k="You'll get about" v="No quote" sub={(quote.error as { sentence?: string })?.sentence ?? "The exchange couldn't quote this. Try again."} />;
    if (quote.status === "ready" && !q) return <KV k="You'll get about" v="No quote" sub="The exchange sent no quote for this." />;
    if (!q || !prepared) return null;
    if (!q.ok || q.amountOut === null)
      return <KV k="You'll get about" v="Trade blocked" sub="No tokens will move. Try a smaller amount or check the trading rule below." />;
    return (
      <>
        <KV
          k="You'll get about"
          v={side === "buy" ? `${shares(q.amountOut)} shares` : `${usdc(q.amountOut)} USDC`}
          sub={`At least ${side === "buy" ? shares(prepared.details.minOut) : usdc(prepared.details.minOut)} after ${slippage}% price movement`}
        />
        <KV
          k="Price after your trade"
          v={q.priceAfter === null ? "Could not estimate" : q.priceAfter.toFixed(3)}
          sub={`Price now ${lotFixed(q.priceBefore ?? lastPrice)}${q.avgPrice !== null ? ` · you pay on average ${lotFixed(q.avgPrice)}` : ""}`}
        />
      </>
    );
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
        onMax={balanceRaw !== undefined ? max : undefined}
        error={
          shortOfMoney
            ? side === "buy"
              ? `You have ${usdc(usdcBalance ?? 0)} USDC. Enter that or less.`
              : `You own ${shares(held)} shares. Enter that or less.`
            : undefined
        }
        helper={have}
      />

      <div className="mt-4 divide-y divide-line">{quoteLine()}</div>

      {verdict && (
        <div
          className={cx(
            "mt-4 flex min-h-12 items-start gap-2 border-y border-line py-3",
            verdict.ok === true ? "text-gain-text" : verdict.ok === false ? "text-loss-text" : "text-text-2",
          )}
        >
          {verdict.ok === true ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span className="t-body">
            {verdict.text}
            {verdict.ok === false && verdict.fix && <span className="block text-text">{verdict.fix}</span>}
          </span>
        </div>
      )}
      {prepared?.details.warnings?.map((w) => (
        <p key={w} className="t-label mt-2">
          {w}
        </p>
      ))}

      <Details title="More options" className="mt-2">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2">
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
          {q?.ok ? <>
            <KV k="Effect on the price" v={pct(q.priceImpactBps)} />
            {q.avgPriceVsSpotBps !== null && <KV k="Average price vs price now" v={pct(q.avgPriceVsSpotBps)} />}
          </> : <p className="t-label py-3">Price comparisons appear once you have an allowed quote.</p>}
        </div>
      </Details>

      <Details className="mt-2">
        <div className="divide-y divide-line">
          {prepared?.permit2 && <>
            <KV k="Token contract" v={<CopyAddress value={prepared.permit2.token} />} />
            <KV k="Trade contract" v={<CopyAddress value={prepared.permit2.spender} />} />
            <KV k="Trade permission ends" v={dateTimeIST(prepared.permit2.expiration)} />
          </>}
          <KV k="Route" v="Universal Router · Uniswap v4 pool" />
          <KV k="Quote source" v="Exchange server · V4Quoter (exact in)" />
          <KV k="Pool id" v={<CopyAddress value={ipo.records.pool} />} />
          {q?.priceAfter != null && <KV k="Raw price after" v={`${q.priceAfter.toFixed(6)} (${q.priceAfterSource ?? "unknown"})`} mono />}
          {prepared && <KV k="Checked with" v={`${prepared.simulate.method} at block ${prepared.simulate.block}`} mono />}
          {(q?.error ?? prepared?.simulate.error) && <KV k="Reason code" v={(q?.error ?? prepared?.simulate.error)?.name} mono />}
          <KV k="Rule mirrored" v={`ListingHook.afterSwap · ${market.policy.mode}`} mono />
        </div>
      </Details>
    </>
  );

  const stepTitles = [...approvals.map((s) => approvalTitle(s.kind, side === "buy" ? "USDC" : "shares")), side === "buy" ? "Buy" : "Sell"];
  const current = progress && progress.phase !== "preparing" ? Math.min(stepTitles.length, progress.index + 1) : 1;
  const canSend = connected && canSign && !!prepared && verdict?.ok !== false && !shortOfMoney && !busy && !txBusy;

  const footer = (
    <>
      {approvals.length > 0 && (
        <Stepper
          className="mb-3"
          current={busy ? current : 1}
          steps={stepTitles.map((title, i) => ({
            title,
            sub: i < approvals.length
              ? approvals[i].kind === "permit2Approve"
                ? "Only for this trade amount. See Details for the contract and expiry."
                : `Approve once so trades can move your ${side === "buy" ? "USDC" : "shares"}.`
              : "Confirm the trade. You get at least the minimum shown.",
          }))}
        />
      )}
      {!connected ? (
        <Button variant={side === "buy" ? "buy" : "sell"} size="bar" className="w-full" onClick={connect}>
          Sign in to trade
        </Button>
      ) : (
        <Button variant={side === "buy" ? "buy" : "sell"} size="bar" className="w-full" busy={busy} disabled={!canSend} onClick={send}>
          {busy
            ? "Check your wallet app"
            : verdict?.ok === false
              ? "Not allowed today"
              : side === "buy"
                ? `Buy for ${parsed.ok ? usdc(parsed.value) : "0"} USDC`
                : `Sell ${parsed.ok ? shares(parsed.value) : "0"} shares`}
        </Button>
      )}
      {connected && !canSign && (
        <p className="t-label mt-2 text-center">
          {"This sign-in can look but not send. Sign in with a wallet to trade."}
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
        <span className="t-label">
          <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} />
          {ipo.sector ? ` · ${ipo.sector}` : ""}
        </span>
      </div>
      {body}
    </Sheet>
  );
}
