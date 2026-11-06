"use client";

// Issuer console index (UX.md 3.9): the signed-in wallet's listings.

import { AppBar } from "@/components/shell";
import { useApp } from "@/components/providers";
import { EmptyState, ListRow, TickerLogo, statusLabel } from "@/components/ui";
import { CONSOLE, ensName, getIpo } from "@/lib/mock";

const NEXT: Record<string, string> = {
  create: "Next: save the listing",
  ticker: "Next: register the ticker",
  policy: "Next: publish the trading rule",
  launch: "Next: open the IPO",
  monitor: "IPO open · watching applications",
  graduate: "Next: open the market",
  demo: "Listed · exchange desk",
};

export function ConsoleListScreen() {
  const { connected, isIssuerFor } = useApp();
  const tickers = isIssuerFor.filter((t) => getIpo(t));
  return (
    <>
      <AppBar title="Console" />
      <main>
        {!connected ? (
          <EmptyState title="Sign in to manage a listing" body="The console opens for the wallet that owns a ticker." />
        ) : tickers.length === 0 ? (
          <EmptyState title="No listings yet" body="This wallet doesn't own a ticker on Listing Day." />
        ) : (
          <div className="mt-2 divide-y divide-line">
            {tickers.map((t) => {
              const ipo = getIpo(t)!;
              const step = (CONSOLE as unknown as Record<string, { step?: string }>)[t]?.step ?? "create";
              return (
                <ListRow
                  key={t}
                  href={`/console/${t}`}
                  logo={<TickerLogo ipo={ipo} size={40} />}
                  title={ipo.name}
                  sub={`${ensName(t)} · ${NEXT[step] ?? ""}`}
                  right={statusLabel(ipo)}
                  chevron
                />
              );
            })}
          </div>
        )}
        <p className="t-caption mt-6">Runner {CONSOLE.runnerOnline ? "online" : "offline"}. Exchange actions need the runner on the demo laptop.</p>
      </main>
    </>
  );
}
