"use client";

// Console shell: the issuer side is a separate app, so it brings its own
// header and its own navigation. No AppBar, no BottomNav, no TopNav, no
// investor account control. Same tokens, same plain English, denser layout.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/shell";
import { Button, Card, TickerLogo, cx } from "@/components/ui";
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
          <span className="t-list-title text-text">Thamba</span>
          <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
          <span className="t-card-title hidden text-text sm:block">Issuer console</span>
          <div className="ml-auto flex items-center gap-4">
            <RunnerStatus />
            <span className="t-label hidden truncate md:block">{session?.ensName ?? shortAddr(session?.address)}</span>
            <button type="button" onClick={signOut} className="t-change-sm h-12 shrink-0 text-text-2 hover:text-text">
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

/** What an issuer can do here. Shown beside the sign-in so the purpose of the
 *  console is readable before anyone signs in. */
const CAN_DO: { title: string; sub: string }[] = [
  { title: "Publish a listing", sub: "Shares, issue price and the name investors find you by." },
  { title: "Open an IPO", sub: "Take applications, then watch the price and the money raised." },
  { title: "Set the trading rule", sub: "The price limits the exchange enforces on your share each day." },
  { title: "Halt trading", sub: "Stop buying and selling at once. Liquidity can still be withdrawn." },
];

/** Signed-out console: its own sign-in, never the investor one. */
export function ConsoleSignIn() {
  const { signIn, signInOther } = useIssuerSession();
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5 lg:px-10 xl:px-16">
        <Logo size={28} />
        <span className="t-list-title text-text">Thamba</span>
        <span aria-hidden className="h-5 w-px bg-line" />
        <span className="t-card-title text-text">Issuer console</span>
        <Link href="/" className="t-change-sm ml-auto flex h-12 items-center text-text-2 hover:text-text">
          Investor app
        </Link>
      </header>

      {/* Two panels, floor to ceiling: context on the left, sign-in on the right.
          On phone they stack and the sign-in comes first. */}
      <main className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(440px,40%)]">
        <section className="order-2 flex border-t border-line bg-surface-2 px-5 py-10 lg:order-1 lg:items-center lg:border-t-0 lg:border-r lg:px-10 lg:py-14 xl:px-16">
          <div className="w-full max-w-[620px]">
            <p className="t-label-sm text-text-2">For companies listing shares</p>
            <h1 className="t-price-large mt-2 text-text">Take your company to market.</h1>
            <p className="t-body mt-3 text-text-2">
              The issuer side of Thamba. Everything a company does after the paperwork, in plain English, with a receipt for every step.
            </p>
            <ol className="mt-7 border-t border-line">
              {CAN_DO.map((c, i) => (
                <li key={c.title} className="flex gap-4 border-b border-line py-4">
                  <span className="t-label-sm mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-text-2">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="t-list-title block text-text">{c.title}</span>
                    <span className="t-label block">{c.sub}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="order-1 flex px-5 py-8 lg:order-2 lg:items-center lg:px-10 lg:py-14 xl:px-16">
          <div className="w-full">
            <Card className="p-5 sm:p-6">
              <h2 className="t-section-title text-text">Issuer sign in</h2>
              <p className="t-body mt-2 text-text-2">Use the wallet that owns your listing&apos;s name, for example acme.listingday.eth.</p>
              <Button className="mt-5 w-full" onClick={signIn}>
                Sign in
              </Button>
              <p className="t-label mt-3">One signature, nothing is charged. Investors never sign in here.</p>
              <div className="mt-5 border-t border-line pt-3">
                <button type="button" onClick={signInOther} className="t-change-sm flex h-12 items-center text-text-2 hover:text-text">
                  Use a different wallet
                </button>
                <p className="t-label">Signs in a wallet that owns no listing, so you can see that state.</p>
              </div>
            </Card>

            <div className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-3">
              <span className="t-label">Exchange runner</span>
              <RunnerStatus />
            </div>
            <p className="t-caption mt-3">
              Buying and selling shares happens in the{" "}
              <Link href="/" className="text-gain-text">
                Thamba app
              </Link>
              , not in this console.
            </p>
          </div>
        </section>
      </main>

      <footer className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-t border-line px-5 py-3 lg:px-10 xl:px-16">
        <span className="t-caption">Sepolia test network</span>
        <span className="t-caption">Sample data, not live chain reads</span>
      </footer>
    </div>
  );
}
