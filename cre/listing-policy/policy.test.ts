import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeAbiParameters } from "viem";

import {
  buildListingPolicy,
  encodeReport,
  isqrt,
  parseExchangePolicy,
  pointsE2ToSqrtPriceX96,
  REPORT_ABI,
} from "./policy";
import { computeExpected, FIXTURE_PATH, type FixtureCase } from "./scripts/gen-fixtures";

const SEPOLIA = 16015286601757825753n;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: FixtureCase[] };

describe("golden report vectors (shared with contracts/test/unit/CreReportFixture.t.sol)", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      expect(computeExpected(c)).toEqual(c.expected);
    });
  }
});

describe("encodeReport", () => {
  test("round-trips through abi.decode((ListingPolicy, string))", () => {
    const policy = buildListingPolicy(parseExchangePolicy(fixture.cases[3].api), {
      asOf: 1_762_400_210n,
      chainSelector: SEPOLIA,
      usdcIsCurrency0: true,
    });
    const [decoded, status] = decodeAbiParameters(REPORT_ABI, encodeReport(policy, "surveillance"));
    expect(decoded).toEqual(policy);
    expect(status).toBe("surveillance");
  });

  test("leaves version 0 for the receiver to assign", () => {
    const p = buildListingPolicy(parseExchangePolicy({}), { asOf: 1n, chainSelector: SEPOLIA, usdcIsCurrency0: true });
    expect(p.version).toBe(0);
    expect(p.refSqrtPriceX96).toBe(0n);
  });

  test("rejects asOf outside uint64", () => {
    const s = parseExchangePolicy({});
    expect(() => buildListingPolicy(s, { asOf: 0n, chainSelector: SEPOLIA, usdcIsCurrency0: true })).toThrow();
    expect(() => buildListingPolicy(s, { asOf: 1n << 64n, chainSelector: SEPOLIA, usdcIsCurrency0: true })).toThrow();
  });
});

describe("parseExchangePolicy", () => {
  test("defaults missing fields like the hook does", () => {
    expect(parseExchangePolicy({})).toEqual({
      refPointsE2: 0,
      mode: 0,
      halted: false,
      coolOffUntil: 0,
      normalBandBps: 0,
      survBandBps: 0,
      status: "",
    });
  });

  test("accepts mode names and numbers, 2-decimal points", () => {
    expect(parseExchangePolicy({ mode: "directional", refPricePoints: 104.55 })).toMatchObject({
      mode: 2,
      refPointsE2: 10_455,
    });
    expect(parseExchangePolicy({ mode: 1 }).mode).toBe(1);
  });

  test("rejects bad input with every problem listed", () => {
    expect(() =>
      parseExchangePolicy({
        refPricePoints: 1.234,
        mode: "panic",
        halted: "no",
        coolOffUntil: -5,
        bands: { normalBps: 10_000, surveillanceBps: 1.5 },
        status: "delisted",
      }),
    ).toThrow(/refPricePoints.*mode.*halted.*coolOffUntil.*normalBps.*surveillanceBps.*status/);
    expect(() => parseExchangePolicy([])).toThrow(/JSON object/);
    expect(() => parseExchangePolicy({ refPricePoints: 0 })).toThrow(/refPricePoints/);
  });
});

describe("price math", () => {
  test("isqrt is floor(sqrt)", () => {
    for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, (1n << 192n) - 1n, 1n << 192n, 10n ** 40n + 7n]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });

  test("a higher share price is a lower sqrtPriceX96 when USDC is currency0", () => {
    expect(pointsE2ToSqrtPriceX96(11_000n, true)).toBeLessThan(pointsE2ToSqrtPriceX96(10_000n, true));
    expect(pointsE2ToSqrtPriceX96(11_000n, false)).toBeGreaterThan(pointsE2ToSqrtPriceX96(10_000n, false));
  });
});
