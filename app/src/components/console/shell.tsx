"use client";

// Console shell: the issuer side is a separate app, so it brings its own
// header and its own navigation. No AppBar, no BottomNav, no TopNav, no
// investor account control. Same tokens, same plain English, denser layout.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Logo } from "@/components/shell";
import { Button, Card, TickerLogo, cx } from "@/components/ui";
import { shortAddr } from "@/lib/format";
import { ensName } from "@/lib/mock";
import { useIssuerSession } from "./session";

/** Console page width: wider and denser than the investor 1200px container. */
export function ConsoleContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1280px] px-5", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Notices. Flat, bordered, untinted: a heading line and a sentence.
// ---------------------------------------------------------------------------

export function Notice({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-[10px] border border-line-strong bg-surface p-4", className)}>
      <p className="t-list-title text-text">{title}</p>
      <div className="t-body mt-1 text-text-2">{children}</div>
    </div>
  );
}

/**
 * Shown on every console screen when no listing owner address is configured.
 * Without it an open console could be read as a passed ownership check.
 */
export function DemoModeNotice({ className }: { className?: string }) {
  const { gate } = useIssuerSession();
  if (gate !== "demo") return null;
  return (
    <Notice title="Demo mode. Nobody is being checked." className={cx("mt-4", className)}>
      No listing owner address is set for this build, so this console does not know whether you own anything. Anyone who
      signs in can open it and read these screens. Set the owner address in the deployment config and the console checks
      the signed-in wallet against it.
    </Notice>
  );
}

/** The signed-in address and what it was checked against. */
export function GateLine({ className }: { className?: string }) {
  const { gate, address, owner } = useIssuerSession();
  return (
    <p className={cx("t-label", className)}>
      {gate === "api"
        ? `Signed in as ${shortAddr(address ?? "")}, which the exchange reads as the issuer (the owner of the listing's name).`
        : gate === "checked"
          ? `Signed in as ${shortAddr(address ?? "")}, which matches the listing owner ${shortAddr(owner ?? "")}.`
          : `Signed in as ${shortAddr(address ?? "")}. Not checked against any owner address.`}
    </p>
  );
}

/** A command to run on the demo laptop. Never a button that pretends to run it. */
export function CommandBlock({ label, command, note }: { label?: string; command: string; note?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      {label && <p className="t-label">{label}</p>}
      <div className="mt-1 flex items-start gap-3 rounded-[8px] bg-surface-2 p-3">
        <code className="t-mono min-w-0 flex-1 break-all whitespace-pre-wrap text-text">{command}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(command).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
          className="t-change-sm h-12 shrink-0 px-1 text-text-2 hover:text-text"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note && <p className="t-label mt-1">{note}</p>}
    </div>
  );
}

/** Header + listings navigation. Rendered by every signed-in console screen. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { address, ensName: signedInEns, signOut, rows } = useIssuerSession();
  const path = usePathname();

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <ConsoleContainer className="flex h-14 items-center gap-3">
          <Logo size={28} />
          <span className="t-list-title text-text">thaamba</span>
          <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
          <span className="t-card-title hidden text-text sm:block">Issuer console</span>
          <div className="ml-auto flex items-center gap-4">
            <span className="t-label hidden truncate md:block">{signedInEns ?? shortAddr(address ?? "")}</span>
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
            {rows.map((ipo) => (
              <ConsoleNavLink key={ipo.ticker} href={`/console/${ipo.ticker}`} active={path === `/console/${ipo.ticker}`}>
                <span className="flex items-center gap-2">
                  <TickerLogo ipo={ipo} size={20} />
                  {ipo.name}
                </span>
              </ConsoleNavLink>
            ))}
          </nav>
        </ConsoleContainer>
      </header>
      <ConsoleContainer className="pb-12">
        <DemoModeNotice />
        {children}
      </ConsoleContainer>
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

/** Signed in, but this wallet is not the listing owner. */
export function NotTheOwner({ ticker }: { ticker?: string }) {
  const { address, owner, gate, error, retry } = useIssuerSession();
  return (
    <ConsoleShell>
      <div className="max-w-[640px] py-10">
        {error && (
          <Notice title="We couldn't check who the issuer is" className="mb-6">
            {error.sentence}{" "}
            <button type="button" onClick={retry} className="text-gain-text">
              Retry
            </button>
          </Notice>
        )}
        <p className="t-label-sm text-text-2">Not your listing</p>
        <h1 className="t-page-title mt-2 text-text">This console is for the listing owner</h1>
        <p className="t-body mt-2 text-text-2">
          {ticker
            ? `${ensName(ticker)} is managed by one address. Sign out and sign in with that wallet to open this listing.`
            : "No listing is registered to the wallet you are signed in with. Sign out and sign in with the wallet that owns the listing."}
        </p>
        <div className="mt-4 divide-y divide-line border-t border-line">
          <p className="t-label flex min-h-12 items-center justify-between gap-4 py-2">
            <span>You are signed in as</span>
            <span className="num t-mono text-text">{shortAddr(address ?? "")}</span>
          </p>
          <p className="t-label flex min-h-12 items-center justify-between gap-4 py-2">
            <span>The listing owner is</span>
            <span className="num t-mono text-text">{gate === "api" ? "The owner of the listing's name, per the exchange" : shortAddr(owner ?? "")}</span>
          </p>
        </div>
      </div>
    </ConsoleShell>
  );
}

/** What an issuer can do here. Shown beside the sign-in so the purpose of the
 *  console is readable before anyone signs in. */
const CAN_DO: { title: string; sub: string }[] = [
  { title: "Follow a listing", sub: "Shares, issue price and the name investors find you by." },
  { title: "Watch the IPO", sub: "Applications, the money raised and the price so far." },
  { title: "Read the trading rule", sub: "The price limits the exchange is enforcing on your share right now." },
  { title: "See every receipt", sub: "The transaction behind each step, on Etherscan." },
];

/** Signed-out console: the real wallet sign-in, and nothing that fakes one. */
export function ConsoleSignIn() {
  const { signIn, gate } = useIssuerSession();
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5 lg:px-10 xl:px-16">
        <Logo size={28} />
        <span className="t-list-title text-text">thaamba</span>
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
              The issuer side of thaamba. Everything a company does after the paperwork, in plain English, with a receipt for every step.
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
              <p className="t-body mt-2 text-text-2">
                {gate === "checked"
                  ? "Sign in with the wallet that owns your listing. The console checks that address and opens only for it."
                  : "Sign in with your wallet to look around."}
              </p>
              <Button className="mt-5 w-full" onClick={signIn}>
                Sign in
              </Button>
              <p className="t-label mt-3">One signature, nothing is charged. Investors never sign in here.</p>
            </Card>

            {gate === "demo" && (
              <Notice title="Demo mode. Nobody is being checked." className="mt-4">
                No listing owner address is set for this build, so any wallet that signs in can open this console. It is
                not an ownership check.
              </Notice>
            )}

            <p className="t-caption mt-3">
              Buying and selling shares happens in the{" "}
              <Link href="/" className="text-gain-text">
                thaamba app
              </Link>
              , not in this console.
            </p>
          </div>
        </section>
      </main>

      <footer className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-t border-line px-5 py-3 lg:px-10 xl:px-16">
        <span className="t-caption">Sepolia test network</span>
      </footer>
    </div>
  );
}
