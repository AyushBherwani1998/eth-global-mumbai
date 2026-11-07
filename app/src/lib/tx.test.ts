// The write path against a mock wallet and a mock exchange server. Nothing
// here signs or broadcasts: the "wallet" records requests and returns hashes,
// and receipts are scripted.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prepared, PreparedStep } from "./api";
import { createLock, isUserRejection, pollReceipt, runPrepared, type Eip1193, type Hex, type Receipt, type WalletSigner } from "./tx.ts";

const SEPOLIA = 11155111;
const ME = "0xD6014C0D0c9E3A1F9b6E3a3A6c5d1e2F3a4B5c6D";
const ME_LOWER = ME.toLowerCase() as Hex;
const OTHER = "0x1111111111111111111111111111111111111111";
const USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Hex;
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as Hex;
const ROUTER = "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" as Hex;

const step = (kind: PreparedStep["kind"], needed: boolean, to: Hex, value = "0"): PreparedStep => ({
  kind,
  needed,
  to,
  data: `0x${kind.length.toString(16).padStart(8, "0")}` as Hex,
  value,
  description: kind,
});

function prepared(steps: PreparedStep[], over: Partial<Prepared> = {}): Prepared {
  const last = steps[steps.length - 1];
  return {
    to: last.to,
    data: last.data,
    value: last.value,
    ticker: "ACME",
    action: "swap",
    from: ME_LOWER,
    chainId: SEPOLIA,
    steps,
    permit2: null,
    simulate: { ok: true, method: steps.length > 1 ? "eth_simulateV1" : "eth_call", block: 1, error: null, gasUsed: null, note: null },
    details: {},
    ...over,
  };
}

type Sent = { to: string; data: string; value: string; from: string; chainId: string };

function mockWallet(opts: { chainId?: number; accounts?: string[]; reject?: (n: number) => unknown } = {}) {
  const sent: Sent[] = [];
  const state = { chainId: opts.chainId ?? SEPOLIA, accounts: opts.accounts ?? [ME] };
  const provider: Eip1193 = {
    async request({ method, params }) {
      if (method === "eth_chainId") return `0x${state.chainId.toString(16)}`;
      if (method === "eth_accounts") return state.accounts;
      if (method === "eth_sendTransaction") {
        const err = opts.reject?.(sent.length);
        if (err) throw err;
        sent.push((params as Sent[])[0]);
        return `0x${String(sent.length).padStart(64, "0")}`;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const signer: WalletSigner = { address: ME, label: "Mock", provider: async () => provider };
  return { sent, state, provider, signer };
}

const confirmAll = async (): Promise<Receipt> => ({ status: "success", blockNumber: 10n, transactionHash: "0x" as Hex });
const noSleep = async () => {};

test("approvals go first, one at a time, each to a receipt; then prepare again and send the call", async () => {
  const w = mockWallet();
  const rounds = [
    prepared([step("approveUsdcToPermit2", true, USDC), step("permit2Approve", true, PERMIT2), step("swap", true, ROUTER)]),
    prepared([step("approveUsdcToPermit2", false, USDC), step("permit2Approve", false, PERMIT2), step("swap", true, ROUTER)]),
  ];
  let calls = 0;
  const receiptsFor: string[] = [];
  const r = await runPrepared({
    prepare: async () => rounds[Math.min(calls++, rounds.length - 1)],
    signer: w.signer,
    chainId: SEPOLIA,
    sleep: noSleep,
    waitForReceipt: async (_p, h) => (receiptsFor.push(h), confirmAll()),
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(w.sent.map((s) => s.to), [USDC, PERMIT2, ROUTER]);
  assert.equal(receiptsFor.length, 3, "every send waited for its receipt before the next");
  assert.ok(w.sent.every((s) => s.from === ME_LOWER && s.chainId === "0xaa36a7"));
  assert.deepEqual(r.steps.map((s) => s.status), ["confirmed", "confirmed", "confirmed"]);
});

test("a step is not sent until the previous receipt is in", async () => {
  const w = mockWallet();
  let releaseFirst!: () => void;
  const gate = new Promise<void>((res) => (releaseFirst = res));
  let calls = 0;
  const run = runPrepared({
    prepare: async () =>
      calls++ === 0
        ? prepared([step("approveUsdcToPermit2", true, USDC), step("permit2Approve", true, PERMIT2), step("swap", true, ROUTER)])
        : prepared([step("approveUsdcToPermit2", false, USDC), step("permit2Approve", false, PERMIT2), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    sleep: noSleep,
    waitForReceipt: async () => {
      if (w.sent.length === 1) await gate;
      return confirmAll();
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(w.sent.length, 1, "second approval waits on the first receipt");
  releaseFirst();
  const r = await run;
  assert.equal(r.ok, true);
  assert.equal(w.sent.length, 3);
});

test("value is sent as hex wei", async () => {
  const w = mockWallet();
  const r = await runPrepared({
    prepare: async () => prepared([step("swap", true, ROUTER, "1000000000000000")]),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, true);
  assert.equal(w.sent[0].value, "0x38d7ea4c68000");
});

test("a failed simulation sends nothing and returns the decoded error", async () => {
  const w = mockWallet();
  const error = { name: "OutOfBand", selector: "0x12345678" as Hex, args: {}, message: "That trade would move the price outside today's band.", wrappers: [], data: null };
  const r = await runPrepared({
    prepare: async () => prepared([step("approveUsdcToPermit2", true, USDC), step("swap", true, ROUTER)], { simulate: { ok: false, method: "eth_simulateV1", block: 1, error, gasUsed: null, note: null } }),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, false);
  assert.equal(w.sent.length, 0, "no approval either");
  if (!r.ok) {
    assert.equal(r.reason, "simulation");
    assert.equal(r.error?.name, "OutOfBand");
    assert.equal(r.message, error.message);
  }
});

test("a re-prepare that now fails simulation (price moved past minOut) stops before the swap", async () => {
  const w = mockWallet();
  let calls = 0;
  const error = { name: "V4TooLittleReceived", selector: null, args: {}, message: "The price moved past your slippage limit.", wrappers: [], data: null };
  const r = await runPrepared({
    prepare: async () =>
      calls++ === 0
        ? prepared([step("approveUsdcToPermit2", true, USDC), step("swap", true, ROUTER)])
        : prepared([step("approveUsdcToPermit2", false, USDC), step("swap", true, ROUTER)], { simulate: { ok: false, method: "eth_call", block: 2, error, gasUsed: null, note: null } }),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(w.sent.map((s) => s.to), [USDC]);
  if (!r.ok) {
    assert.equal(r.reason, "simulation");
    assert.deepEqual(r.steps.map((s) => s.status), ["confirmed"], "the approval stays confirmed; nothing is rolled back");
  }
});

test("wallet rejection (4001) stops the run with nothing further sent", async () => {
  const w = mockWallet({ reject: (n) => (n === 1 ? { code: 4001, message: "User rejected the request." } : null) });
  const r = await runPrepared({
    prepare: async () => prepared([step("approveUsdcToPermit2", true, USDC), step("permit2Approve", true, PERMIT2), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "rejected");
    assert.deepEqual(r.steps.map((s) => s.status), ["confirmed", "rejected"]);
  }
  assert.equal(w.sent.length, 1);
});

test("isUserRejection recognises Privy and injected wordings", () => {
  assert.ok(isUserRejection({ code: 4001 }));
  assert.ok(isUserRejection(new Error("User rejected the request.")));
  assert.ok(isUserRejection(new Error("user exited")));
  assert.ok(isUserRejection({ message: "wrapped", cause: { code: 4001 } }));
  assert.ok(!isUserRejection(new Error("insufficient funds for gas")));
});

test("reverted receipt is a failure with the hash, and the next step is not sent", async () => {
  const w = mockWallet();
  const r = await runPrepared({
    prepare: async () => prepared([step("approveUsdcToPermit2", true, USDC), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: async () => ({ status: "reverted", blockNumber: 3n, transactionHash: "0x" as Hex }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "reverted");
    assert.ok(r.tx?.startsWith("0x"));
  }
  assert.equal(w.sent.length, 1);
});

test("no receipt in time is reported as sent-not-confirmed, never success", async () => {
  const w = mockWallet();
  const r = await runPrepared({
    prepare: async () => prepared([step("claimTokens", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: async () => null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "timeout");
    assert.ok(r.tx);
  }
});

test("wrong chain: refuses before sending", async () => {
  const w = mockWallet({ chainId: 1 });
  const r = await runPrepared({ prepare: async () => prepared([step("swap", true, ROUTER)]), signer: w.signer, chainId: SEPOLIA, waitForReceipt: confirmAll });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "wrongChain");
  assert.equal(w.sent.length, 0);
});

test("server prepared for another chain: refuses", async () => {
  const w = mockWallet();
  const r = await runPrepared({ prepare: async () => prepared([step("swap", true, ROUTER)], { chainId: 1 }), signer: w.signer, chainId: SEPOLIA, waitForReceipt: confirmAll });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "wrongChain");
  assert.equal(w.sent.length, 0);
});

test("account switched in the wallet mid-flow: stops before the next send", async () => {
  const w = mockWallet();
  let calls = 0;
  const r = await runPrepared({
    prepare: async () =>
      calls++ === 0
        ? prepared([step("approveUsdcToPermit2", true, USDC), step("swap", true, ROUTER)])
        : prepared([step("approveUsdcToPermit2", false, USDC), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    waitForReceipt: async () => {
      w.state.accounts = [OTHER];
      return confirmAll();
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "wrongAccount");
  assert.equal(w.sent.length, 1);
});

test("server prepared for a different address: refuses", async () => {
  const w = mockWallet();
  const r = await runPrepared({ prepare: async () => prepared([step("swap", true, ROUTER)], { from: OTHER as Hex }), signer: w.signer, chainId: SEPOLIA, waitForReceipt: confirmAll });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "wrongAccount");
});

test("a server that cannot produce sendable calldata never reaches the wallet", async () => {
  const w = mockWallet();
  const stub = await runPrepared({ prepare: async () => prepared([step("swap", true, ROUTER)], { details: { stub: true } }), signer: w.signer, chainId: SEPOLIA, waitForReceipt: confirmAll });
  assert.equal(stub.ok, false);
  if (!stub.ok) assert.equal(stub.reason, "notLive");
  let prepared_ = 0;
  const demo = await runPrepared({ prepare: async () => (prepared_++, prepared([step("swap", true, ROUTER)])), signer: w.signer, chainId: SEPOLIA, notLive: true });
  assert.equal(demo.ok, false);
  assert.equal(prepared_, 0);
  assert.equal(w.sent.length, 0);
});

test("no signer: refuses without preparing", async () => {
  let n = 0;
  const r = await runPrepared({ prepare: async () => (n++, prepared([step("swap", true, ROUTER)])), signer: null, chainId: SEPOLIA });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "noSigner");
  assert.equal(n, 0);
});

test("approval confirmed but the server's node lags a block: wait and prepare again, don't re-send", async () => {
  const w = mockWallet();
  let calls = 0;
  let slept = 0;
  const r = await runPrepared({
    prepare: async () =>
      calls++ < 2
        ? prepared([step("approveTokenToPermit2", true, USDC), step("swap", true, ROUTER)])
        : prepared([step("approveTokenToPermit2", false, USDC), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    sleep: async () => void slept++,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, true);
  assert.equal(slept, 1);
  assert.deepEqual(w.sent.map((s) => s.to), [USDC, ROUTER]);
});

test("gives up after the round limit if the approval never shows", async () => {
  const w = mockWallet();
  const r = await runPrepared({
    prepare: async () => prepared([step("approveTokenToPermit2", true, USDC), step("swap", true, ROUTER)]),
    signer: w.signer,
    chainId: SEPOLIA,
    sleep: noSleep,
    maxRounds: 3,
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "notVisible");
  assert.equal(w.sent.length, 1);
});

test("guard refuses (nothing to claim) before any send", async () => {
  const w = mockWallet();
  const r = await runPrepared({
    prepare: async () => prepared([step("claimTokens", true, ROUTER)], { details: { warnings: ["nothing to claim"] } }),
    signer: w.signer,
    chainId: SEPOLIA,
    guard: (p) => ((p.details as { warnings?: string[] }).warnings?.length ? "Nothing to collect." : null),
    waitForReceipt: confirmAll,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "refused");
    assert.equal(r.message, "Nothing to collect.");
  }
  assert.equal(w.sent.length, 0);
});

test("prepare failure carries the server's words", async () => {
  const w = mockWallet();
  const failure = Object.assign(new Error("x"), { sentence: "The app asked for something the exchange server could not read.", serverMessage: "amountRaw must be > 0" });
  const r = await runPrepared({ prepare: async () => Promise.reject(failure), signer: w.signer, chainId: SEPOLIA });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "api");
    assert.match(r.message, /amountRaw must be > 0/);
  }
});

test("pollReceipt: waits for a mined receipt and reads status", async () => {
  let n = 0;
  const reader: Eip1193 = {
    async request() {
      n += 1;
      return n < 3 ? null : { status: "0x0", blockNumber: "0x10", transactionHash: "0xab" };
    },
  };
  const r = await pollReceipt(reader, "0xab", { sleep: noSleep });
  assert.deepEqual(r, { status: "reverted", blockNumber: 16n, transactionHash: "0xab" });
  let t = 0;
  const never: Eip1193 = { request: async () => null };
  const timedOut = await pollReceipt(never, "0xab", { sleep: async () => void (t += 1000), now: () => t, timeoutMs: 3000 });
  assert.equal(timedOut, null);
});

test("createLock blocks double submits", () => {
  const lock = createLock();
  assert.equal(lock.tryAcquire(), true);
  assert.equal(lock.tryAcquire(), false);
  lock.release();
  assert.equal(lock.tryAcquire(), true);
});
