import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, type Hex } from "viem";

import { ccaAbi, universalRouterAbi } from "../src/abis.ts";
import { encodeV4ExactInSingle } from "../src/prepare.ts";
import { bidState } from "../src/reads/auction.ts";

const poolKey = {
  currency0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  currency1: "0x326EC4516BE96704743a458f2FAa1ABC2027185a",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x35080Fc282034FBa0dD6D712AAbA2F380fD5f0c0",
} as const;

test("V4_SWAP: SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL", () => {
  const { commands, inputs } = encodeV4ExactInSingle({
    poolKey,
    zeroForOne: true,
    amountIn: 50_000n,
    minOut: 43n * 10n ** 18n,
    currencyIn: poolKey.currency0,
    currencyOut: poolKey.currency1,
  });
  assert.equal(commands, "0x10");
  assert.equal(inputs.length, 1);
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]!);
  assert.equal(actions, "0x060c0f");
  assert.equal(params.length, 3);
  const [swap] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    params[0] as Hex,
  );
  assert.deepEqual(swap.poolKey, poolKey);
  assert.equal(swap.zeroForOne, true);
  assert.equal(swap.amountIn, 50_000n);
  assert.equal(swap.amountOutMinimum, 43n * 10n ** 18n);
  assert.deepEqual(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[1] as Hex), [poolKey.currency0, 50_000n]);
  assert.deepEqual(decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[2] as Hex), [poolKey.currency1, 43n * 10n ** 18n]);

  const data = encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [commands, inputs, 1n] });
  assert.equal(data.slice(0, 10), "0x3593564c");
});

test("submitBid with the prevTickPrice hint picks the 5-argument overload", () => {
  const data = encodeFunctionData({
    abi: ccaAbi,
    functionName: "submitBid",
    args: [102_996_611_268_460n, 10_000_000n, "0x00000000000000000000000000000000000bEEf1", 63_382_530_011_360n, "0x"],
  });
  const d = decodeFunctionData({ abi: ccaAbi, data });
  assert.equal(d.functionName, "submitBid");
  assert.equal(d.args?.length, 5);
});

test("bidState", () => {
  const clearing = 100n;
  const s = (maxPrice: bigint, o: Partial<Parameters<typeof bidState>[0]> = {}) =>
    bidState({ maxPrice, exitedBlock: 0n, claimed: false, clearing, ended: false, graduated: false, ...o });
  assert.equal(s(150n), "active");
  assert.equal(s(100n), "partial");
  assert.equal(s(90n), "outbid");
  assert.equal(s(150n, { ended: true }), "refundable");
  assert.equal(s(150n, { ended: true, graduated: true }), "filled");
  assert.equal(s(100n, { ended: true, graduated: true }), "partial");
  assert.equal(s(90n, { ended: true, graduated: true }), "refundable");
  assert.equal(s(150n, { exitedBlock: 5n }), "exited");
  assert.equal(s(150n, { exitedBlock: 5n, claimed: true }), "claimed");
});
