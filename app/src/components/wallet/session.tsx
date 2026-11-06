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

import { useContext, useEffect, useMemo, type ReactNode } from "react";
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

const PALETTE: Record<ResolvedTheme, { surface: `#${string}`; accent: `#${string}`; ink: string }> = {
  // --surface, --buy and --text from globals.css, one theme per row.
  light: { surface: "#EDEDEB", accent: "#007553", ink: "#111113" },
  dark: { surface: "#16161A", accent: "#00805F", ink: "#EDEDEB" },
};

/**
 * The octagon, copied verbatim from design/brand/thaamba-logo.svg.
 *
 * components/brand keeps its own copy of this path private and draws it in
 * `currentColor`, which is right for every other place the mark appears.
 * Privy takes a URL rather than a node, so this one has to be a literal.
 */
const OCTAGON =
  "M34.7273 6.29842C37.7433 4.84597 41.2567 4.84596 44.2727 6.29842L62.4823 15.0677C65.4984 16.5201 67.6889 19.267 68.4338 22.5306L72.9312 42.235C73.6761 45.4986 72.8943 48.9239 70.8071 51.5411L58.2057 67.3428C56.1185 69.96 52.9531 71.4844 49.6056 71.4844H29.3945C26.0469 71.4844 22.8815 69.96 20.7943 67.3428L8.19289 51.5411C6.10571 48.9239 5.32392 45.4986 6.06882 42.235L10.5662 22.5306C11.3111 19.267 13.5016 16.5201 16.5177 15.0677L34.7273 6.29842Z";

/** The thaamba mark as a data URI, in this theme's ink, for Privy's <img>. */
function logoDataUri(ink: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 80 80">` +
    `<path transform="translate(0.5 1.835)" d="${OCTAGON}" fill="none" stroke="${ink}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The one piece of Privy theming that cannot live in privy-theme.css.
 *
 * Privy blurs the page behind its modal (`backdrop-filter: blur(3px)`), and
 * UI.md 2.15 has a flat overlay and nothing else: this app has no blur and no
 * elevation anywhere. The override belongs in the stylesheet, but every *.css
 * in this project is compiled by @tailwindcss/turbopack (next.config.ts) and
 * that pass drops a `backdrop-filter` declaration whatever its value, even
 * behind a var(). A stylesheet created at runtime never goes through the
 * build, so this one rule is appended to the head instead. Everything else
 * Privy paints is themed from privy-theme.css.
 */
const FLAT_BACKDROP_ID = "thamba-privy-flat-backdrop";

function useFlatBackdrop() {
  useEffect(() => {
    if (document.getElementById(FLAT_BACKDROP_ID)) return;
    const el = document.createElement("style");
    el.id = FLAT_BACKDROP_ID;
    el.textContent = "#privy-dialog-backdrop{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}";
    document.head.append(el);
  }, []);
}

function PrivySession({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  useFlatBackdrop();
  const p = PALETTE[resolved];
  const config = useMemo<PrivyClientConfig>(
    () => ({
      appearance: {
        theme: p.surface,
        accentColor: p.accent,
        logo: logoDataUri(p.ink),
        landingHeader: "Sign in to thaamba",
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
    [p.surface, p.accent, p.ink],
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
