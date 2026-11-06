// Sign-in configuration. Read at build time by Next (NEXT_PUBLIC_*), so these
// are plain constants on the client.
//
// The app must boot and demo without a Privy app id, so the placeholder below
// is deliberately not a plausible id: `hasPrivy` is false whenever the value is
// missing, blank or still the placeholder, and the session layer mounts a local
// demo sign-in instead of PrivyProvider.

export const PRIVY_APP_ID_PLACEHOLDER = "missing-privy-app-id";

const raw = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();

export const PRIVY_APP_ID = raw || PRIVY_APP_ID_PLACEHOLDER;

/** Privy app ids are 24-25 lowercase alphanumerics. Anything else is "not configured". */
export const hasPrivy = /^[a-z0-9]{20,32}$/.test(PRIVY_APP_ID) && PRIVY_APP_ID !== PRIVY_APP_ID_PLACEHOLDER;

/** The address that owns the demo listings. Overridable so a judge can use their own wallet. */
export const ISSUER_ADDRESS = (process.env.NEXT_PUBLIC_ISSUER_ADDRESS ?? "").trim();
