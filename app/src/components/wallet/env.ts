// Sign-in and deployment configuration. Read at build time by Next
// (NEXT_PUBLIC_*), so these are plain constants on the client.
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

// ---------------------------------------------------------------------------
// Who owns the listings.
//
// There is no "listing owner" field in the backend (services/api/README.md):
// `/v1/listings/:ticker` carries the share token, auction, pool, hook and
// policy addresses, and `/v1/auction/:ticker` carries `tokensRecipient` and
// `fundsRecipient`, but nothing returns the owner of the ENS ticker name. So
// the owner address comes from the deployment config
// (`contracts/deployments/<network>.json`), handed to the client as
// NEXT_PUBLIC_ISSUER_ADDRESS.
//
// It is never invented here. When it is unset the console says on screen that
// it is checking nobody, and runs as a labelled demo.
// ---------------------------------------------------------------------------

const ownerRaw = (process.env.NEXT_PUBLIC_ISSUER_ADDRESS ?? "").trim();

/** Lowercase 0x address of the listing owner, or null when none is configured. */
export const LISTING_OWNER: string | null = /^0x[0-9a-fA-F]{40}$/.test(ownerRaw) ? ownerRaw.toLowerCase() : null;

/** True when a real address is configured and the console can check ownership. */
export const hasListingOwner = LISTING_OWNER !== null;

/** Base URL of services/api, e.g. http://127.0.0.1:8788. Empty when not configured. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

export const hasApi = API_URL.length > 0;
