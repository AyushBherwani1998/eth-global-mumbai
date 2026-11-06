# verify

World ID eligibility backend for **human** listings (plan.md §8). It turns a World ID 4.0 Proof of Human into a
short-lived, EIP-712 signed `EligibilityPass` that `WorldPassModule` checks on every `submitBid`:

1. `POST /v1/idkit/request` signs an IDKit request (`signRequest` from `@worldcoin/idkit-server`) for action
   `listingday-<ticker>`, with signal = the bidder's wallet.
2. The frontend runs the IDKit widget (Proof of Human) and posts the result to `POST /v1/idkit/verify`.
3. The backend forwards it as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`, asserts `success`,
   environment, action and nullifier, and stores `(action, auction, nullifier) -> wallet` with `UNIQUE` constraints
   both ways in SQLite. A second wallet for the same person gets `409`.
4. It returns the pass, its signature and the ABI-encoded `hookData` for `submitBid`. Passes expire after 10 minutes.

The frontend contract (request/response JSON, error codes, IDKit props, `submitBid`) is in [API.md](API.md). The
contract side is `contracts/src/modules/WorldPassModule.sol`; `contracts/errors.md` lists its errors.

Node ≥ 22.18 runs the TypeScript directly (type stripping) and provides `node:sqlite`. Runtime dependencies:
`@worldcoin/idkit-server` (RP signatures) and `viem` (EIP-712, ABI encoding).

```bash
cd services/verify
npm ci
cp .env.example .env        # fill in, see below
npm run start:env           # http://127.0.0.1:8788
npm test                    # node:test, World's verify endpoint mocked (never calls World)
npm run typecheck
npm run fixtures            # regenerate fixtures/pass-vectors.json (contracts' WorldPassFixture.t.sol reads it)
```

## Configuration

Only environment variables; secrets never go in files that are committed. See [.env.example](.env.example).

| Env | Default | |
|---|---|---|
| `WORLD_APP_ID` | required | `app_…` from the Developer Portal |
| `WORLD_RP_ID` | required | `rp_…` (World ID 4.0 relying party) |
| `WORLD_RP_SIGNING_KEY` | required, **secret** | RP signing key (shown once by the portal) |
| `WORLD_ENVIRONMENT` | `staging` | `staging` (World ID Simulator, the demo) or `production`. Proofs from the other environment are rejected |
| `WORLD_ALLOW_LEGACY_PROOFS` | `false` | Also accept World ID 3.0 Orb proofs (see "Legacy proofs") |
| `WORLD_VERIFY_BASE_URL` | `https://developer.world.org` | |
| `WORLD_RP_REQUEST_TTL_SECONDS` | `300` | How long a signed IDKit request stays open |
| `PASS_SIGNER_KEY` | required, **secret** | Signs passes. Its address must be the `WorldPassModule`'s `signer` |
| `PASS_TTL_SECONDS` | `600` | Pass lifetime |
| `LISTINGS` / `LISTINGS_FILE` | required | JSON array `[{"ticker","chainId","auction","module","cap"}]`; `make -s verify-listings ELIGIBILITY=human` in `contracts/` prints it from the deployments file |
| `DB_PATH` | `data/verify.sqlite` | Bindings store (git-ignored) |
| `HOST` / `PORT` / `CORS_ORIGIN` | `127.0.0.1` / `8788` / `*` | |

The store holds only `(action, auction, nullifier, wallet)`: nothing else about the user. Bindings are per auction,
so relaunching a listing (new auction) starts fresh. The pass signer is the trust point: anyone with
`PASS_SIGNER_KEY` can mint passes, so keep it server-only, like the RP key.

## Manual check: IDKit simulator (staging)

Automated tests mock World. The real round trip needs the owner's World Developer Portal app; nothing here fakes it.

**What the owner must create** (https://developer.world.org):

1. A team and an app. On the app, enable **World ID 4.0** (the "Enable World ID 4.0" banner on older apps). Note
   `app_id` (`app_…`), `rp_id` (`rp_…`) and the **signing key** (`signing_key`, shown once: store it right away).
2. An **action** `listingday-acme` (one per ticker: `listingday-<ENS_TICKER>`) in the **staging** environment. A
   staging action only works with the World ID Simulator; real phones need a production action and
   `WORLD_ENVIRONMENT=production`.
3. Wait until the RP registration shows as registered for staging (the verify endpoint returns `not_registered` /
   an `rp` error until then).

**What to set**:

- `services/verify/.env`: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ENVIRONMENT=staging`,
  `PASS_SIGNER_KEY` (any fresh key), `LISTINGS` (from `make -s verify-listings ELIGIBILITY=human`).
- `contracts/.env`: `ELIGIBILITY=human`, `PASS_SIGNER_ADDRESS` (= the address of `PASS_SIGNER_KEY`) or
  `PASS_SIGNER_KEY` itself, then `make deploy launch` (DEPLOY.md, "Human listing").
- Frontend: the verify backend URL. `app_id`, `rp_id`, action and environment come from `/v1/idkit/request`.

**Steps**:

1. `npm run start:env`, then `curl -s localhost:8788/health` shows the pass signer and `acme`.
2. In the frontend, connect wallet A, start verification: the widget shows a QR / connect URL. Open
   https://simulator.worldcoin.org, create or pick a simulated identity, and scan / paste the connect URL.
3. Expect `200` from `/v1/idkit/verify` with `firstVerification: true`, and a bid with that `hookData` goes through.
4. Same simulated identity, wallet B: expect `409 nullifier_bound_to_other_wallet`.
5. Wallet A again after 10 minutes: a fresh pass (`firstVerification: false`). If World refuses a repeated proof for
   the action here (`world_verification_failed`), note its `world_code`: the first pass then has to be used within its
   10 minutes.
6. If step 2 produces a 3.0 proof (`unsupported_proof`, message `protocol_version must be 4.0`) because the simulator
   identity has no 4.0 credential, retry with `WORLD_ALLOW_LEGACY_PROOFS=true` and read "Legacy proofs" first.

Record the `world_code` / `message` of any failure: IDKit's `getDebugReport()` has the `request_id` World needs.

## Legacy proofs

With `allow_legacy_proofs: true`, IDKit's `proofOfHuman` preset falls back to a World ID 3.0 Orb proof for users
without a 4.0 credential. 3.0 and 4.0 nullifiers for the same person and action differ, so one person could bind one
wallet with a 3.0 proof and another with a 4.0 proof. That is why it is off by default; turn it on only if the demo
identities can't produce 4.0 proofs, and say so in the demo.

## Not implemented

- **Agent Pass (OIDC)**: plan.md mentions it as an alternative World path. It would need an OIDC / JWKS client and a
  separate trust model, so it is not here; each deployment uses IDKit Proof of Human only.
- No nationality, age or document checks: World ID Proof of Human only (plan.md §8). This is sybil resistance, not KYC.
