"use client";

// Markets (UX.md 3.1 / 3.2): one row of two chips, Stocks | IPO, selection in ?tab=.
// Both bodies read the backend through src/lib/api.ts.

import { useSearchParams } from "next/navigation";
import { AppBar } from "@/components/shell";
import { Chip, ChipRow } from "@/components/ui";
import { DemoDataStrip } from "@/lib/api-state";
import { StocksBody } from "./market-list";
import { IpoBody } from "./ipo-list";

export function MarketsScreen() {
  const params = useSearchParams();
  const tab = params.get("tab") === "ipo" ? "ipo" : "stocks";
  return (
    <>
      <AppBar title="Markets" />
      <DemoDataStrip className="-mx-5" />
      <main>
        <ChipRow className="mt-2">
          <Chip href="/" selected={tab === "stocks"}>
            Stocks
          </Chip>
          <Chip href="/?tab=ipo" selected={tab === "ipo"}>
            IPO
          </Chip>
        </ChipRow>
        {tab === "stocks" ? <StocksBody /> : <IpoBody />}
      </main>
    </>
  );
}
