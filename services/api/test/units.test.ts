import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ONE_POINT_Q96,
  Q96,
  formatLot,
  fullRangeAmounts,
  iso,
  parseAmount,
  pointsToQ96,
  priceToPoints,
  q96ToPoints,
  q96ToPrice,
  sqrtPriceX96ToPointsE2,
  sqrtPriceX96ToPrice,
} from "../src/units.ts";

test("ONE_POINT_Q96 matches ListingPrice.sol", () => {
  assert.equal(ONE_POINT_Q96, 792_281_625_142n);
});

test("points <-> Q96 round-trips the demo prices", () => {
  // floor 80, issue 100, cap 190 points; clearing 1.10 from the rehearsal.
  assert.equal(pointsToQ96(80n), 63_382_530_011_360n);
  assert.equal(pointsToQ96(190n), 150_533_508_776_980n);
  for (const p of [1n, 80n, 100n, 110n, 130n, 190n]) assert.equal(q96ToPoints(pointsToQ96(p)), Number(p));
  assert.equal(q96ToPrice(pointsToQ96(80n)), 0.8);
  assert.equal(q96ToPrice(87_150_978_765_691n), 1.1);
});

test("sqrtPriceX96 with USDC as currency0 inverts to the share price", () => {
  // The rehearsal's listing sqrt price (110 points) and post-trade price (114 points).
  assert.equal(sqrtPriceX96ToPointsE2(2_388_818_980_810_137_845_276_585_969_313_655_524n, true), 11_000n);
  assert.equal(sqrtPriceX96ToPrice(2_346_535_657_612_926_232_651_887_599_287_742_833n, true), 1.14);
  // USDC as currency1: sqrt(priceQ96 / 2^96) * 2^96 for 1.00 / lot = 100 points.
  const priceQ96 = pointsToQ96(100n);
  const sqrt = BigInt(Math.floor(Math.sqrt(Number(priceQ96) / Number(Q96)) * Number(Q96)));
  assert.equal(sqrtPriceX96ToPointsE2(sqrt, false), 10_000n);
  assert.equal(sqrtPriceX96ToPrice(0n, true), 0);
});

test("parseAmount", () => {
  assert.equal(parseAmount(20, 6), 20_000_000n);
  assert.equal(parseAmount("19.5", 6), 19_500_000n);
  assert.equal(parseAmount(1.3, 4), 13_000n);
  assert.equal(parseAmount(0.05, 6), 50_000n);
  assert.equal(parseAmount("100", 18), 100n * 10n ** 18n);
  assert.throws(() => parseAmount("1.0000001", 6), /more than 6 decimals/);
  assert.throws(() => parseAmount("-1", 6), /not a positive/);
  assert.throws(() => parseAmount("abc", 6), /not a positive/);
  assert.throws(() => parseAmount(1e-7, 6), /decimal string/);
});

test("priceToPoints requires the 1-point tick", () => {
  assert.equal(priceToPoints(1.3), 130n);
  assert.equal(priceToPoints("0.8"), 80n);
  assert.equal(priceToPoints("1.90"), 190n);
  assert.throws(() => priceToPoints(1.305), /multiple of 0.01/);
});

test("fullRangeAmounts", () => {
  const { amount0, amount1 } = fullRangeAmounts(10n ** 18n, Q96);
  assert.equal(amount0, 10n ** 18n);
  assert.equal(amount1, 10n ** 18n);
  assert.deepEqual(fullRangeAmounts(1n, 0n), { amount0: 0n, amount1: 0n });
});

test("iso", () => {
  assert.equal(iso(0n), null);
  assert.equal(iso(null), null);
  assert.equal(iso(1_700_000_000n), "2023-11-14T22:13:20.000Z");
});

test("formatLot", () => {
  assert.equal(formatLot(1.1), "1.10");
  assert.equal(formatLot(0.8), "0.80");
  assert.equal(formatLot(1.045), "1.045");
  assert.equal(formatLot(1.8527), "1.853");
});
