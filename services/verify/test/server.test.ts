import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import { computeRpSignatureMessage } from "@worldcoin/idkit-server";
import { decodeAbiParameters, recoverMessageAddress, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { parseListings, type Config } from "../src/config.ts";
import { passDomain, PASS_TYPES, type EligibilityPass } from "../src/pass.ts";
import { createVerifyServer } from "../src/server.ts";
import { BindingStore } from "../src/store.ts";
import { hashSignal } from "../src/world.ts";

const NOW = 1_762_400_000;
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const AUCTION = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const MODULE = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const HUMAN_1 = "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
const HUMAN_2 = "0x0e81a8a8b3d2e4c1f7a7f0e9f4b4cbbd1c5a1d6c7e2f3a4b5c6d7e8f9a0b1c2d";
const RP_KEY = generatePrivateKey();
const PASS_KEY = generatePrivateKey();

type WorldCall = { path: string; body: Record<string, unknown> };
type WorldReply = (body: Record<string, unknown>) => { status: number; body?: unknown } | "hangup";

/** Stand-in for `POST https://developer.world.org/api/v4/verify/{rp_id}`; never the real endpoint in tests. */
async function startMockWorld() {
  const calls: WorldCall[] = [];
  let reply: WorldReply = (body) => ({
    status: 200,
    body: {
      success: true,
      action: body.action,
      nullifier: (body.responses as { nullifier: string }[])[0].nullifier,
      environment: body.environment,
      created_at: "2026-11-06T12:00:00.000Z",
      results: [{ identifier: "proof_of_human", success: true, nullifier: (body.responses as { nullifier: string }[])[0].nullifier }],
    },
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ path: `${req.method} ${req.url}`, body });
    const r = reply(body);
    if (r === "hangup") return req.socket.destroy();
    res.statusCode = r.status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(r.body ?? {}));
  });
  await listen(server);
  return {
    url: base(server),
    calls,
    setReply: (r: WorldReply) => {
      reply = r;
    },
    close: () => close(server),
  };
}

function listen(server: Server) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}
function close(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
function base(server: Server) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function testConfig(worldUrl: string, overrides: Partial<Config["world"]> = {}): Config {
  return {
    host: "127.0.0.1",
    port: 0,
    corsOrigin: "*",
    world: {
      appId: "app_staging_test",
      rpId: "rp_test",
      rpSigningKey: RP_KEY,
      environment: "staging",
      verifyBaseUrl: worldUrl,
      allowLegacyProofs: false,
      rpRequestTtlSeconds: 300,
      ...overrides,
    },
    passSignerKey: PASS_KEY,
    passTtlSeconds: 600,
    dbPath: ":memory:",
    listings: parseListings(JSON.stringify([{ ticker: "acme", chainId: 11155111, auction: AUCTION, module: MODULE, cap: "20000000" }])),
  };
}

async function startVerify(worldUrl: string, opts: { store?: BindingStore; world?: Partial<Config["world"]> } = {}) {
  const clock = { t: NOW };
  const store = opts.store ?? new BindingStore(":memory:");
  const server = createVerifyServer({ config: testConfig(worldUrl, opts.world), store, now: () => clock.t });
  await listen(server);
  return { url: base(server), clock, store, close: () => close(server) };
}

async function post(url: string, path: string, body: unknown) {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** What IDKit returns after a staging Proof of Human for `signal` (the simulator's shape, protocol 4.0). */
function idkitResult(rp: Record<string, any>, nullifier: string, signal: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0",
    nonce: rp.rp_context.nonce,
    action: rp.action,
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(signal),
        proof: ["0x11", "0x22", "0x33", "0x44", "0x55"],
        nullifier,
        issuer_schema_id: 1,
        expires_at_min: NOW + 3600,
      },
    ],
    ...overrides,
  };
}

/** request -> IDKit (mocked) -> verify, as the frontend does it. */
async function verifyAs(url: string, wallet: string, nullifier: string, mutate?: (r: Record<string, any>) => void) {
  const rp = await post(url, "/v1/idkit/request", { ticker: "acme", wallet });
  assert.equal(rp.status, 200);
  const result = idkitResult(rp.body, nullifier, rp.body.signal);
  mutate?.(result);
  return post(url, "/v1/idkit/verify", { ticker: "acme", wallet, idkitResponse: result });
}

describe("verify backend", () => {
  let world: Awaited<ReturnType<typeof startMockWorld>>;
  let api: Awaited<ReturnType<typeof startVerify>>;

  beforeEach(async () => {
    world = await startMockWorld();
    api = await startVerify(world.url);
  });
  afterEach(async () => {
    await api.close();
    await world.close();
  });

  it("POST /v1/idkit/request returns an RP-signed IDKit request for action listingday-<ticker>, signal = wallet", async () => {
    const { status, body } = await post(api.url, "/v1/idkit/request", { ticker: "ACME", wallet: ALICE.toLowerCase() });
    assert.equal(status, 200);
    assert.equal(body.app_id, "app_staging_test");
    assert.equal(body.action, "listingday-acme");
    assert.equal(body.environment, "staging");
    assert.equal(body.allow_legacy_proofs, false);
    assert.equal(body.signal, ALICE);
    assert.deepEqual(body.preset, { type: "ProofOfHuman", signal: ALICE });
    const rp = body.rp_context;
    assert.equal(rp.rp_id, "rp_test");
    assert.match(rp.nonce, /^0x00[0-9a-f]{62}$/);
    assert.equal(rp.expires_at - rp.created_at, 300);
    const msg = computeRpSignatureMessage(Buffer.from(rp.nonce.slice(2), "hex"), rp.created_at, rp.expires_at, "listingday-acme");
    assert.equal(await recoverMessageAddress({ message: { raw: msg }, signature: rp.signature }), privateKeyToAccount(RP_KEY).address);
    assert.equal(world.calls.length, 0);
  });

  it("verifies through World and returns a signed EligibilityPass + hookData for submitBid", async () => {
    const { status, body } = await verifyAs(api.url, ALICE, HUMAN_1);
    assert.equal(status, 200, JSON.stringify(body));

    assert.equal(world.calls.length, 1);
    assert.equal(world.calls[0].path, "POST /api/v4/verify/rp_test");
    assert.equal(world.calls[0].body.environment, "staging");
    assert.equal(world.calls[0].body.protocol_version, "4.0");
    assert.deepEqual((world.calls[0].body.responses as unknown[]).length, 1, "IDKit result forwarded as-is");

    assert.deepEqual(body.pass, { nullifier: HUMAN_1, wallet: ALICE, auction: AUCTION, cap: "20000000", expiry: NOW + 600 });
    assert.equal(body.module, MODULE);
    assert.equal(body.chainId, 11155111);
    assert.equal(body.firstVerification, true);
    assert.equal(body.signer, privateKeyToAccount(PASS_KEY).address);
    const message = { ...body.pass, cap: BigInt(body.pass.cap), expiry: BigInt(body.pass.expiry) } as EligibilityPass;
    assert.ok(
      await verifyTypedData({
        address: body.signer,
        domain: passDomain({ chainId: 11155111, module: MODULE }),
        types: PASS_TYPES,
        primaryType: "EligibilityPass",
        message,
        signature: body.signature,
      }),
    );
    const [pass, sig] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "nullifier", type: "bytes32" },
            { name: "wallet", type: "address" },
            { name: "auction", type: "address" },
            { name: "cap", type: "uint128" },
            { name: "expiry", type: "uint64" },
          ],
        },
        { type: "bytes" },
      ],
      body.hookData as Hex,
    );
    assert.deepEqual(pass, message);
    assert.equal(sig, body.signature);
  });

  it("same person, second wallet: 409 nullifier_bound_to_other_wallet and no pass", async () => {
    assert.equal((await verifyAs(api.url, ALICE, HUMAN_1)).status, 200);
    const second = await verifyAs(api.url, BOB, HUMAN_1);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "nullifier_bound_to_other_wallet");
    assert.equal(second.body.hookData, undefined);
    assert.equal(second.body.pass, undefined);
    assert.equal(api.store.walletOf("listingday-acme", AUCTION, HUMAN_1), ALICE.toLowerCase());
  });

  it("the same nullifier in decimal or upper-case hex is still the same person (409)", async () => {
    assert.equal((await verifyAs(api.url, ALICE, BigInt(HUMAN_1).toString())).status, 200);
    const upper = await verifyAs(api.url, BOB, HUMAN_1.toUpperCase().replace("0X", "0x"));
    assert.equal(upper.status, 409);
    assert.equal(upper.body.error, "nullifier_bound_to_other_wallet");
  });

  it("same person, same wallet again (pass expired): a fresh pass", async () => {
    const first = await verifyAs(api.url, ALICE, HUMAN_1);
    api.clock.t += 900;
    const again = await verifyAs(api.url, ALICE, HUMAN_1);
    assert.equal(again.status, 200);
    assert.equal(again.body.firstVerification, false);
    assert.equal(again.body.pass.expiry, NOW + 900 + 600);
    assert.notEqual(again.body.signature, first.body.signature);
  });

  it("another person, an already verified wallet: 409 wallet_bound_to_other_human", async () => {
    assert.equal((await verifyAs(api.url, ALICE, HUMAN_1)).status, 200);
    const res = await verifyAs(api.url, ALICE, HUMAN_2);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "wallet_bound_to_other_human");
  });

  it("World rejects the proof: 400 world_verification_failed with World's code, nothing stored", async () => {
    world.setReply(() => ({
      status: 400,
      body: { success: false, code: "all_verifications_failed", detail: "All proof verifications failed." },
    }));
    const res = await verifyAs(api.url, ALICE, HUMAN_1);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "world_verification_failed");
    assert.equal(res.body.world_code, "all_verifications_failed");
    assert.equal(api.store.walletOf("listingday-acme", AUCTION, HUMAN_1), undefined);
  });

  it("World says success: false or a failed result item: 400", async () => {
    world.setReply(() => ({ status: 200, body: { success: false, code: "x", detail: "y" } }));
    assert.equal((await verifyAs(api.url, ALICE, HUMAN_1)).body.error, "world_verification_failed");
    world.setReply((b) => ({
      status: 200,
      body: { success: true, environment: b.environment, results: [{ identifier: "proof_of_human", success: false }] },
    }));
    assert.equal((await verifyAs(api.url, ALICE, HUMAN_1)).body.error, "world_verification_failed");
  });

  it("World verified another nullifier than the one in the result: 400", async () => {
    world.setReply((b) => ({ status: 200, body: { success: true, environment: b.environment, nullifier: HUMAN_2 } }));
    const res = await verifyAs(api.url, ALICE, HUMAN_1);
    assert.equal(res.body.error, "world_verification_failed");
  });

  it("World verified it for another environment: 400 environment_mismatch", async () => {
    world.setReply(() => ({ status: 200, body: { success: true, environment: "production" } }));
    const res = await verifyAs(api.url, ALICE, HUMAN_1);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "environment_mismatch");
  });

  it("World is down or 5xx: 502 world_unavailable, and the same request can be retried", async () => {
    world.setReply(() => ({ status: 503, body: {} }));
    const rp = await post(api.url, "/v1/idkit/request", { ticker: "acme", wallet: ALICE });
    const result = idkitResult(rp.body, HUMAN_1, ALICE);
    const down = await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE, idkitResponse: result });
    assert.equal(down.status, 502);
    assert.equal(down.body.error, "world_unavailable");
    world.setReply(() => "hangup");
    assert.equal((await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE, idkitResponse: result })).status, 502);

    world.setReply((b) => ({ status: 200, body: { success: true, environment: b.environment } }));
    assert.equal((await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE, idkitResponse: result })).status, 200);
  });

  it("checks the IDKit result before calling World (environment, signal, credential)", async () => {
    const cases: [string, (r: Record<string, any>) => void][] = [
      ["environment_mismatch", (r) => (r.environment = "production")],
      ["action_mismatch", (r) => (r.action = "listingday-other")],
      ["signal_mismatch", (r) => (r.responses[0].signal_hash = hashSignal(BOB))],
      ["unsupported_proof", (r) => Object.assign(r.responses[0], { identifier: "selfie", issuer_schema_id: 11 })],
      ["unsupported_proof", (r) => (r.protocol_version = "3.0")],
    ];
    for (const [code, mutate] of cases) {
      const res = await verifyAs(api.url, ALICE, HUMAN_1, mutate);
      assert.equal(res.status, 400, code);
      assert.equal(res.body.error, code);
    }
    assert.equal(world.calls.length, 0, "World is never called for a result we already reject");
  });

  it("the proof must answer an open request for this wallet: unknown, other wallet, expired, replayed", async () => {
    const rp = await post(api.url, "/v1/idkit/request", { ticker: "acme", wallet: ALICE });
    const forAlice = idkitResult(rp.body, HUMAN_1, ALICE);

    const unknown = await post(api.url, "/v1/idkit/verify", {
      ticker: "acme",
      wallet: ALICE,
      idkitResponse: { ...forAlice, nonce: "0x00deadbeef" },
    });
    assert.equal(unknown.body.error, "unknown_request");

    const otherWallet = await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: BOB, idkitResponse: forAlice });
    assert.equal(otherWallet.body.error, "unknown_request");

    const ok = await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE, idkitResponse: forAlice });
    assert.equal(ok.status, 200);
    const replay = await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE, idkitResponse: forAlice });
    assert.equal(replay.body.error, "unknown_request");

    const late = await post(api.url, "/v1/idkit/request", { ticker: "acme", wallet: ALICE });
    api.clock.t += 301;
    const expired = await post(api.url, "/v1/idkit/verify", {
      ticker: "acme",
      wallet: ALICE,
      idkitResponse: idkitResult(late.body, HUMAN_1, ALICE),
    });
    assert.equal(expired.body.error, "unknown_request");
    assert.equal(world.calls.length, 1);
  });

  it("input errors: unknown listing 404, bad wallet / body 400, unknown route 404, wrong method 405", async () => {
    assert.equal((await post(api.url, "/v1/idkit/request", { ticker: "zzz", wallet: ALICE })).status, 404);
    assert.equal((await post(api.url, "/v1/idkit/request", { ticker: "zzz", wallet: ALICE })).body.error, "unknown_listing");
    assert.equal((await post(api.url, "/v1/idkit/request", { ticker: "acme", wallet: "0x1234" })).body.error, "invalid_request");
    assert.equal((await post(api.url, "/v1/idkit/request", "{nope")).body.error, "invalid_json");
    assert.equal((await post(api.url, "/v1/idkit/verify", { ticker: "acme", wallet: ALICE })).body.error, "invalid_request");
    assert.equal((await fetch(`${api.url}/nope`)).status, 404);
    assert.equal((await fetch(`${api.url}/v1/idkit/request`)).status, 405);
    assert.equal((await post(api.url, "/v1/idkit/request", { ticker: "acme", wallet: ALICE, pad: "x".repeat(70_000) })).status, 413);
  });

  it("GET /health and /v1/listings/:ticker expose the public config the frontend needs", async () => {
    const health = await (await fetch(`${api.url}/health`)).json();
    assert.deepEqual(health, { ok: true, environment: "staging", passSigner: privateKeyToAccount(PASS_KEY).address, listings: ["acme"] });
    const res = await fetch(`${api.url}/v1/listings/acme`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const l = (await res.json()) as Record<string, any>;
    assert.equal(l.action, "listingday-acme");
    assert.equal(l.auction, AUCTION);
    assert.equal(l.module, MODULE);
    assert.equal(l.cap, "20000000");
    assert.equal(l.world.app_id, "app_staging_test");
    assert.equal(l.world.environment, "staging");
    assert.equal(l.eip712.domain.name, "ListingDay WorldPass");
    assert.equal(JSON.stringify(l).includes(RP_KEY.slice(2)), false, "no secret in public config");
    assert.equal(JSON.stringify(l).includes(PASS_KEY.slice(2)), false, "no secret in public config");
    assert.equal(((await (await fetch(`${api.url}/v1/listings`)).json()) as any).listings.length, 1);
  });
});

describe("binding store", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-store-"));
  after(() => {});

  it("persists across restarts: a second wallet is still refused", async () => {
    const world = await startMockWorld();
    const dbPath = join(dir, "verify.sqlite");
    let api = await startVerify(world.url, { store: new BindingStore(dbPath) });
    assert.equal((await verifyAs(api.url, ALICE, HUMAN_1)).status, 200);
    await api.close();
    api.store.close();

    api = await startVerify(world.url, { store: new BindingStore(dbPath) });
    const res = await verifyAs(api.url, BOB, HUMAN_1);
    assert.equal(res.status, 409);
    await api.close();
    api.store.close();
    await world.close();
  });

  it("stores exactly (action, auction, nullifier, wallet) with both UNIQUE constraints", () => {
    const dbPath = join(dir, "schema.sqlite");
    new BindingStore(dbPath).close();
    const db = new DatabaseSync(dbPath);
    const cols = (db.prepare("PRAGMA table_info(bindings)").all() as { name: string }[]).map((c) => c.name);
    assert.deepEqual(cols, ["action", "auction", "nullifier", "wallet"]);
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'bindings'").get() as { sql: string }).sql;
    assert.match(sql, /UNIQUE \(action, auction, nullifier\)/);
    assert.match(sql, /UNIQUE \(action, auction, wallet\)/);
    db.close();
  });

  it("bindings are per auction: a relaunched listing starts fresh", () => {
    const s = new BindingStore(":memory:");
    assert.deepEqual(s.bind("listingday-acme", AUCTION, HUMAN_1, ALICE), { ok: true, created: true });
    assert.deepEqual(s.bind("listingday-acme", AUCTION, HUMAN_1, ALICE), { ok: true, created: false });
    assert.deepEqual(s.bind("listingday-acme", AUCTION, HUMAN_1, BOB), { ok: false, conflict: "nullifier_bound_to_other_wallet" });
    assert.deepEqual(s.bind("listingday-acme", MODULE, HUMAN_1, BOB), { ok: true, created: true });
    s.close();
  });
});
