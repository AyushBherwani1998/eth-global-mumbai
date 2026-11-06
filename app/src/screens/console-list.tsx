"use client";

// Issuer console index: the listings registered to the signed-in issuer wallet.
// The console is a separate app: its own sign-in (components/console/session),
// its own shell, and no investor chrome anywhere.

import Link from "next/link";

import { ConsoleShell, ConsoleSignIn, GateLine, NotTheOwner } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { SkeletonList } from "@/components/states";
import { EmptyState, Table, TickerLogo, statusLabel, type Column } from "@/components/ui";
import { usdc } from "@/lib/format";
import { CONSOLE, OFFER, ensName, getIpo, type Ipo } from "@/lib/mock";

const NEXT: Record<string, string> = {
  create: "Create the listing",
  ticker: "Register the name",
  policy: "Publish the trading rule",
  launch: "Open the IPO",
  monitor: "Watch applications",
  graduate: "List on the market",
  demo: "Watch the trading rule",
};

type Row = { ipo: Ipo; next: string; raised: number; applications: number };

export function ConsoleListScreen() {
  const { ready, connected, listings, ensName: signedInEns } = useIssuerSession();

  if (!ready) return <SkeletonList rows={4} className="pt-6" />;
  if (!connected) return <ConsoleSignIn />;
  if (listings.length === 0) return <NotTheOwner />;

  const rows: Row[] = listings
    .map((t) => getIpo(t))
    .filter((i): i is Ipo => Boolean(i))
    .map((ipo) => {
      const step = (CONSOLE as unknown as Record<string, { step?: string }>)[ipo.ticker]?.step ?? "create";
      return { ipo, next: NEXT[step] ?? "Create the listing", raised: ipo.raised ?? 0, applications: ipo.bidCount ?? 0 };
    });

  const totalRaised = rows.reduce((s, r) => s + r.raised, 0);
  const totalApplications = rows.reduce((s, r) => s + r.applications, 0);

  const columns: Column<Row>[] = [
    {
      key: "listing",
      label: "Listing",
      width: "32%",
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
    { key: "phase", label: "Phase", width: "12%", render: (r) => statusLabel(r.ipo) },
    { key: "next", label: "Next step", width: "22%", render: (r) => r.next },
    { key: "raised", label: "Raised", align: "right", width: "14%", render: (r) => `${usdc(r.raised)} / ${OFFER.targetRaise}` },
    { key: "applications", label: "Applications", align: "right", width: "12%", render: (r) => String(r.applications) },
    {
      key: "open",
      label: "",
      align: "right",
      width: "8%",
      render: (r) => (
        <Link href={`/console/${r.ipo.ticker}`} className="t-change-sm text-gain-text">
          Open
        </Link>
      ),
    },
  ];

  return (
    <ConsoleShell>
      <header className="border-b border-line py-5">
        <h1 className="t-page-title text-text">Your listings</h1>
        <p className="t-label mt-1">
          {signedInEns ?? "This wallet"} manages {rows.length} {rows.length === 1 ? "listing" : "listings"}. Investors never see this screen.
        </p>
        <GateLine className="mt-1" />
      </header>

      {rows.length > 0 && (
        <dl className="mt-6 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-3">
          {[
            { k: "Listings", v: String(rows.length) },
            { k: "Raised across listings", v: `${usdc(totalRaised)} USDC` },
            { k: "Applications", v: String(totalApplications) },
          ].map((c) => (
            <div key={c.k} className="bg-surface p-4">
              <dt className="t-label">{c.k}</dt>
              <dd className="num t-list-title mt-1 text-text">{c.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No listing is registered to this wallet"
          body="Register a company name on Thamba with this wallet, or sign out and sign in with the wallet that owns the listing."
        />
      ) : (
        <>
          <h2 className="t-section-title mt-8 text-text">Listings</h2>
          <div className="mt-2 hidden lg:block">
            <Table columns={columns} rows={rows} rowKey={(r) => r.ipo.ticker} href={(r) => `/console/${r.ipo.ticker}`} />
          </div>
          <div className="mt-2 divide-y divide-line border-t border-line lg:hidden">
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

      <p className="t-caption mt-8 border-t border-line pt-4">Prices and amounts in USDC per 1,000 shares. Sample data, not live chain reads.</p>
    </ConsoleShell>
  );
}
