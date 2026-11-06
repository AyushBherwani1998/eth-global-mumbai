import { hexToBytes, keccak256, stringToBytes, toHex, type Hex } from "viem";

/**
 * World ID `hash_to_field`: keccak256(input) >> 8, as 32 bytes (always starts with 0x00).
 * https://docs.world.org/world-id/idkit/signatures (test vectors in test/world.test.ts).
 */
export function hashToField(input: Uint8Array): Hex {
  return toHex(BigInt(keccak256(input)) >> 8n, { size: 32 });
}

/**
 * Same as IDKit's `hashSignal` (`@worldcoin/idkit-core/hashing`): a 0x-hex signal is hashed as bytes, anything
 * else as UTF-8. IDKit puts this in each response item's `signal_hash`; the proof commits to it.
 */
export function hashSignal(signal: string): Hex {
  const isHex = signal.startsWith("0x") && signal.length > 2 && signal.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(signal.slice(2));
  return hashToField(isHex ? hexToBytes(signal as Hex) : stringToBytes(signal));
}

/**
 * World returns nullifiers as 256-bit integers in 0x-hex (docs) or decimal (IDKit's v4 typings) strings. Parse as a
 * number and store one canonical form (bytes32, lowercase) so casing or padding can't create a second identity.
 */
export function parseNullifier(value: unknown): Hex | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return undefined;
  let n: bigint;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) n = BigInt(value);
  else if (/^[0-9]{1,78}$/.test(value)) n = BigInt(value);
  else return undefined;
  if (n === 0n || n >= 1n << 256n) return undefined;
  return toHex(n, { size: 32 });
}

export type WorldEnvironment = "production" | "staging";

/** The parts of an IDKit result (`IDKitResult`) this backend checks; the full object is forwarded as-is. */
export type IdkitResult = {
  protocol_version?: unknown;
  nonce?: unknown;
  action?: unknown;
  environment?: unknown;
  session_id?: unknown;
  responses?: unknown;
  [key: string]: unknown;
};

export type ProofItem = {
  identifier: string;
  nullifier: Hex;
  signalHash: Hex;
};

export class ProofRejected extends Error {
  readonly code: string;
  /** World's own error `code` (for example `all_verifications_failed`), when World rejected the proof. */
  readonly worldCode?: string;
  constructor(code: string, message: string, worldCode?: string) {
    super(message);
    this.code = code;
    this.worldCode = worldCode;
  }
}

const V4_PROOF_OF_HUMAN = { identifier: "proof_of_human", issuerSchemaId: 1 };
/** Legacy (World ID 3.0) Orb proofs, only with `allowLegacyProofs`. */
const V3_PROOF_OF_HUMAN_IDENTIFIERS = new Set(["orb", "proof_of_human"]);

export type ExpectedProof = {
  action: string;
  environment: WorldEnvironment;
  signal: string;
  allowLegacyProofs: boolean;
};

/**
 * Checks the IDKit result before it is forwarded: environment, action, a single Proof of Human uniqueness item
 * (no sessions, no other credentials) whose `signal_hash` commits to the expected wallet. Returns that item.
 */
export function checkIdkitResult(result: IdkitResult, expected: ExpectedProof): ProofItem {
  if (result.environment !== expected.environment) {
    throw new ProofRejected("environment_mismatch", `expected environment "${expected.environment}"`);
  }
  if (result.action !== expected.action) {
    throw new ProofRejected("action_mismatch", `expected action "${expected.action}"`);
  }
  if (result.session_id !== undefined) throw new ProofRejected("unsupported_proof", "session proofs are not accepted");
  const v4 = result.protocol_version === "4.0";
  const v3 = result.protocol_version === "3.0";
  if (!v4 && !(v3 && expected.allowLegacyProofs)) {
    throw new ProofRejected(
      "unsupported_proof",
      expected.allowLegacyProofs ? "protocol_version must be 4.0 or 3.0" : "protocol_version must be 4.0",
    );
  }
  if (!Array.isArray(result.responses) || result.responses.length !== 1) {
    throw new ProofRejected("unsupported_proof", "expected exactly one Proof of Human response");
  }
  const item = result.responses[0] as Record<string, unknown>;
  const identifier = typeof item?.identifier === "string" ? item.identifier : "";
  const isPoh = v4
    ? identifier === V4_PROOF_OF_HUMAN.identifier && item.issuer_schema_id === V4_PROOF_OF_HUMAN.issuerSchemaId
    : V3_PROOF_OF_HUMAN_IDENTIFIERS.has(identifier);
  if (!isPoh) throw new ProofRejected("unsupported_proof", "only the Proof of Human credential is accepted");

  const nullifier = parseNullifier(item.nullifier);
  if (!nullifier) throw new ProofRejected("unsupported_proof", "missing or malformed nullifier");
  const want = hashSignal(expected.signal);
  if (typeof item.signal_hash !== "string" || parseNullifier(item.signal_hash) !== want) {
    throw new ProofRejected("signal_mismatch", "the proof's signal is not this wallet");
  }
  return { identifier, nullifier, signalHash: want };
}

export class WorldUnavailable extends Error {}

export type WorldVerifyOptions = {
  baseUrl: string;
  rpId: string;
  environment: WorldEnvironment;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * `POST {baseUrl}/api/v4/verify/{rp_id}` with the IDKit result forwarded as-is (plus the expected `environment`),
 * per https://docs.world.org/world-id/idkit/integrate step 5. Requires `success: true`, the expected environment,
 * and, where World echoes them, the same nullifier and action.
 */
export async function verifyWithWorld(
  result: IdkitResult,
  proof: ProofItem,
  action: string,
  options: WorldVerifyOptions,
): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/v4/verify/${encodeURIComponent(options.rpId)}`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...result, environment: options.environment }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new WorldUnavailable(`World verify request failed: ${(err as Error).message}`);
  }
  if (res.status >= 500) throw new WorldUnavailable(`World verify returned HTTP ${res.status}`);
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    if (res.ok) throw new WorldUnavailable("World verify returned a non-JSON body");
  }
  if (!res.ok || body.success !== true) {
    const code = typeof body.code === "string" ? body.code : `http_${res.status}`;
    throw new ProofRejected("world_verification_failed", `World rejected the proof (${code})`, code);
  }
  if (body.environment !== options.environment) {
    throw new ProofRejected("environment_mismatch", `World verified it for environment "${String(body.environment)}"`);
  }
  if (body.action !== undefined && body.action !== action) {
    throw new ProofRejected("action_mismatch", "World verified a different action");
  }
  const echoed = [body.nullifier, ...(Array.isArray(body.results) ? body.results.map((r) => (r as { nullifier?: unknown })?.nullifier) : [])];
  for (const n of echoed) {
    if (n !== undefined && parseNullifier(n) !== proof.nullifier) {
      throw new ProofRejected("world_verification_failed", "World verified a different nullifier");
    }
  }
  if (Array.isArray(body.results) && body.results.some((r) => (r as { success?: unknown })?.success === false)) {
    throw new ProofRejected("world_verification_failed", "World reported a failed proof");
  }
}
