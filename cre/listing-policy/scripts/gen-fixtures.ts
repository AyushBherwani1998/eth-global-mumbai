/**
 * Recomputes the expected outputs in fixtures/report-vectors.json from each case's inputs.
 * `bun run fixtures` after an intentional encoding change; the Solidity side
 * (contracts/test/unit/CreReportFixture.t.sol) independently checks the same bytes.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { buildListingPolicy, encodeReport, parseExchangePolicy } from "../policy";

export const FIXTURE_PATH = new URL("../fixtures/report-vectors.json", import.meta.url).pathname;

export type FixtureCase = {
  name: string;
  api: Record<string, unknown>;
  asOf: number;
  usdcIsCurrency0: boolean;
  chainSelector: string;
  expected: {
    pointsE2: number;
    mode: number;
    halted: boolean;
    coolOffUntil: number;
    normalBandBps: number;
    survBandBps: number;
    status: string;
    refSqrtPriceX96: string;
    payload: string;
  };
};

export function computeExpected(c: FixtureCase): FixtureCase["expected"] {
  const s = parseExchangePolicy(c.api);
  const policy = buildListingPolicy(s, {
    asOf: BigInt(c.asOf),
    chainSelector: BigInt(c.chainSelector),
    usdcIsCurrency0: c.usdcIsCurrency0,
  });
  return {
    pointsE2: s.refPointsE2,
    mode: s.mode,
    halted: s.halted,
    coolOffUntil: s.coolOffUntil,
    normalBandBps: s.normalBandBps,
    survBandBps: s.survBandBps,
    status: s.status,
    refSqrtPriceX96: policy.refSqrtPriceX96.toString(),
    payload: encodeReport(policy, s.status),
  };
}

if (import.meta.main) {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: FixtureCase[] };
  for (const c of fixture.cases) c.expected = computeExpected(c);
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${fixture.cases.length} cases to ${FIXTURE_PATH}`);
}
