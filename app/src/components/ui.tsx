"use client";

// UI primitives per design/UI.md section 2 (Groww parity) and section 7
// (legibility). Every colour is a token, no shadows, no gradients, 10px radius.
// See components/README.md for the prop reference.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { CompanyLogo } from "@/components/company/logos";
import type { Ipo } from "@/lib/mock";
import { addrUrl, shortAddr } from "@/lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Ticker logo (UI.md 6.2 TickerTile): flat initials on a neutral surface.
// ---------------------------------------------------------------------------

export function TickerLogo({
  ipo,
  initials,
  size = 36,
  className,
}: {
  ipo?: { avatar?: Ipo["avatar"]; ticker?: string };
  initials?: string;
  size?: 28 | 36 | 40 | 48 | number;
  className?: string;
}) {
  if (ipo?.ticker) return <CompanyLogo ticker={ipo.ticker} size={size} className={className} />;
  const text = initials ?? ipo?.avatar?.initials ?? "";
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-2 font-medium text-text select-none", className)}
      // The initials scale with the tile instead of stepping at one breakpoint,
      // so a 28 and a 48 tile read as the same mark at two sizes.
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)), lineHeight: 1 }}
    >
      {text}
    </span>
  );
}

/** @deprecated legacy name; use TickerLogo. */
export function TickerAvatar({ ipo, size = 32 }: { ipo: Pick<Ipo, "avatar" | "symbol">; size?: number }) {
  return <TickerLogo ipo={ipo} size={size} />;
}

// ---------------------------------------------------------------------------
// Card (UI.md 6.2): 10px radius, 1px line, surface fill, no shadow.
// ---------------------------------------------------------------------------

export function Card({ className, children, interactive, role }: { className?: string; children: ReactNode; interactive?: boolean; role?: string }) {
  return (
    <div
      role={role}
      className={cx(
        "rounded-[10px] border border-line bg-surface",
        interactive && "transition-colors duration-120 hover:border-line-strong active:bg-surface-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change: sign always, gain-text / loss-text, tabular (UI.md 7.6).
// ---------------------------------------------------------------------------

export function Change({
  abs,
  rel,
  digits = 2,
  size = "sm",
  className,
}: {
  abs: number;
  rel: number;
  digits?: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  // Round first, so a sub-cent fall never prints as "-0.00".
  const rounded = Number(abs.toFixed(digits));
  const up = rounded >= 0;
  const a = Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <span className={cx("num", size === "lg" ? "t-change-lg" : "t-change-sm", up ? "text-gain-text" : "text-loss-text", className)}>
      {rounded === 0 ? "" : up ? "+" : "-"}
      {a} ({Math.abs(rel).toFixed(2)}%)
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar (UI.md 3.2): 4px, track line, fill gain, threshold tick.
// ---------------------------------------------------------------------------

export function ProgressBar({ value, max, marker, className }: { value: number; max: number; marker?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cx("relative h-1 w-full overflow-visible rounded-full bg-line", className)}
      role="progressbar"
      aria-label="Progress"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {/* The fill carries the same radius as the track, so a 2% raise still
          reads as a rounded bar sitting in a rounded trough, not a chip. */}
      <div className="h-full rounded-full bg-gain transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
      {marker !== undefined && (
        <span aria-hidden className="absolute -top-[3px] h-[10px] w-px bg-text" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />
      )}
    </div>
  );
}

/** @deprecated legacy name; use ProgressBar. The tone prop is ignored. */
export function Progress({ value, max, marker }: { value: number; max: number; marker?: number; tone?: string }) {
  return <ProgressBar value={value} max={max} marker={marker} />;
}

// ---------------------------------------------------------------------------
// In-place view swaps (UI.md 5): one body replacing another under a tab row.
// ---------------------------------------------------------------------------

/**
 * One movement, one duration, one curve, for every tab-like control in the app.
 *
 * 200ms is the number UI.md 5 already gives a tab underline, and the curve is
 * the decelerating one the chart's range tween runs on (`easeOutCubic` in
 * components/chart/series.ts, 1 - (1 - t)^3, written here as the bezier CSS
 * spells it). So when a tab row changes, the underline and the body it governs
 * travel together on the same curve for the same 200ms: one gesture, not two
 * animations that happen to overlap.
 *
 * The travel is 8px, the distance UI.md 5 already allows a modal, taken
 * sideways here in the direction the tab row moved: the body arrives from the
 * side the user reached towards.
 */
const SWAP_MS = 200;
const SWAP_EASE = "cubic-bezier(0.215, 0.61, 0.355, 1)";
const SWAP_PX = 8;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The hold currently in force, so a second swap replaces it instead of racing it. */
let releaseHold: (() => void) | null = null;

/**
 * Hold the page's height across one view swap.
 *
 * Two tab bodies are never the same height. When the shorter one arrives the
 * document shrinks, the browser clamps the scroll position to the new bottom,
 * and the whole page -- the tab row the user is still touching included --
 * slides up under the finger. Nobody asked for that scroll.
 *
 * So: pin the page to the height it had, let the new body settle, then let go.
 * If letting go would still clamp the scroll, keep exactly the height the
 * current position needs to stand on, and drop even that the moment scrolling
 * up makes it unnecessary. The page never gets shorter under a reader.
 *
 * Every in-place swap goes through here, which is how a tab row that only
 * calls `onChange` (UnderlineTabs, Segmented) gets this without its screen
 * knowing anything about it. It has to be called *before* the new view is in
 * the DOM -- from the control that starts the swap, never from an effect after
 * it -- because by then the browser has already clamped the scroll.
 */
export function holdPageHeight() {
  if (typeof document === "undefined") return;
  // A sheet owns the page scroll while it is open (body overflow is hidden), so
  // a tab row inside one has nothing to hold.
  if (document.querySelector('[role="dialog"]')) return;

  const body = document.body;
  const doc = document.documentElement;
  // Where the reader is, before anything is let go of: dropping a pad from an
  // earlier swap can shrink the page and clamp the scroll on its own.
  const needed = window.scrollY + window.innerHeight;
  const was = window.scrollY;
  releaseHold?.();
  body.style.minHeight = `${Math.max(doc.scrollHeight, needed)}px`;
  if (window.scrollY !== was) window.scrollTo(0, was);

  let timer = 0;
  let onScroll: (() => void) | null = null;
  const stop = () => {
    window.clearTimeout(timer);
    if (onScroll) window.removeEventListener("scroll", onScroll);
    onScroll = null;
    body.style.minHeight = "";
    if (releaseHold === stop) releaseHold = null;
  };
  const settle = () => {
    // Where the reader is has to be read before the hold comes off: letting go
    // and measuring is itself enough to make the browser clamp the scroll, and
    // then the number being protected is already gone.
    const needed = window.scrollY + window.innerHeight;
    body.style.minHeight = "";
    const natural = doc.scrollHeight;
    if (needed <= natural) {
      stop();
      return;
    }
    // Still too short: keep exactly the height this position needs. All of this
    // happens in one go, before the browser paints, so a clamp that did land
    // between the two lines above is undone without ever being seen.
    body.style.minHeight = `${needed}px`;
    if (window.scrollY + window.innerHeight < needed) window.scrollTo(0, needed - window.innerHeight);
    onScroll = () => {
      if (window.scrollY + window.innerHeight <= natural) stop();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  };
  timer = window.setTimeout(settle, prefersReducedMotion() ? 0 : SWAP_MS);
  releaseHold = stop;
}

/**
 * Play the arrival on elements that have just become the new view.
 *
 * The swap itself is never gated: React has already put the new body in the
 * DOM and it is interactive from the first frame. The animation runs over the
 * top of it, so a tab is usable at 0ms and merely still settling at 100ms.
 *
 * `dir` is -1, 0 or 1: which way along the tab row the user moved.
 */
function playSwap(targets: Element[], dir: number) {
  if (prefersReducedMotion()) return;
  for (const el of targets) {
    if (!(el instanceof HTMLElement) || typeof el.animate !== "function") continue;
    // A view that animates its own arrival (ViewSwap) is left alone: two fades
    // over one body is two gestures, which is the thing this is avoiding.
    if (el.hasAttribute("data-view-swap")) continue;
    el.animate([{ opacity: 0, transform: `translateX(${dir * SWAP_PX}px)` }, { opacity: 1, transform: "none" }], {
      duration: SWAP_MS,
      easing: SWAP_EASE,
    });
  }
}

/**
 * Play the arrival on the content a tab row governs but does not own.
 *
 * `UnderlineTabs` and `Segmented` are given a value and a callback; the body
 * they switch between belongs to the screen, as a sibling further down the
 * same block. So the row finds that content the only way it can -- the
 * elements that follow it once the swap has committed -- and animates those.
 * It is how a screen that never heard of any of this still gets the motion.
 *
 * Deliberately shallow: at most three steps up looking for something that
 * follows, never past `<main>` or the page itself, and nothing animated from a
 * row that is not the visible one (Orders renders a phone row and a desktop
 * row, and only one of them is on screen).
 */
function playSwapAfter(row: HTMLElement | null, dir: number) {
  if (!row || prefersReducedMotion()) return;
  if (row.offsetParent === null) return;

  let node: HTMLElement | null = row;
  for (let step = 0; node && !node.nextElementSibling && step < 3; step++) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent || parent === document.body || parent.tagName === "MAIN") break;
    node = parent;
  }
  if (!node || !node.nextElementSibling) return;

  const targets: Element[] = [];
  for (let el: Element | null = node.nextElementSibling; el && targets.length < 12; el = el.nextElementSibling) targets.push(el);
  playSwap(targets, dir);
}

/** Which way along `order` the view moved: 1 forward, -1 back, 0 if unknown. */
function swapDir<T extends string>(order: readonly T[] | undefined, from: T, to: T) {
  if (!order) return 0;
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  return a < 0 || b < 0 ? 0 : Math.sign(b - a);
}

/**
 * One view replacing another in place: Markets' Stocks and IPO bodies, the IPO
 * status segments. The incoming body arrives on the shared swap movement while
 * the page holds the height it had, so the change reads as a movement and the
 * tab row above it does not shift. Under reduced motion it is immediate.
 *
 * `view` is the view's identity and `order` is the row it belongs to, which is
 * what gives the arrival its direction. Re-rendering with the same view (a poll
 * landing, a countdown ticking) animates nothing.
 */
export function ViewSwap<T extends string>({
  view,
  order,
  children,
  className,
}: {
  view: T;
  order?: readonly T[];
  children: ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const shown = useRef(view);
  useLayoutEffect(() => {
    if (shown.current === view) return;
    const dir = swapDir(order, shown.current, view);
    shown.current = view;
    playSwap(inner.current ? [inner.current] : [], dir);
  }, [view, order]);
  return (
    <div className={className} data-view-swap="">
      <div ref={inner}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips (UI.md 2.5 filter, 2.6 range): 40px tall, 48px hit area.
// ---------------------------------------------------------------------------

/**
 * One source for every 40px pill in the app (filter chips, range chips, the
 * segmented row). Chips are 40 tall; the `after` box pads the hit area to 48
 * without moving the pill or the 8px gap between pills (UI.md 7.2).
 * Rest, hover and pressed are three distinct steps in both themes.
 */
function chipClass(opts: { selected?: boolean; variant?: "filter" | "range"; disabled?: boolean; className?: string }) {
  const { selected, variant = "filter", disabled, className } = opts;
  return cx(
    "t-chip relative inline-flex h-10 items-center justify-center rounded-full border whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,filter] duration-120",
    "after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']",
    // A filter chip keeps its width. A range chip is one of seven on a phone,
    // so it may shrink: seven at 52px plus gaps overflowed a 390px screen once
    // the typeface changed. The 48px touch target is held by the after box.
    variant === "filter" ? "shrink-0 px-[18px]" : "min-w-[40px] px-[10px]",
    selected
      ? cx("border-chip-on-line bg-chip-on-bg text-text", !disabled && "active:brightness-[0.96]")
      : variant === "filter"
        ? cx("border-line text-text", !disabled && "hover:bg-surface-2 active:bg-line")
        : cx("border-transparent text-text-2", !disabled && "hover:bg-surface-2 hover:text-text active:bg-line"),
    disabled && "border-line text-text-3",
    className,
  );
}

export function Chip({
  selected,
  onClick,
  href,
  children,
  variant = "filter",
  disabled,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
  /** filter: outlined at rest. range: borderless, text-2 at rest. */
  variant?: "filter" | "range";
  disabled?: boolean;
  className?: string;
}) {
  const cls = chipClass({ selected, variant, disabled, className });
  const router = useRouter();
  const [, startSwap] = useTransition();
  if (href) {
    return (
      <Link
        href={href}
        aria-current={selected ? "page" : undefined}
        className={cls}
        replace
        scroll={false}
        onClick={(e) => {
          // Modified clicks and middle clicks stay the browser's business: this
          // is still a link, and it still opens in a new tab.
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          // Hold the page before anything moves, then do the chip's own work
          // urgently (a screen that keeps its selection locally swaps right
          // now), and leave the URL -- a bookmark, not something the user is
          // waiting on -- to a transition. Marking the navigation non-urgent is
          // what keeps the swap from being torn across two frames.
          holdPageHeight();
          onClick?.();
          startSwap(() => router.replace(href, { scroll: false }));
        }}
      >
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/** Horizontal chip row: scrolls, keeps the 20px page padding, no fade masks. Max one per screen. */
export function ChipRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1", className)}>{children}</div>;
}

/** @deprecated legacy name; use Chip. */
export function FilterChip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <Chip selected={active} onClick={onClick}>
      {children}
    </Chip>
  );
}

/** Single-select chip row (Open · Upcoming · Closed, System · Light · Dark). Same look as Chip. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  className?: string;
  /** @deprecated ignored */
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement>(null);
  const order = options.map((o) => o.id);
  const [, startSwap] = useTransition();
  const shown = useRef(value);

  // Changing a segment swaps a view somewhere below it. The row cannot see that
  // view, so it holds the page height before the change and plays the arrival
  // on whatever follows it afterwards: every screen with a segmented row gets
  // the same movement without knowing it is there.
  const select = (next: T) => {
    if (next === value) return;
    holdPageHeight();
    startSwap(() => onChange(next));
  };
  useLayoutEffect(() => {
    if (shown.current === value) return;
    const dir = swapDir(order, shown.current, value);
    shown.current = value;
    playSwapAfter(rowRef.current, dir);
    // `order` is rebuilt every render; `value` is the change worth reacting to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // A radiogroup is one tab stop: Tab reaches the checked option, the arrows
  // move between options. Matches how the chip row reads out loud.
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    select(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div ref={rowRef} role="radiogroup" aria-label={label} className={cx("flex flex-wrap gap-2", className)}>
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          ref={(el) => {
            refs.current[i] = el;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i, -1);
            }
          }}
          onClick={() => select(o.id)}
          className={chipClass({ selected: value === o.id })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Underline tabs (UI.md 2.7): 48px, one sliding 3px gain underline.
// ---------------------------------------------------------------------------

export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  equal = true,
  underline = "gain",
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (t: T) => void;
  /** Equal widths (mobile). false = auto width with 24px padding (desktop tables). */
  equal?: boolean;
  underline?: "gain" | "loss";
  className?: string;
}) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  // `animate` is false for the first measurement only: the bar appears where it
  // belongs instead of sliding in from the left edge on every page load.
  const [bar, setBar] = useState<{ left: number; width: number; animate: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      const list = listRef.current;
      if (!el || !list) return;
      // offsetLeft is already relative to this list (it is position: relative),
      // while list.offsetLeft is the list's place in a higher ancestor. Subtracting
      // the two shifts the bar by the centred container's offset.
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setBar((prev) => ({ left: elRect.left - listRect.left, width: elRect.width, animate: prev !== null }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const el = refs.current.get(value);
    if (el) ro.observe(el);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [value, tabs.length]);

  const order = tabs.map((t) => t.id);
  const [, startSwap] = useTransition();
  const shown = useRef(value);

  // The panel this row switches between belongs to the screen, not to the row.
  // So: hold the page height before the change, mark it non-urgent, and once it
  // has committed play the arrival on the content that follows the row. The
  // underline slides on the same 200ms and the same curve, so the bar and the
  // body are one movement.
  const select = (next: T) => {
    if (next === value) return;
    holdPageHeight();
    startSwap(() => onChange(next));
  };
  useLayoutEffect(() => {
    if (shown.current === value) return;
    const dir = swapDir(order, shown.current, value);
    shown.current = value;
    playSwapAfter(listRef.current, dir);
    // `order` is rebuilt every render; `value` is the change worth reacting to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    select(tabs[next].id);
    refs.current.get(tabs[next].id)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" className={cx("relative flex border-b border-line", className)}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          ref={(el) => {
            if (el) refs.current.set(t.id, el);
            else refs.current.delete(t.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              move(i, -1);
            } else if (e.key === "Home") {
              e.preventDefault();
              move(0, 0);
            } else if (e.key === "End") {
              e.preventDefault();
              move(tabs.length - 1, 0);
            }
          }}
          onClick={() => select(t.id)}
          className={cx(
            // -outline-offset keeps the focus ring inside the 48px tab instead
            // of painting over the neighbour and the underline.
            "t-tab h-12 whitespace-nowrap transition-colors duration-120 select-none focus-visible:-outline-offset-2",
            equal ? "flex-1" : "px-6",
            value === t.id ? (underline === "loss" ? "text-loss-text" : "text-gain-text") : "text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num ml-1 text-text-2">{t.count}</span>}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden
          className={cx(
            "absolute -bottom-px h-[3px]",
            // Same 200ms and same curve as the body it governs (UI.md 5 asks
            // for 200ms ease-out; `ease-swap` is that curve as easeOutCubic,
            // which is what the chart's range tween runs on).
            bar.animate && "duration-200 ease-swap transition-transform",
            underline === "loss" ? "bg-loss" : "bg-gain",
          )}
          style={{ width: bar.width, transform: `translateX(${bar.left}px)`, left: 0 }}
        />
      )}
    </div>
  );
}

/** @deprecated legacy name; use UnderlineTabs. */
export const Tabs = UnderlineTabs;

// ---------------------------------------------------------------------------
// List row (UI.md 2.9 / UX.md section 2): 64px min, logo, name, grey line, right column.
// ---------------------------------------------------------------------------

export function ListRow({
  href,
  onClick,
  logo,
  title,
  sub,
  right,
  rightSub,
  flag,
  sparkline,
  chevron,
  className,
}: {
  href?: string;
  onClick?: () => void;
  logo?: ReactNode;
  title: ReactNode;
  /** One grey line under the name (sector, "IPO open · closes in 42m"). */
  sub?: ReactNode;
  /** Right column, line 1 (price 18/500 or "Apply"). */
  right?: ReactNode;
  /** Right column, line 2 (change). */
  rightSub?: ReactNode;
  /** Short status word before the price: "Watch" (warn) or "Halted" (loss). */
  flag?: { text: string; tone: "warn" | "loss" };
  sparkline?: ReactNode;
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {logo}
      <span className="min-w-0 flex-1">
        <span className="t-list-title block truncate text-text">{title}</span>
        {sub && <span className="t-label block truncate">{sub}</span>}
      </span>
      {sparkline && <span className="hidden shrink-0 min-[360px]:block">{sparkline}</span>}
      {(right || rightSub || flag) && (
        // pl-1 on top of the row gap: the value column needs more air from the
        // sparkline than the logo needs from the name.
        <span className="num flex shrink-0 flex-col items-end pl-1 text-right">
          <span className="flex items-baseline gap-2">
            {flag && <span className={cx("t-change-sm", flag.tone === "loss" ? "text-loss-text" : "text-warn")}>{flag.text}</span>}
            {right && <span className="text-[18px] leading-6 font-medium text-text">{right}</span>}
          </span>
          {rightSub && <span className="t-change-sm">{rightSub}</span>}
        </span>
      )}
      {chevron && <ChevronRight className="-mr-1 size-5 shrink-0 text-text-2" />}
    </>
  );
  const cls = cx(
    "flex min-h-16 w-full items-center gap-3 py-3 text-left transition-colors duration-120",
    (href || onClick) && "hover:bg-surface-2 active:bg-surface-2",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

// ---------------------------------------------------------------------------
// Cards: company (2-col grid), index strip, summary 2x2, promo.
// ---------------------------------------------------------------------------

export function CompanyCard({
  href,
  logo,
  name,
  price,
  change,
  sub,
}: {
  href: string;
  logo: ReactNode;
  name: string;
  /** Price line (16/400). For an open IPO pass "Closes in 02:14" instead. */
  price: ReactNode;
  /** Change line (14/500 gain/loss), usually <Change />. */
  change?: ReactNode;
  /** Optional 13px caption under the change. */
  sub?: ReactNode;
}) {
  return (
    <Link href={href} className="block min-h-[160px] rounded-[10px] border border-line bg-surface p-4 transition-colors duration-120 hover:border-line-strong active:bg-surface-2">
      {logo}
      <span className="t-card-title mt-5 block truncate text-text">{name}</span>
      <span className="num t-price-row mt-2 block text-text">{price}</span>
      {change && <span className="num mt-1 block">{change}</span>}
      {sub && <span className="t-caption mt-1 block">{sub}</span>}
    </Link>
  );
}

export function IndexCard({
  href,
  onClick,
  label,
  value,
  change,
  spark,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  value: ReactNode;
  change?: ReactNode;
  /** Small chart sitting behind the figures. */
  spark?: ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="t-label-sm block truncate text-text">{label}</span>
        <span className="num mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-[16px] leading-[22px] text-text">{value}</span>
          {change && <span className="t-change-sm">{change}</span>}
        </span>
      </span>
      {spark && <span className="pointer-events-none shrink-0">{spark}</span>}
    </>
  );
  const interactive = Boolean(href || onClick);
  const cls = cx(
    "relative flex min-h-[68px] min-w-0 flex-1 items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-left transition-colors duration-120",
    // Same two-step reaction as CompanyCard: the outline firms up on hover,
    // the ground darkens on press.
    interactive && "hover:border-line-strong active:bg-surface-2",
  );
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

export function SummaryCard({
  cells,
  footer,
  className,
}: {
  /** Four cells, read left-right, top-bottom. */
  cells: { label: string; value: ReactNode; tone?: "gain" | "loss" }[];
  footer?: { left: ReactNode; right?: ReactNode };
  className?: string;
}) {
  return (
    <Card className={cx("p-4", className)}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {cells.map((c, i) => (
          <div key={i} className={cx(i % 2 === 1 && "text-right")}>
            <p className="t-label">{c.label}</p>
            <p className={cx("num mt-1 t-list-title", c.tone === "gain" ? "text-gain-text" : c.tone === "loss" ? "text-loss-text" : "text-text")}>{c.value}</p>
          </div>
        ))}
      </div>
      {footer && (
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="t-label">{footer.left}</span>
          {footer.right && <span className="t-change-sm text-gain-text">{footer.right}</span>}
        </div>
      )}
    </Card>
  );
}

export function PromoCard({
  href,
  onClick,
  icon,
  title,
  sub,
  className,
}: {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-text [&>svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="t-list-title block text-text">{title}</span>
        {sub && <span className="t-caption block">{sub}</span>}
      </span>
      {(href || onClick) && <ChevronRight className="size-5 shrink-0 text-text-2" />}
    </>
  );
  const cls = cx(
    "flex min-h-[88px] w-full items-center gap-4 rounded-[10px] border border-line bg-surface p-4 text-left transition-colors duration-120",
    (href || onClick) && "hover:border-line-strong active:bg-surface-2",
    className,
  );
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

// ---------------------------------------------------------------------------
// Sheet (UI.md 2.15): bottom sheet on phone, centred 480px modal at >= 768.
// ---------------------------------------------------------------------------

/**
 * The close control for a sheet (UI.md 2.15, labelled per 7.3). One pill, not
 * a loose word next to a loose icon: 36px tall, label and glyph on a shared
 * optical centre, the whole thing lighting up as a single control. The visual
 * stays small so it never competes with the title; the `after` box carries the
 * 48px hit area (7.2).
 */
function SheetClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="t-nav-label relative -mr-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-3 text-text-2 transition-colors duration-120 hover:bg-surface-2 hover:text-text active:bg-line after:absolute after:-inset-x-1 after:-top-1.5 after:-bottom-1.5 after:content-['']"
    >
      Close
      <X className="size-4" strokeWidth={2.25} />
    </button>
  );
}

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Sheet({ open, ...rest }: SheetProps) {
  // The panel is a separate component mounted only while the sheet is open, so
  // its scroll state and its focus handling start clean on every open and need
  // no teardown branch.
  if (!open) return null;
  return <SheetPanel {...rest} />;
}

function SheetPanel({ onClose, title, children, footer }: Omit<SheetProps, "open">) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The header grows a hairline once the body has scrolled, the same way the
  // app bar does, so long sheets never look like the text is cut mid-air.
  const [scrolled, setScrolled] = useState(false);
  // Callers pass an inline arrow, so onClose is a new function on every parent
  // render. The mount effect must not re-run for that: it would re-focus the
  // panel and steal the caret out of a field mid-keystroke.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the sheet: behind it the page is inert to the eye, so
      // it has to be inert to the keyboard too.
      const panel = panelRef.current;
      if (!panel) return;
      // `[tabindex="-1"]` is excluded everywhere: a roving-tabindex group
      // (Segmented, UnderlineTabs) is one stop, not one stop per option.
      const items = panel.querySelectorAll<HTMLElement>(
        'a[href]:not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])',
      );
      const focusable = [...items].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the sheet, unless a field inside it already claimed the
    // caret (AmountField / SearchField autoFocus).
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="animate-fade-in absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center md:items-center">
        <div
          ref={panelRef}
          tabIndex={-1}
          className="animate-sheet-in md:animate-modal-in pointer-events-auto flex max-h-[90dvh] w-full flex-col rounded-t-[10px] border-t border-line bg-surface outline-none md:max-h-[85dvh] md:w-[480px] md:rounded-[10px] md:border"
        >
          <div
            className={cx(
              "flex h-14 shrink-0 items-center justify-between gap-3 border-b pr-3 pl-5 transition-colors duration-120",
              scrolled ? "border-line" : "border-transparent",
            )}
          >
            <h2 id={id} className="t-section-title min-w-0 truncate">
              {title}
            </h2>
            <SheetClose onClose={onClose} />
          </div>
          <div
            className={cx(
              "overflow-y-auto overscroll-contain px-5",
              // With a footer the safe area is the footer's job; without one the
              // last row of the body must clear the home indicator itself.
              footer ? "pb-5" : "pb-[max(20px,env(safe-area-inset-bottom))]",
            )}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
          >
            {children}
          </div>
          {footer && <div className="shrink-0 border-t border-line px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs (UI.md 2.16): amount field 72px, slider, search field.
// ---------------------------------------------------------------------------

export function AmountField({
  label,
  value,
  onChange,
  unit,
  onMax,
  error,
  helper,
  autoFocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  /** Renders a "Max" text button inside the field. */
  onMax?: () => void;
  error?: string;
  helper?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cx(
          "field flex h-[72px] flex-col justify-center rounded-[10px] px-4 py-3",
          error && "field-error",
        )}
      >
        <span className="t-label">{label}</span>
        <span className="flex items-center gap-2">
          <input
            id={id}
            inputMode="decimal"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || helper ? noteId : undefined}
            className="num t-input-value min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
            placeholder="0.00"
          />
          {onMax && (
            // A text button, per 2.16, but with a shape to press: a 28px pill
            // that reacts, carrying its 48px hit area in the `after` box so it
            // does not grow the 72px field.
            <button
              type="button"
              onClick={onMax}
              className="t-change-sm relative h-7 shrink-0 rounded-full px-2.5 text-gain-text transition-colors duration-120 hover:bg-surface-2 active:bg-line after:absolute after:-inset-x-1 after:-top-2.5 after:-bottom-2.5 after:content-['']"
            >
              Max
            </button>
          )}
          {unit && <span className="t-body shrink-0 text-text-2">{unit}</span>}
        </span>
      </label>
      {error ? (
        <p id={noteId} className="t-caption mt-1 text-loss-text">
          {error}
        </p>
      ) : helper ? (
        <p id={noteId} className="t-caption mt-1">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  ticks,
  label,
  className,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Tick labels under the track (Floor 0.80 · Clearing 1.12 · Cap 1.90). */
  ticks?: { label: string }[];
  label: string;
  className?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={className}>
      <input
        type="range"
        className="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      {ticks && (
        // The track sits on the centre line of a 48px input, so the labels need
        // a little lift to read as belonging to it rather than to what follows.
        <div className="num -mt-1.5 flex justify-between gap-3">
          {ticks.map((t, i) => (
            <span key={i} className={cx("t-caption", i === 0 ? "text-left" : i === ticks.length - 1 ? "text-right" : "text-center")}>
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search companies",
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <label className={cx("field flex h-12 items-center gap-2 rounded-[10px] bg-surface px-3", className)}>
      <SearchIcon />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="t-body h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
      />
      {value && (
        // Same pill as the sheet's Close, one size down: label and glyph read
        // as one control, and it keeps 8px clear of the field's border.
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="t-nav-label relative -mr-1 flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-2.5 text-text-2 transition-colors duration-120 hover:bg-surface-2 hover:text-text active:bg-line after:absolute after:-inset-x-1 after:-top-2 after:-bottom-2 after:content-['']"
        >
          Clear <X className="size-4" strokeWidth={2.25} />
        </button>
      )}
    </label>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-2" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stepper (UI.md 2.17, 7.7): three steps, one-sentence labels, no green.
// ---------------------------------------------------------------------------

/**
 * Where you are in a run of wallet approvals, above the button that does the
 * current one.
 *
 * The rail is markers and connectors only, and the words sit under the whole
 * rail at full width. The earlier shape gave every step its own column and put
 * both its title and its sentence inside it, which at phone width is about
 * 104px of text space per step. One of those titles is an amount the user
 * typed (`Allow 1,000,000,000.00`), and when an amount is too long to fit, the
 * column cannot shrink below it: the text ran straight over the next step's
 * title. Measured at 390px, step 2 of the apply flow overflowed its column by
 * 5px and collided with "Apply".
 *
 * Nothing is truncated and nothing is squeezed now, because nothing is in a
 * column: a long amount simply wraps across the full width, at body size,
 * which is the size copy a person reads before signing a transaction should
 * have been all along. Only the step you are on has a sentence, so one
 * sentence slot under the rail is also the honest shape for it.
 *
 * This is a deliberate departure from UI.md 2.17, which draws the titles under
 * their markers. 2.17's own example labels are one word ("Enable", "Approve",
 * "Submit"); the app's are sentences and amounts, and they do not fit.
 */
export function Stepper({ steps, current, className }: { steps: { title: string; sub?: string }[]; current: number; className?: string }) {
  const at = Math.min(Math.max(current, 1), steps.length);
  const now = steps[at - 1];
  return (
    <div className={className}>
      <ol className="flex items-center" aria-label="Steps">
        {steps.map((s, i) => {
          const n = i + 1;
          const done = n < at;
          return (
            <li
              key={s.title}
              className={cx("flex items-center", i < steps.length - 1 && "flex-1")}
              aria-current={n === at ? "step" : undefined}
            >
              <span
                className={cx(
                  // 1.5px on the current marker against 1px on an upcoming one:
                  // the step you are on is the only one that gains weight.
                  "num flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none font-medium",
                  done ? "bg-text text-bg" : n === at ? "border-[1.5px] border-text text-text" : "border border-line text-text-2",
                )}
              >
                <span aria-hidden>{done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}</span>
                {/* A row of bare numerals reads as nothing out loud, so each
                    marker carries its step's name for a screen reader even
                    though only the current step's name is drawn. */}
                <span className="sr-only">{`Step ${n} of ${steps.length}: ${s.title}${done ? ", done" : ""}`}</span>
              </span>
              {/* The connector meets both markers on their centre line and
                  carries the done colour only for a segment already walked. */}
              {i < steps.length - 1 && <span aria-hidden className={cx("mx-2 h-px flex-1", done ? "bg-text" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
      {now && <p className="t-list-title mt-3 text-text">{now.title}</p>}
      {now?.sub && <p className="t-body mt-1 text-text-2">{now.sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status chip (UI.md 2.18): one outlined kind; "Halted" in loss.
// ---------------------------------------------------------------------------

export function statusLabel(ipo: Pick<Ipo, "status" | "phase">): string {
  if (ipo.phase === "refunding") return "Not listed";
  switch (ipo.status) {
    case "draft":
      return "Upcoming";
    case "auction":
      return "IPO open";
    case "listed":
      return "Listed";
    case "surveillance":
      return "Under watch";
    case "halted":
      return "Halted";
  }
}

export function StatusChip({ ipo, children, halted }: { ipo?: Pick<Ipo, "status" | "phase">; children?: ReactNode; halted?: boolean }) {
  const label = children ?? (ipo ? statusLabel(ipo) : "");
  const isHalted = halted ?? (ipo ? ipo.status === "halted" : label === "Halted");
  return (
    <span
      className={cx(
        // 13px label in a 26px pill with 10px of side air: the proportions of a
        // word wearing an outline, not of a chip you can press.
        "inline-flex h-[26px] shrink-0 items-center rounded-full border px-2.5 align-middle text-[13px] leading-[16px] font-medium whitespace-nowrap",
        isHalted ? "border-loss text-loss-text" : "border-line text-text-2",
      )}
    >
      {label}
    </span>
  );
}

/** @deprecated legacy; renders as an outlined StatusChip. tone and dot are ignored. */
export function Pill({ children }: { tone?: string; dot?: boolean; children: ReactNode }) {
  return <StatusChip>{children}</StatusChip>;
}

// ---------------------------------------------------------------------------
// Rule strip (UI.md 2.19 / UX.md 3.3): flat full-bleed strip, no border, no animation.
// ---------------------------------------------------------------------------

export type RuleKind = "listing" | "surveillance" | "one-way" | "halted";

export function RuleStrip({
  kind,
  text,
  label,
  onDetails,
  className,
}: {
  kind: RuleKind;
  text: string;
  /** Leading word, in the mode colour. The rest of the sentence stays black. */
  label?: string;
  onDetails?: () => void;
  className?: string;
}) {
  const square = kind === "halted" ? "bg-loss" : kind === "listing" ? "bg-brand" : "bg-warn";
  const word = kind === "halted" ? "text-loss-text" : kind === "listing" ? "text-brand-text" : "text-warn";
  const rest = label && text.startsWith(label) ? text.slice(label.length).replace(/^[.\s]+/, "") : text;
  const Tag = onDetails ? "button" : "div";
  return (
    <Tag
      type={onDetails ? "button" : undefined}
      onClick={onDetails}
      className={cx(
        "group -mx-5 flex min-h-12 w-[calc(100%+40px)] items-center gap-3 bg-surface-2 px-5 py-2 text-left transition-colors duration-120",
        // The strip is already surface-2, so its pressed state steps to --line:
        // the next shade up in both themes.
        onDetails && "hover:bg-line active:bg-line",
        className,
      )}
    >
      <span aria-hidden className={cx("size-2 shrink-0", square)} />
      <span className="t-body min-w-0 flex-1 text-text">
        {label && <span className={cx("font-medium", word)}>{label}</span>}
        {label && rest ? ". " : null}
        {rest}
      </span>
      {onDetails && (
        <span className="t-nav-label shrink-0 text-text-2 underline-offset-[3px] group-hover:text-text group-hover:underline">Details</span>
      )}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Toast (UI.md 2.20): inverse colours, bottom, one at a time.
// ---------------------------------------------------------------------------

export function Toast({
  status,
  title,
  detail,
  link,
  onDismiss,
}: {
  status: "pending" | "success" | "error";
  title: string;
  /** Second line, e.g. the decoded protocol error name in grey. */
  detail?: string;
  link?: { href: string; label: string };
  onDismiss?: () => void;
}) {
  return (
    <div role="status" className="animate-toast-up flex min-h-12 w-full max-w-[440px] items-start gap-3 rounded-[8px] bg-inverse-bg px-4 py-3 text-inverse-text">
      {/* The icon aligns to the title's line, not to the middle of a two-line
          block, so a toast with a detail line still reads top-down. */}
      {status === "pending" && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />}
      {status === "success" && <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />}
      {status === "error" && <X className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-5 font-medium">{title}</span>
        {/* --inverse-text-2 instead of an opacity trick (UI.md 2, states legend). */}
        {detail && <span className="mt-0.5 block text-[13px] leading-[18px] text-inverse-text-2">{detail}</span>}
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] leading-[18px] underline underline-offset-2">
            {link.label} <ExternalLink className="size-3" />
          </a>
        )}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="relative -mr-1.5 -mt-0.5 shrink-0 rounded-full px-1.5 py-1 text-[13px] leading-5 font-medium text-inverse-text-2 underline-offset-[3px] transition-colors duration-120 hover:text-inverse-text hover:underline after:absolute after:-inset-x-2 after:-top-3 after:-bottom-3 after:content-['']"
        >
          Close
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton (UI.md 2.21): surface-2 blocks, opacity pulse, no shimmer.
// ---------------------------------------------------------------------------

export function Skeleton({ className, w, h = 16 }: { className?: string; w?: number | string; h?: number }) {
  return <span aria-hidden className={cx("animate-skeleton block rounded-[8px] bg-surface-2", className)} style={{ width: w ?? "100%", height: h }} />;
}

// ---------------------------------------------------------------------------
// Empty state (UI.md 2.22): text first, left aligned, no icon.
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div className={cx("py-6", className)}>
      <p className="t-list-title text-text">{title}</p>
      {body && <p className="t-body mt-1 text-text-2">{body}</p>}
      {action && (
        // prose-link already carries 8px of its own top padding; mt-1 lands the
        // link 12px under the body (UI.md 2.22) instead of 20.
        <div className="mt-1">
          {action.href ? (
            <Link href={action.href} className="prose-link t-change-sm text-gain-text underline-offset-[3px] hover:underline focus-visible:underline">
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className="prose-link t-change-sm text-gain-text underline-offset-[3px] hover:underline focus-visible:underline">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** @deprecated legacy; icon is ignored. Prefer EmptyState. */
export function Empty({ title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="py-6">
      <p className="t-list-title text-text">{title}</p>
      {body && <p className="t-body mt-1 text-text-2">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key / value row (UI.md 2.23): 48px min, key 14 text-2, value 16/500 right.
// ---------------------------------------------------------------------------

export function KV({ k, v, sub, mono }: { k: ReactNode; v: ReactNode; sub?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-12 items-start justify-between gap-4 py-2.5">
      {/* The key is 14/20 against a 16/22 value: 1px of top padding puts the
          two on the same baseline. */}
      <span className="t-label shrink-0 pt-px">{k}</span>
      <span className="min-w-0 text-right">
        {/* Only a hash or an address may break mid-token; ordinary words wrap. */}
        <span className={cx("num block text-text", mono ? "t-mono break-all" : "t-list-title break-words")}>{v}</span>
        {sub && <span className="t-caption mt-0.5 block">{sub}</span>}
      </span>
    </div>
  );
}

/** @deprecated legacy name; use KV. */
export const KVRow = KV;

/** Collapsed disclosure for protocol words (addresses, versions, block numbers). */
export function Details({ title = "Details", children, defaultOpen = false, className }: { title?: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cx("border-t border-line", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="group flex h-12 w-full items-center justify-between gap-3 text-left"
      >
        <span className="t-list-title text-text">{title}</span>
        {/* The chevron sits in its own 24px box so the glyph's optical centre,
            not its bounding box, lines up with the row's right edge. */}
        <span className="flex size-6 shrink-0 items-center justify-center">
          <ChevronDown className={cx("size-5 text-text-2 transition-transform duration-200 group-hover:text-text", open && "rotate-180")} />
        </span>
      </button>
      {/* Still mounted only when open: the contents can be expensive. */}
      {open && (
        <div id={id} className="pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table (UI.md 2.25, 7.9): desktop only; the same data is ListRows on phone.
// ---------------------------------------------------------------------------

export type Column<T> = {
  key: string;
  label: string;
  /**
   * Header and cell are always aligned together, so a column can never
   * disagree with its own heading. Left is the default, which is right for the
   * first column and almost never right for any other: a value column that
   * forgets this sits at the left of its cell between neighbours that sit at
   * the right, and the row stops reading as one system. The house rule is the
   * identity column left, every column after it right -- a status label with a
   * number in it ("Under watch ±5%", "Done") counts as a value.
   */
  align?: "left" | "right";
  width?: string;
  render: (row: T) => ReactNode;
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  href,
  onRowClick,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  href?: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={cx("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                style={{ width: c.width }}
                className={cx(
                  // 40px header against 56px rows: the head is a label strip,
                  // the rows are the content (UI.md 2.25, 7.9).
                  "h-10 px-2 align-middle text-[13px] leading-[18px] font-normal whitespace-nowrap text-text-2",
                  i === 0 && "pl-0",
                  i === columns.length - 1 && "pr-0",
                  c.align === "right" ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = Boolean(href || onRowClick);
            return (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx(
                  // The last row closes against the section's whitespace, not
                  // against a rule that separates it from nothing.
                  "border-b border-line last:border-b-0 transition-colors duration-120",
                  clickable && "hover:bg-surface-2",
                  // Only a row that is clickable everywhere says so; with href
                  // alone the link lives in the first cell.
                  onRowClick && "cursor-pointer",
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cx(
                      "h-14 px-2 t-body text-text",
                      i === 0 && "pl-0",
                      i === columns.length - 1 && "pr-0",
                      c.align === "right" && "num text-right",
                    )}
                  >
                    {href && i === 0 ? (
                      <Link href={href(r)} className="block">
                        {c.render(r)}
                      </Link>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button (UI.md 2.14): buy / sell / primary / secondary / text / danger.
// ---------------------------------------------------------------------------

export type ButtonVariant = "buy" | "sell" | "primary" | "secondary" | "text" | "danger";
export type ButtonSize = "bar" | "default" | "sm";

type LegacyTone = "gain" | "loss" | "brand" | "neutral";

function resolveVariant(variant: ButtonVariant | "solid" | "outline" | undefined, tone: LegacyTone | undefined): ButtonVariant {
  if (variant && variant !== "solid" && variant !== "outline") return variant;
  if (variant === "outline") return tone === "loss" ? "danger" : "secondary";
  if (tone === "gain") return "buy";
  if (tone === "loss") return "sell";
  if (tone === "brand" || tone === "neutral") return "primary";
  return "buy";
}

export function Button({
  variant,
  tone,
  size = "default",
  busy,
  className,
  children,
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant | "solid" | "outline";
  /** @deprecated legacy tone mapping: gain → buy, loss → sell, neutral/brand → primary. */
  tone?: LegacyTone;
  /** bar = 56px (fixed action bar), default = 48px, sm = 40px. */
  size?: ButtonSize;
  /** Shows a 16px spinner; the caller sets the label ("Check your wallet app"). */
  busy?: boolean;
  children: ReactNode;
}) {
  const v = resolveVariant(variant, tone);
  // Filled buttons darken under the finger; outlined and text ones have no fill
  // to darken, so they take a ground instead.
  const filled = v === "buy" || v === "sell" || v === "primary";
  const look: Record<ButtonVariant, string> = {
    buy: "bg-buy text-white",
    sell: "bg-sell text-white",
    primary: "bg-text text-bg",
    secondary: "border border-line-strong bg-transparent text-text hover:bg-surface-2 active:bg-line",
    text: "bg-transparent text-gain-text hover:bg-surface-2 active:bg-line",
    danger: "border border-loss bg-transparent text-loss-text hover:bg-surface-2 active:bg-line",
  };
  return (
    <button
      type="button"
      {...props}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] whitespace-nowrap select-none",
        "transition-[filter,background-color,border-color,color] duration-120",
        // Side padding tracks the height: a 56px bar needs more air around a
        // 17px label than a 40px button does around a 15px one.
        size === "bar" ? "t-button h-14 px-6" : size === "sm" ? "t-chip h-10 px-4" : "t-button h-12 px-5",
        disabled ? "border border-line bg-surface-2 text-text-3" : look[v],
        !disabled && filled && "active:brightness-[0.94]",
        className,
      )}
    >
      {busy && <Loader2 className="size-4 shrink-0 animate-spin" />}
      {children}
    </button>
  );
}

/** Plain text link in the gain colour (UI.md 6.2 Button text variant). */
export function TextLink({ href, onClick, children, className }: { href?: string; onClick?: () => void; children: ReactNode; className?: string }) {
  // No underline at rest (Groww draws none), but one on hover and on focus, so
  // the link is never carried by colour alone once you are pointing at it.
  const cls = cx("prose-link t-change-sm text-gain-text underline-offset-[3px] hover:underline focus-visible:underline", className);
  if (href) {
    const external = href.startsWith("http");
    return external ? (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Copy address: mono value with labelled "Copy" and "View" controls.
// ---------------------------------------------------------------------------

// Copy / View share the pill the sheet's Close uses: 32px visual, 48px hit.
const INLINE_ACTION =
  "t-nav-label relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-text-2 transition-colors duration-120 hover:bg-surface-2 hover:text-text active:bg-line after:absolute after:-inset-x-1 after:-top-2 after:-bottom-2 after:content-['']";

export function CopyAddress({ value, label }: { value: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!value) return <span className="t-label">Not set yet</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span className="num t-mono text-text">{label ?? shortAddr(value)}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        }}
        className={INLINE_ACTION}
      >
        {copied ? <Check className="size-4 text-gain-text" strokeWidth={2.25} /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {value.length === 42 && (
        <a href={addrUrl(value)} target="_blank" rel="noreferrer" className={INLINE_ACTION}>
          <ExternalLink className="size-4" /> View
        </a>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section title (UI.md 6.2): 18/500, 24 top / 12 bottom, optional right link.
// ---------------------------------------------------------------------------

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mt-6 mb-3 flex items-center justify-between", className)}>
      <h2 className="t-section-title">{children}</h2>
      {action}
    </div>
  );
}
