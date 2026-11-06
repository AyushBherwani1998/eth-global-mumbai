"use client";

// Markets (UX.md 3.1 / 3.2): one row of two chips, Stocks | IPO, selection in ?tab=.
// Stopgap composition over the old list bodies; the screen engineers replace the bodies.

import { useSearchParams } from "next/navigation";
import { AppBar } from "@/components/shell";
import { Chip, ChipRow } from "@/components/ui";
import { StocksBody } from "./market-list";
import { IpoBody } from "./ipo-list";

export function MarketsScreen() {
  const params = useSearchParams();
  const tab = params.get("tab") === "ipo" ? "ipo" : "stocks";
  return (
    <>
      <AppBar title="Markets" />
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
