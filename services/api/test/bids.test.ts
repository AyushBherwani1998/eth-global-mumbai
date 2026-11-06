import assert from "node:assert/strict";
import { test } from "node:test";

import { bidKey, bidSettlement } from "../src/reads/auction.ts";

const base = { exited: false, claimed: false, filled: 0n, unclaimed: 0n, amount: 20_000_000n, maxPrice: 150n, clearing: 80n, ended: true, graduated: true };

test("bidKey is the lowercase auction plus the id (the app's bidKey())", () => {
  assert.equal(bidKey("0xF36d09f6C780bde8f09000d87e47B9D3E2EE5aE3", 2), "0xf36d09f6c780bde8f09000d87e47b9d3e2ee5ae3:2");
});

test("bidSettlement separates exited, claimed and fully refunded", () => {
  assert.deepEqual(bidSettlement({ ...base, ended: false }), { status: "open", claimable: null, refundable: null });
  assert.deepEqual(bidSettlement(base), { status: "awaitingExit", claimable: null, refundable: 0n });
  assert.deepEqual(bidSettlement({ ...base, maxPrice: 80n }), { status: "awaitingExit", claimable: null, refundable: null });
  assert.deepEqual(bidSettlement({ ...base, graduated: false }), { status: "awaitingExit", claimable: null, refundable: 20_000_000n });
  assert.deepEqual(bidSettlement({ ...base, exited: true, filled: 5n, unclaimed: 5n }), { status: "exited", claimable: 5n, refundable: 0n });
  assert.deepEqual(bidSettlement({ ...base, exited: true, filled: 5n, unclaimed: 0n, claimed: true }), { status: "claimed", claimable: 0n, refundable: 0n });
  assert.deepEqual(bidSettlement({ ...base, exited: true, graduated: false }), { status: "refunded", claimable: 0n, refundable: 0n });
});
