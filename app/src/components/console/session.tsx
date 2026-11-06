"use client";

// Who may open the issuer console.
//
// The gate is the connected wallet. With an exchange server configured, each
// listing is checked with GET /v1/issuer/:ticker?address= (`check.isIssuer`):
// the ENS owner of the ticker name, else the deployment's issuer wallet. That
// is the "api" gate. Without a server there is nothing to read, so the
// signed-in address is compared with the listing owner from the deployment
// config (NEXT_PUBLIC_ISSUER_ADDRESS; see components/wallet/env.ts): the
// "checked" gate. There is no editable local flag and no URL parameter that
// grants access.
//
// When neither is available there is nothing to check against. The console
// then runs in demo mode, which every console screen announces on screen, so
// an open console is never mistaken for a passed check.

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useWalletSession } from "@/components/wallet/session";
import { LISTING_OWNER, hasListingOwner } from "@/components/wallet/env";
import { apiConfigured, type ApiFailure, type Listing } from "@/lib/api";
import { useIssuerOf, useListings } from "@/lib/live";
import { WALLET } from "@/lib/mock";

export type ConsoleAccess = {
  /** "api": checked with the exchange server. "checked": compared with the configured owner. "demo": nothing was checked. */
  gate: "api" | "checked" | "demo";
  /** False while the wallet session, or the issuer check, is still being read. */
  ready: boolean;
  connected: boolean;
  address: string | null;
  ensName: string | null;
  /** The configured owner address ("checked" gate only). */
  owner: string | null;
  /** True when the signed-in address passed the gate for at least one listing. Always false in demo mode. */
  isOwner: boolean;
  /** Tickers this session may open. Empty when the address is not the issuer. */
  listings: string[];
  /** The exchange's listing rows for `listings` (empty without a server). */
  rows: Listing[];
  /** The issuer check failed to read (the "api" gate). */
  error: ApiFailure | null;
  retry: () => void;
  signIn: () => void;
  signOut: () => void;
};

const Ctx = createContext<ConsoleAccess | null>(null);

export function IssuerSessionProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletSession();
  const address = wallet.connected ? wallet.address : null;
  const useApi = apiConfigured();
  const all = useListings();
  const tickers = useMemo(() => (useApi ? (all.data?.listings ?? []).map((l) => l.ticker) : []), [useApi, all.data]);
  const check = useIssuerOf(tickers, address);

  const value = useMemo<ConsoleAccess>(() => {
    const gate: ConsoleAccess["gate"] = useApi ? "api" : hasListingOwner ? "checked" : "demo";
    let listings: string[];
    if (gate === "api") listings = check.data ?? [];
    else if (gate === "checked") listings = address && address.toLowerCase() === LISTING_OWNER ? WALLET.isIssuerFor : [];
    // Demo mode has no owner to check, so a signed-in wallet sees the listings
    // and every screen carries the demo notice.
    else listings = address ? WALLET.isIssuerFor : [];
    const answered = !address || gate !== "api" || check.data !== null || check.error !== null || (all.error !== null && !all.data);
    return {
      gate,
      ready: wallet.ready && answered,
      connected: !!address,
      address,
      ensName: wallet.ensName,
      owner: gate === "checked" ? LISTING_OWNER : null,
      isOwner: gate !== "demo" && listings.length > 0,
      listings,
      rows: (all.data?.listings ?? []).filter((l) => listings.includes(l.ticker)),
      error: gate === "api" ? (check.error ?? all.error) : null,
      retry: () => {
        all.retry();
        check.retry();
      },
      signIn: wallet.login,
      signOut: wallet.logout,
    };
  }, [useApi, address, wallet.ready, wallet.ensName, wallet.login, wallet.logout, check, all]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIssuerSession(): ConsoleAccess {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIssuerSession outside the console layout");
  return v;
}
