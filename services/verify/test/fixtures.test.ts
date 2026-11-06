import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { recoverTypedDataAddress, type Hex } from "viem";

import { computeCases, FIXTURE_PATH } from "../scripts/gen-fixtures.ts";
import { passDomain, PASS_TYPES } from "../src/pass.ts";

describe("EIP-712 pass vectors (fixtures/pass-vectors.json)", () => {
  it("are what the backend signer produces today (run `npm run fixtures` after an intentional change)", async () => {
    const pinned = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    assert.deepEqual(pinned, JSON.parse(JSON.stringify(await computeCases())));
  });

  it("each signature recovers to the fixture signer over the WorldPassModule domain", async () => {
    const { signer, cases } = await computeCases();
    for (const c of cases) {
      const recovered = await recoverTypedDataAddress({
        domain: passDomain({ chainId: c.chainId, module: c.module }),
        types: PASS_TYPES,
        primaryType: "EligibilityPass",
        message: { ...c.pass, cap: BigInt(c.pass.cap), expiry: BigInt(c.pass.expiry) },
        signature: c.signature as Hex,
      });
      assert.equal(recovered, signer, c.name);
    }
  });
});
