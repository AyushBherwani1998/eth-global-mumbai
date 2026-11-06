"use client";

// Who may open the issuer console.
//
// The gate is the connected wallet. The signed-in address is compared with the
// listing owner address that comes from the deployment config
// (NEXT_PUBLIC_ISSUER_ADDRESS, mirroring contracts/deployments/<network>.json;
// see components/wallet/env.ts for why the backend cannot supply it). There is
// no editable local flag and no URL parameter that grants access.
//
// When no owner address is configured there is nothing to check against. The
// console then runs in demo mode, which every console screen announces on
// screen, so an open console is never mistaken for a passed check.

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useWalletSession } from "@/components/wallet/session";
import { LISTING_OWNER, hasListingOwner } from "@/components/wallet/env";
import { WALLET } from "@/lib/mock";

/** The tickers this deployment has a console for. */
const DEPLOYED_LISTINGS = WALLET.isIssuerFor;

export type ConsoleAccess = {
  /** "checked": the address was compared with the configured owner. "demo": nothing was checked. */
  gate: "checked" | "demo";
  /** False only while the wallet session is still being read. */
  ready: boolean;
  connected: boolean;
  address: string | null;
  ensName: string | null;
  /** The configured owner address, or null in demo mode. */
  owner: string | null;
  /** True when the signed-in address is the configured owner. Always false in demo mode. */
  isOwner: boolean;
  /** Listings this session may open. Empty when the address is not the owner. */
  listings: string[];
  signIn: () => void;
  signOut: () => void;
};

const Ctx = createContext<ConsoleAccess | null>(null);

export function IssuerSessionProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletSession();

  const value = useMemo<ConsoleAccess>(() => {
    const address = wallet.connected ? wallet.address : null;
    const isOwner = hasListingOwner && !!address && address.toLowerCase() === LISTING_OWNER;
    // Demo mode has no owner to check, so a signed-in wallet sees the listings
    // and every screen carries the demo notice.
    const listings = hasListingOwner ? (isOwner ? DEPLOYED_LISTINGS : []) : address ? DEPLOYED_LISTINGS : [];
    return {
      gate: hasListingOwner ? "checked" : "demo",
      ready: wallet.ready,
      connected: !!address,
      address,
      ensName: wallet.ensName,
      owner: LISTING_OWNER,
      isOwner,
      listings,
      signIn: wallet.login,
      signOut: wallet.logout,
    };
  }, [wallet.ready, wallet.connected, wallet.address, wallet.ensName, wallet.login, wallet.logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIssuerSession(): ConsoleAccess {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIssuerSession outside the console layout");
  return v;
}
