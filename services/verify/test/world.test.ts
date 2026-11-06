import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeRpSignatureMessage, signRequest } from "@worldcoin/idkit-server";
import { hashSignal as idkitHashSignal } from "@worldcoin/idkit-core/hashing";
import { bytesToHex, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { checkIdkitResult, hashSignal, hashToField, parseNullifier, ProofRejected, type IdkitResult } from "../src/world.ts";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EXPECTED = { action: "listingday-acme", environment: "staging", signal: WALLET, allowLegacyProofs: false } as const;

function v4Result(overrides: Partial<IdkitResult> = {}, item: Record<string, unknown> = {}): IdkitResult {
  return {
    protocol_version: "4.0",
    nonce: "0x00aa",
    action: "listingday-acme",
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        signal_hash: hashSignal(WALLET),
        nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        expires_at_min: 1_762_400_000,
        ...item,
      },
    ],
    ...overrides,
  };
}

function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof ProofRejected && err.code === code);
}

describe("hash_to_field / hashSignal", () => {
  // https://docs.world.org/world-id/idkit/signatures#test-vectors
  it("matches the documented hash_to_field vectors", () => {
    assert.equal(hashToField(new Uint8Array()), "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4");
    assert.equal(
      hashToField(new TextEncoder().encode("test_signal")),
      "0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed",
    );
    assert.equal(hashToField(Uint8Array.from([1, 2, 3])), "0x00f1885eda54b7a053318cd41e2093220dab15d65381b1157a3633a83bfd5c92");
    assert.equal(hashToField(new TextEncoder().encode("hello")), "0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea");
  });

  it("equals IDKit's hashSignal for a wallet signal (any casing) and for strings", () => {
    for (const s of [WALLET, WALLET.toLowerCase(), "user-123", "", "0x", "0xabc"]) {
      assert.equal(hashSignal(s), idkitHashSignal(s), s);
    }
    assert.equal(hashSignal(WALLET), hashSignal(WALLET.toLowerCase()));
  });
});

describe("RP signatures (@worldcoin/idkit-server)", () => {
  it("builds the documented 81-byte message for an action", () => {
    const nonce = Uint8Array.from(Buffer.from("008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd", "hex"));
    assert.equal(
      bytesToHex(computeRpSignatureMessage(nonce, 1700000000, 1700000300, "test-action")),
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a",
    );
  });

  it("reproduces the documented uniqueness signature vector (EIP-191 over the message)", async () => {
    const key = `0x${"ab".repeat(32)}` as Hex;
    const nonce = hashToField(Uint8Array.from({ length: 32 }, (_, i) => i));
    assert.equal(nonce, "0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd");
    const msg = computeRpSignatureMessage(Buffer.from(nonce.slice(2), "hex"), 1700000000, 1700000300, "test-action");
    const sig = await privateKeyToAccount(key).signMessage({ message: { raw: msg } });
    assert.equal(
      sig,
      "0x05594adb6c1495768a38d523d7d6ee6356b2c31231919198794ed022ade7d08f73753f83bd167067d99c9b969d28e9222315837c66af25867b041273a6d5056f1b",
    );
  });

  it("signRequest output recovers to the RP signing key for the listing action", async () => {
    const key = `0x${"cd".repeat(32)}` as Hex;
    const rp = signRequest({ signingKeyHex: key, action: "listingday-acme", ttl: 300 });
    assert.equal(rp.expiresAt - rp.createdAt, 300);
    const msg = computeRpSignatureMessage(Buffer.from(rp.nonce.slice(2), "hex"), rp.createdAt, rp.expiresAt, "listingday-acme");
    const recovered = await recoverMessageAddress({ message: { raw: msg }, signature: rp.sig as Hex });
    assert.equal(recovered, privateKeyToAccount(key).address);
  });
});

describe("parseNullifier", () => {
  it("accepts 0x-hex and decimal forms of the same number and canonicalises them", () => {
    const hex = "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
    const canonical = parseNullifier(hex);
    assert.equal(canonical, hex);
    assert.equal(parseNullifier(BigInt(hex).toString()), canonical);
    assert.equal(parseNullifier(hex.toUpperCase().replace("0X", "0x")), canonical);
    assert.equal(parseNullifier("0x10"), `0x${"0".repeat(62)}10`);
  });

  it("rejects junk, zero and values above 2^256", () => {
    for (const v of [undefined, 1, "", "0x", "0", "0x0", "nil_123", "12a", `0x${"f".repeat(65)}`, (1n << 256n).toString()]) {
      assert.equal(parseNullifier(v), undefined, String(v));
    }
  });
});

describe("checkIdkitResult", () => {
  it("accepts one v4 Proof of Human item whose signal is the wallet", () => {
    const item = checkIdkitResult(v4Result(), EXPECTED);
    assert.equal(item.identifier, "proof_of_human");
    assert.equal(item.nullifier, "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8");
  });

  it("accepts the decimal nullifier IDKit's v4 typings describe", () => {
    const dec = BigInt("0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8").toString();
    assert.equal(checkIdkitResult(v4Result({}, { nullifier: dec }), EXPECTED).nullifier, parseNullifier(dec));
  });

  it("rejects the wrong environment or action", () => {
    rejects(() => checkIdkitResult(v4Result({ environment: "production" }), EXPECTED), "environment_mismatch");
    rejects(() => checkIdkitResult(v4Result({ action: "listingday-other" }), EXPECTED), "action_mismatch");
  });

  it("rejects a proof bound to another signal", () => {
    rejects(
      () => checkIdkitResult(v4Result({}, { signal_hash: hashSignal("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC") }), EXPECTED),
      "signal_mismatch",
    );
    rejects(() => checkIdkitResult(v4Result({}, { signal_hash: undefined }), EXPECTED), "signal_mismatch");
  });

  it("accepts only Proof of Human: no other credentials, sessions or extra items", () => {
    rejects(() => checkIdkitResult(v4Result({}, { identifier: "selfie", issuer_schema_id: 11 }), EXPECTED), "unsupported_proof");
    rejects(() => checkIdkitResult(v4Result({}, { identifier: "passport", issuer_schema_id: 9303 }), EXPECTED), "unsupported_proof");
    rejects(() => checkIdkitResult(v4Result({}, { issuer_schema_id: 9303 }), EXPECTED), "unsupported_proof");
    rejects(() => checkIdkitResult(v4Result({ session_id: "session_x" }), EXPECTED), "unsupported_proof");
    const two = v4Result();
    two.responses = [...(two.responses as unknown[]), ...(two.responses as unknown[])];
    rejects(() => checkIdkitResult(two, EXPECTED), "unsupported_proof");
    rejects(() => checkIdkitResult(v4Result({ responses: [] }), EXPECTED), "unsupported_proof");
    rejects(() => checkIdkitResult(v4Result({}, { nullifier: "nope" }), EXPECTED), "unsupported_proof");
  });

  it("rejects legacy 3.0 proofs unless WORLD_ALLOW_LEGACY_PROOFS is on, then only Orb", () => {
    const v3 = (identifier: string): IdkitResult => ({
      protocol_version: "3.0",
      nonce: "0x00aa",
      action: "listingday-acme",
      environment: "staging",
      responses: [{ identifier, signal_hash: hashSignal(WALLET), proof: "0x1", merkle_root: "0x2", nullifier: "0x1234" }],
    });
    rejects(() => checkIdkitResult(v3("orb"), EXPECTED), "unsupported_proof");
    const legacy = { ...EXPECTED, allowLegacyProofs: true };
    assert.equal(checkIdkitResult(v3("orb"), legacy).nullifier, parseNullifier("0x1234"));
    rejects(() => checkIdkitResult(v3("device"), legacy), "unsupported_proof");
  });
});
