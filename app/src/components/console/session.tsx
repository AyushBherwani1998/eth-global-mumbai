"use client";

// Issuer session: the console is a separate app with its own sign-in. It never
// reads the investor session in providers.tsx, and signing in here does not
// sign anyone into the investor app (or the other way round). The session is a
// small module store persisted in localStorage, exposed through a provider that
// is mounted only by the console layout.

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { WALLET } from "@/lib/mock";

const KEY = "listingday.issuer-session";

export type IssuerSession = {
  address: string;
  ensName: string | null;
  /** Tickers whose name is registered to this wallet. */
  listings: string[];
};

/** The demo issuer wallet, and a second wallet that owns no listing. */
const ISSUER_WALLET: IssuerSession = { address: WALLET.address, ensName: WALLET.ensName, listings: WALLET.isIssuerFor };
const OTHER_WALLET: IssuerSession = { address: "0x19bD4f2A77c6E0b31d8a95C4e7F0a2B6d3C102aF", ensName: null, listings: [] };
const ISSUER_RAW = JSON.stringify(ISSUER_WALLET);
const OTHER_RAW = JSON.stringify(OTHER_WALLET);

// ---------------------------------------------------------------------------
// Module store. React only ever sees a string, so the snapshot identity is
// stable; the provider parses it once per change.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let stored: string | null = null;
let storedFresh = false;
/** False until the first subscribe, which runs after hydration. */
let hydrated = false;

function emit() {
  storedFresh = false;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  if (!hydrated) {
    // The server rendered the signed-out tree; swap in the real session right
    // after hydration instead of during it (no mismatch, no setState in an effect).
    hydrated = true;
    queueMicrotask(emit);
  }
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Screenshot / demo override, like ?theme= in the root layout. Never persisted. */
function override(): string | null {
  const v = new URLSearchParams(window.location.search).get("issuer");
  if (v === "1") return ISSUER_RAW;
  if (v === "none") return OTHER_RAW;
  return null;
}

function getSnapshot(): string | null {
  if (!hydrated) return null;
  const forced = override();
  if (forced) return forced;
  if (!storedFresh) {
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    storedFresh = true;
  }
  return stored;
}

const getServerSnapshot = () => null;

function write(session: IssuerSession | null) {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: the session then lasts for this page only.
  }
  emit();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type SessionState = {
  session: IssuerSession | null;
  signIn: () => void;
  /** Signs in a wallet that owns no listing, so that state is reachable. */
  signInOther: () => void;
  signOut: () => void;
};

const Ctx = createContext<SessionState | null>(null);

export function IssuerSessionProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const session = useMemo<IssuerSession | null>(() => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as IssuerSession;
      return parsed && typeof parsed.address === "string" ? parsed : null;
    } catch {
      return null;
    }
  }, [raw]);

  const signIn = useCallback(() => write(ISSUER_WALLET), []);
  const signInOther = useCallback(() => write(OTHER_WALLET), []);
  const signOut = useCallback(() => write(null), []);

  const value = useMemo<SessionState>(() => ({ session, signIn, signInOther, signOut }), [session, signIn, signInOther, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIssuerSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIssuerSession outside the console layout");
  return v;
}
