"use client";

import { BadgeCheck } from "lucide-react";
import { TickerAvatar } from "@/components/ui";
import { ensName, type Ipo } from "@/lib/mock";

export function BottomSpacer() {
  return <div className="h-4" />;
}

/** Logo, name and verified ENS name: top of the IPO and market screens. */
export function TickerTitle({ ipo }: { ipo: Ipo }) {
  return (
    <div>
      <TickerAvatar ipo={ipo} size={36} />
      <h1 className="mt-3 text-[19px] font-medium ">{ipo.name}</h1>
      <p className="mt-0.5 flex items-center gap-1 text-[13px] text-text-2">
        <BadgeCheck className="size-3.5 text-gain-text" />
        {ensName(ipo.ticker)}
      </p>
    </div>
  );
}
