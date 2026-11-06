"use client";

// Issuer console index: the listings registered to the signed-in issuer wallet.
// The console is a separate app: its own sign-in (components/console/session),
// its own shell, and no investor chrome anywhere. Rows are the exchange's
// listings (GET /v1/listings); the raise target is each listing's offer
// (GET /v1/listings/:ticker).

import Link from "next/link";

import { ConsoleShell, ConsoleSignIn, GateLine, NotTheOwner } from "@/components/console/shell";
import { useIssuerSession } from "@/components/console/session";
import { SkeletonList } from "@/components/states";
import { EmptyState, Table, TickerLogo, statusLabel, type Column } from "@/components/ui";
import { nextByPhase } from "@/components/console/lifecycle";
import { POLL, api, apiConfigured, type Listing } from "@/lib/api";
import { usdc } from "@/lib/format";
import { useLive } from "@/lib/live";

type Row = { ipo: Listing; next: string; raised: number | null; target: number | null; applications: number };

const raisedWords = (r: Row) => (r.raised === null ? "Not available" : usdc(r.raised));

export function ConsoleListScreen() {
  const { ready, connected, listings, rows: listed, ensName: signedInEns } = useIssuerSession();
  const tickers = listed.map((l) => l.ticker).join(",");
  const offers = useLive(
    tickers ? `console-offers:${tickers}` : null,
    async () => Object.fromEntries((await Promise.all(tickers.split(",").map((t) => api.listing(t)))).map((d) => [d.ticker, d.offer.targetRaise])),
    POLL.listings,
  );

  if (!ready) return <SkeletonList rows={4} className="pt-6" />;
  if (!connected) return <ConsoleSignIn />;
  if (listings.length === 0) return <NotTheOwner />;

  if (!apiConfigured())
    return (
      <ConsoleShell>
        <GateLine className="mt-5" />
        <EmptyState
          title="No exchange server is configured"
          body="The console reads every listing from the exchange server. Set NEXT_PUBLIC_API_URL and rebuild the app."
        />
      </ConsoleShell>
    );

  const rows: Row[] = listed.map((ipo) => ({
    ipo,
    next: nextByPhase(ipo.phase),
    raised: ipo.raised,
    target: offers.data?.[ipo.ticker] ?? null,
    applications: ipo.bidCount,
  }));

  const totalRaised = rows.reduce((s, r) => s + (r.raised ?? 0), 0);
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
            <span className="t-label block truncate">{r.ipo.ensName}</span>
          </span>
        </span>
      ),
    },
    { key: "phase", label: "Phase", width: "12%", render: (r) => statusLabel(r.ipo) },
    { key: "next", label: "Next step", width: "22%", render: (r) => r.next },
    { key: "raised", label: "Raised", align: "right", width: "14%", render: (r) => (r.target === null ? raisedWords(r) : `${raisedWords(r)} / ${r.target}`) },
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
                    {statusLabel(r.ipo)} · {r.ipo.ensName}
                  </span>
                  <span className="t-label block truncate text-text">Next: {r.next}</span>
                </span>
                <span className="num flex w-[104px] shrink-0 flex-col items-end text-right">
                  <span className="t-list-title text-text">{raisedWords(r)}</span>
                  {r.target !== null && <span className="t-label">of {r.target} USDC</span>}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="t-caption mt-8 border-t border-line pt-4">Prices and amounts in USDC per 1,000 shares, read from the exchange server.</p>
    </ConsoleShell>
  );
}
