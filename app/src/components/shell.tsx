"use client";

// App shell per UI.md 2.1 to 2.3 and UX.md section 2: mobile app bar + 3-item
// bottom nav, desktop top nav at >= 1024px, detail bar, Account sheet, search,
// layout containers and the fixed action bar.

import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, Briefcase, ListOrdered, Search, Share2, TrendingUp, type LucideIcon } from "lucide-react";
import { useApp } from "./providers";
import { useTheme, type ThemeSetting } from "./theme";
import { Logo as BrandLockup, Mark } from "@/components/brand";
import { TickerMark } from "@/components/company/logos";
import { EditAvatarSheet, UserAvatar } from "@/components/avatar";
import { Button, Card, Change, ListRow, SearchField, Segmented, Sheet, TickerLogo, cx } from "./ui";
import { blocksToCountdown, changeVs, lotFixed, shortAddr, usdc } from "@/lib/format";
import { BIDS, CURRENT_BLOCK, FAUCET_URL, IPOS, OFFER, dayOpen, getMarket, type Ipo } from "@/lib/mock";

// ---------------------------------------------------------------------------
// The brand mark (components/brand, design/brand/TOKENS.md). The old inline
// blue disc with a white tick is gone: the mark is an outlined octagon drawn
// in currentColor, so it follows the palette and the theme on its own.
// ---------------------------------------------------------------------------

/**
 * @deprecated Square brand glyph, kept because `screens/offline.tsx` and the
 * issuer console ask for one by `size`. New code imports `Mark`, `Wordmark` or
 * `Logo` from `@/components/brand`.
 */
export function Logo({ size = 34, className }: { size?: number; className?: string }) {
  return <Mark size={size} className={className} />;
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
// Header action (UI.md 7.2, 7.3).
//
// Icon and label on ONE line inside a 40px pill with a 48px hit area. The
// label is still compulsory, but stacking a caption under a bare glyph was the
// wrong way to honour that: it gave the header two species of control, two
// baselines and no clean bottom edge. Search, Share, Back and Account are now
// the same pill, and `strong` draws the hairline that marks the one primary
// action of the pair.
// ---------------------------------------------------------------------------

/** 40px visual, 48px target: the pill plus 4px of invisible reach above and below. */
const BAR_ACTION =
  "t-chip relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 whitespace-nowrap text-text transition-colors duration-120 hover:bg-surface-2 active:bg-surface-2 after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']";

export function IconButton({
  label,
  icon: Icon,
  onClick,
  href,
  strong,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  /** Adds the hairline that makes this the header's primary action. */
  strong?: boolean;
  className?: string;
}) {
  const cls = cx(BAR_ACTION, strong && "border border-line px-4", className);
  const body = (
    <>
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
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

/** The signed-in person's profile picture (components/avatar). */
function Avatar({ size = 36 }: { size?: number }) {
  const { address } = useApp();
  return <UserAvatar address={address} size={size} />;
}

/**
 * The account control: one 40px pill in every state and at every width, so it
 * pairs with Search in the app bar and sits level in the desktop nav. The old
 * `compact` flag is gone with the two shapes it used to switch between.
 */
export function AccountControl() {
  const { connected, sessionReady, connect } = useApp();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pathWhenOpen, setPathWhenOpen] = useState(pathname);
  // The control lives in the root nav, so a client navigation does not remount
  // it. Drop the sheet as soon as the path changes, including the back button.
  if (open && pathWhenOpen !== pathname) {
    setOpen(false);
    setPathWhenOpen(pathname);
  }
  const show = () => {
    setPathWhenOpen(pathname);
    setOpen(true);
  };
  // The session is read after mount, so hold the space until it is known
  // rather than showing "Sign in" and swapping it for the picture a tick later.
  if (!sessionReady) return <span aria-hidden className="block h-10 w-[88px]" />;

  // Signed out there is nothing to put in an account sheet, so the control is
  // the sign-in itself: one tap, straight into the sign-in dialog. The two
  // settings that need no account (Appearance, About) moved to the foot of
  // Portfolio; see AppSettingsRows.
  //
  // Either way this is the one hairlined control in the header: the same pill
  // as Search beside it, drawn as the primary of the pair.
  if (!connected)
    return (
      <button type="button" onClick={connect} className={cx(BAR_ACTION, "border border-line px-4")}>
        Sign in
      </button>
    );

  return (
    <>
      <button type="button" onClick={show} className={cx(BAR_ACTION, "border border-line pr-4 pl-1.5")}>
        <Avatar size={28} />
        <span>Account</span>
      </button>
      <AccountSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The one sign-in affordance (UI.md 7.7).
//
// Every signed-out surface in the app uses one of these two: the button, or
// the card that explains what signing in puts on the screen. Both call
// `connect()` directly, so signing in is always one tap and always lands in
// the same dialog. Nothing in the app asks twice, and nothing says "connect"
// or "wallet".
// ---------------------------------------------------------------------------

/** "Sign in", filled, straight into the sign-in dialog. */
export function SignInButton({
  label = "Sign in",
  size = "default",
  className,
}: {
  label?: string;
  size?: "bar" | "default" | "sm";
  className?: string;
}) {
  const { connect } = useApp();
  return (
    <Button variant="buy" size={size} className={className} onClick={connect}>
      {label}
    </Button>
  );
}

/**
 * The signed-out block: what this screen shows once you are signed in, the
 * list of what appears (optional), and one filled "Sign in".
 */
export function SignInCard({
  title,
  body,
  points,
  label = "Sign in",
  quiet,
  className,
}: {
  title: string;
  body: string;
  /** Named, in the words the signed-in screen uses. Omit for in-page slots. */
  points?: string[];
  label?: string;
  /**
   * The screen already carries a filled "Sign in" somewhere it can't miss (the
   * action bar, the sticky panel). Same words, same one tap, lighter shape, so
   * the screen keeps one filled action (UI.md 7.4).
   */
  quiet?: boolean;
  className?: string;
}) {
  const { connect, network } = useApp();
  return (
    <Card className={cx("p-5", className)}>
      <h2 className="t-card-title text-text">{title}</h2>
      <p className="t-body mt-1 text-text-2">{body}</p>
      {points && points.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {points.map((p) => (
            <li key={p} className="t-body flex min-h-12 items-center py-2 text-text">
              {p}
            </li>
          ))}
        </ul>
      )}
      {quiet ? (
        <button type="button" onClick={connect} className="prose-link t-change-sm mt-1 text-gain-text underline-offset-[3px] hover:underline focus-visible:underline">
          {label}
        </button>
      ) : (
        <>
          <SignInButton label={label} size="bar" className="mt-4 w-full sm:w-auto sm:min-w-[240px]" />
          <p className="t-caption mt-3">
            Use your email and we make you a secure wallet, or sign in with one you already have. Everything here runs on the {network.name} test
            network and nothing is charged.
          </p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mobile app bar (tab screens). Hidden on desktop where TopNav takes over.
// ---------------------------------------------------------------------------

export function AppBar({ title, right, below }: { title: string; right?: ReactNode; below?: ReactNode }) {
  const scrolled = useScrolled();
  return (
    <header className={cx("sticky top-0 z-30 -mx-5 bg-bg px-5 pt-[max(0px,env(safe-area-inset-top))] lg:hidden", scrolled ? "border-b border-line" : "border-b border-transparent")}>
      <div className="flex h-14 items-center gap-2.5">
        {/* 30, not the old disc's 34: an outlined octagon with a 10%-of-size
            stroke carries more weight than a flat circle at the same box, and
            30 sits level with the 20px title's cap height. */}
        <Mark size={30} className="text-text" />
        <h1 className="text-[20px] leading-7 font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
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
  const [searchOpen, setSearchOpen] = useState(false);
  // The issuer console is a separate app with its own shell (components/console).
  if (path.startsWith("/console")) return null;
  return (
    <nav className="sticky top-0 z-30 hidden h-14 border-b border-line bg-bg lg:block" aria-label="Main">
      <Container className="flex h-full items-center">
        {/* The lockup rather than the mark plus typed text: the wordmark is
            drawn letterforms from the brand file, and typing the name in the
            UI face would drift the moment the typeface changes. One SVG also
            keeps the mark-to-word spacing the brand file specifies. */}
        <Link href="/" className="mr-11 flex items-center text-text" aria-label="thaamba, home">
          <BrandLockup height={28} />
        </Link>
        {/* 44px of clear space after the lockup against 28px between the links:
            the brand and the navigation have to read as two things, not one
            run of words. Both hold at 1024, where the row still has ~130px
            spare before the search field. */}
        <ul className="flex h-full items-stretch gap-7">
          {NAV.map((it) => {
            const active = it.match(path);
            return (
              <li key={it.href} className="flex">
                <Link
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("relative flex items-center text-[17px] leading-[22px] font-medium", active ? "text-text" : "text-text-2 hover:text-text")}
                >
                  {it.label}
                  {active && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-gain" />}
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
        <div className="ml-4 flex items-center">
          <AccountControl />
        </div>
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
    <header className="sticky top-0 z-30 -mx-5 flex h-14 items-center bg-bg px-5 pt-[max(0px,env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
        className={cx(BAR_ACTION, "-ml-3")}
      >
        <ArrowLeft className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span>Back</span>
      </button>
      <div className="ml-auto flex items-center gap-2">{right}</div>
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
// Sheets. The app bar is sticky and z-indexed, so a sheet rendered from inside
// it would sit under the bottom nav; every sheet below goes to document.body.
// ---------------------------------------------------------------------------

const noSubscribe = () => () => {};
const alwaysTrue = () => true;
const alwaysFalse = () => false;

/** Renders a sheet into document.body once mounted on the client. */
function SheetPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noSubscribe, alwaysTrue, alwaysFalse);
  if (!mounted) return null;
  return createPortal(children, document.body);
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

/**
 * One company row in three shapes (UX.md section 2): listed (price and today's
 * change, with a Watch / Halted word), IPO open or upcoming, and closed but not
 * listed. Search results use these; list screens can reuse them.
 */
export function CompanyResultRow({ ipo, hasMoneyIn }: { ipo: Ipo; hasMoneyIn?: boolean }) {
  const href = `/stock/${ipo.ticker}`;
  const logo = <TickerLogo ipo={ipo} size={40} />;

  if (ipo.phase === "listed") {
    const m = getMarket(ipo.ticker);
    const last = m ? m.prices[m.prices.length - 1].value : (ipo.clearingPrice ?? 0);
    const open = dayOpen(ipo.ticker) ?? last;
    const ch = changeVs(last, open);
    const halted = m?.policy.halted || m?.policy.mode === "halted";
    const watch = !halted && (m?.policy.mode === "surveillance" || m?.policy.mode === "directional");
    return (
      <ListRow
        href={href}
        logo={logo}
        title={ipo.name}
        sub={
          <>
            <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · {ipo.sector}
          </>
        }
        flag={halted ? { text: "Halted", tone: "loss" } : watch ? { text: "Watch", tone: "warn" } : undefined}
        right={lotFixed(last)}
        rightSub={<Change abs={ch.abs} rel={ch.rel} />}
      />
    );
  }

  if (ipo.phase === "live")
    return (
      <ListRow
        href={href}
        logo={logo}
        title={ipo.name}
        sub={
          <>
            <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · IPO open · closes in{" "}
            {blocksToCountdown((ipo.endBlock ?? CURRENT_BLOCK) - CURRENT_BLOCK)}
          </>
        }
        right={<span className="t-change-sm text-gain-text">Apply</span>}
      />
    );

  if (ipo.phase === "draft")
    return (
      <ListRow
        href={href}
        logo={logo}
        title={ipo.name}
        sub={
          <>
            <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · IPO opens in{" "}
            {blocksToCountdown((ipo.startBlock ?? CURRENT_BLOCK) - CURRENT_BLOCK)}
          </>
        }
        right={<span className="t-body text-text-2">{`${lotFixed(OFFER.floorPrice)} to ${lotFixed(OFFER.capPrice)}`}</span>}
      />
    );

  return (
    <ListRow
      href={href}
      logo={logo}
      title={ipo.name}
      sub={
        <>
          <TickerMark ticker={ipo.ticker} symbol={ipo.symbol} /> · Not listed · refunds open
        </>
      }
      right={
        hasMoneyIn ? (
          <span className="t-change-sm text-gain-text">Refund</span>
        ) : (
          <span className="t-body text-text-2">Closed</span>
        )
      }
    />
  );
}

export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { connected } = useApp();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\.listingday\.eth$/, "");
    if (!s) return IPOS;
    return IPOS.filter((i) => i.ticker.includes(s) || i.symbol.toLowerCase().includes(s) || i.name.toLowerCase().includes(s));
  }, [q]);
  const moneyIn = (ticker: string) => connected && BIDS.some((b) => b.ticker === ticker && b.refund > 0 && b.state !== "exited" && b.state !== "claimed");
  if (!open) return null;
  return (
    <SheetPortal>
      <Sheet open={open} onClose={onClose} title="Search">
        <SearchField value={q} onChange={setQ} autoFocus />
        <div className="mt-2 divide-y divide-line" onClick={onClose} role="presentation">
          {hits.map((i) => (
            <CompanyResultRow key={i.ticker} ipo={i} hasMoneyIn={moneyIn(i.ticker)} />
          ))}
          {hits.length === 0 && <p className="t-body py-6 text-text-2">No company matches &ldquo;{q}&rdquo;.</p>}
        </div>
        <p className="t-caption mt-4">Prices in USDC per 1,000 shares.</p>
      </Sheet>
    </SheetPortal>
  );
}

// ---------------------------------------------------------------------------
// Account sheet (UX.md section 2 "Account screen").
// ---------------------------------------------------------------------------

function AccountRow({
  title,
  sub,
  right,
  href,
  external,
  onClick,
  onNavigate,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  href?: string;
  /** Opens in a new tab (the test-USDC faucet). */
  external?: boolean;
  onClick?: () => void;
  /** Close the sheet when an in-app link is followed, including a same-page link. */
  onNavigate?: () => void;
}) {
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
  if (href && external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {body}
      </a>
    );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onNavigate}>
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

const isIosDevice = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function useInstallPrompt() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => true);
  const ios = useSyncExternalStore(noSubscribe, isIosDevice, alwaysFalse);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return {
    canInstall: (!!evt || ios) && !standalone,
    /** iOS has no prompt API: the row opens a two-step instruction sheet. */
    needsSteps: !evt && ios,
    install: () => evt?.prompt().catch(() => {}),
  };
}

/** iOS "Add to home screen" instructions (UX.md section 5: never a pop-up). */
function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <SheetPortal>
      <Sheet open={open} onClose={onClose} title="Add to home screen">
        <p className="t-body text-text-2">Two steps in Safari, and thaamba opens like any other app.</p>
        <ol className="t-body mt-3 list-decimal space-y-2 pl-5 text-text">
          <li>Tap the Share button at the bottom of Safari.</li>
          <li>Scroll down and tap &ldquo;Add to Home Screen&rdquo;, then tap Add.</li>
        </ol>
      </Sheet>
    </SheetPortal>
  );
}

const THEME_OPTIONS: { id: ThemeSetting; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/**
 * Appearance and About: the only two settings that work without an account.
 *
 * Signed in they sit in the Account sheet. Signed out there is no account
 * sheet any more (the header control signs you in directly), so they live at
 * the foot of Portfolio, the "you" tab, one tap away from every screen in the
 * bottom nav and the desktop top nav.
 */
export function AppSettingsRows({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <section className={cx("border-t border-line", className)}>
      <AccountRow title="Appearance" right={<Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Appearance" />} />
      <AccountRow title="About thaamba" sub="What this is, the mock disclaimer, credits" href="/about" />
    </section>
  );
}

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const { theme, setTheme } = useTheme();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { canInstall, needsSteps, install } = useInstallPrompt();

  // Signed out this sheet has nothing to say: the header control is the sign
  // in. It is never opened in that state, and never renders one.
  if (!open || !app.connected) return null;

  const low = app.usdcBalance < OFFER.perApplicantCap;
  return (
    <SheetPortal>
      <Sheet open={open} onClose={onClose} title="Account">
        <div className="divide-y divide-line">
          <div className="flex min-h-14 items-center gap-3 py-3">
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

          <AccountRow
            title="Profile picture"
            sub="Pick one made from your account, or upload your own"
            right={<Avatar size={32} />}
            onClick={() => setAvatarOpen(true)}
          />

          {low && <AccountRow title="Get free test USDC" sub="Opens the Circle faucet in a new tab" href={FAUCET_URL} external />}

          {app.network.ok ? (
            <AccountRow
              title={
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2 rounded-full bg-gain" />
                  {app.network.name} test network
                </span>
              }
              sub="Everything here is test money."
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

          <AccountRow title="Private browsing" sub="How your lookups are kept private" onClick={() => setPrivacyOpen(true)} />

          <AccountRow title="Appearance" right={<Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Appearance" />} />

          {/*
            No issuer row here on purpose. The console is a separate product
            with its own sign in at /console, and the investor app must not
            reveal that an issuer mode exists. See design/UX.md section 2.
          */}

          {canInstall && (
            <AccountRow title="Add to home screen" sub="Opens like an app, works offline" onClick={() => (needsSteps ? setInstallOpen(true) : install())} />
          )}

          <AccountRow title="About thaamba" sub="What this is, the mock disclaimer, credits" href="/about" onNavigate={onClose} />
        </div>
      </Sheet>
      <PrivacySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      <EditAvatarSheet open={avatarOpen} onClose={() => setAvatarOpen(false)} address={app.address} />
    </SheetPortal>
  );
}

/**
 * Private reads explainer (UX.md 3.10).
 *
 * The counters that used to sit here ("342 private lookups", "0 direct") were
 * fabricated: they came from a fixture and a timer, not from any traffic. They
 * are gone. The explanation stays, because it is the point: what private
 * browsing does, and what it does not hide. The last paragraph says plainly
 * where this build stands, so the design is never read as a live measurement.
 */
export function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { anon } = useApp();
  if (!open) return null;
  return (
    <SheetPortal>
      <Sheet open={open} onClose={onClose} title="Private browsing">
        <p className="t-body text-text-2">
          Prices and company details have to be fetched from somewhere, and whoever serves them can normally see your
          internet address next to every company you look at. Private browsing sends those lookups through a relay
          instead, so the two cannot be tied together.
        </p>

        <p className="t-list-title mt-4 text-text">What this doesn&apos;t hide</p>
        <ul className="t-body mt-1 list-disc space-y-1 pl-5 text-text-2">
          <li>The provider still sees which companies are looked up, just not by whom.</li>
          <li>The first connection isn&apos;t private.</li>
          <li>Buying, selling and applying go through your own wallet, which has its own connection.</li>
          <li>Your account name, once you are signed in, is yours.</li>
        </ul>

        <p className="t-list-title mt-4 text-text">Where this build stands</p>
        <p className="t-body mt-1 text-text-2">
          {anon.live
            ? `Lookups are going through ${anon.transport} right now.`
            : `Not switched on yet. This build's lookups still go straight to the server, and so does the one request it makes to read your account name. The relay is ${anon.transport}, with ${anon.fallback} behind it.`}
        </p>
        <p className="t-caption mt-2">No lookup counts are shown here. Nothing is measuring that traffic yet, so there is nothing to report.</p>
      </Sheet>
    </SheetPortal>
  );
}
