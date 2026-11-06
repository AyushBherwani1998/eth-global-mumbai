import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Address, Hex } from "viem";

export type BindResult =
  | { ok: true; created: boolean }
  | { ok: false; conflict: "nullifier_bound_to_other_wallet" | "wallet_bound_to_other_human" };

/**
 * The only thing this backend stores: `(action, auction, nullifier) -> wallet`, one-to-one per auction.
 * `UNIQUE(action, auction, nullifier)` stops one human from getting a pass for a second wallet;
 * `UNIQUE(action, auction, wallet)` stops a second human from claiming an already-bound wallet.
 * Same rules as `WorldPassModule` onchain. No timestamps, IPs or proofs are kept.
 */
export class BindingStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS bindings (
        action    TEXT NOT NULL,
        auction   TEXT NOT NULL,
        nullifier TEXT NOT NULL,
        wallet    TEXT NOT NULL,
        UNIQUE (action, auction, nullifier),
        UNIQUE (action, auction, wallet)
      )
    `);
  }

  /** Binds on first use; the same pair again is fine (a re-verify after the pass expired). */
  bind(action: string, auction: Address, nullifier: Hex, wallet: Address): BindResult {
    const key = [action, auction.toLowerCase(), nullifier.toLowerCase(), wallet.toLowerCase()] as const;
    try {
      this.#db.prepare("INSERT INTO bindings (action, auction, nullifier, wallet) VALUES (?, ?, ?, ?)").run(...key);
      return { ok: true, created: true };
    } catch (err) {
      if ((err as { errcode?: number }).errcode !== 2067 /* SQLITE_CONSTRAINT_UNIQUE */) throw err;
    }
    const byNullifier = this.#db
      .prepare("SELECT wallet FROM bindings WHERE action = ? AND auction = ? AND nullifier = ?")
      .get(key[0], key[1], key[2]) as { wallet: string } | undefined;
    if (byNullifier) {
      return byNullifier.wallet === key[3]
        ? { ok: true, created: false }
        : { ok: false, conflict: "nullifier_bound_to_other_wallet" };
    }
    return { ok: false, conflict: "wallet_bound_to_other_human" };
  }

  walletOf(action: string, auction: Address, nullifier: Hex): string | undefined {
    const row = this.#db
      .prepare("SELECT wallet FROM bindings WHERE action = ? AND auction = ? AND nullifier = ?")
      .get(action, auction.toLowerCase(), nullifier.toLowerCase()) as { wallet: string } | undefined;
    return row?.wallet;
  }

  close() {
    this.#db.close();
  }
}
