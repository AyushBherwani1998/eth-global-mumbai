"use client";

// Read-only policy state for the console, `GET /v1/policy/:ticker`
// (services/api/README.md). This is the effective policy the hook enforces
// right now, read from the receiver: version, mode, band, halted, since, creTx
// and whether the report has gone stale.
//
// Nothing here writes. Chainlink CRE is run from the command line for the demo
// (cre/README.md), so the console reports what landed and never claims to be
// driving it. The request goes through lib/api.ts like every other read, so an
// unconfigured or unreachable backend is a named state with its own sentence,
// not a blank or a guess.

import { POLL, api, type PolicyView } from "@/lib/api";
import { useLive } from "@/lib/live";

export type { PolicyView };

/** Polls the published policy. `retry()` is the "Check again" button. */
export function usePolicy(ticker: string) {
  return useLive<PolicyView>(`policy:${ticker}`, () => api.policy(ticker), POLL.market);
}

/** Plain-English name for the rule in force. */
export function modeWords(p: Pick<PolicyView, "mode" | "halted">): string {
  if (p.halted || p.mode === "halted") return "Trading halted";
  switch (p.mode) {
    case "listing":
      return "Listing day limits";
    case "surveillance":
      return "Under watch";
    case "directional":
      return "One-way day";
    default:
      return "Normal day";
  }
}
