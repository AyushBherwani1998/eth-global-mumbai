// Generates the time-series fallback data in app/mock.
// Deterministic (seeded), so re-running produces the same files.
//
//   node scripts/gen-mock-series.mjs
//
// Writes mock/market-series.json and mock/auction-series.json.
// Prices are in USDC per 1,000-share lot. Times are unix seconds (UTC).
//
// These files are NOT the app's data any more: every screen reads the backend
// through src/lib/api.ts. They are the static copy a few not-yet-migrated
// pieces still lean on (the search sheet, the issuer console charts), so they
// cover the one real listing, Acme, at the numbers Acme actually shows on
// Sepolia: cleared at 0.80, 60 USDC raised, 3 applicants, policy version 5.
// No other company exists; every other one was invented and has been removed.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "mock");

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ist = (s) => Math.floor(new Date(`${s}+05:30`).getTime() / 1000);
const r4 = (n) => Math.round(n * 10000) / 10000;
const STEP = 5 * 60; // coarse candles, for days before today
const NOW = ist("2026-11-06T15:40:00");
const SESSION_START = ist("2026-11-06T09:15:00");

/** Resolution by age, so the intraday ranges (5m to 1H) have something to draw. */
function stepAt(t) {
  if (t >= NOW - 900) return 5;
  if (t >= NOW - 3600) return 15;
  if (t >= NOW - 3 * 3600) return 30;
  if (t >= SESSION_START) return 60;
  return STEP;
}

/** Mean-reverting walk, clipped to the band the hook would enforce. */
function walk({ seed, start, segments, vol }) {
  const rand = rng(seed);
  const points = [];
  let p = start;
  for (const seg of segments) {
    let t = seg.from;
    while (t < seg.to && t <= NOW) {
      const step = stepAt(t);
      if (seg.halted) {
        points.push({ time: t, value: r4(p), halted: true });
        t += step;
        continue;
      }
      const scale = step / STEP;
      const shock = (rand() - 0.5) * 2 * vol * p * Math.sqrt(scale);
      const pull = (seg.target - p) * (seg.pull ?? 0.06) * scale;
      p = Math.min(seg.hi * 0.998, Math.max(seg.lo * 1.002, p + shock + pull));
      points.push({ time: t, value: r4(p) });
      t += step;
    }
  }
  return points;
}

function trades(points, seed, count) {
  const rand = rng(seed);
  const live = points.filter((p) => !p.halted);
  const out = [];
  for (let i = live.length - 1; i > 0 && out.length < count; i -= 1) {
    if (rand() < 0.45) continue;
    const side = live[i].value >= live[i - 1].value ? "buy" : "sell";
    const usdc = r4(0.4 + rand() * 6.5);
    out.push({
      time: live[i].time - Math.floor(rand() * 300),
      side,
      usdc,
      shares: Math.round((usdc / live[i].value) * 1000),
      price: live[i].value,
      tx: `0x${Math.floor(rand() * 2 ** 52).toString(16).padStart(13, "0")}${"a3f9c0d1e2b4"}`,
    });
  }
  return out;
}

const band = (ref, bps) => ({ lo: r4(ref * (1 - bps / 10000)), hi: r4(ref * (1 + bps / 10000)) });

// --- ACME: cleared at the 0.80 floor, listed today at 10:00 IST, listing-day band ±5%.
const acmeBand = band(0.8, 500);
const acme = walk({
  seed: 11,
  start: 0.8,
  vol: 0.005,
  segments: [
    { from: ist("2026-11-06T10:00:00"), to: ist("2026-11-06T10:40:00"), target: 0.822, pull: 0.2, ...acmeBand },
    { from: ist("2026-11-06T10:40:00"), to: ist("2026-11-06T13:00:00"), target: 0.812, ...acmeBand },
    { from: ist("2026-11-06T13:00:00"), to: ist("2026-11-06T14:10:00"), target: 0.788, ...acmeBand },
    { from: ist("2026-11-06T14:10:00"), to: NOW + 1, target: 0.806, pull: 0.1, ...acmeBand },
  ],
});

const market = {
  acme: {
    prices: acme,
    reference: [{ time: ist("2026-11-06T10:00:00"), value: 0.8, mode: "listing", bandBps: 500 }],
    trades: trades(acme, 101, 14),
  },
};

/** CCA clearing price per block. Clearing only ever moves up. */
function clearing({ seed, startBlock, startTime, blocks, floor, finalPrice, raisedTo }) {
  const rand = rng(seed);
  const out = [];
  let p = floor;
  let raised = 0;
  for (let b = 0; b <= blocks; b += 2) {
    const progress = b / blocks;
    const target = floor + (finalPrice - floor) * Math.pow(progress, 0.7);
    if (target > p && rand() < 0.55) p = Math.min(target, p + (target - p) * (0.5 + rand() * 0.8));
    raised = Math.max(raised, raisedTo * Math.pow(progress, 0.85) * (0.96 + rand() * 0.04));
    out.push({
      block: startBlock + b,
      time: startTime + b * 12,
      price: r4(p),
      raised: Math.round(raised * 100) / 100,
    });
  }
  out[out.length - 1].price = finalPrice;
  out[out.length - 1].raised = raisedTo;
  return out;
}

const auctions = {
  acme: clearing({ seed: 54, startBlock: 7408200, startTime: ist("2026-11-05T09:00:00"), blocks: 300, floor: 0.8, finalPrice: 0.8, raisedTo: 60 }),
};

writeFileSync(join(OUT, "market-series.json"), JSON.stringify(market, null, 1) + "\n");
writeFileSync(join(OUT, "auction-series.json"), JSON.stringify(auctions, null, 1) + "\n");
console.log("wrote", Object.keys(market).length, "market series and", Object.keys(auctions).length, "auction series");
