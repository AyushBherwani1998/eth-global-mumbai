"use client";

// Issuer console index: the listings registered to the signed-in issuer wallet.
// The console is a separate app: its own sign-in (components/console/session),
// its own shell, and no investor chrome anywhere.

import Link from "next/link";

import { ConsoleShell, ConsoleSignIn } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { EmptyState, Table, TickerLogo, cx, statusLabel, type Column } from "@/components/ui";
import { usdc } from "@/lib/format";
import { CONSOLE, OFFER, ensName, getIpo, type Ipo } from "@/lib/mock";

const NEXT: Record<string, string> = {
  create: "Create the listing",
  ticker: "Register the name",
  policy: "Publish the trading rule",
  launch: "Open the IPO",
  monitor: "Watch applications",
  graduate: "List on the market",
  demo: "Run the exchange desk",
};

type Row = { ipo: Ipo; next: string; raised: number; applications: number };

export function ConsoleListScreen() {
  const { session } = useIssuerSession();
  if (!session) return <ConsoleSignIn />;

  const rows: Row[] = session.listings
    .map((t) => getIpo(t))
    .filter((i): i is Ipo => Boolean(i))
    .map((ipo) => {
      const step = (CONSOLE as unknown as Record<string, { step?: string }>)[ipo.ticker]?.step ?? "create";
      return { ipo, next: NEXT[step] ?? "Create the listing", raised: ipo.raised ?? 0, applications: ipo.bidCount ?? 0 };
    });

  const columns: Column<Row>[] = [
    {
      key: "listing",
      label: "Listing",
      render: (r) => (
        <span className="flex items-center gap-3">
          <TickerLogo ipo={r.ipo} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-text">{r.ipo.name}</span>
            <span className="t-label block truncate">{ensName(r.ipo.ticker)}</span>
          </span>
        </span>
      ),
    },
    { key: "phase", label: "Phase", render: (r) => statusLabel(r.ipo) },
    { key: "raised", label: "Raised", align: "right", render: (r) => `${usdc(r.raised)} / ${OFFER.targetRaise}` },
    { key: "applications", label: "Applications", align: "right", render: (r) => String(r.applications) },
    { key: "next", label: "Next", render: (r) => r.next },
    {
      key: "open",
      label: "",
      align: "right",
      render: (r) => (
        <Link href={`/console/${r.ipo.ticker}`} className="t-change-sm text-gain-text">
          Open
        </Link>
      ),
    },
  ];

  return (
    <ConsoleShell>
      <h1 className="t-page-title mt-6">Your listings</h1>
      <p className="t-label mt-1">
        {session.ensName ?? "This wallet"} manages {rows.length} {rows.length === 1 ? "listing" : "listings"}. Investors never see this screen.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No listing is registered to this wallet"
          body="Register a company name on Listing Day with this wallet, or sign out and connect the wallet that owns the listing."
        />
      ) : (
        <>
          <div className="mt-6 hidden lg:block">
            <Table columns={columns} rows={rows} rowKey={(r) => r.ipo.ticker} href={(r) => `/console/${r.ipo.ticker}`} />
          </div>
          <div className="mt-4 divide-y divide-line lg:hidden">
            {rows.map((r) => (
              <Link key={r.ipo.ticker} href={`/console/${r.ipo.ticker}`} className="flex min-h-14 items-center gap-3 py-3">
                <TickerLogo ipo={r.ipo} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="t-list-title block truncate text-text">{r.ipo.name}</span>
                  <span className="t-label block truncate">
                    {statusLabel(r.ipo)} · {ensName(r.ipo.ticker)}
                  </span>
                  <span className="t-label block truncate text-text">Next: {r.next}</span>
                </span>
                <span className="num flex w-[104px] shrink-0 flex-col items-end text-right">
                  <span className="t-list-title text-text">{usdc(r.raised)}</span>
                  <span className="t-label">of {OFFER.targetRaise} USDC</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className={cx("t-caption mt-8")}>Prices and amounts in USDC per 1,000 shares. Sample data, not live chain reads.</p>
    </ConsoleShell>
  );
}
