"use client";

// Mock app state: wallet, Anon-RPC read counter, tx toasts.
// Real wiring (wagmi + Anon-RPC transport) replaces this provider later;
// screens only use the hooks below.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import { WALLET } from "@/lib/mock";
import { shortHash, txUrl } from "@/lib/format";

type Toast = {
  id: number;
  status: "pending" | "success" | "reverted";
  title: string;
  detail?: string;
  tx?: string;
};

type TxOptions = {
  title: string;
  success?: string;
  /** Decoded custom error name, e.g. "BidAboveCap". Makes the mock tx revert. */
  revert?: string;
  revertDetail?: string;
  delayMs?: number;
};

type AppState = {
  connected: boolean;
  address: string;
  ensName: string | null;
  usdcBalance: number;
  connect: () => void;
  disconnect: () => void;
  isIssuerFor: string[];
  anon: { transport: string; reads: number; direct: number; lastError: string | null; since: string };
  countRead: (n?: number) => void;
  sendTx: (o: TxOptions) => Promise<{ ok: boolean; tx: string }>;
};

const Ctx = createContext<AppState | null>(null);

function fakeHash() {
  const hex = "0123456789abcdef";
  let h = "0x";
  for (let i = 0; i < 64; i += 1) h += hex[Math.floor(Math.random() * 16)];
  return h;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(WALLET.connected);
  const [reads, setReads] = useState(WALLET.anonRpc.anonReads);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const countRead = useCallback((n = 1) => setReads((r) => r + n), []);

  // Every screen polls per block; mimic that so the badge visibly ticks.
  useEffect(() => {
    const id = setInterval(() => setReads((r) => r + 2), 12000);
    return () => clearInterval(id);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const sendTx = useCallback(
    (o: TxOptions) => {
      const id = nextId.current++;
      const tx = fakeHash();
      setToasts((t) => [...t, { id, status: "pending", title: o.title, detail: "Confirm in your wallet…" }]);
      return new Promise<{ ok: boolean; tx: string }>((resolve) => {
        setTimeout(() => {
          const ok = !o.revert;
          setToasts((t) =>
            t.map((x) =>
              x.id === id
                ? {
                    ...x,
                    status: ok ? "success" : "reverted",
                    title: ok ? (o.success ?? `${o.title} confirmed`) : `Reverted: ${o.revert}`,
                    detail: ok ? undefined : o.revertDetail,
                    tx,
                  }
                : x,
            ),
          );
          setReads((r) => r + 3);
          setTimeout(() => dismiss(id), ok ? 4000 : 7000);
          resolve({ ok, tx });
        }, o.delayMs ?? 1400);
      });
    },
    [dismiss],
  );

  const value = useMemo<AppState>(
    () => ({
      connected,
      address: WALLET.address,
      ensName: WALLET.ensName,
      usdcBalance: WALLET.usdcBalance,
      connect: () => setConnected(true),
      disconnect: () => setConnected(false),
      isIssuerFor: connected ? WALLET.isIssuerFor : [],
      anon: {
        transport: WALLET.anonRpc.transport,
        reads,
        direct: WALLET.anonRpc.directReads,
        lastError: WALLET.anonRpc.lastError,
        since: WALLET.anonRpc.connectedSince,
      },
      countRead,
      sendTx,
    }),
    [connected, reads, countRead, sendTx],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside Providers");
  return v;
}

function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] mx-auto flex w-full max-w-[480px] flex-col gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-[12px] border border-line bg-card p-3 shadow-[var(--shadow)]"
        >
          {t.status === "pending" && <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-brand" />}
          {t.status === "success" && <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gain" />}
          {t.status === "reverted" && <XCircle className="mt-0.5 size-5 shrink-0 text-loss" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-strong">{t.title}</p>
            {t.detail && <p className="text-[13px] text-muted">{t.detail}</p>}
            {t.tx && (
              <a
                href={txUrl(t.tx)}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-brand"
              >
                {shortHash(t.tx)} on Etherscan <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <button aria-label="Dismiss" onClick={() => onDismiss(t.id)} className="text-muted">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
