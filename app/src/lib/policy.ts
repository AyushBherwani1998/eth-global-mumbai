// Circuit policy → band, copy and tone. Mirrors what ListingHook enforces so
// the trade sheet's pre-check and the banner always agree.

import type { Mode, Policy } from "./mock";
import { lotFixed } from "./format";

export type Tone = "brand" | "gain" | "warn" | "loss";

export function band(ref: number, bps: number) {
  return { lo: ref * (1 - bps / 10000), hi: ref * (1 + bps / 10000) };
}

export function bandDigits(ref: number, bps: number) {
  const { lo, hi } = band(ref, bps);
  // 1.045–1.155 needs 3 decimals; 0.88–1.32 reads fine with 2.
  const needs3 = Math.abs(lo * 100 - Math.round(lo * 100)) > 1e-6 || Math.abs(hi * 100 - Math.round(hi * 100)) > 1e-6;
  return needs3 ? 3 : 2;
}

export function bandText(ref: number, bps: number) {
  const { lo, hi } = band(ref, bps);
  const d = bandDigits(ref, bps);
  return `${lotFixed(lo, d)}–${lotFixed(hi, d)}`;
}

export function modeInfo(p: Pick<Policy, "mode" | "referencePrice" | "bandBps" | "halted">): {
  label: string;
  copy: string;
  tone: Tone;
} {
  const pctBand = `±${p.bandBps / 100}%`;
  if (p.halted || p.mode === "halted")
    return { label: "Halted", copy: "Halted · swaps revert · LP exits open", tone: "loss" };
  switch (p.mode) {
    case "listing":
      return { label: "Listing day", copy: `Listing day · ${pctBand} · ${bandText(p.referencePrice, p.bandBps)}`, tone: "brand" };
    case "normal":
      return { label: "Normal", copy: `Normal · ${pctBand} · ${bandText(p.referencePrice, p.bandBps)}`, tone: "gain" };
    case "surveillance":
      return { label: "Surveillance", copy: `Surveillance · ${pctBand} · ${bandText(p.referencePrice, p.bandBps)}`, tone: "warn" };
    case "directional":
      return {
        label: "Directional",
        copy: `Directional · only trades toward ref ${lotFixed(p.referencePrice)}`,
        tone: "warn",
      };
  }
  return { label: p.mode, copy: p.mode, tone: "brand" };
}

export const MODE_ORDER: Mode[] = ["listing", "normal", "surveillance", "directional", "halted"];

// ---- Pool math for the trade sheet pre-check (mock) -------------------------
// The demo pool is tiny (20,000 shares + ~18 USDC). v4 concentrates it in a
// range, so we model it as a constant-product pool with 10× virtual depth.
const VIRTUAL_DEPTH = 10;
const FEE = 0.003;

export type Quote = {
  out: number;
  priceAfter: number;
  impactPct: number;
  verdict: { ok: true } | { ok: false; reason: "OutOfBand" | "WrongDirection" | "Halted"; text: string };
};

export function quote(opts: {
  side: "buy" | "sell";
  amount: number; // USDC for buy, shares for sell
  liquidity: { usdc: number; shares: number };
  policy: Policy;
}): Quote {
  const U = opts.liquidity.usdc * VIRTUAL_DEPTH;
  const S = opts.liquidity.shares * VIRTUAL_DEPTH;
  const k = U * S;
  const priceBefore = (U / S) * 1000;
  let out: number;
  let U2: number;
  let S2: number;
  if (opts.side === "buy") {
    U2 = U + opts.amount * (1 - FEE);
    S2 = k / U2;
    out = S - S2;
  } else {
    S2 = S + opts.amount * (1 - FEE);
    U2 = k / S2;
    out = U - U2;
  }
  const priceAfter = (U2 / S2) * 1000;
  const impactPct = ((priceAfter - priceBefore) / priceBefore) * 100;

  const p = opts.policy;
  let verdict: Quote["verdict"] = { ok: true };
  if (p.halted || p.mode === "halted") {
    verdict = { ok: false, reason: "Halted", text: "Trading halted. Swaps revert." };
  } else if (p.mode === "directional") {
    const before = Math.abs(priceBefore - p.referencePrice);
    const after = Math.abs(priceAfter - p.referencePrice);
    if (after > before)
      verdict = {
        ok: false,
        reason: "WrongDirection",
        text: `Would revert: widens the gap from reference ${lotFixed(p.referencePrice)}`,
      };
  } else {
    const { lo, hi } = band(p.referencePrice, p.bandBps);
    const d = bandDigits(p.referencePrice, p.bandBps);
    if (priceAfter > hi)
      verdict = {
        ok: false,
        reason: "OutOfBand",
        text: `Would revert: price after ${priceAfter.toFixed(3)} is outside the band (max ${lotFixed(hi, d)})`,
      };
    else if (priceAfter < lo)
      verdict = {
        ok: false,
        reason: "OutOfBand",
        text: `Would revert: price after ${priceAfter.toFixed(3)} is outside the band (min ${lotFixed(lo, d)})`,
      };
  }
  return { out: Math.max(0, out), priceAfter, impactPct, verdict };
}
