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

Every screen carries a "Demo data" strip while the app is pointed at the stub.
That strip is driven by the server reporting itself as a stub, not by a flag in
the app, so it cannot be forgotten.

Error and loading states:

```bash
STUB_FAIL=RPC_ERROR node dev/api-stub/server.mjs   # every call fails
STUB_DELAY=600 node dev/api-stub/server.mjs        # 600ms, shows skeletons
```

## Mode B: real Sepolia

Needs deployed contracts. From the repo root:

```bash
cd contracts
make demo-sepolia                 # writes contracts/deployments/sepolia.json

cd ../services/api
npm install
SEPOLIA_RPC_URL=<your rpc> npm start      # real backend on port 8788
```

Then in `app/.env.local`:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8788
NEXT_PUBLIC_ISSUER_ADDRESS=<the issuer key's address from deployments/sepolia.json>
```

Restart `pnpm dev`. Seven demo companies disappear, the "Demo data" strip
disappears, and the issuer console switches from demo mode to a real ownership
check against the signed-in wallet.

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

## If a change does not show up

Next reads `.env.local` once at startup. Restart `pnpm dev` after editing it.
If the app shows error cards everywhere, the API server on port 8788 is not
running: `curl 127.0.0.1:8788/health` should answer.
