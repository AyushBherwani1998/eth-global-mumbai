"use client";

// Fallback sign-in for builds with no NEXT_PUBLIC_PRIVY_APP_ID.
//
// Privy hard-fails without a valid app id: PrivyProvider never reaches `ready`,
// so `connect()` would do nothing and the whole demo would be stuck signed out.
// Rather than ship that, a build with no app id mounts this instead: the same
// three ways in that Privy would offer, in our own sheet, with the same
// WalletSession shape. A browser wallet gives a real address and can sign;
// email gives a deterministic demo address, the way an embedded wallet would,
// but has no keys, so it (like the demo account) can look but not send.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getAddress, keccak256, toHex } from "viem";
import { createPortal } from "react-dom";
import { WALLET } from "@/lib/mock";
import type { Eip1193, WalletSigner } from "@/lib/tx";
import { Button, Sheet } from "../ui";
import { WalletSessionContext, type WalletSession } from "./session-context";
import { useEnsName } from "./ens";

const KEY = "thamba.session";

type Stored = { address: string; via: "email" | "wallet" | "demo"; email?: string };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return typeof v?.address === "string" ? v : null;
  } catch {
    return null;
  }
}

function write(v: Stored | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {}
}

// localStorage as a tiny external store, so the first client render matches the
// server HTML and the session is read without a setState cascade.
const listeners = new Set<() => void>();
let cached: Stored | null | undefined;

function snapshot(): Stored | null {
  if (cached === undefined) cached = read();
  return cached;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function store(v: Stored | null) {
  write(v);
  cached = v;
  listeners.forEach((l) => l());
}

const serverSnapshot = () => null;
const clientReady = () => true;
const serverReady = () => false;

/** A stable address for an email, the way an embedded wallet would be stable per account. */
export function demoAddressFor(seed: string) {
  const h = keccak256(toHex(`thamba:${seed.trim().toLowerCase()}`));
  return getAddress(`0x${h.slice(-40)}`);
}

type Injected = Eip1193 & {
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
};
const injected = (): Injected | null => (window as unknown as { ethereum?: Injected }).ethereum ?? null;

/** The browser wallet, switched to `chainId` on each send. Only for a `via: "wallet"` sign-in. */
function injectedSigner(address: string): WalletSigner {
  return {
    address,
    label: "your browser wallet",
    provider: async (chainId) => {
      const eth = injected();
      if (!eth) throw new Error("No wallet app was found in this browser.");
      if (Number(await eth.request({ method: "eth_chainId" })) !== chainId) {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
      }
      return eth;
    },
  };
}

/** The injected wallet's chain, kept current through `chainChanged`. */
function useInjectedChainId(active: boolean): number | null {
  const [chainId, setChainId] = useState<number | null>(null);
  useEffect(() => {
    const eth = active ? injected() : null;
    if (!eth) return;
    let live = true;
    const onChain = (id: unknown) => {
      if (live) setChainId(Number(id) || null);
    };
    eth.request({ method: "eth_chainId" }).then(onChain, () => {});
    eth.on?.("chainChanged", onChain);
    return () => {
      live = false;
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [active]);
  return active ? chainId : null;
}

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const stored = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [open, setOpen] = useState(false);

  const signIn = useCallback((v: Stored) => {
    store(v);
    setOpen(false);
  }, []);

  const address = stored?.address ?? null;
  const ensName = useEnsName(address);
  const canSign = stored?.via === "wallet" && !!address;
  const signer = useMemo(() => (canSign && address ? injectedSigner(address) : null), [canSign, address]);
  const chainId = useInjectedChainId(canSign);

  const value = useMemo<WalletSession>(
    () => ({
      mode: "demo",
      ready,
      connected: ready && !!address,
      address,
      ensName,
      login: () => setOpen(true),
      logout: () => store(null),
      signer,
      chainId,
    }),
    [ready, address, ensName, signer, chainId],
  );

  return (
    <WalletSessionContext.Provider value={value}>
      {children}
      <SignInSheet open={open} onClose={() => setOpen(false)} onSignIn={signIn} />
    </WalletSessionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// The sheet. Same copy rules as the rest of the app: plain words, one primary
// action, 48px targets, the protocol words stay out of it.
// ---------------------------------------------------------------------------

function SignInSheet({ open, onClose, onSignIn }: { open: boolean; onClose: () => void; onSignIn: (v: Stored) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The sheet portals into document.body, which only exists on the client.
  const mounted = useSyncExternalStore(subscribe, clientReady, serverReady);

  if (!open || !mounted) return null;

  const withEmail = () => {
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      setError("That does not look like an email address. Check it and try again.");
      return;
    }
    setError(null);
    onSignIn({ address: demoAddressFor(v), via: "email", email: v });
  };

  const withWallet = async () => {
    const eth = injected();
    if (!eth) {
      setError("No wallet app was found in this browser. Sign in with your email instead.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.[0]) throw new Error("no account");
      onSignIn({ address: getAddress(accounts[0]), via: "wallet" });
    } catch {
      setError("Your wallet app did not let us in. Open it, unlock it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <Sheet open={open} onClose={onClose} title="Sign in to thaamba">
      <p className="t-body text-text-2">
        Sign in with your email and we make you a secure wallet. Nothing to install, nothing to remember.
      </p>

      <label className="t-label mt-4 block text-text-2" htmlFor="signin-email">
        Email address
      </label>
      <input
        id="signin-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && withEmail()}
        placeholder="you@example.com"
        className="t-body mt-1 h-12 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-text placeholder:text-text-3"
      />
      <Button variant="buy" size="bar" className="mt-3 w-full" onClick={withEmail}>
        Continue
      </Button>

      <p className="t-caption mt-5 text-text-2">Already have a wallet?</p>
      <Button variant="secondary" size="bar" className="mt-2 w-full" onClick={withWallet} busy={busy}>
        {busy ? "Check your wallet app" : "Use a wallet in this browser"}
      </Button>
      <Button
        variant="secondary"
        size="bar"
        className="mt-3 w-full"
        onClick={() => onSignIn({ address: WALLET.address, via: "demo" })}
      >
        Use the demo account
      </Button>

      {error && <p className="t-label mt-3 text-loss-text">{error}</p>}

      <p className="t-caption mt-4">
        The demo account owns the Acme and Kesar listings, so it sees the issuer console. Everything here is test money.
      </p>
    </Sheet>,
    document.body,
  );
}
