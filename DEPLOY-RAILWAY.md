# Deploy Listing Day on Railway

This repo is an **isolated monorepo**: the Next.js app, the read/prepare API, and the mock exchange are separate Node packages. `contracts/` (Foundry) and `cre/` (Chainlink CRE workflow) are not Railway services.

Nothing in this PR creates a Railway project. Create one yourself, connect this GitHub repo, and add **three services** from the same repo.

Railway injects `PORT`. Do not set `PORT` yourself. Each process binds to that port on `0.0.0.0` when `PORT` is set (the API image also sets `HOST=0.0.0.0`).

## Services to create

| Service name | Root directory | Config file (absolute repo path) | Builder | Healthcheck |
| --- | --- | --- | --- | --- |
| `app` | `/` (repository root) | `/app/railway.json` | Dockerfile at `app/Dockerfile` | `/` |
| `api` | `/` (repository root) | `/services/api/railway.json` | Dockerfile at `services/api/Dockerfile` | `/health` |
| `mock-exchange` | `/services/mock-exchange` | `/services/mock-exchange/railway.json` | Railpack (`node src/index.ts`) | `/health` |

The API **root directory must stay `/`**. Its Docker build context is the repository root so the image can copy `contracts/deployments/sepolia.json`. If you set the API root to `/services/api`, that copy fails and the process has no listing addresses.

The app's root directory is `/` for the same reason: it type-imports the API's response types from `services/api/src/types.ts`, which is outside `app/`. With root `/app` that file is not in the build context and `pnpm build` stops with an explanation (`app/scripts/check-monorepo.mjs`).

`railway.json` pins builder, build/start commands, healthcheck, and watch patterns so a change in one package does not rebuild the others. Railway's [config as code](https://docs.railway.com/config-as-code) looks for `railway.json` / `railway.toml` next to the service; the file path does **not** follow Root Directory, so set the config path to the absolute repo path above. Config in code overrides matching dashboard build/deploy fields but does not set the root directory, env vars, or public domain — those stay in the dashboard.

Railway is [deprecating config as code](https://docs.railway.com/config-as-code) for brand-new services (existing files keep working until 2026-12-01). If a new service does not pick up the file, paste the same builder, commands, healthcheck path (`/health` or `/` for the app), 100s timeout, and watch patterns into **Settings**. Watch patterns are always matched from the repository root, even when a root directory is set (for example `/app/**`, not `**`).

Generate a public HTTPS domain for `app` and `api` (and `mock-exchange` if the CRE workflow or issuer console will call it from outside Railway).

## Environment variables

Names only; copy values from each package's `.env.example` or README. Never put an RPC URL in a `NEXT_PUBLIC_*` variable.

### `app` (`app/.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes | Public HTTPS origin of `api`, no trailing slash. Without it every screen shows "exchange server not configured". Example: `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | For Privy sign-in | Without it the app falls back to the demo sign-in sheet. Add the app's public domain to the Privy app's allowed domains. |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_MAINNET_RPC_URL` | No | Browser-side RPCs (Sepolia; mainnet for ENS names). Use a key restricted to the app's domain, never the API's server RPC. |
| `NEXT_PUBLIC_ISSUER_ADDRESS` | No | Issuer-console owner used only when no API is configured. With the API, ownership comes from `GET /v1/issuer/:ticker`. |

Every `NEXT_PUBLIC_*` value is inlined at **build** time: `app/Dockerfile` declares them as build args, and Railway passes service variables to declared build args. After you first generate the API's public domain, trigger a **rebuild** of `app` so the new value is baked in.

The image uses Node 22 (matching `app/.node-version`) and pnpm from `packageManager` (`pnpm@10.28.0`) via corepack.

### `api` (`services/api/.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` or `RPC_URL` | Yes for a useful demo | `RPC_URL` wins if both are set. Use a provider with **full log history** (Alchemy, Infura, QuickNode, …). The default public node prunes logs after about 1.5 days. Server-side only. |
| `CORS_ORIGINS` | Yes once the app is on HTTPS | Comma-separated exact origins, `*`, or one-label wildcards (`https://*.up.railway.app`). Example: `https://${{app.RAILWAY_PUBLIC_DOMAIN}}` |
| `DEPLOYMENTS_FILES` | No | Defaults (and the Docker image) use `../../contracts/deployments/sepolia.json`, which is copied into the image. Comma-separated paths, optional `#ticker` suffix. Do not invent addresses. |
| `CHAIN_ID` | No | Defaults to the first deployments file's `chainId` (Sepolia `11155111`). `/health` is 503 if the RPC disagrees. |
| `HOST` | No | Image default `0.0.0.0`. |
| `EXPLORER_URL` | No | Defaults to Sepolia Etherscan. |
| `ENS_PARENT_NAME` | No | Default `listingday.eth`. |
| `LOGS_MAX_RANGE` | No | Default `50000`. |
| `USDC_ADDRESS`, `PERMIT2_ADDRESS`, `POOL_MANAGER_ADDRESS`, `POSITION_MANAGER_ADDRESS`, `UNIVERSAL_ROUTER_ADDRESS`, `STATE_VIEW_ADDRESS`, `QUOTER_ADDRESS`, `LBP_STRATEGY_ADDRESS`, `MULTICALL3_ADDRESS`, `ENS_UNIVERSAL_RESOLVER_ADDRESS` | No | Overrides; otherwise the deployments file, then Sepolia constants. |

### `mock-exchange` (see `services/mock-exchange/README.md`)

| Variable | Required | Notes |
| --- | --- | --- |
| `MOCK_EXCHANGE_SECRET` | Yes | Shared secret for every write (`x-api-key` or `Authorization: Bearer`). If unset, the process invents a random secret each start and prints it (useless across restarts). |
| `TICKER` | No | Initial ticker; default `ACME`. |
| `STATE_FILE` | No | JSON path loaded at start and rewritten after every edit. Without it, policy is in-memory and resets on each deploy. A Railway volume is required if you want it to persist. |
| `HOST` | No | Binds `0.0.0.0` when `PORT` is set. |

## How services reference each other

The browser talks to `api` over public HTTPS (an HTTPS app cannot call `http://` — mixed content). Reference variables:

```text
# on app (set before / during build)
NEXT_PUBLIC_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}

# on api
CORS_ORIGINS=https://${{app.RAILWAY_PUBLIC_DOMAIN}}
```

[Private networking](https://docs.railway.com/guides/private-networking) (`${{api.RAILWAY_PRIVATE_DOMAIN}}`) is fine for server-to-server calls on Railway's private mesh, but `NEXT_PUBLIC_API_URL` is loaded in the user's browser, so it must be the API's **public** domain.

The CRE workflow (run outside Railway) should `GET` `https://${{mock-exchange.RAILWAY_PUBLIC_DOMAIN}}/policy`. The issuer console can use the same public origin plus `MOCK_EXCHANGE_SECRET`.

`GET ${NEXT_PUBLIC_API_URL}/v1/config` should answer (no RPC required). `GET ${NEXT_PUBLIC_API_URL}/health` needs a reachable RPC and at least one readable deployments file.

## Deployments JSON

The API never fabricates listing addresses. It re-reads `DEPLOYMENTS_FILES` on every request:

- The Docker image bakes in the committed `contracts/deployments/sepolia.json`.
- If a file is missing or incomplete, the server still starts. It logs a warning, `/health` returns **503** with `ok: false` and `deployments[].error` (filename only, not a fake listing), and `/v1/config` lists those errors by basename.
- To serve another listing, commit or mount a real deployments JSON written by the contracts demo scripts and point `DEPLOYMENTS_FILES` at it (relative to `services/api`, or an absolute path).

## Order of deployment

1. Create the Railway project and connect this repo.
2. Create `mock-exchange`, set its root directory and `MOCK_EXCHANGE_SECRET`, generate a domain if CRE needs it, deploy.
3. Create `api` with root `/`, point it at `services/api/Dockerfile`, set `SEPOLIA_RPC_URL` (archive RPC), deploy. Confirm `GET /health` is 200 (503 means the RPC is down, on the wrong chain, or no deployments file was readable). You can set `CORS_ORIGINS` after `app` has a domain and redeploy `api` (cheap: env-only).
4. Create `app` with root `/`, point it at `app/Dockerfile`, set `NEXT_PUBLIC_API_URL` to the API's public `https://…` origin, deploy.
5. Set `CORS_ORIGINS` on `api` to the app origin (and rebuild `app` if you added `NEXT_PUBLIC_API_URL` after the first app build).

Suggested check: open the app URL (the "Demo data" strip must be absent; it appears only when the API reports itself as the fixture stub), then `curl https://<api>/health` and `curl https://<mock-exchange>/health`.
