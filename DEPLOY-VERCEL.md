# Deploy Listing Day on Vercel (Hobby)

Use **two Vercel projects** from the same GitHub repo. The Next.js app and the Hono API are separate packages; putting both in one project fights the monorepo layout (the API needs the repo-root `contracts/deployments/` file, the app wants Root Directory `app`).

Nothing here creates the projects for you. Open [vercel.com/new](https://vercel.com/new), import `AyushBherwani1998/eth-global-mumbai`, and create each project below. Vercel Hobby is enough for the demo.

The mock exchange stays on your laptop with the Chainlink CRE workflow. Do not deploy it to Vercel.

## Project 1 — `listing-day-api` (create first)

| Setting | Value |
| --- | --- |
| Root Directory | **`.`** (repository root — leave blank / `/`). Required so `contracts/deployments/sepolia.json` is uploaded. |
| Framework Preset | **Other** (or Hono if Vercel detects `api/index.ts`) |
| Build Command | leave empty / override to empty (`vercel.json` already sets `""`) |
| Install Command | from `vercel.json`: `npm ci --prefix services/api && ln -sfn services/api/node_modules node_modules` |
| Output Directory | leave empty |
| Node.js Version | **22.x** (Project Settings → General). `.node-version` at the repo root also says `22`. |

`vercel.json` at the repo root:

- installs `services/api` dependencies
- rewrites every path to `/api` (the `api/index.ts` function)
- includes `contracts/deployments/**` and `services/api/src/**` in the function bundle

The app Vercel project uses Root Directory `app`, so it **never reads** this root `vercel.json`.

### Environment variables (API)

| Variable | Required | Notes |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` or `RPC_URL` | Yes for a useful demo | Archive / full-history Sepolia RPC (Alchemy, Infura, QuickNode). `RPC_URL` wins if both are set. publicnode prunes logs after ~1.5 days. Server-side only. |
| `CORS_ORIGINS` | Yes once the app has a URL | Comma-separated exact origins, `*`, or one-label wildcards. Example: `https://listing-day.vercel.app,https://*.vercel.app,http://localhost:3000` |
| `DEPLOYMENTS_FILES` | No | Defaults to `../../contracts/deployments/sepolia.json`. Path resolution also tries `process.cwd()` (Vercel `/var/task`) so the default still finds the file. Set an absolute path only if you move the JSON. |
| `CHAIN_ID` | No | Defaults from the deployments file (Sepolia `11155111`). |
| `EXPLORER_URL`, `ENS_PARENT_NAME`, `LOGS_MAX_RANGE`, `*_ADDRESS` | No | Same as `services/api/.env.example`. |

Do **not** set `PORT` on Vercel.

Deploy, then check:

```bash
curl -sS https://<api-project>.vercel.app/health
curl -sS https://<api-project>.vercel.app/v1/config
```

`/health` should be **200** with `"ok": true`. **503** means the RPC is down, on the wrong chain, or no deployments file was readable.

## Project 2 — `listing-day` (the Next.js app)

| Setting | Value |
| --- | --- |
| Root Directory | **`app`** |
| Framework Preset | **Next.js** (auto-detected) |
| Build / Install / Output | leave Vercel defaults (`pnpm` via `packageManager`, `pnpm build`) |
| Node.js Version | **22.x** (`app/.node-version` is `22`) |

### Environment variables (app)

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Yes for live data | Public HTTPS origin of the API project, **no trailing slash**. Inlined at **build** time. Example: `https://listing-day-api.vercel.app` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes for real sign-in | From [dashboard.privy.io](https://dashboard.privy.io). Blank keeps the local demo sign-in sheet. |
| `NEXT_PUBLIC_ISSUER_ADDRESS` | Recommended | Issuer wallet from `contracts/deployments/sepolia.json`. Blank leaves the console in DEMO MODE. |
| `NEXT_PUBLIC_RPC_URL` | No | Browser Sepolia RPC for the few direct reads. |
| `NEXT_PUBLIC_MAINNET_RPC_URL` | No | Mainnet RPC for ENS name resolution. |

After the first deploy, add the app's `*.vercel.app` domain (and any custom domain) to **Privy → Login methods → Allowed domains**.

## Order

1. Create and deploy the **API** project. Confirm `/health` is 200.
2. Create the **app** project with `NEXT_PUBLIC_API_URL` set to the API origin. Deploy.
3. Set `CORS_ORIGINS` on the API to the app origin (and `https://*.vercel.app` if you want preview URLs) and **redeploy the API**.
4. If you change any `NEXT_PUBLIC_*` value later, **redeploy the app** (they are baked in at build time).
5. Add the app domain to Privy's allowed login domains.

## What this branch adds for Vercel

| Path | Role |
| --- | --- |
| `api/index.ts` | Vercel function: bootstraps the Hono app and `export default`s it (no `serve()`). |
| `vercel.json` | Install, rewrite-all → `/api`, `includeFiles` for deployments JSON + API sources. |
| `services/api/src/bootstrap.ts` | Shared cold-start used by `src/index.ts` (Railway/Docker/local) and `api/index.ts`. |
| `package.json` / `.node-version` | Repo-root engines pin for the API Vercel project only. |

Railway files (`DEPLOY-RAILWAY.md`, `*/railway.json`, Dockerfile) are unchanged and still work.

## Local check without a Vercel login

```bash
cd services/api && npm test && npm run typecheck
# From repo root, exercise the same export Vercel uses:
node --input-type=module -e 'import app from "./api/index.ts"; const r=await app.fetch(new Request("http://x/health")); console.log(r.status, await r.text())'
```

`vercel dev` also works after `npx vercel link` to the API project; it is not required to verify the handler.
