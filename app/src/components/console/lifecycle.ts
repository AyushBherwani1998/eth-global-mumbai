// Which listing steps are done, read from chain state rather than a fixture.
// Each step is done only when the exchange can see the thing it produces:
//   create    the listing is in the exchange's deployments (it is, or it would not be listed)
//   ticker    the ENS name resolves (GET /v1/ens/:ticker `resolved`)
//   policy    at least one CRE report has landed (policy version > 0)
//   launch    the auction exists and has started (phase past "draft")
//   monitor   the auction is over (cleared, listed or refunding)
//   graduate  the pool is listed
// Unknown inputs (null) count as not done, so nothing is claimed early.
//
// No runtime imports: tested under `node --test`.

import type { Listing } from "@/lib/api";

export type StepId = "create" | "ticker" | "policy" | "launch" | "monitor" | "graduate";
export const STEP_ORDER: StepId[] = ["create", "ticker", "policy", "launch", "monitor", "graduate"];

export function lifecycle(l: Pick<Listing, "phase" | "records">, x: { ensResolved: boolean | null; policyVersion: number | null }): Record<StepId, boolean> {
  const over = l.phase === "cleared" || l.phase === "listed" || l.phase === "refunding";
  return {
    create: true,
    ticker: x.ensResolved === true,
    policy: (x.policyVersion ?? 0) > 0,
    launch: l.records.auction !== null && l.phase !== "draft",
    monitor: over,
    graduate: l.phase === "listed",
  };
}

/** The first step not done, or null when every step is. */
export function currentStep(done: Record<StepId, boolean>): StepId | null {
  return STEP_ORDER.find((s) => !done[s]) ?? null;
}

/** The next thing to do for a listing, from its phase alone (the console index has no per-listing ENS or policy read). */
export function nextByPhase(phase: Listing["phase"]): string {
  switch (phase) {
    case "draft":
      return "Open the IPO";
    case "live":
      return "Watch applications";
    case "cleared":
      return "List on the market";
    case "refunding":
      return "Refunds are open";
    case "listed":
      return "Watch the trading rule";
  }
}
