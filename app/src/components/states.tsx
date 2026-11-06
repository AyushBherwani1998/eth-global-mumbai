"use client";

// Loading, error and offline states (UX.md section 3 shared rules, UI.md 2.21).
// Skeletons mirror the real layout; errors are plain English with Retry;
// offline is a grey strip, never a modal.

import { useSyncExternalStore } from "react";
import { Button, Card, Skeleton, cx } from "./ui";

/** N list rows: 40px tile, two text lines, right value column. */
export function SkeletonList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("divide-y divide-line", className)} aria-busy aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 py-3">
          <Skeleton w={40} h={40} />
          <span className="flex-1">
            <Skeleton w="55%" h={22} />
            <Skeleton w="35%" h={20} className="mt-1" />
          </span>
          <span className="flex flex-col items-end">
            <Skeleton w={72} h={24} />
            <Skeleton w={56} h={20} className="mt-1" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A 2-col grid of company card skeletons (cards keep their hairline). */
export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cx("grid grid-cols-2 gap-5 lg:grid-cols-4", className)} aria-busy aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="min-h-[160px] p-4">
          <Skeleton w={36} h={36} />
          <Skeleton w="70%" h={22} className="mt-5" />
          <Skeleton w="45%" h={22} className="mt-2" />
          <Skeleton w="55%" h={20} className="mt-1" />
        </Card>
      ))}
    </div>
  );
}

/** Chart placeholder: the hero number lines, then a flat block at the chart height. */
export function SkeletonChart({ height = 280, className }: { height?: number; className?: string }) {
  return (
    <div className={className} aria-busy aria-label="Loading chart">
      <Skeleton w={140} h={38} />
      <Skeleton w={200} h={22} className="mt-2" />
      <Skeleton h={height} className="mt-6 rounded-[10px]" />
      <div className="mt-3 flex gap-2">
        <Skeleton w={52} h={40} className="rounded-full" />
        <Skeleton w={52} h={40} className="rounded-full" />
        <Skeleton w={52} h={40} className="rounded-full" />
      </div>
    </div>
  );
}

/** Inline error card: what happened and what to do, then Retry. Never a silent fallback. */
export function ErrorCard({
  title = "Couldn't load the latest prices",
  body = "Your private connection didn't answer. Check your internet and try again.",
  onRetry,
  retrying,
  className,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <Card className={cx("p-4", className)} role="alert">
      <p className="t-list-title text-text">{title}</p>
      <p className="t-body mt-1 text-text-2">{body}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4 w-full" onClick={onRetry} busy={retrying}>
          {retrying ? "Trying again" : "Retry"}
        </Button>
      )}
    </Card>
  );
}

/** Tracks navigator.onLine (true during server render). */
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * Grey top strip shown while offline: "You're offline · showing prices as of 15:40 IST".
 * Renders nothing while online. Pass `asOf` from the last good read.
 */
export function OfflineStrip({ asOf, force, className }: { asOf?: string; force?: boolean; className?: string }) {
  const online = useOnline();
  if (online && !force) return null;
  return (
    <div role="status" className={cx("flex min-h-12 items-center bg-surface-2 px-5", className)}>
      <p className="t-body text-text">
        You&apos;re offline{asOf ? ` · showing prices as of ${asOf}` : ""}
      </p>
    </div>
  );
}
