"use client";

// Loading state shaped like the finished chart block: price, change, unit
// line, the frame at its real height, then the two control rows. Every block
// is the size of the thing that replaces it, so nothing moves when prices land.

import { Skeleton, cx } from "../ui";

export function ChartSkeleton({ height = 280, className }: { height?: number; className?: string }) {
  return (
    <div className={cx("pt-2", className)} aria-busy aria-label="Loading chart">
      <Skeleton w={140} h={38} />
      <Skeleton w={200} h={22} className="mt-1" />
      <Skeleton w={180} h={18} className="mt-1" />
      <Skeleton h={height} className="mt-4 rounded-[10px]" />
      <div className="dotted-line mt-3 flex gap-1.5 pt-2 lg:items-center lg:gap-4">
        <div className="flex flex-1 gap-1.5 py-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} h={40} className="flex-1 rounded-full" />
          ))}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <Skeleton w={130} h={42} className="rounded-[10px]" />
        <Skeleton w={96} h={40} className="rounded-[10px] lg:hidden" />
      </div>
    </div>
  );
}
