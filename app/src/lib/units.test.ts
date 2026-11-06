import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRaw, minOutAfterSlippage, parseAmount, priceToPoints, SHARE_DECIMALS, slippageToBps, USDC_DECIMALS } from "./units.ts";

test("parseAmount: USDC to 6-decimal raw, exactly", () => {
  assert.deepEqual(parseAmount("12.5", USDC_DECIMALS), { ok: true, raw: 12_500_000n, value: 12.5 });
  assert.deepEqual(parseAmount("0.000001", USDC_DECIMALS), { ok: true, raw: 1n, value: 0.000001 });
  assert.deepEqual(parseAmount("1,000.25", USDC_DECIMALS), { ok: true, raw: 1_000_250_000n, value: 1000.25 });
  assert.deepEqual(parseAmount(".5", USDC_DECIMALS), { ok: true, raw: 500_000n, value: 0.5 });
  assert.deepEqual(parseAmount("3.", USDC_DECIMALS), { ok: true, raw: 3_000_000n, value: 3 });
});

test("parseAmount: shares at 18 decimals without float error", () => {
  const r = parseAmount("0.1", SHARE_DECIMALS);
  assert.ok(r.ok);
  assert.equal(r.raw, 100_000_000_000_000_000n);
  const big = parseAmount("432.123456789012345678", SHARE_DECIMALS);
  assert.ok(big.ok);
  assert.equal(big.raw, 432_123_456_789_012_345_678n);
});

test("parseAmount: rejects what it cannot send", () => {
  for (const bad of ["", "  ", ".", "-1", "1e3", "1.2.3", "abc", "0", "0.000"]) {
    const r = parseAmount(bad, USDC_DECIMALS);
    assert.equal(r.ok, false, bad);
  }
  const tooFine = parseAmount("1.0000001", USDC_DECIMALS);
  assert.equal(tooFine.ok, false);
  assert.match(tooFine.ok ? "" : tooFine.error, /6 digits/);
});

test("formatRaw round-trips parseAmount", () => {
  assert.equal(formatRaw(12_500_000n, USDC_DECIMALS), "12.5");
  assert.equal(formatRaw(20_050_000n, USDC_DECIMALS), "20.05");
  assert.equal(formatRaw(432n * 10n ** 18n, SHARE_DECIMALS), "432");
  assert.equal(formatRaw(1n, SHARE_DECIMALS), "0.000000000000000001");
});

test("minOutAfterSlippage rounds down, never above the accepted floor", () => {
  assert.equal(minOutAfterSlippage(1_000_000n, 100), 990_000n);
  assert.equal(minOutAfterSlippage(999n, 50), 994n); // 994.005 -> 994
  assert.equal(minOutAfterSlippage(1n, 1), 0n);
  assert.equal(minOutAfterSlippage(5n, 0), 5n);
  assert.throws(() => minOutAfterSlippage(1n, 10_000));
  assert.throws(() => minOutAfterSlippage(1n, 1.5));
});

test("slippageToBps", () => {
  assert.equal(slippageToBps("0.5"), 50);
  assert.equal(slippageToBps("1"), 100);
  assert.equal(slippageToBps("2"), 200);
  assert.throws(() => slippageToBps("x"));
});

test("priceToPoints floors to the auction tick without float drift", () => {
  assert.equal(priceToPoints(1.3), 130);
  assert.equal(priceToPoints(1.29), 129); // 1.29 * 100 is 128.999... in floats
  assert.equal(priceToPoints(1.299), 129);
  assert.equal(priceToPoints(0.79), 79);
});
