"use client";

// App state. Sign-in is real: Privy owns the session (components/wallet), so
// `connected`, `address` and `ensName` come from the signed-in account, and
// sending goes through the session's `signer`.
//
// What is live here:
//   - balances, from GET /v1/portfolio/:address;
//   - the network, from the signing wallet's chain;
//   - who sees the issuer console, from GET /v1/issuer/:ticker?address=
//     (the deployment's listing owner only when no API is configured);
//   - `runTx`: prepare on the server, approve and send in the wallet, wait for
//     each receipt (lib/tx.ts). Its toasts report only what happened: a hash
//     appears once the wallet returns one, and success only on a status-1
//     receipt. One transaction at a time; a second press while one is open is
//     refused rather than queued.
//
// Still static: the private-reads design copy (`anon`), unchanged.

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sepolia } from "viem/chains";
import { WALLET } from "@/lib/mock";
import { shortHash, txUrl } from "@/lib/format";
import { apiConfigured, type Portfolio, type Prepared } from "@/lib/api";
import { refreshLive, useHealth, useIssuerOf, useListings, usePortfolio, type Live } from "@/lib/live";
import { createLock, failureMessage, runPrepared, type TxProgress, type TxResult } from "@/lib/tx";
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

export type RunTx<D> = {
  /** Plain-English headline while it runs, e.g. "Placing your bid". */
  title: string;
  /** Headline once the receipt is in, e.g. "Bid placed". */
  success: string;
  /** Headline on failure. The reason goes on the second line. */
  failTitle?: string;
  /** Called fresh for every round: after approvals land, the server reads allowances (and prices) again. */
  prepare: () => Promise<Prepared<D>>;
  /** Refuse before anything is sent (return the sentence to show). */
  guard?: (p: Prepared<D>) => string | null;
  onProgress?: (p: TxProgress) => void;
};

/** The chain every deployment and the Privy config use. */
export const APP_CHAIN = { id: sepolia.id, name: "Sepolia" } as const;

type AppState = {
  connected: boolean;
  /** False only while the sign-in session is still being read, so nothing flashes signed-out. */
  sessionReady: boolean;
  /** The signed-in address. Signed out it is the sample address, for copy only: gate reads on `connected`. */
  address: string;
  ensName: string | null;
  /** From /v1/portfolio; null while loading, signed out, or when the read failed. */
  usdcBalance: number | null;
  ethBalance: number | null;
  portfolio: Live<Portfolio>;
  connect: () => void;
  disconnect: () => void;
  isIssuerFor: string[];
  /** `ok` is false only when a signing wallet is known to be on another chain. */
  network: { ok: boolean; name: string; chainId: number; walletChainId: number | null };
  /** Ask the wallet to switch to Sepolia. */
  switchNetwork: () => void;
  /** Signed in with a wallet that can send (not the keyless demo sign-ins). */
  canSign: boolean;
  /** "your email wallet", "MetaMask"... for "approve it in ___". */
  signerLabel: string | null;
  /** The API is the fixture stub: everything can be viewed, nothing can be sent. */
  notLive: boolean;
  /** A transaction is open in the wallet or waiting for its receipt. */
  txBusy: boolean;
  runTx: <D>(o: RunTx<D>) => Promise<TxResult<D>>;
  /** The private-reads design, for the explainer. No counters: nothing here measures traffic. */
  anon: { transport: string; fallback: string; live: boolean };
  /** Show a plain toast without a transaction. */
  notify: (title: string, status?: ToastItem["status"], detail?: string) => void;
};

const Ctx = createContext<AppState | null>(null);

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

function progressDetail(p: TxProgress, label: string): string {
  switch (p.phase) {
    case "preparing":
      return p.round === 0 ? "Checking this with the exchange" : "Checking again now that your approval is in";
    case "wallet":
      return `${p.total > 1 ? `Step ${p.index + 1} of ${p.total}: ${p.step.description}. ` : ""}Approve it in ${label}.`;
    case "confirming":
      return "Sent. Waiting for the network to confirm it.";
  }
}

function AppProvider({ children }: { children: React.ReactNode }) {
  const signedOut = useSignedOutFlag();
  const session = useWalletSession();
  const connected = session.connected && !signedOut;
  const address = connected ? session.address : null;
  const signer = connected ? session.signer : null;
  const [toast, setToast] = useState<ToastItem | null>(null);
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lock = useRef(createLock());
  const [txBusy, setTxBusy] = useState(false);

  const health = useHealth();
  const notLive = typeof health.data?.rpc === "string" && health.data.rpc.startsWith("stub://");
  const portfolio = usePortfolio(address);
  const listings = useListings();
  const tickers = useMemo(() => (listings.data?.listings ?? []).map((l) => l.ticker), [listings.data]);
  const issuerOf = useIssuerOf(apiConfigured() ? tickers : [], address);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  // One toast at a time; a new one replaces the previous (UI.md 2.20).
  const show = useCallback((t: Omit<ToastItem, "id">, autoMs?: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = nextId.current++;
    setToast({ ...t, id });
    if (autoMs) timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), autoMs);
    return id;
  }, []);

  const notify = useCallback((title: string, status: ToastItem["status"] = "success", detail?: string) => show({ title, status, detail }, 3000), [show]);

  const runTx = useCallback(
    async <D,>(o: RunTx<D>): Promise<TxResult<D>> => {
      if (!lock.current.tryAcquire()) {
        show({ status: "error", title: o.failTitle ?? "That didn't go through", detail: failureMessage("busy") }, 5000);
        return { ok: false, reason: "busy", message: failureMessage("busy"), error: null, tx: null, steps: [] };
      }
      setTxBusy(true);
      const label = signer?.label ?? "your wallet";
      let pendingTx: string | undefined;
      show({ status: "pending", title: o.title, detail: "Checking this with the exchange" });
      try {
        const r = await runPrepared<D>({
          prepare: o.prepare,
          guard: o.guard,
          signer,
          chainId: APP_CHAIN.id,
          notLive,
          onProgress: (p) => {
            pendingTx = p.phase === "confirming" ? p.tx : p.phase === "wallet" ? undefined : pendingTx;
            show({ status: "pending", title: o.title, detail: progressDetail(p, label), tx: pendingTx });
            o.onProgress?.(p);
          },
        });
        if (r.ok) {
          show({ status: "success", title: o.success, tx: r.tx }, 6000);
        } else {
          const done = r.steps.filter((s) => s.status === "confirmed").length;
          const partial = done > 0 ? ` ${done === 1 ? "One earlier step was" : `${done} earlier steps were`} confirmed and stay done.` : "";
          const code = r.error && r.error.name !== "Error" ? ` (${r.error.name})` : "";
          show({ status: "error", title: o.failTitle ?? "That didn't go through", detail: `${r.message}${code}${partial}`, tx: r.tx ?? undefined }, r.reason === "rejected" ? 5000 : undefined);
        }
        if (r.ok || r.steps.some((s) => s.status !== "rejected")) refreshLive();
        return r;
      } finally {
        lock.current.release();
        setTxBusy(false);
      }
    },
    [show, signer, notLive],
  );

  const switchNetwork = useCallback(() => {
    if (!signer) return;
    signer.provider(APP_CHAIN.id).then(
      () => notify(`Switched to ${APP_CHAIN.name}`),
      () => notify(`Your wallet didn't switch to ${APP_CHAIN.name}`, "error", `Open your wallet and choose the ${APP_CHAIN.name} test network.`),
    );
  }, [signer, notify]);

  // Who sees the issuer console: the API's ENS-owner check. With no API there
  // is nothing to check against, so the deployment's configured listing owner
  // (wallet/env.ts) stands in, never the URL or local storage.
  const isIssuerFor = useMemo(() => {
    if (!connected) return [];
    if (apiConfigured()) return issuerOf.data ?? [];
    return hasListingOwner && (session.address ?? "").toLowerCase() === LISTING_OWNER ? WALLET.isIssuerFor : [];
  }, [connected, issuerOf.data, session.address]);

  const walletChainId = signer ? session.chainId : null;
  const value = useMemo<AppState>(
    () => ({
      connected,
      sessionReady: session.ready,
      address: session.address ?? WALLET.address,
      ensName: session.ensName,
      usdcBalance: connected ? (portfolio.data?.balances.usdc ?? null) : null,
      ethBalance: connected ? (portfolio.data?.balances.eth ?? null) : null,
      portfolio,
      connect: session.login,
      disconnect: session.logout,
      isIssuerFor,
      network: { ok: walletChainId === null || walletChainId === APP_CHAIN.id, name: APP_CHAIN.name, chainId: APP_CHAIN.id, walletChainId },
      switchNetwork,
      canSign: !!signer,
      signerLabel: signer?.label ?? null,
      notLive,
      txBusy,
      runTx,
      anon: {
        transport: WALLET.anonRpc.transport,
        fallback: WALLET.anonRpc.fallback,
        // No read in this build goes through the relay: the app reads the
        // exchange API directly, and reverse ENS is a direct call too.
        live: false,
      },
      notify,
    }),
    [connected, session.ready, session.address, session.ensName, session.login, session.logout, portfolio, isIssuerFor, walletChainId, switchNetwork, signer, notLive, txBusy, runTx, notify],
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
