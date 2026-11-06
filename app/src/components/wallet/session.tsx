"use client";

// Real sign-in. Privy (@privy-io/react-auth) owns the session: email with a
// Privy embedded wallet for people who have never held crypto, plus MetaMask
// and other browser wallets. Sending goes through `signer` (session-context.ts).
//
// Two implementations behind one context:
//   - `hasPrivy` (a real NEXT_PUBLIC_PRIVY_APP_ID): PrivyProvider + usePrivy.
//   - no app id: a local demo sign-in sheet with the same shape, so the app
//     boots, signs in and demos without any key. See demo-session.tsx.
// The branch is on a build-time constant, so only one of the two is ever
// mounted for a given build and no hook order changes at runtime.

import { useContext, useMemo, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets, type ConnectedWallet, type PrivyClientConfig } from "@privy-io/react-auth";
import { sepolia } from "viem/chains";
import type { Eip1193, WalletSigner } from "@/lib/tx";
import { useTheme, type ResolvedTheme } from "../theme";
import { PRIVY_APP_ID, hasPrivy } from "./env";
import { useEnsName } from "./ens";
import { DemoSessionProvider } from "./demo-session";
import { WalletSessionContext, type WalletSession } from "./session-context";
import "./privy-theme.css";

export type { WalletSession };

export function useWalletSession(): WalletSession {
  const v = useContext(WalletSessionContext);
  if (!v) throw new Error("useWalletSession outside WalletSessionProvider");
  return v;
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  return hasPrivy ? <PrivySession>{children}</PrivySession> : <DemoSessionProvider>{children}</DemoSessionProvider>;
}

// ---------------------------------------------------------------------------
// Privy appearance, mapped onto the tokens in globals.css.
//
// Privy derives its own foreground scale from one background colour, so the
// values here are the literal hex behind --surface / --gain-text in each theme
// rather than var() references (Privy reads them with tinycolor2). Roboto, the
// 10px radius and our hairline are not in Privy's config, so they come from the
// scoped overrides in privy-theme.css.
// ---------------------------------------------------------------------------

const PALETTE: Record<ResolvedTheme, { surface: `#${string}`; accent: `#${string}`; brand: string }> = {
  light: { surface: "#FFFFFF", accent: "#00805F", brand: "#5367FF" },
  dark: { surface: "#1A1A1A", accent: "#0FCB9A", brand: "#7B8BFF" },
};

/** The Thamba mark as a data URI, so Privy can render it as a plain <img>. */
function logoDataUri(brand: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="16" fill="${brand}"/>` +
    `<path d="M7 21.5 L13 15 L17 18.5 L25 10" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M20.5 10 H25 V14.5" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function PrivySession({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const p = PALETTE[resolved];
  const config = useMemo<PrivyClientConfig>(
    () => ({
      appearance: {
        theme: p.surface,
        accentColor: p.accent,
        logo: logoDataUri(p.brand),
        landingHeader: "Sign in to Thamba",
        loginMessage: "Sign in with your email and we make you a secure wallet. Or use one you already have.",
        showWalletLoginFirst: false,
        walletChainType: "ethereum-only",
        walletList: ["detected_wallets", "metamask", "coinbase_wallet", "wallet_connect"],
      },
      loginMethods: ["email", "wallet"],
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      supportedChains: [sepolia],
      defaultChain: sepolia,
    }),
    [p.surface, p.accent, p.brand],
  );

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={config}>
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

/** "eip155:11155111" -> 11155111. */
function caipChainId(id: string | undefined): number | null {
  const n = Number(id?.split(":").pop());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The signer for the signed-in address: the connected wallet Privy reports for
 * `user.wallet.address` (the embedded wallet for email users). Privy notes that
 * `switchChain` does not update existing providers, so the provider is fetched
 * after any switch, on every send.
 */
function privySigner(wallet: ConnectedWallet | null): WalletSigner | null {
  if (!wallet) return null;
  return {
    address: wallet.address,
    label: wallet.walletClientType === "privy" ? "your email wallet" : wallet.meta?.name || "your wallet",
    provider: async (chainId) => {
      if (caipChainId(wallet.chainId) !== chainId) await wallet.switchChain(chainId);
      return (await wallet.getEthereumProvider()) as Eip1193;
    },
  };
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const address = (authenticated && user?.wallet?.address) || null;
  const ensName = useEnsName(address);
  const wallet = useMemo(() => (address ? (wallets.find((w) => w.address.toLowerCase() === address.toLowerCase()) ?? null) : null), [wallets, address]);
  const signer = useMemo(() => privySigner(wallet), [wallet]);
  const chainId = caipChainId(wallet?.chainId);

  const value = useMemo<WalletSession>(
    () => ({
      mode: "privy",
      ready,
      connected: ready && authenticated && !!address,
      address,
      ensName,
      login: () => login(),
      logout: () => void logout(),
      signer,
      chainId,
    }),
    [ready, authenticated, address, ensName, login, logout, signer, chainId],
  );

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}
