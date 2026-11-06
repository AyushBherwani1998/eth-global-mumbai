"use client";

// One context, two implementations (Privy or the local demo sign-in). Kept in
// its own module so demo-session.tsx and session.tsx can both fill it without
// importing each other.

import { createContext } from "react";

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
};

export const WalletSessionContext = createContext<WalletSession | null>(null);
