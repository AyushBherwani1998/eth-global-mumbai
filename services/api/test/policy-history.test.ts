/** buildPolicyTimeline against the live Sepolia ACME reports (v1 to v5), plus cool-off and staleness. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hex } from "viem";

import { buildPolicyTimeline, type AppliedLog, type ReportedPolicy, type TimelineInput } from "../src/reads/policy-history.ts";

const LISTED_AT = 1_793_978_640n;
const ENDS_AT = 1_793_982_240n;
const LISTING_SQRT = 2_801_138_548_740_444_334_653_601_382_131_617_302n;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const policy = (p: Partial<ReportedPolicy> & { asOf: bigint }): ReportedPolicy => ({
  refSqrtPriceX96: 0n,
  normalBandBps: 2000,
  survBandBps: 500,
  mode: 0,
  halted: false,
  coolOffUntil: 0n,
  ...p,
});
const applied = (version: number, time: bigint, p: ReportedPolicy, status: string): AppliedLog => ({ version, block: 12_077_000n + BigInt(version), time, tx: tx(version), policy: p, status });

const LIVE: AppliedLog[] = [
  applied(1, 1_793_979_108n, policy({ asOf: 1_793_979_084n, halted: true, normalBandBps: 0, survBandBps: 0 }), "halted"),
  applied(2, 1_793_979_756n, policy({ asOf: 1_793_979_748n, refSqrtPriceX96: 2_801_138_548_739_317_383_221_084_629_386_531_507n }), "listed"),
  applied(3, 1_793_982_552n, policy({ asOf: 1_793_982_547n, mode: 2, refSqrtPriceX96: 2_994_543_069_219_334_140_280_393_581_600_695_631n }), "surveillance"),
  applied(4, 1_793_982_672n, policy({ asOf: 1_793_982_661n, halted: true }), "halted"),
  applied(5, 1_793_982_720n, policy({ asOf: 1_793_982_712n }), "listed"),
];

const input = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  usdcIsCurrency0: true,
  listingDayBandBps: 500,
  listed: { block: 12_077_424n, time: LISTED_AT, tx: tx(99), listingSqrtPriceX96: LISTING_SQRT, listingDayEndsAt: ENDS_AT },
  applied: LIVE,
  maxAges: [{ block: 12_077_327n, time: 1_793_977_000n, maxAge: 86_400n }],
  fallbackMaxAge: 86_400n,
  now: 1_793_990_100n,
  ...over,
});

test("live ACME history: spans, triggers, listing-day override and directional reference", () => {
  const t = buildPolicyTimeline(input());
  const rows = t.spans.map((s) => [s.trigger, s.version, s.tradingMode, s.halted, s.haltCause, s.referencePrice, s.bandBps, s.band.low, s.band.high]);
  assert.deepEqual(rows, [
    ["listed", 0, "listing", false, null, 0.8, 500, 0.76, 0.84],
    ["policyApplied", 1, "listing", true, "report", 0.8, 500, 0.76, 0.84],
    ["policyApplied", 2, "listing", false, null, 0.8, 500, 0.76, 0.84],
    ["listingDayEnded", 2, "normal", false, null, 0.8, 2000, 0.64, 0.96],
    ["policyApplied", 3, "directional", false, null, 0.7, 2000, 0.56, 0.84],
    ["policyApplied", 4, "normal", true, "report", 0.8, 2000, 0.64, 0.96],
    ["policyApplied", 5, "normal", false, null, 0.8, 2000, 0.64, 0.96],
  ]);
  assert.equal(t.spans[0]!.fromTime, Number(LISTED_AT));
  assert.equal(t.spans[3]!.fromTime, Number(ENDS_AT));
  assert.equal(t.spans.at(-1)!.toTime, null);
  for (let i = 1; i < t.spans.length; i++) assert.equal(t.spans[i - 1]!.toTime, t.spans[i]!.fromTime, "spans are contiguous");
  assert.equal(t.spans[4]!.directionalBandBps, 500);
  assert.equal(t.spans[4]!.mode, "directional");
  assert.equal(t.spans[1]!.mode, "halted");
  assert.equal(t.spans[1]!.tradingOpen, false);

  assert.deepEqual(
    t.haltSpans.map((h) => [h.fromTime, h.toTime, h.cause, h.version]),
    [
      [1_793_979_108, 1_793_979_756, "report", 1],
      [1_793_982_672, 1_793_982_720, "report", 4],
    ],
  );

  assert.equal(t.reference.length, t.spans.length + 1);
  assert.deepEqual(t.reference.at(-1), { ...t.reference.at(-1)!, time: 1_793_990_100, value: 0.8, carryForward: true });
  assert.ok(t.reference.slice(0, -1).every((r) => !r.carryForward));

  assert.equal(t.entries.length, 5);
  const e1 = t.entries[0]!;
  assert.equal(e1.halted, true);
  assert.equal(e1.supersededAt, new Date(1_793_979_756_000).toISOString());
  assert.equal(e1.staleAt, new Date((1_793_979_084 + 86_400 + 1) * 1000).toISOString());
  assert.equal(e1.effective?.listingDayOverride, true);
  assert.equal(t.entries[4]!.supersededAt, null);
});

test("staleness halts trading once asOf + maxAge passes, and a report before listing has no effective rules", () => {
  const early = applied(1, LISTED_AT - 100n, policy({ asOf: LISTED_AT - 100n }), "listed");
  const t = buildPolicyTimeline(input({ applied: [early], now: LISTED_AT + 200_000n }));
  assert.equal(t.entries[0]!.effective, null);
  const stale = t.spans.find((s) => s.trigger === "stale");
  assert.ok(stale, JSON.stringify(t.spans.map((s) => s.trigger)));
  assert.equal(stale.fromTime, Number(LISTED_AT - 100n + 86_400n + 1n));
  assert.equal(stale.halted, true);
  assert.equal(stale.haltCause, "stale");
  assert.deepEqual(
    t.haltSpans.map((h) => [h.cause, h.toTime]),
    [["stale", null]],
  );
});

test("cool-off closes trading without counting as halted, and ends on its own", () => {
  const coolUntil = ENDS_AT + 600n;
  const report = applied(1, ENDS_AT + 60n, policy({ asOf: ENDS_AT + 50n, coolOffUntil: coolUntil }), "coolingOff");
  const t = buildPolicyTimeline(input({ applied: [report], now: ENDS_AT + 3_600n }));
  const cool = t.spans.find((s) => s.coolingOff)!;
  assert.equal(cool.halted, false);
  assert.equal(cool.tradingOpen, false);
  assert.equal(cool.haltCause, "coolingOff");
  const after = t.spans.find((s) => s.trigger === "coolOffEnded")!;
  assert.equal(after.fromTime, Number(coolUntil));
  assert.equal(after.tradingOpen, true);
  assert.deepEqual(
    t.haltSpans.map((h) => [h.cause, h.fromTime, h.toTime]),
    [["coolingOff", Number(ENDS_AT + 60n), Number(coolUntil)]],
  );
});

test("not listed: no spans, entries kept", () => {
  const t = buildPolicyTimeline(input({ listed: null }));
  assert.deepEqual(t.spans, []);
  assert.deepEqual(t.haltSpans, []);
  assert.equal(t.entries.length, 5);
  assert.ok(t.entries.every((e) => e.effective === null));
});
