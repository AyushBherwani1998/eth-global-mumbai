"use client";

// App shell per UI.md 2.1 to 2.3 and UX.md section 2: mobile app bar + 3-item
// bottom nav, desktop top nav at >= 1024px, detail bar, Account sheet, search,
// layout containers and the fixed action bar.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, Briefcase, ListOrdered, Search, Share2, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react";
import { useApp } from "./providers";
import { useTheme, type ThemeSetting } from "./theme";
import { Button, KV, ListRow, SearchField, Segmented, Sheet, TickerLogo, cx } from "./ui";
import { dateTimeIST, shortAddr, usdc } from "@/lib/format";
import { FAUCET_URL, IPOS, OFFER, WALLET, type Ipo } from "@/lib/mock";
import { statusLabel } from "./ui";

// ---------------------------------------------------------------------------
// Logo: flat brand circle, white step-up glyph. No gradient.
// ---------------------------------------------------------------------------

export function Logo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx("shrink-0", className)}>
      <circle cx="16" cy="16" r="16" fill="var(--brand)" />
      <path d="M7 21.5 L13 15 L17 18.5 L25 10" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.5 10 H25 V14.5" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Layout containers (UI.md 2.3).
// ---------------------------------------------------------------------------

/** Mobile: full width, 20px padding. Desktop: 1200px centred (plus the same 20px). */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1240px] px-5", className)}>{children}</div>;
}

/**
 * Company page grid: 776px content + 24px gap + 400px sticky panel at >= 1024px.
 * The panel is hidden on phone (the fixed ActionBar and sheets take over)
 * unless `panelOnMobile` is set, in which case it stacks under the content.
 */
export function TwoColumn({ children, panel, panelOnMobile, className }: { children: ReactNode; panel?: ReactNode; panelOnMobile?: boolean; className?: string }) {
  return (
    <div className={cx("lg:grid lg:grid-cols-[776px_400px] lg:items-start lg:gap-6", className)}>
      <div className="min-w-0">{children}</div>
      {panel && <aside className={cx("lg:sticky lg:top-20", panelOnMobile ? "mt-6 block lg:mt-0" : "hidden lg:block")}>{panel}</aside>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav model (UX.md section 2).
// ---------------------------------------------------------------------------

type NavItem = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Markets", icon: TrendingUp, match: (p) => p === "/" || p.startsWith("/stock") },
  { href: "/orders", label: "Orders", icon: ListOrdered, match: (p) => p.startsWith("/orders") },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, match: (p) => p.startsWith("/portfolio") },
];
const CONSOLE_NAV: NavItem = { href: "/console", label: "Console", icon: SlidersHorizontal, match: (p) => p.startsWith("/console") };

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 0);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

// ---------------------------------------------------------------------------
// Labelled icon button (UI.md 7.3): icon 24 over a 13/500 label, 48x56 target.
// ---------------------------------------------------------------------------

export function IconButton({
  label,
  icon: Icon,
  onClick,
  href,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const cls = cx("flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] px-2 text-text transition-colors duration-120 hover:bg-surface-2 active:bg-surface-2", className);
  const body = (
    <>
      <Icon className="size-6" strokeWidth={1.75} />
      <span className="t-nav-label">{label}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Account control: "Sign in" (outlined, 40px) or avatar + "Account".
// ---------------------------------------------------------------------------

function Avatar({ size = 36 }: { size?: number }) {
  const { ensName, address } = useApp();
  const initial = (ensName ?? address).replace(/^0x/, "").charAt(0).toUpperCase();
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-full border border-line bg-surface-2 text-[15px] font-medium text-text" style={{ width: size, height: size }}>
      {initial}
    </span>
  );
}

export function AccountControl({ compact }: { compact?: boolean }) {
  const { connected } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      {connected ? (
        <button type="button" onClick={() => setOpen(true)} className={cx("flex items-center rounded-[10px] text-text hover:bg-surface-2", compact ? "h-12 gap-2 px-2" : "h-14 min-w-12 flex-col justify-center gap-0.5 px-2")}>
          <Avatar size={compact ? 34 : 36} />
          <span className="t-nav-label">Account</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="t-chip inline-flex h-10 items-center rounded-full border border-line px-4 text-text hover:bg-surface-2">
          Sign in
        </button>
      )}
      <AccountSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Mobile app bar (tab screens). Hidden on desktop where TopNav takes over.
// ---------------------------------------------------------------------------

export function AppBar({ title, right, below }: { title: string; right?: ReactNode; below?: ReactNode }) {
  const scrolled = useScrolled();
  return (
    <header className={cx("sticky top-0 z-30 -mx-5 bg-bg px-5 pt-[max(0px,env(safe-area-inset-top))] lg:hidden", scrolled ? "border-b border-line" : "border-b border-transparent")}>
      <div className="flex h-14 items-center gap-3">
        <Logo size={34} />
        <h1 className="text-[20px] leading-7 font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-1">
          {right}
          <SearchButton />
          <AccountControl />
        </div>
      </div>
      {below && <div className="pb-2">{below}</div>}
    </header>
  );
}

/** @deprecated legacy name; use AppBar. */
export function TabHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return <AppBar title={title} right={actions} />;
}

// ---------------------------------------------------------------------------
// Desktop top nav (>= 1024px): 56px, logo + wordmark, links, search, account.
// ---------------------------------------------------------------------------

export function TopNav() {
  const path = usePathname();
  const { isIssuerFor } = useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const items = isIssuerFor.length ? [...NAV, CONSOLE_NAV] : NAV;
  return (
    <nav className="sticky top-0 z-30 hidden h-14 border-b border-line bg-bg lg:block" aria-label="Main">
      <Container className="flex h-full items-center gap-8">
        <Link href="/" className="flex items-center gap-3 text-text">
          <Logo size={34} />
          <span className="text-[20px] leading-7 font-medium">Listing Day</span>
        </Link>
        <ul className="flex h-full items-stretch gap-6">
          {items.map((it) => {
            const active = it.match(path);
            return (
              <li key={it.href} className="flex">
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("relative flex items-center text-[17px] leading-[22px] font-medium", active ? "text-text" : "text-text-2 hover:text-text")}
                >
                  {it.label}
                  {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" />}
                </Link>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ml-auto flex h-10 w-[320px] items-center gap-2 rounded-[10px] border border-line px-3 text-left text-[15px] text-text-3 hover:border-line-strong"
        >
          <Search className="size-[18px] text-text-2" /> Search companies
        </button>
        <AccountControl compact />
      </Container>
      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Bottom nav (mobile only): 3 items, 64px, active = brand icon + label, no pill.
// ---------------------------------------------------------------------------

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
      <ul className="flex h-16">
        {NAV.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-full flex-col items-center justify-center gap-1", active ? "text-brand-text" : "text-text-2")}
              >
                <Icon className={cx("size-[26px]", active ? "text-brand" : "text-text-2")} strokeWidth={active ? 2 : 1.75} />
                <span className="t-nav-label">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Detail bar: "Back" at left (the only icon-led control), optional right slot.
// ---------------------------------------------------------------------------

export function DetailBar({ fallback = "/", right }: { fallback?: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 -mx-5 flex h-14 items-center bg-bg px-3 pt-[max(0px,env(safe-area-inset-top))]">
      <button
        type="button"
        aria-label="Back"
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
        className="flex h-12 items-center gap-1 rounded-[10px] px-2 text-text hover:bg-surface-2"
      >
        <ArrowLeft className="size-6" />
        <span className="t-chip">Back</span>
      </button>
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </header>
  );
}

/** @deprecated legacy name; use DetailBar. */
export function DetailHeader({ actions, fallback = "/" }: { actions?: ReactNode; fallback?: string }) {
  return <DetailBar fallback={fallback} right={actions} />;
}

/** "Share" control for the detail bar. */
export function ShareButton({ title }: { title: string }) {
  return <IconButton label="Share" icon={Share2} onClick={() => navigator.share?.({ title, url: location.href }).catch(() => {})} />;
}

// ---------------------------------------------------------------------------
// Fixed action bar (mobile): 56px buttons, Sell red / Buy green. Hidden on desktop.
// ---------------------------------------------------------------------------

export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("fixed inset-x-0 bottom-0 z-40 flex gap-4 border-t border-line bg-surface px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search (UX.md 2 "Header"): sheet with a real field, rows reuse ListRow.
// ---------------------------------------------------------------------------

export function SearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Search" icon={Search} onClick={() => setOpen(true)} />
      <SearchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function rowSub(ipo: Ipo) {
  if (ipo.phase === "listed") return ipo.sector;
  if (ipo.phase === "live") return "IPO open";
  if (ipo.phase === "draft") return "IPO upcoming";
  return "Not listed · refunds open";
}

export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { countRead } = useApp();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\.listingday\.eth$/, "");
    if (!s) return IPOS;
    return IPOS.filter((i) => i.ticker.includes(s) || i.symbol.toLowerCase().includes(s) || i.name.toLowerCase().includes(s));
  }, [q]);
  useEffect(() => {
    if (q.trim()) countRead(1);
  }, [q, countRead]);
  return (
    <Sheet open={open} onClose={onClose} title="Search">
      <SearchField value={q} onChange={setQ} autoFocus />
      <div className="mt-2 divide-y divide-line">
        {hits.map((i) => (
          <ListRow
            key={i.ticker}
            href={`/stock/${i.ticker}`}
            onClick={undefined}
            logo={<TickerLogo ipo={i} size={40} />}
            title={i.name}
            sub={rowSub(i)}
            right={statusLabel(i)}
          />
        ))}
        {hits.length === 0 && <p className="t-body py-6 text-text-2">No company matches &ldquo;{q}&rdquo;.</p>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Account sheet (UX.md section 2 "Account screen").
// ---------------------------------------------------------------------------

function AccountRow({ title, sub, right, href, onClick }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="t-body block text-text">{title}</span>
        {sub && <span className="t-label block">{sub}</span>}
      </span>
      {right}
      {(href || onClick) && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-2" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </>
  );
  const cls = "flex min-h-14 w-full items-center gap-3 py-2 text-left";
  if (href)
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

function subscribeDisplayMode(cb: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

function useInstallPrompt() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => true);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return { canInstall: !!evt && !standalone, install: () => evt?.prompt().catch(() => {}) };
}

const THEME_OPTIONS: { id: ThemeSetting; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const { theme, setTheme } = useTheme();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const { canInstall, install } = useInstallPrompt();

  if (!app.connected)
    return (
      <Sheet open={open} onClose={onClose} title="Sign in">
        <p className="t-body text-text-2">Sign in with MetaMask or WalletConnect. We never move your money without asking.</p>
        <div className="mt-4 space-y-3">
          {["MetaMask", "WalletConnect"].map((w) => (
            <Button
              key={w}
              variant="secondary"
              size="bar"
              className="w-full"
              onClick={() => {
                app.connect();
                onClose();
              }}
            >
              Sign in with {w}
            </Button>
          ))}
        </div>
        <p className="t-caption mt-3">Signing in uses a crypto wallet on the Sepolia test network. Nothing is charged.</p>
        <div className="mt-4 border-t border-line">
          <AccountRow title="Appearance" right={<Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Appearance" />} />
          <AccountRow title="About Listing Day" href="/about" />
        </div>
      </Sheet>
    );

  const low = app.usdcBalance < OFFER.perApplicantCap;
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Account">
        <div className="divide-y divide-line">
          <div className="py-3">
            <div className="flex items-center gap-3">
              <Avatar size={40} />
              <div className="min-w-0 flex-1">
                <p className="t-body text-text">Signed in as {app.ensName ?? shortAddr(app.address)}</p>
                <p className="num t-label">Available to spend {usdc(app.usdcBalance)} USDC</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  app.disconnect();
                  onClose();
                }}
                className="t-change-sm h-12 shrink-0 px-2 text-gain-text"
              >
                Sign out
              </button>
            </div>
            {low && (
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="prose-link t-change-sm text-gain-text">
                Get free test USDC
              </a>
            )}
          </div>

          {app.network.ok ? (
            <AccountRow
              title={
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2 rounded-full bg-gain" />
                  {app.network.name} test network
                </span>
              }
            />
          ) : (
            <div className="py-3">
              <p className="t-body text-text">Wrong network</p>
              <p className="t-label">This app only works on the {app.network.name} test network.</p>
              <Button variant="primary" className="mt-3 w-full" onClick={app.switchNetwork}>
                Switch to {app.network.name}
              </Button>
            </div>
          )}

          <AccountRow title="Private browsing" sub={`On · ${app.anon.reads.toLocaleString("en-US")} private lookups`} onClick={() => setPrivacyOpen(true)} />

          <AccountRow title="Appearance" right={<Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Appearance" />} />

          {app.isIssuerFor.length > 0 && <AccountRow title="Issuer console" sub={`You manage ${app.isIssuerFor.map((t) => t.toUpperCase()).join(", ")}`} href="/console" />}

          {canInstall && <AccountRow title="Add to home screen" onClick={install} />}

          <AccountRow title="About Listing Day" href="/about" />
        </div>
      </Sheet>
      <PrivacySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </>
  );
}

/** Private reads explainer (content from the old PrivacyBadge, UX.md 3.10). */
export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { anon } = useApp();
  return (
    <Sheet open={open} onClose={onClose} title="Private browsing">
      <p className="t-body text-text-2">
        Every lookup this app makes goes through a private relay, so the data provider can&apos;t link your internet address to the companies you look at.
      </p>
      <div className="mt-3 divide-y divide-line">
        <KV k="Private lookups" v={anon.reads.toLocaleString("en-US")} />
        <KV k="Direct lookups" v={<span className="text-gain-text">{anon.direct} (should be 0)</span>} />
        <KV k="Relay" v={anon.transport} sub={`Fallback: ${WALLET.anonRpc.fallback}`} />
        <KV k="Connected since" v={dateTimeIST(anon.since)} />
        <KV k="Last problem" v={anon.lastError ?? "None"} />
      </div>
      <p className="t-list-title mt-4 text-text">What this doesn&apos;t hide</p>
      <ul className="t-body mt-1 list-disc space-y-1 pl-5 text-text-2">
        <li>The provider still sees which companies are looked up, just not by whom.</li>
        <li>The first connection isn&apos;t private.</li>
        <li>Buying, selling and applying go through your own wallet.</li>
      </ul>
    </Sheet>
  );
}
