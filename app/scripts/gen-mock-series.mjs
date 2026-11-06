// Generates the time-series mock data the screens chart from.
// Deterministic (seeded), so re-running produces the same files.
//
//   node scripts/gen-mock-series.mjs
//
// Writes mock/market-series.json and mock/auction-series.json.
// Prices are in USDC per 1,000-share lot. Times are unix seconds (UTC).

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

/**
 * Resolution by age, so the intraday ranges (5m to 1H) have something to draw:
 * 15s for the last hour, 30s for the last three, 1m for the rest of today,
 * 5m for older days.
 */
function stepAt(t) {
  if (t >= NOW - 3600) return 15;
  if (t >= NOW - 3 * 3600) return 30;
  if (t >= SESSION_START) return 60;
  return STEP;
}

/**
 * Mean-reverting walk through a list of segments. Each segment pulls the
 * price toward `target`, clipped to its band (the ListingHook would revert
 * anything outside it).
 */
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
      // Scale the walk to the step so a 15s point is not as jumpy as a 5m one.
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

// --- ACME: listed today at 10:00 IST, listing-day band ±5% around clearing 1.10
const acmeBand = band(1.1, 500);
const acme = walk({
  seed: 11,
  start: 1.1,
  vol: 0.006,
  segments: [
    { from: ist("2026-11-06T10:00:00"), to: ist("2026-11-06T10:40:00"), target: 1.15, pull: 0.2, ...acmeBand },
    { from: ist("2026-11-06T10:40:00"), to: ist("2026-11-06T13:00:00"), target: 1.12, ...acmeBand },
    { from: ist("2026-11-06T13:00:00"), to: ist("2026-11-06T14:10:00"), target: 1.07, ...acmeBand },
    { from: ist("2026-11-06T14:10:00"), to: NOW + 1, target: 1.132, pull: 0.1, ...acmeBand },
  ],
});

// --- MASALA: listed 2 Nov, listing band day 1, then normal ±20% with a daily CRE reference
const masalaRefs = [
  { at: ist("2026-11-02T10:00:00"), ref: 1.25, bps: 500, mode: "listing" },
  { at: ist("2026-11-03T09:15:00"), ref: 1.29, bps: 2000, mode: "normal" },
  { at: ist("2026-11-04T09:15:00"), ref: 1.31, bps: 2000, mode: "normal" },
  { at: ist("2026-11-05T09:15:00"), ref: 1.32, bps: 2000, mode: "normal" },
];
const masala = walk({
  seed: 23,
  start: 1.25,
  vol: 0.008,
  segments: masalaRefs.map((r, i) => ({
    from: r.at,
    to: masalaRefs[i + 1]?.at ?? NOW + 1,
    target: [1.3, 1.33, 1.29, 1.36][i],
    ...band(r.ref, r.bps),
  })),
});

// --- NIRMAAN: listed 4 Nov at 0.98, slid; surveillance ±5% around 0.90 from 5 Nov 11:15
const nirmaanRefs = [
  { at: ist("2026-11-04T10:00:00"), ref: 0.98, bps: 500, mode: "listing" },
  { at: ist("2026-11-05T09:15:00"), ref: 0.93, bps: 2000, mode: "normal" },
  { at: ist("2026-11-05T11:15:00"), ref: 0.9, bps: 500, mode: "surveillance" },
];
const nirmaan = walk({
  seed: 37,
  start: 0.98,
  vol: 0.007,
  segments: nirmaanRefs.map((r, i) => ({
    from: r.at,
    to: nirmaanRefs[i + 1]?.at ?? NOW + 1,
    target: [0.94, 0.89, 0.912][i],
    ...band(r.ref, r.bps),
  })),
});

// --- VAYU: listed 3 Nov at 1.42, sold off, directional mode, halted today 14:32 IST
const vayuRefs = [
  { at: ist("2026-11-03T10:00:00"), ref: 1.42, bps: 500, mode: "listing" },
  { at: ist("2026-11-04T09:15:00"), ref: 1.36, bps: 2000, mode: "normal" },
  { at: ist("2026-11-05T13:05:00"), ref: 1.3, bps: 2000, mode: "directional" },
  { at: ist("2026-11-06T14:32:00"), ref: 1.3, bps: 0, mode: "halted" },
];
const vayu = walk({
  seed: 41,
  start: 1.42,
  vol: 0.009,
  segments: vayuRefs.map((r, i) => ({
    from: r.at,
    to: vayuRefs[i + 1]?.at ?? NOW + 1,
    target: [1.36, 1.2, 1.21, 1.21][i],
    halted: r.mode === "halted",
    ...(r.mode === "halted" ? { lo: 0, hi: 9 } : band(r.ref, r.bps)),
  })),
});

const refSeries = (refs) =>
  refs.map((r) => ({ time: r.at, value: r.ref, mode: r.mode, bandBps: r.bps }));

const market = {
  acme: {
    prices: acme,
    reference: refSeries([{ at: ist("2026-11-06T10:00:00"), ref: 1.1, bps: 500, mode: "listing" }]),
    trades: trades(acme, 101, 14),
  },
  masala: { prices: masala, reference: refSeries(masalaRefs), trades: trades(masala, 102, 14) },
  nirmaan: { prices: nirmaan, reference: refSeries(nirmaanRefs), trades: trades(nirmaan, 103, 14) },
  vayu: { prices: vayu, reference: refSeries(vayuRefs), trades: trades(vayu, 104, 14) },
};

// --- CCA clearing price per block. Clearing only ever moves up.
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
  kesar: clearing({ seed: 51, startBlock: 7412000, startTime: NOW - 212 * 12, blocks: 212, floor: 0.8, finalPrice: 1.24, raisedTo: 61.4 }),
  tara: clearing({ seed: 52, startBlock: 7412150, startTime: NOW - 62 * 12, blocks: 62, floor: 0.8, finalPrice: 0.86, raisedTo: 12.0 }),
  lotus: clearing({ seed: 53, startBlock: 7409100, startTime: ist("2026-11-05T16:00:00"), blocks: 300, floor: 0.8, finalPrice: 0.82, raisedTo: 31.2 }),
  acme: clearing({ seed: 54, startBlock: 7408200, startTime: ist("2026-11-05T09:00:00"), blocks: 300, floor: 0.8, finalPrice: 1.1, raisedTo: 82.5 }),
  masala: clearing({ seed: 55, startBlock: 7385900, startTime: ist("2026-11-01T11:00:00"), blocks: 300, floor: 0.8, finalPrice: 1.25, raisedTo: 88.2 }),
  nirmaan: clearing({ seed: 56, startBlock: 7399400, startTime: ist("2026-11-03T11:00:00"), blocks: 300, floor: 0.8, finalPrice: 0.98, raisedTo: 71.6 }),
  vayu: clearing({ seed: 57, startBlock: 7392600, startTime: ist("2026-11-02T11:00:00"), blocks: 300, floor: 0.8, finalPrice: 1.42, raisedTo: 90 }),
};

writeFileSync(join(OUT, "market-series.json"), JSON.stringify(market, null, 1) + "\n");
writeFileSync(join(OUT, "auction-series.json"), JSON.stringify(auctions, null, 1) + "\n");
console.log("wrote", Object.keys(market).length, "market series and", Object.keys(auctions).length, "auction series");
