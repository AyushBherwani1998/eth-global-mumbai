// Circuit policy → band, copy and tone. Mirrors what ListingHook enforces so
// the trade sheet's pre-check and the banner always agree.

import type { Mode, Policy } from "./mock";
import { lotFixed } from "./format";

export type Tone = "brand" | "gain" | "warn" | "loss";

/**
 * ListingHook's surveillance band (DEFAULT_SURVEILLANCE_BAND_BPS). In
 * directional mode a swap that widens the gap to the reference reverts
 * DirectionalWidening only if it also lands outside this band; every swap must
 * still land inside the policy band (normal, 20%) or it reverts OutOfBand.
 */
export const SURVEILLANCE_BAND_BPS = 500;

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
        copy: `Directional · ±${SURVEILLANCE_BAND_BPS / 100}% away from ref ${lotFixed(p.referencePrice)}, toward it within ${pctBand}`,
        tone: "warn",
      };
  }
  return { label: p.mode, copy: p.mode, tone: "brand" };
}

export const MODE_ORDER: Mode[] = ["listing", "normal", "surveillance", "directional", "halted"];
