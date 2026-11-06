"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  ChartLine,
  Gavel,
  LayoutGrid,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { useApp } from "./providers";
import { Button, KV, Pill, Sheet, cx } from "./ui";
import { dateTimeIST, shortAddr, usdc } from "@/lib/format";
import { FAUCET_URL, OFFER, WALLET } from "@/lib/mock";

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="ld-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5076ee" />
          <stop offset="1" stopColor="#00b386" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill="url(#ld-g)" />
      <path d="M7 21.5 L13 15 L17 18.5 L25 10" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5 10 H25 V14.5" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletAvatar({ onClick }: { onClick: () => void }) {
  const { connected, ensName, address } = useApp();
  if (!connected)
    return (
      <button onClick={onClick} className="rounded-full bg-strong px-3.5 py-1.5 text-sm font-semibold text-bg">
        Connect
      </button>
    );
  return (
    <button onClick={onClick} aria-label={`Wallet ${ensName ?? address}`} className="size-9 overflow-hidden rounded-full ring-1 ring-line">
      <span
        className="block size-full"
        style={{ background: `conic-gradient(from 120deg, #5076ee, #00b386, #f59e0b, #5076ee)` }}
      />
    </button>
  );
}

export function PrivacyBadge() {
  const { anon } = useApp();
  const [open, setOpen] = useState(false);
  const total = anon.reads + anon.direct;
  const share = total === 0 ? 100 : Math.round((anon.reads / total) * 100);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gain/30 bg-gain-soft px-2.5 py-1 text-xs font-semibold text-gain"
      >
        <ShieldCheck className="size-3.5" />
        Reads via {anon.transport.split(" ")[0]} · {share}%
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Private browsing">
        <p className="text-sm text-muted">
          Every chain read this app makes goes through Anon-RPC, so the RPC provider can&apos;t link your IP to the
          tickers and addresses you look up.
        </p>
        <div className="mt-3 divide-y divide-line">
          <KV k="Transport" v={anon.transport} sub={`Fallback: ${WALLET.anonRpc.fallback}`} />
          <KV k="Reads via Anon-RPC" v={anon.reads.toLocaleString("en-IN")} />
          <KV k="Direct reads" v={<span className="text-gain">{anon.direct} (must be 0)</span>} />
          <KV k="Connected since" v={dateTimeIST(anon.since)} />
          <KV k="Last error" v={anon.lastError ?? "None"} />
        </div>
        <div className="mt-3 rounded-[12px] bg-subtle p-3 text-[13px] text-muted">
          <p className="font-semibold text-strong">What this doesn&apos;t hide</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>The RPC still sees which addresses are queried, just not from whom.</li>
            <li>The first bootstrap read isn&apos;t private.</li>
            <li>Writes (bids, swaps) go through your wallet&apos;s own RPC.</li>
          </ul>
        </div>
      </Sheet>
    </>
  );
}

function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  if (!app.connected)
    return (
      <Sheet open={open} onClose={onClose} title="Connect a wallet">
        <div className="space-y-2">
          {["MetaMask", "WalletConnect"].map((w) => (
            <button
              key={w}
              onClick={() => {
                app.connect();
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-[12px] border border-line p-3 text-left font-medium text-strong"
            >
              <Wallet className="size-5 text-brand" /> {w}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Sepolia only. Writes go through your wallet; reads stay on Anon-RPC.</p>
      </Sheet>
    );
  const low = app.usdcBalance < OFFER.perApplicantCap;
  return (
    <Sheet open={open} onClose={onClose} title="Wallet">
      <div className="flex items-center gap-3">
        <span
          className="size-11 rounded-full"
          style={{ background: `conic-gradient(from 120deg, #5076ee, #00b386, #f59e0b, #5076ee)` }}
        />
        <div>
          <p className="font-semibold text-strong">{app.ensName ?? shortAddr(app.address)}</p>
          <p className="num font-mono text-[13px] text-muted">{shortAddr(app.address)}</p>
        </div>
        <span className="ml-auto">
          <Pill tone="gain">Sepolia</Pill>
        </span>
      </div>
      <div className="mt-4 divide-y divide-line">
        <KV k="USDC" v={`${usdc(app.usdcBalance)} USDC`} sub="Circle Sepolia USDC" />
        <KV k="ETH (gas)" v={`${WALLET.ethBalance} ETH`} />
      </div>
      {low && (
        <a
          href={FAUCET_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-between rounded-[12px] bg-brand-soft p-3 text-sm text-brand"
        >
          <span>
            <b>Get test USDC</b>
            <span className="block text-[13px]">One faucet request (20 USDC) covers a full application</span>
          </span>
          <span aria-hidden>→</span>
        </a>
      )}
      <Button
        tone="neutral"
        variant="outline"
        className="mt-4 w-full"
        onClick={() => {
          app.disconnect();
          onClose();
        }}
      >
        <LogOut className="size-4" /> Disconnect
      </Button>
    </Sheet>
  );
}

/** Top bar on tab screens, modelled on the reference ("Stocks" + search + avatar). */
export function TabHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 bg-bg/95 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 backdrop-blur">
      <div className="flex h-11 items-center gap-3">
        <Logo />
        <h1 className="text-[19px]">{title}</h1>
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <WalletAvatar onClick={() => setOpen(true)} />
        </div>
      </div>
      <WalletSheet open={open} onClose={() => setOpen(false)} />
    </header>
  );
}

/** Top bar on detail screens: back arrow + right-side icons. */
export function DetailHeader({ actions, fallback = "/" }: { actions?: React.ReactNode; fallback?: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center bg-bg/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
      <button
        aria-label="Back"
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
        className="rounded-full p-2.5 text-strong hover:bg-subtle"
      >
        <ArrowLeft className="size-6" />
      </button>
      <div className="ml-auto flex items-center">{actions}</div>
    </header>
  );
}

export function IconButton({ label, onClick, children, active }: { label: string; onClick?: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx("rounded-full p-2.5 hover:bg-subtle", active ? "text-brand" : "text-strong")}
    >
      {children}
    </button>
  );
}

export function BottomNav() {
  const path = usePathname();
  const { isIssuerFor } = useApp();
  const items = [
    { href: "/", label: "IPOs", icon: LayoutGrid, match: (p: string) => p === "/" },
    { href: "/bids", label: "My bids", icon: Gavel, match: (p: string) => p.startsWith("/bids") },
    { href: "/market", label: "Market", icon: ChartLine, match: (p: string) => p.startsWith("/market") },
    { href: "/portfolio", label: "Portfolio", icon: Briefcase, match: (p: string) => p.startsWith("/portfolio") },
  ];
  if (isIssuerFor.length)
    items.push({
      href: `/console/${isIssuerFor[0]}`,
      label: "Console",
      icon: SlidersHorizontal,
      match: (p: string) => p.startsWith("/console"),
    });
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="flex">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11px] font-medium", active ? "text-brand" : "text-muted")}
              >
                <span className={cx("flex h-7 w-10 items-center justify-center rounded-[8px]", active && "bg-brand-soft")}>
                  <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
                </span>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Fixed action bar for detail screens (the reference's Sell / Buy bar). */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[480px] gap-3 border-t border-line bg-card px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}
