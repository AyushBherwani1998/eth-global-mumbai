"use client";

// UI primitives per design/UI.md section 2 (Groww parity) and section 7
// (legibility). Every colour is a token, no shadows, no gradients, 10px radius.
// See components/README.md for the prop reference.

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";
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
  ipo?: Pick<Ipo, "avatar">;
  initials?: string;
  size?: 28 | 36 | 40 | 48 | number;
  className?: string;
}) {
  const text = initials ?? ipo?.avatar.initials ?? "";
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface-2 font-bold text-text", className)}
      style={{ width: size, height: size, fontSize: size >= 48 ? 15 : 13, lineHeight: 1 }}
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
    <div className={cx("relative h-1 w-full bg-line", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full bg-gain" style={{ width: `${pct}%` }} />
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
// Chips (UI.md 2.5 filter, 2.6 range): 40px tall, 48px hit area.
// ---------------------------------------------------------------------------

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
  const cls = cx(
    "t-chip relative inline-flex h-10 shrink-0 items-center justify-center rounded-full whitespace-nowrap transition-colors duration-120",
    "after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']",
    variant === "filter" ? "px-[18px]" : "min-w-[52px] px-[14px]",
    selected
      ? "border border-chip-on-line bg-chip-on-bg text-text"
      : variant === "filter"
        ? "border border-line text-text hover:bg-surface-2"
        : "border border-transparent text-text-2 hover:bg-surface-2",
    disabled && "text-text-3",
    className,
  );
  if (href) {
    return (
      <Link href={href} aria-current={selected ? "page" : undefined} className={cls} replace scroll={false}>
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
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex flex-wrap gap-2", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "t-chip relative inline-flex h-10 items-center justify-center rounded-full px-[18px] whitespace-nowrap transition-colors duration-120",
            "after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']",
            value === o.id ? "border border-chip-on-line bg-chip-on-bg text-text" : "border border-line text-text hover:bg-surface-2",
          )}
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
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      const list = listRef.current;
      if (!el || !list) return;
      setBar({ left: el.offsetLeft - list.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [value, tabs.length]);

  return (
    <div ref={listRef} role="tablist" className={cx("relative flex border-b border-line", equal ? "" : "gap-0", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          ref={(el) => {
            if (el) refs.current.set(t.id, el);
            else refs.current.delete(t.id);
          }}
          onClick={() => onChange(t.id)}
          className={cx(
            "t-tab h-12 whitespace-nowrap transition-colors duration-120",
            equal ? "flex-1" : "px-6",
            value === t.id ? (underline === "loss" ? "text-loss-text" : "text-gain-text") : "text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-text-2">{t.count}</span>}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden
          className={cx("absolute -bottom-px h-[3px] transition-transform duration-200 ease-out", underline === "loss" ? "bg-loss" : "bg-gain")}
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
        <span className="num flex shrink-0 flex-col items-end text-right">
          <span className="flex items-baseline gap-2">
            {flag && <span className={cx("t-change-sm", flag.tone === "loss" ? "text-loss-text" : "text-warn")}>{flag.text}</span>}
            {right && <span className="text-[18px] leading-6 font-medium text-text">{right}</span>}
          </span>
          {rightSub && <span className="t-change-sm">{rightSub}</span>}
        </span>
      )}
      {chevron && <ChevronRight className="size-5 shrink-0 text-text-2" />}
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
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  value: ReactNode;
  change?: ReactNode;
}) {
  const body = (
    <>
      <span className="t-label-sm block truncate text-text">{label}</span>
      <span className="num mt-1 flex items-baseline gap-2">
        <span className="text-[16px] leading-[22px] text-text">{value}</span>
        {change && <span className="t-change-sm">{change}</span>}
      </span>
    </>
  );
  const cls = "flex h-[68px] min-w-[160px] flex-1 flex-col justify-center rounded-[10px] border border-line bg-surface px-4 text-left transition-colors duration-120 active:bg-surface-2";
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
  const cls = cx("flex min-h-[88px] w-full items-center gap-4 rounded-[10px] border border-line bg-surface p-4 text-left transition-colors duration-120", (href || onClick) && "active:bg-surface-2", className);
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

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="animate-fade-in absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center md:items-center">
        <div className="animate-sheet-in md:animate-modal-in pointer-events-auto flex max-h-[90dvh] w-full flex-col rounded-t-[10px] border-t border-line bg-surface md:max-h-[85dvh] md:w-[480px] md:rounded-[10px] md:border">
          <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-5">
            <h2 id={id} className="t-section-title">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="t-nav-label flex h-12 items-center gap-1 rounded-full px-3 text-text-2 hover:bg-surface-2">
              Close <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 pb-5">{children}</div>
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
        <span className="flex items-center gap-3">
          <input
            id={id}
            inputMode="decimal"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
            className="num t-input-value min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
            placeholder="0.00"
          />
          {onMax && (
            <button type="button" onClick={onMax} className="t-change-sm -my-3 h-12 shrink-0 px-2 text-gain-text">
              Max
            </button>
          )}
          {unit && <span className="t-body shrink-0 text-text-2">{unit}</span>}
        </span>
      </label>
      {error ? <p className="t-caption mt-1 text-loss-text">{error}</p> : helper ? <p className="t-caption mt-1">{helper}</p> : null}
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
        <div className="num flex justify-between">
          {ticks.map((t, i) => (
            <span key={i} className="t-caption">
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
        className="t-body h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="t-nav-label -mr-2 flex h-12 items-center gap-1 px-2 text-text-2">
          Clear <X className="size-4" />
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

export function Stepper({ steps, current, className }: { steps: { title: string; sub?: string }[]; current: number; className?: string }) {
  return (
    <ol className={cx("flex items-start", className)} aria-label="Steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        const now = n === current;
        return (
          <li key={s.title} className="flex min-w-0 flex-1 flex-col items-start">
            <span className="flex w-full items-center">
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] leading-none font-medium",
                  done ? "bg-text text-bg" : now ? "border-[1.5px] border-text text-text" : "border border-line text-text-2",
                )}
              >
                {done ? <Check className="size-3.5" /> : n}
              </span>
              {i < steps.length - 1 && <span className={cx("mx-2 h-px flex-1", done ? "bg-text" : "bg-line")} />}
            </span>
            <span className={cx("t-nav-label mt-2 pr-2", now ? "text-text" : "text-text-2")}>{s.title}</span>
            {s.sub && now && <span className="t-caption mt-0.5 pr-2">{s.sub}</span>}
          </li>
        );
      })}
    </ol>
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
        "inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] leading-none font-medium whitespace-nowrap",
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

export function RuleStrip({ kind, text, onDetails, className }: { kind: RuleKind; text: string; onDetails?: () => void; className?: string }) {
  const square = kind === "halted" ? "bg-loss" : kind === "listing" ? "bg-text-2" : "bg-warn";
  const Tag = onDetails ? "button" : "div";
  return (
    <Tag
      type={onDetails ? "button" : undefined}
      onClick={onDetails}
      className={cx("-mx-5 flex min-h-12 w-[calc(100%+40px)] items-center gap-3 bg-surface-2 px-5 py-2 text-left", className)}
    >
      <span aria-hidden className={cx("size-2 shrink-0", square)} />
      <span className="t-body flex-1 text-text">{text}</span>
      {onDetails && <span className="t-nav-label shrink-0 text-text-2">Details</span>}
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
    <div role="status" className="animate-toast-up flex min-h-12 w-full max-w-[440px] items-center gap-3 rounded-[8px] bg-inverse-bg px-4 py-3 text-inverse-text">
      {status === "pending" && <Loader2 className="size-4 shrink-0 animate-spin" />}
      {status === "success" && <Check className="size-4 shrink-0" />}
      {status === "error" && <X className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-5 font-medium">{title}</span>
        {detail && <span className="block text-[13px] leading-[18px] opacity-70">{detail}</span>}
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[13px] leading-[18px] underline underline-offset-2">
            {link.label} <ExternalLink className="size-3" />
          </a>
        )}
      </span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="-mr-2 flex h-12 shrink-0 items-center px-2 text-[13px] font-medium opacity-80">
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
        <div className="mt-3">
          {action.href ? (
            <Link href={action.href} className="prose-link t-change-sm text-gain-text">
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className="prose-link t-change-sm text-gain-text">
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
      <span className="t-label shrink-0 pt-0.5">{k}</span>
      <span className="min-w-0 text-right">
        <span className={cx("num block break-all text-text", mono ? "t-mono" : "t-list-title")}>{v}</span>
        {sub && <span className="t-caption block">{sub}</span>}
      </span>
    </div>
  );
}

/** @deprecated legacy name; use KV. */
export const KVRow = KV;

/** Collapsed disclosure for protocol words (addresses, versions, block numbers). */
export function Details({ title = "Details", children, defaultOpen = false, className }: { title?: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cx("border-t border-line", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-12 w-full items-center justify-between text-left">
        <span className="t-list-title text-text">{title}</span>
        <ChevronDown className={cx("size-5 text-text-2 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table (UI.md 2.25, 7.9): desktop only; the same data is ListRows on phone.
// ---------------------------------------------------------------------------

export type Column<T> = {
  key: string;
  label: string;
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
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ width: c.width }} className={cx("h-10 px-2 text-[13px] leading-[18px] font-normal whitespace-nowrap text-text-2", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = href || onRowClick;
            return (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx("border-b border-line", clickable && "cursor-pointer hover:bg-surface-2")}
              >
                {columns.map((c, i) => (
                  <td key={c.key} className={cx("h-14 px-2 t-body text-text", c.align === "right" && "num text-right")}>
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
  const look: Record<ButtonVariant, string> = {
    buy: "bg-buy text-white",
    sell: "bg-sell text-white",
    primary: "bg-text text-bg",
    secondary: "border border-line-strong bg-transparent text-text",
    text: "bg-transparent text-gain-text",
    danger: "border border-loss bg-transparent text-loss-text",
  };
  return (
    <button
      type="button"
      {...props}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 whitespace-nowrap transition-[filter,background-color] duration-120 active:brightness-[0.94]",
        size === "bar" ? "t-button h-14" : size === "sm" ? "t-chip h-10 px-3" : "t-button h-12",
        disabled ? "border border-line bg-surface-2 text-text-3" : look[v],
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Plain text link in the gain colour (UI.md 6.2 Button text variant). */
export function TextLink({ href, onClick, children, className }: { href?: string; onClick?: () => void; children: ReactNode; className?: string }) {
  const cls = cx("prose-link t-change-sm text-gain-text", className);
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

export function CopyAddress({ value, label }: { value: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="t-label">Not set yet</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
      <span className="num t-mono text-text">{label ?? shortAddr(value)}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="t-nav-label flex h-12 items-center gap-1 px-2 text-text-2"
      >
        {copied ? <Check className="size-4 text-gain-text" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {value.length === 42 && (
        <a href={addrUrl(value)} target="_blank" rel="noreferrer" className="t-nav-label flex h-12 items-center gap-1 px-2 text-text-2">
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
