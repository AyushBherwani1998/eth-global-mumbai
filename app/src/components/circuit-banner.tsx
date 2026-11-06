"use client";

// Trading-rule strip + sheet (UX.md 3.3 item 4). A thin wrapper over
// RuleStrip: plain sentence in the strip, "Why" and the receipt in the sheet,
// protocol words only inside the collapsed Details row.

import { useState } from "react";
import type { Policy } from "@/lib/mock";
import { ensName } from "@/lib/mock";
import { dateTimeIST, lotFixed, shortHash, timeIST, txUrl } from "@/lib/format";
import { SURVEILLANCE_BAND_BPS, band, bandDigits, bandText } from "@/lib/policy";
import { Details, KV, RuleStrip, Sheet, TextLink, type RuleKind } from "./ui";

export type RuleCopy = { kind: RuleKind; text: string; why: string; label: string } | null;

/** Plain-English copy for a policy. Returns null for Normal (no strip). */
export function ruleCopy(p: Pick<Policy, "mode" | "referencePrice" | "bandBps" | "halted" | "since">): RuleCopy {
  const ref = lotFixed(p.referencePrice);
  const d = bandDigits(p.referencePrice, p.bandBps);
  const { lo, hi } = band(p.referencePrice, p.bandBps);
  if (p.halted || p.mode === "halted")
    return {
      kind: "halted",
      label: "Trading halted",
      text: `Trading paused since ${timeIST(p.since)}. Buying and selling are off until the exchange lifts it.`,
      why: "The exchange pauses trading when it sees unusual activity. Your shares are safe, and you can still withdraw liquidity.",
    };
  switch (p.mode) {
    case "listing":
      return {
        kind: "listing",
        label: "Listing day",
        text: `Listing day. Trades allowed between ${lotFixed(lo, d)} and ${lotFixed(hi, d)}.`,
        why: "On the first day a new share can move only a little from its listing price. This keeps the opening orderly.",
      };
    case "surveillance":
      return {
        kind: "surveillance",
        label: "Under watch",
        text: `Extra checks today. Prices can move at most ${p.bandBps / 100}% from ${ref}.`,
        why: "The exchange has put this share under watch. Trades that would push the price outside the range are turned away.",
      };
    case "directional":
      return {
        kind: "one-way",
        label: "One-way day",
        text: `One-way day. Trades that move the price further from ${ref} can go at most ${SURVEILLANCE_BAND_BPS / 100}% from it. Trades toward ${ref} go through within ${p.bandBps / 100}%.`,
        why: "The price has drifted far from the reference. Until it comes back, trades that bring it closer are accepted, and trades that push it further away are capped tightly.",
      };
    default:
      return null;
  }
}

const tickerStatus = (p: Policy) => (p.halted || p.mode === "halted" ? "halted" : p.mode === "surveillance" || p.mode === "directional" ? "surveillance" : "listed");

/** Rule strip for a policy, with the Trading rule sheet. Renders nothing on Normal. */
export function CircuitBanner({ ticker, policy, className }: { ticker: string; policy: Policy; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const copy = ruleCopy(policy);
  if (!copy) return null;
  const d = bandDigits(policy.referencePrice, policy.bandBps);
  const { lo, hi } = band(policy.referencePrice, policy.bandBps);
  return (
    <>
      <RuleStrip kind={copy.kind} label={copy.label} text={copy.text} onDetails={() => setOpen(true)} className={className} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Trading rule">
        <p className="t-list-title text-text">{copy.label}</p>
        <p className="t-body mt-1 text-text">{copy.text}</p>
        <p className="t-body mt-3 text-text-2">{copy.why}</p>
        <div className="mt-4 divide-y divide-line">
          <KV k="Changed" v={dateTimeIST(policy.since)} />
          <KV k="Reference price" v={`${lotFixed(policy.referencePrice)} USDC per lot`} />
          <KV
            k="Allowed range today"
            v={policy.halted || policy.mode === "halted" ? "No trading" : policy.mode === "directional" ? `${bandText(policy.referencePrice, SURVEILLANCE_BAND_BPS)} away from ${lotFixed(policy.referencePrice)}, up to ${lotFixed(lo, d)} to ${lotFixed(hi, d)} toward it` : `${lotFixed(lo, d)} to ${lotFixed(hi, d)}`}
          />
        </div>
        <Details className="mt-2">
          <div className="divide-y divide-line">
            <KV k="Policy version" v={`v${policy.version}`} />
            <KV k="Report time" v={dateTimeIST(policy.asOf)} />
            <KV k="Ticker status" v={`${ensName(ticker)} · ${tickerStatus(policy)}`} mono />
            <KV k="Report receipt" v={<TextLink href={txUrl(policy.creTx)}>{shortHash(policy.creTx)} on Etherscan</TextLink>} />
          </div>
        </Details>
      </Sheet>
    </>
  );
}
