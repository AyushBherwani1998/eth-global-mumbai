# Running thaamba locally

Two modes. Both serve the app at http://localhost:3000.

## Mode A: fixtures, no chain needed

What the demo runs on. Eight companies covering every trading rule: listing day,
normal limits, under watch, halted, two live IPOs, one refunding, one upcoming.

```bash
cd app
cp .env.example .env.local        # the defaults already point at the stub
node dev/api-stub/server.mjs &    # fixture API on port 8788
pnpm dev                          # app on port 3000
```

Error and loading states:

```bash
STUB_FAIL=RPC_ERROR node dev/api-stub/server.mjs   # every call fails
STUB_DELAY=600 node dev/api-stub/server.mjs        # 600ms, shows skeletons
```

## Mode B: real Sepolia

Acme is already deployed; its addresses are committed in
`contracts/deployments/sepolia.json`, so no deploy is needed. From the repo root:

```bash
cd services/api
npm install
npm run dev                       # real backend on port 8788, read-only
```

It defaults to a public Sepolia RPC, which prunes old logs and state; set
`RPC_URL` (or `SEPOLIA_RPC_URL`) to a full-history RPC for complete history.

Then in `app/.env.local`:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788
```

Restart `pnpm dev`. The fixture companies disappear and the issuer console
checks ownership with `GET /v1/issuer/:ticker?address=` against the signed-in
wallet.

Reads are free. Anything confirmed in the wallet (Buy, Sell, Apply, Collect,
Refund) is a real Sepolia transaction: the app prepares it on the server, the
wallet sends each approval and then the final call, and the app waits for
each receipt before it says anything worked.

Nothing in the app code changes between the two modes. The app talks to one
base URL and believes whatever that server says.

## Sign in

Without a Privy app id the app uses a local demo sign-in sheet: an email that
maps to a deterministic address, a browser wallet through `window.ethereum`, or
the demo issuer account.

With `NEXT_PUBLIC_PRIVY_APP_ID` set it uses Privy proper: email with an embedded
wallet for people who have never held crypto, plus MetaMask and the rest. Only
the app id is needed. The Privy app secret is for server-side token
verification, which this app does not do.

In the Privy dashboard, allow `http://localhost:3000` as a login domain, enable
Email and Wallet login, and turn on embedded wallets for users without one.

## Checks

From `app/`, in this order (all of them run in CI, `.github/workflows/app.yml`):

```bash
pnpm lint
pnpm test        # node --test: units, the transaction runner, quotes, adapters, console lifecycle
pnpm typecheck   # next typegen && tsc --noEmit
pnpm build
```

The tests mock the wallet and the API; nothing signs or broadcasts.

## Deploying

The app type-imports `services/api/src/types.ts`, so it builds only inside the
whole repository: `pnpm build` stops early with an explanation otherwise. On a
host with a root-directory setting use the repository root (`/`) and
`app/Dockerfile` (see DEPLOY-RAILWAY.md). `NEXT_PUBLIC_*` values are inlined
at build time, so rebuild after changing them.

## If a change does not show up

Next reads `.env.local` once at startup. Restart `pnpm dev` after editing it.
If the app shows error cards everywhere, the API server on port 8788 is not
running: `curl 127.0.0.1:8788/health` should answer.
