"use client";

// App state. Sign-in is real: Privy owns the session (components/wallet), so
// `connected`, `address` and `ensName` come from the signed-in account.
// Everything else here is still mock: balances, holdings, bids, policy, prices
// and the transaction toasts.
//
// Two things deliberately do not exist here any more:
//   - a private-read counter. The app reads sample data, so there was nothing
//     to count and the old number only incremented on a timer (see the privacy
//     explainer in shell.tsx, which now describes the design without numbers).
//   - an issuer override. Who sees the issuer console is decided by comparing
//     the signed-in address with the configured listing owner, and by nothing
//     else; `?issuer=1` is gone.

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { WALLET } from "@/lib/mock";
import { shortHash, txUrl } from "@/lib/format";
import { ThemeProvider } from "./theme";
import { Toast } from "./ui";
import { WalletSessionProvider, useWalletSession } from "./wallet/session";
import { LISTING_OWNER, hasListingOwner } from "./wallet/env";

type ToastItem = {
  id: number;
  status: "pending" | "success" | "error";
  title: string;
  detail?: string;
  tx?: string;
};

type TxOptions = {
  /** Plain-English headline while pending, e.g. "Placing your bid". */
  title: string;
  /** Plain-English headline on success, e.g. "Bid placed". */
  success?: string;
  /** Decoded custom error name, e.g. "BidAboveCap". Makes the mock tx fail. */
  revert?: string;
  /** Plain-English headline on failure. The error name goes on the second line. */
  revertTitle?: string;
  revertDetail?: string;
  delayMs?: number;
};

type AppState = {
  connected: boolean;
  /** False only while the sign-in session is still being read, so nothing flashes signed-out. */
  sessionReady: boolean;
  address: string;
  ensName: string | null;
  usdcBalance: number;
  ethBalance: number;
  connect: () => void;
  disconnect: () => void;
  isIssuerFor: string[];
  network: { ok: boolean; name: string; chainId: number };
  /** Mock "Switch to Sepolia". */
  switchNetwork: () => void;
  /** Demo helper so a screen can show the wrong-network state. */
  setWrongNetwork: (wrong: boolean) => void;
  /** The private-reads design, for the explainer. No counters: nothing here measures traffic. */
  anon: { transport: string; fallback: string; live: boolean };
  sendTx: (o: TxOptions) => Promise<{ ok: boolean; tx: string }>;
  /** Show a plain toast without a transaction. */
  notify: (title: string, status?: ToastItem["status"], detail?: string) => void;
};

const Ctx = createContext<AppState | null>(null);

function fakeHash() {
  const hex = "0123456789abcdef";
  let h = "0x";
  for (let i = 0; i < 64; i += 1) h += hex[Math.floor(Math.random() * 16)];
  return h;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <WalletSessionProvider>
        <AppProvider>{children}</AppProvider>
      </WalletSessionProvider>
    </ThemeProvider>
  );
}

/** Screenshot hook. ?signedout=1 keeps the investor session signed out. It does not touch the issuer console. */
function useSignedOutFlag() {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("signedout") === "1",
    () => false,
  );
}

function AppProvider({ children }: { children: React.ReactNode }) {
  const signedOut = useSignedOutFlag();
  const session = useWalletSession();
  const connected = session.connected && !signedOut;
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [toast, setToast] = useState<ToastItem | null>(null);
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  // One toast at a time; a new one replaces the previous (UI.md 2.20).
  const show = useCallback(
    (t: Omit<ToastItem, "id">, autoMs?: number) => {
      if (timer.current) clearTimeout(timer.current);
      const id = nextId.current++;
      setToast({ ...t, id });
      if (autoMs) timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), autoMs);
      return id;
    },
    [],
  );

  const notify = useCallback((title: string, status: ToastItem["status"] = "success", detail?: string) => show({ title, status, detail }, 3000), [show]);

  const sendTx = useCallback(
    (o: TxOptions) => {
      const tx = fakeHash();
      show({ status: "pending", title: o.title, detail: "Check your wallet app" });
      return new Promise<{ ok: boolean; tx: string }>((resolve) => {
        setTimeout(() => {
          const ok = !o.revert;
          show(
            ok
              ? { status: "success", title: o.success ?? "Done", tx }
              : { status: "error", title: o.revertTitle ?? "That didn't go through", detail: [o.revertDetail, o.revert].filter(Boolean).join(" · "), tx },
            ok ? 4000 : 7000,
          );
          resolve({ ok, tx });
        }, o.delayMs ?? 1400);
      });
    },
    [show],
  );

  // The listing owner comes from the deployment config (wallet/env.ts), never
  // from the URL or local storage. With no owner configured nothing matches.
  const isIssuer = connected && hasListingOwner && (session.address ?? "").toLowerCase() === LISTING_OWNER;

  const value = useMemo<AppState>(
    () => ({
      connected,
      sessionReady: session.ready,
      // Balances stay mock, so the demo works with a wallet that owns nothing.
      address: session.address ?? WALLET.address,
      ensName: session.ensName,
      usdcBalance: WALLET.usdcBalance,
      ethBalance: WALLET.ethBalance,
      connect: session.login,
      disconnect: session.logout,
      isIssuerFor: isIssuer ? WALLET.isIssuerFor : [],
      network: { ok: !wrongNetwork, name: WALLET.chainName, chainId: WALLET.chainId },
      switchNetwork: () => setWrongNetwork(false),
      setWrongNetwork,
      anon: {
        transport: WALLET.anonRpc.transport,
        fallback: WALLET.anonRpc.fallback,
        // No read in this build goes through the relay yet: the screens render
        // sample data, and the one real network call (reverse ENS) is direct.
        live: false,
      },
      sendTx,
      notify,
    }),
    [connected, isIssuer, session.ready, session.address, session.ensName, session.login, session.logout, wrongNetwork, sendTx, notify],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-5 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[60] flex justify-center lg:inset-x-auto lg:bottom-6 lg:left-6">
        {toast && (
          <div className="pointer-events-auto w-full max-w-[440px]">
            <Toast
              status={toast.status}
              title={toast.title}
              detail={toast.detail}
              link={toast.tx ? { href: txUrl(toast.tx), label: `${shortHash(toast.tx)} on Etherscan` } : undefined}
              onDismiss={dismiss}
            />
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside Providers");
  return v;
}
