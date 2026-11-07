"use client";

// One context, two implementations (Privy or the local demo sign-in). Kept in
// its own module so demo-session.tsx and session.tsx can both fill it without
// importing each other.
//
// The signing boundary. Sign-in (who you are) is Privy's, unchanged. Sending
// a transaction needs exactly one more thing from the session: `signer`, an
// EIP-1193 provider for the signed-in address on the requested chain
// (lib/tx.ts `WalletSigner`). Each implementation fills it from what it
// already has:
//   - Privy: the `useWallets()` entry whose address is `user.wallet.address`
//     (embedded or external), via `switchChain` + `getEthereumProvider()`.
//   - Demo: the injected browser wallet, only when that is how you signed in.
//     The email and demo-account sign-ins have no keys, so `signer` is null.
// Nothing outside components/wallet touches Privy or window.ethereum.

import { createContext } from "react";
import type { WalletSigner } from "@/lib/tx";

export type WalletSession = {
  /** Which implementation is live. "demo" means no Privy app id is configured. */
  mode: "privy" | "demo";
  /** False until the session store has been read. Screens show a neutral state. */
  ready: boolean;
  connected: boolean;
  address: string | null;
  ensName: string | null;
  /** Opens the sign-in flow. */
  login: () => void;
  logout: () => void;
  /** Sends for `address`. Null when signed out, while the wallet is still loading, or for a keyless demo sign-in. */
  signer: WalletSigner | null;
  /** The wallet's current chain id; null when unknown (no signer, or the wallet has not said). */
  chainId: number | null;
  /** Sign a message with the connected wallet. Null when no wallet is connected or signing not available. */
  signMessage: ((message: string) => Promise<string>) | null;
  /** Get ethers provider for transaction signing. Null when no wallet is connected. */
  getEthersProvider: (() => Promise<any>) | null;
};

export const WalletSessionContext = createContext<WalletSession | null>(null);
