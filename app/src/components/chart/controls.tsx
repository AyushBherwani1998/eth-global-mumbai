"use client";

// Controls that sit under the chart: the window chips, the Line / Bars
// segmented control and (mobile) Expand. All 40px tall with a 48px hit area
// and visible text labels (UI.md 7.2, 7.3).

import { useCallback, useSyncExternalStore } from "react";
import { Maximize2 } from "lucide-react";
import { Chip, cx } from "../ui";

export type ChartType = "line" | "bars";

const STORE_KEY = "thamba.chartType";

// One store for every chart on the page, read from localStorage on first use.
// The server always says "line", so the markup matches and React swaps in the
// remembered choice right after hydration.
let cached: ChartType | null = null;
const listeners = new Set<() => void>();

function snapshot(): ChartType {
  if (cached === null) {
    try {
      cached = localStorage.getItem(STORE_KEY) === "bars" ? "bars" : "line";
    } catch {
      cached = "line";
    }
  }
  return cached;
}
function serverSnapshot(): ChartType {
  return "line";
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Remembered per person. */
export function useChartType(): [ChartType, (t: ChartType) => void] {
  const type = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const set = useCallback((t: ChartType) => {
    cached = t;
    try {
      localStorage.setItem(STORE_KEY, t);
    } catch {}
    for (const l of listeners) l();
  }, []);
  return [type, set];
}

/**
 * One tap per window, every option visible. The seven share the row evenly and
 * never scroll, so nothing is hidden behind a swipe.
 */
export function RangeChipRow<T extends string>({
  value,
  onChange,
  options,
  label = "Chart window",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label?: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex items-center gap-1.5 py-1", className)}>
      {options.map((o) => (
        <Chip key={o.id} variant="range" selected={value === o.id} onClick={() => onChange(o.id)} className="min-w-0 flex-1 px-1">
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

/** Line | Bars. Labelled, never icon-only. */
export function ChartTypeToggle({
  value,
  onChange,
  className,
}: {
  value: ChartType;
  onChange: (t: ChartType) => void;
  className?: string;
}) {
  const opts: { id: ChartType; label: string }[] = [
    { id: "line", label: "Line" },
    { id: "bars", label: "Bars" },
  ];
  return (
    <div role="radiogroup" aria-label="Chart type" className={cx("inline-flex h-[42px] items-center rounded-[10px] border border-line p-px", className)}>
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "t-chip relative flex h-10 min-w-[62px] items-center justify-center rounded-[9px] px-3 transition-colors duration-120",
            "after:absolute after:inset-x-0 after:-top-2 after:-bottom-2 after:content-['']",
            value === o.id ? "bg-chip-on-bg text-text" : "text-text-2 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Mobile only; the chart frame itself stays free of furniture. */
export function ExpandButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("t-chip flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-text-2 lg:hidden", className)}
    >
      <Maximize2 className="size-[18px]" aria-hidden /> Expand
    </button>
  );
}
