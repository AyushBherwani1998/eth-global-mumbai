"use client";

// Console shell: the issuer side is a separate app, so it brings its own
// header and its own navigation. No AppBar, no BottomNav, no TopNav, no
// investor account control. Same tokens, same plain English, denser layout.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/shell";
import { Button, TickerLogo, cx } from "@/components/ui";
import { shortAddr } from "@/lib/format";
import { CONSOLE, getIpo } from "@/lib/mock";
import { useIssuerSession } from "./session";

/** Console page width: wider and denser than the investor 1200px container. */
export function ConsoleContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1280px] px-5", className)}>{children}</div>;
}

export function RunnerStatus({ className }: { className?: string }) {
  const online = CONSOLE.runnerOnline;
  return (
    <span className={cx("t-change-sm whitespace-nowrap", online ? "text-gain-text" : "text-loss-text", className)}>
      {online ? "Runner online" : "Runner offline"}
    </span>
  );
}

/** Header + listings navigation. Rendered by every signed-in console screen. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { session, signOut } = useIssuerSession();
  const path = usePathname();
  const listings = (session?.listings ?? []).filter((t) => getIpo(t));

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <ConsoleContainer className="flex h-14 items-center gap-3">
          <Logo size={28} />
          <span className="t-list-title text-text">Listing Day</span>
          <span className="t-label hidden sm:block">Issuer console</span>
          <div className="ml-auto flex items-center gap-4">
            <RunnerStatus className="hidden sm:block" />
            <span className="t-label hidden truncate md:block">{session?.ensName ?? shortAddr(session?.address)}</span>
            <button type="button" onClick={signOut} className="t-change-sm h-12 shrink-0 px-2 text-gain-text">
              Sign out
            </button>
          </div>
        </ConsoleContainer>
        <ConsoleContainer>
          <nav aria-label="Listings" className="no-scrollbar -mb-px flex gap-6 overflow-x-auto">
            <ConsoleNavLink href="/console" active={path === "/console"}>
              All listings
            </ConsoleNavLink>
            {listings.map((t) => {
              const ipo = getIpo(t)!;
              return (
                <ConsoleNavLink key={t} href={`/console/${t}`} active={path === `/console/${t}`}>
                  <span className="flex items-center gap-2">
                    <TickerLogo ipo={ipo} size={20} />
                    {ipo.name}
                  </span>
                </ConsoleNavLink>
              );
            })}
          </nav>
        </ConsoleContainer>
      </header>
      <ConsoleContainer className="pb-12">{children}</ConsoleContainer>
    </div>
  );
}

function ConsoleNavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx("relative flex h-12 items-center whitespace-nowrap t-chip", active ? "text-text" : "text-text-2 hover:text-text")}
    >
      {children}
      {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-text" />}
    </Link>
  );
}

/** Signed-out console: its own sign-in, never the investor one. */
export function ConsoleSignIn() {
  const { signIn, signInOther } = useIssuerSession();
  return (
    <div className="min-h-dvh bg-bg">
      <ConsoleContainer className="flex min-h-dvh max-w-[520px] flex-col justify-center py-12">
        <div className="flex items-center gap-3">
          <Logo size={28} />
          <span className="t-list-title text-text">Listing Day</span>
          <span className="t-label">Issuer console</span>
        </div>
        <h1 className="t-page-title mt-8">Issuer sign in</h1>
        <p className="t-body mt-2 text-text-2">
          This console is for companies listing their shares. If you are here to buy or sell shares, use the Listing Day app instead.
        </p>
        <Button size="bar" className="mt-6 w-full" onClick={signIn}>
          Connect issuer wallet
        </Button>
        <p className="t-label mt-3">Sign in with the wallet that owns your listing&apos;s name, for example acme.listingday.eth.</p>
        <div className="mt-6 border-t border-line pt-4">
          <button type="button" onClick={signInOther} className="t-change-sm h-12 text-text-2">
            Use a different wallet
          </button>
        </div>
      </ConsoleContainer>
    </div>
  );
}
