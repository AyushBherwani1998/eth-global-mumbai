"use client";

// Markets (UX.md 3.1 / 3.2): one row of two chips, Stocks | ICO, selection in ?tab=.
// Both bodies read the backend through src/lib/api.ts.

import { useSearchParams } from "next/navigation";
import { AppBar } from "@/components/shell";
import { Chip, ChipRow, ViewSwap } from "@/components/ui";
import { StocksBody } from "./market-list";
import { IpoBody } from "./ipo-list";

const TABS = ["stocks", "ipo"] as const;
type Tab = (typeof TABS)[number];

export function MarketsScreen() {
  const params = useSearchParams();
  // One source of truth, and it is the URL: the back button and a desktop
  // reload have to land on the tab the reader was on. The chips navigate inside
  // a transition (see Chip in components/ui.tsx), so the swap is one commit
  // rather than a route change racing a render.
  const tab: Tab = params.get("tab") === "ipo" ? "ipo" : "stocks";

  return (
    <>
      <AppBar title="Markets" />
      <main>
        <ChipRow className="mt-2">
          <Chip href="/" selected={tab === "stocks"}>
            Stocks
          </Chip>
          <Chip href="/?tab=ipo" selected={tab === "ipo"}>
            ICO
          </Chip>
        </ChipRow>
        <ViewSwap view={tab} order={TABS}>
          {tab === "stocks" ? <StocksBody /> : <IpoBody />}
        </ViewSwap>
      </main>
    </>
  );
}
