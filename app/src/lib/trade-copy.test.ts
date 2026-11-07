import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalTitle, bandRejection } from "./trade-copy.ts";

test("approval titles use plain English, not server addresses", () => {
  assert.equal(approvalTitle("approveUsdcToPermit2", "USDC"), "Enable USDC for trading");
  assert.equal(approvalTitle("approveTokenToPermit2", "shares"), "Enable shares for trading");
  assert.equal(approvalTitle("permit2Approve", "shares"), "Allow this trade to use your shares");
  assert.equal(approvalTitle("futureKind", "USDC"), "Approve in your wallet");
});

test("boundary rejection does not call identical rounded values above or below", () => {
  for (const after of [0.96000001, 0.96, 0.63999999, 0.64, null]) {
    const copy = bandRejection("0.64 to 0.96", after);
    assert.match(copy, /breaks today's price limit/);
    assert.match(copy, /full on-chain price/);
    assert.doesNotMatch(copy, /above|below/);
  }
});
