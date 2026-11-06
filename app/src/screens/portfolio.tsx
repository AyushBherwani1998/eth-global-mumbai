"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Droplets } from "lucide-react";
import { AppBar } from "@/components/shell";
import { Button, Card, Change, Empty, KV, SectionTitle, TickerAvatar, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { changeVs, lotFixed, shares, usdc } from "@/lib/format";
import { FAUCET_URL, OFFER, PORTFOLIO, getIpo, getMarket, lastPrice } from "@/lib/mock";
import { Sparkline } from "@/components/sparkline";
import { BottomSpacer } from "./common";

export function PortfolioScreen() {
  const { connected, connect, usdcBalance, sendTx } = useApp();
  const [removed, setRemoved] = useState<number[]>([]);
  const [basis, setBasis] = useState<"clearing" | "issue">("clearing");

  if (!connected)
    return (
      <>
        <AppBar title="Portfolio" />
        <Empty title="Sign in to see your shares" body="Your holdings, returns and liquidity show up here." action={<Button variant="secondary" onClick={connect}>Sign in</Button>} />
      </>
    );

  const rows = PORTFOLIO.holdings.map((h) => {
    const ipo = getIpo(h.ticker)!;
    const qty = h.shares + h.unclaimedShares;
    const last = lastPrice(h.ticker)!;
    const value = (qty * last) / 1000;
    const costPrice = basis === "clearing" ? h.avgCost : OFFER.issuePrice;
    const cost = (qty * costPrice) / 1000;
    return { h, ipo, qty, last, value, cost, pnl: value - cost };
  });
  const invested = rows.reduce((s, r) => s + r.cost, 0);
  const current = rows.reduce((s, r) => s + r.value, 0);
  const total = changeVs(current, invested);
  const unclaimed = rows.filter((r) => r.h.unclaimedShares > 0);

  if (rows.length === 0)
    return (
      <>
        <AppBar title="Portfolio" />
        <Empty title="No holdings yet" body="Shares you're allotted in an IPO show up here after you claim them." />
      </>
    );

  return (
    <>
      <AppBar title="Portfolio" />
      <main>
        <Card className="p-4">
          <p className="text-[13px] text-text-2">Current value</p>
          <p className="num text-[28px] font-medium  text-text">
            {usdc(current)} <span className="text-[14px] font-medium text-text-2">USDC</span>
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[13px]">
              <Change abs={total.abs} rel={total.rel} /> <span className="text-text-2">total returns</span>
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1 rounded-full bg-surface-2 p-1 text-[13px]">
            {(
              [
                ["clearing", "vs clearing (your cost)"],
                ["issue", "vs issue 1.00"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setBasis(id)}
                className={cx("flex-1 rounded-full py-2 font-medium", basis === id ? "border border-chip-on-line bg-chip-on-bg text-text" : "border border-transparent text-text-2")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <div>
              <p className="text-[13px] text-text-2">Invested</p>
              <p className="num font-medium text-text">{usdc(invested)} USDC</p>
            </div>
            <div>
              <p className="text-[13px] text-text-2">USDC balance</p>
              <p className="num font-medium text-text">{usdc(usdcBalance)} USDC</p>
              {usdcBalance < OFFER.perApplicantCap && (
                <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-gain-text">
                  Get test USDC
                </a>
              )}
            </div>
          </div>
        </Card>

        {unclaimed.length > 0 && (
          <Link href="/orders" className="mt-3 block">
            <Card className="flex items-center gap-3 border-line bg-surface-2 p-3">
              <p className="flex-1 text-[13px] text-warn">
                <b>{shares(unclaimed.reduce((s, r) => s + r.h.unclaimedShares, 0))} shares unclaimed</b> across{" "}
                {unclaimed.map((r) => r.ipo.symbol).join(", ")}. Claim them in My bids.
              </p>
              <ChevronRight className="size-4 text-warn" />
            </Card>
          </Link>
        )}

        <SectionTitle>Holdings ({rows.length})</SectionTitle>
        <Card className="divide-y divide-line">
          {rows.map((r) => {
            const pnl = changeVs(r.value, r.cost);
            return (
              <Link key={r.h.ticker} href={`/stock/${r.h.ticker}`} className="flex items-center gap-3 p-3">
                <TickerAvatar ipo={r.ipo} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text">{r.ipo.name}</p>
                  <p className="num text-[13px] text-text-2">
                    {shares(r.qty)} sh · avg {lotFixed(basis === "clearing" ? r.h.avgCost : OFFER.issuePrice)}
                    {r.h.unclaimedShares > 0 && ` · ${shares(r.h.unclaimedShares)} unclaimed`}
                  </p>
                </div>
                <Sparkline points={getMarket(r.h.ticker)!.prices} width={56} height={26} up={pnl.abs >= 0} />
                <div className="w-[88px] text-right">
                  <p className="num text-[15px] font-medium text-text">{usdc(r.value)}</p>
                  <Change abs={pnl.abs} rel={pnl.rel} className="block text-[13px]" />
                </div>
              </Link>
            );
          })}
        </Card>

        {PORTFOLIO.lpPositions.length > 0 && (
          <>
            <SectionTitle>LP positions</SectionTitle>
            {PORTFOLIO.lpPositions.map((lp) => {
              const ipo = getIpo(lp.ticker)!;
              const gone = removed.includes(lp.id);
              return (
                <Card key={lp.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-gain-text">
                      <Droplets className="size-5" />
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-text">
                        {ipo.symbol} / USDC <span className="text-[13px] text-text-2">#{lp.id}</span>
                      </p>
                      <p className="text-[13px] text-text-2">Liquidity you provide to the market</p>
                    </div>
                  </div>
                  <div className="mt-2 divide-y divide-line">
                    <KV k="Range" v={`${lotFixed(lp.rangeLo)}–${lotFixed(lp.rangeHi)} USDC / lot`} />
                    <KV k="Liquidity" v={gone ? "0" : `${usdc(lp.liquidityUsdc)} USDC`} sub={gone ? undefined : `${shares(lp.liquidityShares)} ${ipo.symbol}`} />
                    <KV k="Fees earned" v={`${usdc(lp.feesUsdc)} USDC`} />
                  </div>
                  <Button
                    tone="neutral"
                    variant="outline"
                    className="mt-2 w-full"
                    disabled={gone}
                    onClick={async () => {
                      const r = await sendTx({ title: `Remove ${ipo.symbol}/USDC liquidity`, success: "Liquidity removed. LP exits work even when halted." });
                      if (r.ok) setRemoved((x) => [...x, lp.id]);
                    }}
                  >
                    {gone ? "Removed" : "Remove liquidity"}
                  </Button>
                </Card>
              );
            })}
          </>
        )}
        <p className="mt-4 text-[13px] text-text-2">Value uses the last v4 pool price, including unclaimed shares. Cost basis for IPO fills is the clearing price.</p>
        <BottomSpacer />
      </main>
    </>
  );
}

