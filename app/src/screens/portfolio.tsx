"use client";

// Portfolio (UX.md 3.8): what I own, what it's worth, how it did today.
// Summary 2x2 is the Groww mutual-fund dashboard card (design/reference/
// groww-mf-dashboard.png): Total value / Today, Invested / Since you bought.

import Link from "next/link";
import { useState } from "react";

import { AppBar } from "@/components/shell";
import { useApp } from "@/components/providers";
import { OfflineStrip } from "@/components/states";
import { CompanyLogo, TickerMark, logoColor, markVar } from "@/components/company/logos";
import { Sparkline } from "@/components/sparkline";
import {
  Button,
  Card,
  Change,
  Details,
  EmptyState,
  KV,
  ListRow,
  SectionTitle,
  SummaryCard,
  Table,
  TextLink,
  TickerLogo,
  type Column,
} from "@/components/ui";
import { changeVs, lotFixed, pct, shares, shortAddr, signed, usdc } from "@/lib/format";
import { FAUCET_URL, OFFER, PORTFOLIO, dayOpen, getIpo, getMarket, lastPrice, type Ipo } from "@/lib/mock";
import { BottomSpacer } from "./common";

type Holding = {
  ipo: Ipo;
  qty: number;
  waiting: number;
  avgCost: number;
  last: number;
  value: number;
  cost: number;
  today: { abs: number; rel: number };
};

const changeText = (abs: number, rel: number) => `${signed(abs)} (${pct(rel).replace("+", "").replace("-", "")})`;

function Allocation({ rows, total }: { rows: Holding[]; total: number }) {
  const base = total || 1;
  return (
    <section className="mt-4 lg:max-w-[776px]">
      <h2 className="t-label">Where the value sits</h2>
      <div className="mt-2 flex h-2 overflow-hidden bg-line" aria-hidden>
        {rows.map((r) => (
          <span key={r.ipo.ticker} style={{ width: `${(r.value / base) * 100}%`, background: logoColor(r.ipo.ticker) }} />
        ))}
      </div>
      <ul className="mt-2">
        {rows.map((r) => (
          <li key={r.ipo.ticker} className="flex h-12 items-center gap-3">
            <CompanyLogo ticker={r.ipo.ticker} size={20} />
            <span className="t-body min-w-0 flex-1 truncate text-text">{r.ipo.name}</span>
            <span className="num t-body font-medium" style={{ color: markVar(r.ipo.ticker) }}>
              {Math.round((r.value / base) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PortfolioScreen() {
  const { connected, connect, usdcBalance, ethBalance, address, ensName, isIssuerFor, sendTx } = useApp();
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  if (!connected)
    return (
      <>
        <AppBar title="Portfolio" />
        <main>
          <EmptyState title="Sign in to see your shares" body="What you own, what it is worth and how it did today." />
          <Button className="mt-1" onClick={connect}>
            Sign in
          </Button>
          <BottomSpacer />
        </main>
      </>
    );

  const rows: Holding[] = PORTFOLIO.holdings.map((h) => {
    const ipo = getIpo(h.ticker)!;
    const qty = h.shares + h.unclaimedShares;
    const last = lastPrice(h.ticker)!;
    const open = dayOpen(h.ticker) ?? last;
    return {
      ipo,
      qty,
      waiting: h.unclaimedShares,
      avgCost: h.avgCost,
      last,
      value: (qty * last) / 1000,
      cost: (qty * h.avgCost) / 1000,
      today: {
        abs: (qty * (last - open)) / 1000,
        rel: ((last - open) / open) * 100,
      },
    };
  });

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const invested = rows.reduce((s, r) => s + r.cost, 0);
  const todayAbs = rows.reduce((s, r) => s + r.today.abs, 0);
  const todayRel = totalValue - todayAbs > 0 ? (todayAbs / (totalValue - todayAbs)) * 100 : 0;
  const since = changeVs(totalValue, invested);
  const waiting = rows.reduce((s, r) => s + r.waiting, 0);
  const lowCash = usdcBalance < OFFER.perApplicantCap;

  // Only the wallet that owns the position sees it (UX.md 3.8 item 6).
  const myLp = PORTFOLIO.lpPositions.filter((lp) => lp.owner === "wallet" || (lp.owner === "issuer" && isIssuerFor.includes(lp.ticker)));

  if (rows.length === 0)
    return (
      <>
        <AppBar title="Portfolio" />
        <main>
          <EmptyState
            title="Nothing here yet"
            body="Shares you buy, or get from an IPO, show up here."
            action={{ label: "See companies", href: "/" }}
          />
          <BottomSpacer />
        </main>
      </>
    );

  const holdingColumns: Column<Holding>[] = [
    {
      key: "company",
      label: "Company",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.ipo} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.ipo.name}</span>
            <span className="num t-label block">
              <TickerMark ticker={r.ipo.ticker} symbol={r.ipo.symbol} /> · {shares(r.qty)} shares · bought at {lotFixed(r.avgCost)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "spark",
      label: "",
      width: "80px",
      render: (r) => <Sparkline points={getMarket(r.ipo.ticker)?.prices ?? []} width={72} height={28} up={r.today.abs >= 0} />,
    },
    {
      key: "price",
      label: "Price",
      align: "right",
      render: (r) => lotFixed(r.last),
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      render: (r) => usdc(r.value),
    },
    {
      key: "today",
      label: "Today",
      align: "right",
      render: (r) => <Change abs={r.today.abs} rel={r.today.rel} />,
    },
    {
      key: "since",
      label: "Since you bought",
      align: "right",
      render: (r) => <Change abs={r.value - r.cost} rel={((r.value - r.cost) / r.cost) * 100} />,
    },
  ];

  return (
    <>
      <AppBar title="Portfolio" />
      <OfflineStrip className="-mx-5" />
      <main>
        <SectionTitle>Your investments ({rows.length})</SectionTitle>
        <SummaryCard
          cells={[
            { label: "Total value", value: `${usdc(totalValue)} USDC` },
            {
              label: "Today",
              value: changeText(todayAbs, todayRel),
              tone: todayAbs >= 0 ? "gain" : "loss",
            },
            { label: "Invested", value: `${usdc(invested)} USDC` },
            {
              label: "Since you bought",
              value: changeText(since.abs, since.rel),
              tone: since.abs >= 0 ? "gain" : "loss",
            },
          ]}
          footer={{ left: "Prices in USDC per 1,000 shares" }}
          className="lg:max-w-[776px]"
        />

        <Allocation rows={rows} total={totalValue} />

        {waiting > 0 && (
          <Link href="/orders" className="mt-3 block lg:max-w-[776px]">
            <Card className="flex min-h-14 items-center gap-3 p-4" interactive>
              <p className="t-body flex-1 text-text">
                <span className="text-warn">{shares(waiting)} shares waiting.</span> Collect them in Orders.
              </p>
              <span className="t-change-sm shrink-0 text-gain-text">Open Orders</span>
            </Card>
          </Link>
        )}

        <div className="lg:grid lg:grid-cols-[776px_400px] lg:items-start lg:gap-6">
          <div className="min-w-0">
            <SectionTitle>Your shares ({rows.length})</SectionTitle>
            <div className="divide-y divide-line lg:hidden">
              {rows.map((r) => (
                <ListRow
                  key={r.ipo.ticker}
                  href={`/stock/${r.ipo.ticker}`}
                  logo={<TickerLogo ipo={r.ipo} size={40} />}
                  title={r.ipo.name}
                  sub={
                    <>
                      <TickerMark ticker={r.ipo.ticker} symbol={r.ipo.symbol} /> · {shares(r.qty)} shares · bought at {lotFixed(r.avgCost)}
                    </>
                  }
                  sparkline={<Sparkline points={getMarket(r.ipo.ticker)?.prices ?? []} width={56} height={26} up={r.today.abs >= 0} />}
                  right={usdc(r.value)}
                  rightSub={<Change abs={r.today.abs} rel={r.today.rel} />}
                />
              ))}
            </div>
            <div className="hidden lg:block">
              <Table columns={holdingColumns} rows={rows} rowKey={(r) => r.ipo.ticker} href={(r) => `/stock/${r.ipo.ticker}`} />
            </div>
          </div>

          <div className="min-w-0">
            <SectionTitle>Cash</SectionTitle>
            <Card className="p-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="t-body text-text">USDC available</p>
                <p className="num t-list-title text-text">{usdc(usdcBalance)}</p>
              </div>
              <p className="t-label mt-1">This is what you can spend on shares and IPO applications.</p>
              {lowCash && (
                <p className="mt-1">
                  <TextLink href={FAUCET_URL}>Get free test USDC</TextLink>
                </p>
              )}
              <Details className="mt-3">
                <div className="divide-y divide-line">
                  <KV k="ETH for network fees" v={ethBalance.toFixed(4)} />
                  <KV k="Signed in as" v={ensName ?? shortAddr(address)} />
                </div>
              </Details>
            </Card>

            {myLp.length > 0 && (
              <>
                <SectionTitle>Liquidity you provide</SectionTitle>
                {myLp.map((lp) => {
                  const ipo = getIpo(lp.ticker)!;
                  const gone = removed.includes(lp.id);
                  return (
                    <Card key={lp.id} className="p-4">
                      <p className="t-list-title text-text">{ipo.name}</p>
                      <p className="num t-label mt-0.5">
                        <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> ·{" "}
                        {gone ? "Nothing left in the market" : `${usdc(lp.liquidityUsdc)} USDC + ${shares(lp.liquidityShares)} shares`} · earned{" "}
                        {usdc(lp.feesUsdc)}
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-3 w-full"
                        disabled={gone || busy}
                        busy={busy}
                        onClick={async () => {
                          setBusy(true);
                          const r = await sendTx({
                            title: `Withdrawing your liquidity from ${ipo.name}`,
                            success: "Liquidity withdrawn",
                          });
                          setBusy(false);
                          if (r.ok) setRemoved((x) => [...x, lp.id]);
                        }}
                      >
                        {gone ? "Withdrawn" : busy ? "Check your wallet app" : "Withdraw liquidity"}
                      </Button>
                      <p className="t-label mt-2">Works even while trading is halted.</p>
                    </Card>
                  );
                })}
              </>
            )}

            <p className="t-caption mt-6">
              Value uses the last traded price and includes shares waiting to be collected. NSE-inspired mock, not a regulated product.
            </p>
          </div>
        </div>
        <BottomSpacer />
      </main>
    </>
  );
}
