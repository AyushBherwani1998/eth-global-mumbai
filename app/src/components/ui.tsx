"use client";

import { useEffect, useId, useState } from "react";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import type { EnsStatus, Ipo, Mode } from "@/lib/mock";
import { addrUrl, shortAddr } from "@/lib/format";
import type { Tone } from "@/lib/policy";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function TickerAvatar({ ipo, size = 32 }: { ipo: Pick<Ipo, "avatar" | "symbol">; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[8px] font-bold tracking-tight"
      style={{
        width: size,
        height: size,
        background: ipo.avatar.bg,
        color: ipo.avatar.fg,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {ipo.avatar.initials}
    </span>
  );
}

const toneClass: Record<Tone | "muted", string> = {
  brand: "bg-brand-soft text-brand",
  gain: "bg-gain-soft text-gain",
  warn: "bg-warn-soft text-warn",
  loss: "bg-loss-soft text-loss",
  muted: "bg-subtle text-muted",
};

export function Pill({ tone = "muted", children, dot }: { tone?: Tone | "muted"; children: React.ReactNode; dot?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {dot && <span className="animate-pulse-dot size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const statusMeta: Record<EnsStatus, { label: string; tone: Tone | "muted" }> = {
  draft: { label: "Upcoming", tone: "muted" },
  auction: { label: "Live auction", tone: "brand" },
  listed: { label: "Listed", tone: "gain" },
  surveillance: { label: "Surveillance", tone: "warn" },
  halted: { label: "Halted", tone: "loss" },
};

export function StatusChip({ ipo }: { ipo: Pick<Ipo, "status" | "phase"> }) {
  if (ipo.phase === "refunding") return <Pill tone="muted">Refunding</Pill>;
  const m = statusMeta[ipo.status];
  return (
    <Pill tone={m.tone} dot={ipo.status === "auction"}>
      {m.label}
    </Pill>
  );
}

export function modeTone(mode: Mode): Tone {
  return mode === "listing" ? "brand" : mode === "normal" ? "gain" : mode === "halted" ? "loss" : "warn";
}

/** Outlined filter chip, as in the reference (Explore / Holdings / ETF). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "border-line-strong bg-subtle text-strong" : "border-line text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("rounded-[12px] border border-line bg-card", className)}>{children}</div>;
}

export function Change({ abs, rel, digits = 2, className }: { abs: number; rel: number; digits?: number; className?: string }) {
  const up = abs >= 0;
  return (
    <span className={cx("num font-medium", up ? "text-gain" : "text-loss", className)}>
      {up ? "+" : "-"}
      {Math.abs(abs).toFixed(digits)} ({Math.abs(rel).toFixed(2)}%)
    </span>
  );
}

export function Progress({ value, max, marker, tone = "gain" }: { value: number; max: number; marker?: number; tone?: "gain" | "brand" | "warn" }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="relative h-2 w-full rounded-full bg-subtle">
      <div
        className={cx("h-full rounded-full", tone === "gain" ? "bg-gain" : tone === "brand" ? "bg-brand" : "bg-warn")}
        style={{ width: `${pct}%` }}
      />
      {marker !== undefined && (
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-0.5 rounded bg-strong"
          style={{ left: `${(marker / max) * 100}%` }}
        />
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div role="tablist" className="flex border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "relative flex-1 py-3 text-sm font-medium transition-colors",
            value === t.id ? "text-gain" : "text-fg",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-muted">{t.count}</span>}
          {value === t.id && <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-t bg-gain" />}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cx(
            "rounded-full font-medium transition-colors",
            size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-[13px]",
            value === o.id ? "border border-line-strong bg-subtle text-strong" : "border border-transparent text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyAddress({ value, label }: { value: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-sm text-muted">Not set yet</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num font-mono text-[13px] text-strong">{label ?? shortAddr(value)}</span>
      <button
        aria-label="Copy address"
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-muted"
      >
        {copied ? <Check className="size-3.5 text-gain" /> : <Copy className="size-3.5" />}
      </button>
      {value.length === 42 && (
        <a aria-label="Open in Etherscan" href={addrUrl(value)} target="_blank" rel="noreferrer" className="text-muted">
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  );
}

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
  children: React.ReactNode;
  footer?: React.ReactNode;
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
      <div className="animate-sheet-in absolute inset-x-0 bottom-0 mx-auto flex max-h-[90dvh] w-full max-w-[480px] flex-col rounded-t-[20px] bg-card shadow-[var(--shadow)]">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />
          <h2 id={id} className="pt-2 text-lg">
            {title}
          </h2>
          <button aria-label="Close" onClick={onClose} className="mt-2 rounded-full p-1.5 text-muted hover:bg-subtle">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function KV({ k, v, sub }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm text-muted">{k}</span>
      <span className="text-right">
        <span className="num text-sm font-medium text-strong">{v}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-3 flex items-center justify-between">
      <h2 className="text-[17px]">{children}</h2>
      {action}
    </div>
  );
}

export function Button({
  tone = "gain",
  variant = "solid",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "gain" | "loss" | "brand" | "neutral"; variant?: "solid" | "outline" }) {
  const solid = {
    gain: "bg-gain text-white",
    loss: "bg-loss text-white",
    brand: "bg-brand text-white",
    neutral: "bg-strong text-bg",
  }[tone];
  const outline = {
    gain: "border border-gain text-gain",
    loss: "border border-loss text-loss",
    brand: "border border-brand text-brand",
    neutral: "border border-line-strong text-strong",
  }[tone];
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-semibold transition-opacity disabled:opacity-40",
        variant === "solid" ? solid : outline,
        className,
      )}
    />
  );
}

export function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-subtle text-muted">{icon}</div>
      <p className="font-semibold text-strong">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
