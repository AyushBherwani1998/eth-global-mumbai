import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { BaseError, encodeErrorResult, parseAbi, toFunctionSelector, type Hex } from "viem";

import { allErrorsAbi, errorCatalog } from "../src/abis.ts";
import { sqrtAfterFromRevert } from "../src/prepare.ts";
import { decodeRevert, revertDataOf } from "../src/revert.ts";

const enc = (errorName: string, args: readonly unknown[] = []) => encodeErrorResult({ abi: allErrorsAbi, errorName, args } as never) as Hex;
const HOOK = "0x35080Fc282034FBa0dD6D712AAbA2F380fD5f0c0";

// Bounds and post-trade price from the rehearsal's out-of-band buy (band 104.5 to 115.5 points).
const outOfBand = enc("OutOfBand", [
  1_840_722_885_164_987_285_154_412_915_757_571_830n,
  2_331_248_617_633_454_205_038_093_359_491_008_838n,
  2_450_876_561_361_322_572_629_877_054_028_858_110n,
]);
const wrapped = enc("WrappedError", [HOOK, "0x575e24b4", outOfBand, "0x"]);

test("unwraps v4 WrappedError to the hook's OutOfBand", () => {
  const d = decodeRevert(wrapped, { usdcIsCurrency0: true });
  assert.equal(d.name, "OutOfBand");
  assert.deepEqual(d.wrappers, ["WrappedError"]);
  assert.equal(d.selector, outOfBand.slice(0, 10));
  assert.match(d.message, /1\.045 to 1\.155 USDC \/ lot/);
  assert.match(d.message, /would be 1\.853/);
});

test("unwraps Universal Router ExecutionFailed and V4Quoter UnexpectedRevertBytes", () => {
  const ur = decodeRevert(enc("ExecutionFailed", [0n, wrapped]), { usdcIsCurrency0: true });
  assert.equal(ur.name, "OutOfBand");
  assert.deepEqual(ur.wrappers, ["ExecutionFailed", "WrappedError"]);
  const q = decodeRevert(enc("UnexpectedRevertBytes", [wrapped]));
  assert.deepEqual(q.wrappers, ["UnexpectedRevertBytes", "WrappedError"]);
});

test("hook circuit errors", () => {
  assert.equal(decodeRevert(enc("WrappedError", [HOOK, "0x575e24b4", enc("Halted"), "0x"])).message, "Trading halted");
  const cool = decodeRevert(enc("CoolingOff", [1_800_000_000n]));
  assert.equal(cool.name, "CoolingOff");
  assert.match(cool.message, /Cooling off until 2027-01-15T08:00:00.000Z/);
  const dir = decodeRevert(enc("DirectionalWidening", [1n, 2n, 2_388_818_980_810_137_845_276_585_969_313_655_524n]), { usdcIsCurrency0: true });
  assert.match(dir.message, /toward the reference price \(1\.10 USDC \/ lot\)/);
});

test("CCA validation hook errors", () => {
  const cap = decodeRevert(enc("ValidationHookCallFailed", [enc("CapExceeded", [25_000_000n, 20_000_000n])]));
  assert.equal(cap.name, "CapExceeded");
  assert.deepEqual(cap.args, { newTotal: "25000000", cap: "20000000" });
  assert.equal(cap.message, "Over the 20 USDC per-applicant limit (this bid would bring you to 25 USDC)");
  const above = decodeRevert(enc("ValidationHookCallFailed", [enc("BidAboveCap", [198_070_406_285_500n, 150_533_508_776_980n])]));
  assert.equal(above.message, "Max price 2.50 is above the 1.90 USDC / lot cap");
  assert.equal(decodeRevert(enc("BidMustBeAboveClearingPrice")).message, "Max price must be above the current clearing price");
});

test("string reverts, unknown selectors and empty data", () => {
  const s = decodeRevert(encodeErrorResult({ abi: parseAbi(["error Error(string)"]), errorName: "Error", args: ["nope"] }));
  assert.equal(s.name, "Error");
  assert.equal(s.message, "nope");
  const u = decodeRevert("0xdeadbeef");
  assert.equal(u.name, "Unknown");
  assert.equal(u.selector, "0xdeadbeef");
  assert.equal(decodeRevert("0x").name, "EmptyRevert");
  assert.equal(decodeRevert(null).name, "EmptyRevert");
});

test("revertDataOf walks viem error causes", () => {
  const inner = Object.assign(new Error("execution reverted"), { data: outOfBand });
  const err = new BaseError("call failed", { cause: inner });
  assert.equal(revertDataOf(err), outOfBand);
  assert.equal(revertDataOf(new Error("x")), null);
});

test("every error in contracts/errors.md decodes to its exact name, and is in the catalog", () => {
  const md = readFileSync(resolve(import.meta.dirname, "../../../contracts/errors.md"), "utf8");
  const rows = [...md.matchAll(/^\|\s*`(\w+)\(([^`]*)\)`\s*\|\s*`(0x[0-9a-f]{8})`/gm)];
  assert.ok(rows.length >= 80, `parsed ${rows.length} rows`);
  const catalog = new Map(errorCatalog().map((e) => [e.selector, e.name]));
  for (const [, name, , selector] of rows) {
    // Zero words decode for every argument type (dynamic ones as empty), so this checks the selector -> name map.
    const d = decodeRevert(`${selector}${"0".repeat(64 * 6)}` as Hex);
    assert.equal(d.name, name, `${selector} decodes as ${d.name}, errors.md says ${name}`);
    assert.equal(catalog.get(selector as Hex), name);
  }
  for (const name of ["DirectionalWidening", "OutOfBand", "Halted", "CoolingOff", "CapExceeded", "BidAboveCap"]) {
    assert.ok(rows.some((r) => r[1] === name), `${name} documented`);
  }
  for (const e of errorCatalog()) assert.equal(toFunctionSelector(e.signature), e.selector);
});

test("hook band errors give the rejected post-swap price", () => {
  assert.equal(sqrtAfterFromRevert(decodeRevert(wrapped)), 1_840_722_885_164_987_285_154_412_915_757_571_830n);
  const dir = decodeRevert(enc("DirectionalWidening", [5n, 7n, 9n]));
  assert.equal(dir.name, "DirectionalWidening");
  assert.equal(sqrtAfterFromRevert(dir), 7n);
  assert.equal(sqrtAfterFromRevert(decodeRevert(enc("Halted"))), null);
});
