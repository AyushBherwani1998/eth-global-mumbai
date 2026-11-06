// The write path, wallet-agnostic: prepare on the server, send each step from
// the user's wallet, wait for each receipt, prepare again, then send the call.
//
// services/api never signs. `POST /v1/prepare/*` returns the final call plus
// every approval it needs (`steps`, `needed: false` when already in place) and a
// simulation of the whole sequence. This file turns that into transactions:
//
//   1. prepare. Refuse anything that is not for this chain and this wallet.
//   2. If the simulation already says the call reverts, stop: say why, send nothing.
//   3. Send every needed approval, one at a time, each to a confirmed receipt.
//   4. Prepare again. Allowances (and, for a swap, the quote) are read fresh;
//      a swap keeps the minimum output the user accepted, so a moved price
//      fails the simulation instead of filling worse.
//   5. Send the final call and wait for its receipt. Success means status 1.
//
// Nothing here claims more than happened: a reverted or unconfirmed step is a
// failure with its hash, and steps already confirmed stay confirmed (there is no
// rollback and no atomicity across steps).
//
// The wallet is reached only through `WalletSigner` (components/wallet). No
// runtime imports, so this runs under `node --test` with mocks.

import type { DecodedError, Prepared, PreparedStep } from "./api";

export type Hex = `0x${string}`;

/** The EIP-1193 surface this file uses. Privy's `getEthereumProvider()` and `window.ethereum` both satisfy it. */
export type Eip1193 = { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown> };

/**
 * One wallet that can sign for `address`. Built by the wallet layer from
 * Privy's `useWallets()` (or the injected wallet in the demo session).
 */
export type WalletSigner = {
  address: string;
  /** For copy: "MetaMask", "Your email wallet". */
  label: string;
  /** Switch the wallet to `chainId` when needed and return a provider bound to it. */
  provider(chainId: number): Promise<Eip1193>;
};

export type TxFailure =
  /** Nobody signed in, or this session has no wallet that can sign. */
  | "noSigner"
  /** The server is the fixture stub: its calls are placeholders and must never reach a wallet. */
  | "demoData"
  /** The wallet's account is not the signed-in address, or the server prepared for another one. */
  | "wrongAccount"
  | "wrongChain"
  /** The user declined in the wallet. */
  | "rejected"
  /** The server simulated the sequence and it reverts. `error` says why. */
  | "simulation"
  /** Mined with status 0. */
  | "reverted"
  /** Sent, but no receipt within the wait. It may still land. */
  | "timeout"
  /** Approvals confirmed but the server still reads them as missing. */
  | "notVisible"
  /** The caller's own check refused the prepared call (e.g. nothing to claim). */
  | "refused"
  /** Another transaction from this app is still waiting on the wallet. */
  | "busy"
  | "api"
  | "wallet";

export type StepKind = PreparedStep["kind"];

export type StepRecord = {
  kind: StepKind;
  description: string;
  tx: Hex | null;
  status: "confirmed" | "reverted" | "rejected" | "failed" | "timeout";
};

export type TxResult<D = Record<string, unknown>> =
  | { ok: true; tx: Hex; blockNumber: bigint; steps: StepRecord[]; prepared: Prepared<D> }
  | { ok: false; reason: TxFailure; message: string; error: DecodedError | null; tx: Hex | null; steps: StepRecord[] };

export type TxProgress =
  | { phase: "preparing"; round: number }
  | { phase: "wallet"; step: PreparedStep; index: number; total: number }
  | { phase: "confirming"; step: PreparedStep; tx: Hex; index: number; total: number };

export type Receipt = { status: "success" | "reverted"; blockNumber: bigint; transactionHash: Hex };

export type RunOptions<D = Record<string, unknown>> = {
  prepare: () => Promise<Prepared<D>>;
  signer: WalletSigner | null;
  chainId: number;
  /** True while the API reports fixtures (`/health` rpc `stub://`). */
  demoData?: boolean;
  /** Return a sentence to refuse the final call (approvals are never sent if the first prepare is refused). */
  guard?: (p: Prepared<D>) => string | null;
  onProgress?: (p: TxProgress) => void;
  /** Receipt source; defaults to polling the wallet's own provider. */
  waitForReceipt?: (provider: Eip1193, hash: Hex) => Promise<Receipt | null>;
  sleep?: (ms: number) => Promise<void>;
  /** Prepare calls allowed in one run (approval rounds plus read-lag retries). */
  maxRounds?: number;
  /** Wait between prepares when a confirmed approval is not visible to the server yet. */
  lagRetryMs?: number;
};

const MESSAGES: Record<TxFailure, string> = {
  noSigner: "Sign in with a wallet that can sign to do this. The demo accounts can look around but cannot send anything.",
  demoData: "This copy of the app is showing demo data, so nothing can be sent. Point it at the real exchange server to trade.",
  wrongAccount: "Your wallet is on a different account from the one you signed in with. Switch it back, or sign in again with that account.",
  wrongChain: "Your wallet is on another network. Switch it to Sepolia and try again.",
  rejected: "You declined in your wallet, so nothing was sent.",
  simulation: "The exchange checked this and it would be rejected, so nothing was sent.",
  reverted: "The network rejected this transaction. Nothing changed except the network fee.",
  timeout: "Sent, but not confirmed yet. Check the receipt link before trying again.",
  notVisible: "Your approval is confirmed, but the exchange can't see it yet. Wait a few seconds and try again.",
  refused: "There is nothing to send.",
  busy: "Another transaction is still waiting on your wallet. Finish or decline that one first.",
  api: "We couldn't prepare this with the exchange server. Try again.",
  wallet: "Your wallet couldn't send this. Open it, check it is unlocked, and try again.",
};

export function failureMessage(reason: TxFailure): string {
  return MESSAGES[reason];
}

/** EIP-1193 4001 / Privy and wallet wordings for "the user said no". */
export function isUserRejection(e: unknown): boolean {
  const any = e as { code?: unknown; message?: unknown; cause?: unknown } | null;
  if (!any || typeof any !== "object") return false;
  if (any.code === 4001 || any.code === "ACTION_REJECTED") return true;
  const msg = typeof any.message === "string" ? any.message : "";
  if (/user (rejected|denied|cancel+ed|exited|closed)|rejected the request|request (was )?rejected|denied transaction|user abort/i.test(msg)) return true;
  return any.cause ? isUserRejection(any.cause) : false;
}

/** ApiFailure (lib/api.ts) carries UI copy in `sentence` and the server's own words in `serverMessage`. */
function errorSentence(e: unknown): string | null {
  const any = e as { sentence?: unknown; serverMessage?: unknown; message?: unknown } | null;
  if (any && typeof any === "object") {
    if (typeof any.sentence === "string") {
      return typeof any.serverMessage === "string" && any.serverMessage ? `${any.sentence} The server said: ${any.serverMessage}` : any.sentence;
    }
    if (typeof any.message === "string" && any.message) return any.message;
  }
  return null;
}

const toHex = (n: bigint | number) => `0x${BigInt(n).toString(16)}` as Hex;
const lower = (a: string) => a.toLowerCase();
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type RawReceipt = { status?: string | number; blockNumber?: string | number; transactionHash?: string } | null;

/** Poll `eth_getTransactionReceipt` until it lands or `timeoutMs` passes. Null on timeout. */
export async function pollReceipt(
  reader: Eip1193,
  hash: Hex,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<Receipt | null> {
  const interval = opts.intervalMs ?? 2_000;
  const timeout = opts.timeoutMs ?? 180_000;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const until = now() + timeout;
  for (;;) {
    let r: RawReceipt = null;
    try {
      r = (await reader.request({ method: "eth_getTransactionReceipt", params: [hash] })) as RawReceipt;
    } catch {
      r = null;
    }
    if (r && r.blockNumber !== undefined && r.blockNumber !== null) {
      const ok = r.status === "0x1" || r.status === 1 || r.status === "success";
      return { status: ok ? "success" : "reverted", blockNumber: BigInt(r.blockNumber), transactionHash: (r.transactionHash ?? hash) as Hex };
    }
    if (now() >= until) return null;
    await sleep(interval);
  }
}

/** One wallet transaction at a time across the whole app. */
export function createLock() {
  let held = false;
  return {
    get held() {
      return held;
    },
    tryAcquire(): boolean {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

export async function runPrepared<D = Record<string, unknown>>(o: RunOptions<D>): Promise<TxResult<D>> {
  const steps: StepRecord[] = [];
  const fail = (reason: TxFailure, extra: { message?: string; error?: DecodedError | null; tx?: Hex | null } = {}): TxResult<D> => ({
    ok: false,
    reason,
    message: extra.message ?? MESSAGES[reason],
    error: extra.error ?? null,
    tx: extra.tx ?? null,
    steps,
  });

  if (o.demoData) return fail("demoData");
  if (!o.signer) return fail("noSigner");
  const from = lower(o.signer.address);
  const sleep = o.sleep ?? defaultSleep;
  const wait = o.waitForReceipt ?? ((p: Eip1193, h: Hex) => pollReceipt(p, h, { sleep }));
  const maxRounds = o.maxRounds ?? 6;

  let provider: Eip1193;
  try {
    provider = await o.signer.provider(o.chainId);
  } catch (e) {
    return isUserRejection(e) ? fail("rejected") : fail("wrongChain", { message: `${MESSAGES.wrongChain}${errorSentence(e) ? ` (${errorSentence(e)})` : ""}` });
  }

  const checkWallet = async (): Promise<TxResult<D> | null> => {
    try {
      const chain = Number(await provider.request({ method: "eth_chainId" }));
      if (chain !== o.chainId) return fail("wrongChain");
      const accounts = ((await provider.request({ method: "eth_accounts" })) as string[] | null) ?? [];
      if (!accounts.map(lower).includes(from)) return fail("wrongAccount");
    } catch (e) {
      return fail("wallet", { message: errorSentence(e) ?? MESSAGES.wallet });
    }
    return null;
  };

  const send = async (step: PreparedStep, index: number, total: number): Promise<{ ok: true; tx: Hex; blockNumber: bigint } | { ok: false; result: TxResult<D> }> => {
    const bad = await checkWallet();
    if (bad) return { ok: false, result: bad };
    o.onProgress?.({ phase: "wallet", step, index, total });
    let tx: Hex;
    try {
      tx = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, to: step.to, data: step.data, value: toHex(BigInt(step.value)), chainId: toHex(o.chainId) }],
      })) as Hex;
    } catch (e) {
      const rejected = isUserRejection(e);
      steps.push({ kind: step.kind, description: step.description, tx: null, status: rejected ? "rejected" : "failed" });
      return { ok: false, result: rejected ? fail("rejected") : fail("wallet", { message: errorSentence(e) ?? MESSAGES.wallet }) };
    }
    o.onProgress?.({ phase: "confirming", step, tx, index, total });
    const receipt = await wait(provider, tx);
    if (!receipt) {
      steps.push({ kind: step.kind, description: step.description, tx, status: "timeout" });
      return { ok: false, result: fail("timeout", { tx }) };
    }
    if (receipt.status !== "success") {
      steps.push({ kind: step.kind, description: step.description, tx, status: "reverted" });
      return { ok: false, result: fail("reverted", { tx }) };
    }
    steps.push({ kind: step.kind, description: step.description, tx, status: "confirmed" });
    return { ok: true, tx, blockNumber: receipt.blockNumber };
  };

  const confirmedApprovals = new Set<StepKind>();
  for (let round = 0; round < maxRounds; round += 1) {
    o.onProgress?.({ phase: "preparing", round });
    let p: Prepared<D>;
    try {
      p = await o.prepare();
    } catch (e) {
      return fail("api", { message: errorSentence(e) ?? MESSAGES.api });
    }
    if ((p.details as { stub?: unknown } | null)?.stub === true) return fail("demoData");
    if (p.chainId !== o.chainId) return fail("wrongChain", { message: `The exchange prepared this for chain ${p.chainId}, not Sepolia. Nothing was sent.` });
    if (lower(p.from) !== from) return fail("wrongAccount");
    if (p.steps.length === 0) return fail("api");

    const final = p.steps[p.steps.length - 1];
    const approvals = p.steps.slice(0, -1).filter((s) => s.needed);

    if (p.simulate.ok === false) return fail("simulation", { error: p.simulate.error, message: p.simulate.error?.message ?? MESSAGES.simulation });
    if (round === 0 && o.guard) {
      const no = o.guard(p);
      if (no) return fail("refused", { message: no });
    }

    if (approvals.length > 0) {
      const fresh = approvals.filter((s) => !confirmedApprovals.has(s.kind));
      if (fresh.length === 0) {
        // Every approval it still asks for is one we just confirmed: the
        // server's node is a block behind. Wait, then read again.
        await sleep(o.lagRetryMs ?? 3_000);
        continue;
      }
      for (let i = 0; i < fresh.length; i += 1) {
        const r = await send(fresh[i], i, fresh.length + 1);
        if (!r.ok) return r.result;
        confirmedApprovals.add(fresh[i].kind);
      }
      continue;
    }

    if (o.guard && round > 0) {
      const no = o.guard(p);
      if (no) return fail("refused", { message: no });
    }
    const r = await send(final, 0, 1);
    if (!r.ok) return r.result;
    return { ok: true, tx: r.tx, blockNumber: r.blockNumber, steps, prepared: p };
  }
  return fail("notVisible");
}
