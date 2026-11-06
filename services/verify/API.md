# services/verify HTTP API (frontend contract)

For a **human** listing (ENS `listingday.eligibility = human`), every `submitBid` needs `hookData`: an EIP-712
`EligibilityPass` signed by this backend after a World ID proof of human. The IDKit widget lives in the frontend; this
service signs the IDKit request, verifies the proof with World, binds the person to one wallet, and returns the pass.

```
frontend                          services/verify                       World
  | POST /v1/idkit/request {ticker, wallet}                                |
  |-------------------------------->| signRequest (RP signing key)         |
  |<--------------------------------| app_id, action, rp_context, signal   |
  | IDKitRequestWidget (proofOfHuman, signal = wallet) -- user proves ---->|
  |<--------------------------------------------- IDKit result ------------|
  | POST /v1/idkit/verify {ticker, wallet, idkitResponse}                  |
  |-------------------------------->| POST /api/v4/verify/{rp_id} -------->|
  |                                 |<-------------- success, nullifier ---|
  |                                 | bind (action, auction, nullifier) -> wallet
  |<--------------------------------| pass, signature, hookData           |
  | CCA.submitBid(maxPrice, amount, wallet, prevTickPrice, hookData)      |
```

Base URL: wherever it runs (`http://127.0.0.1:8788` locally). All bodies are JSON; responses carry
`Cache-Control: no-store` and CORS headers (`CORS_ORIGIN`, default `*`).

## `GET /v1/listings/:ticker` (and `GET /v1/listings` for all of them)

Public config for a human listing. Use it to know the action, the module, the cap and the IDKit props.

```json
{
  "ticker": "acme",
  "action": "listingday-acme",
  "chainId": 11155111,
  "auction": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "module": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "cap": "20000000",
  "passSigner": "0x2954dED3C124849d85b92D7E1A01469EE9c60D37",
  "passTtlSeconds": 600,
  "eip712": {
    "domain": { "name": "ListingDay WorldPass", "version": "1", "chainId": 11155111, "verifyingContract": "0x5FbDB2315678afecb367f032d93F642f64180aa3" },
    "types": { "EligibilityPass": [
      { "name": "nullifier", "type": "bytes32" }, { "name": "wallet", "type": "address" },
      { "name": "auction", "type": "address" }, { "name": "cap", "type": "uint128" }, { "name": "expiry", "type": "uint64" }
    ] },
    "primaryType": "EligibilityPass"
  },
  "world": { "app_id": "app_...", "rp_id": "rp_...", "environment": "staging", "allow_legacy_proofs": false, "credential": "proof_of_human" }
}
```

`cap` is the per-human cumulative budget in raw USDC units (6 decimals). `GET /health` returns
`{"ok": true, "environment": "staging", "passSigner": "0x…", "listings": ["acme"]}`. Neither exposes a secret.

## `POST /v1/idkit/request`

Request: `{"ticker": "acme", "wallet": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"}` (the wallet that will bid).

Response `200`:

```json
{
  "app_id": "app_...",
  "action": "listingday-acme",
  "environment": "staging",
  "allow_legacy_proofs": false,
  "signal": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "preset": { "type": "ProofOfHuman", "signal": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  "rp_context": {
    "rp_id": "rp_...",
    "nonce": "0x…",
    "created_at": 1762400000,
    "expires_at": 1762400300,
    "signature": "0x…"
  }
}
```

Pass these straight into IDKit 4.x (`@worldcoin/idkit`). Do not change `action` or `signal`: the backend rejects a
proof whose `signal_hash` is not `hashSignal(wallet)`, and the request expires after `WORLD_RP_REQUEST_TTL_SECONDS`
(300 s) or after one successful verify.

```tsx
import { IDKitRequestWidget, proofOfHuman, type IDKitResult } from "@worldcoin/idkit";

const req = await post("/v1/idkit/request", { ticker, wallet });

<IDKitRequestWidget
  open={open}
  onOpenChange={setOpen}
  app_id={req.app_id}
  action={req.action}
  rp_context={req.rp_context}
  environment={req.environment}
  allow_legacy_proofs={req.allow_legacy_proofs}
  preset={proofOfHuman({ signal: req.signal })}
  handleVerify={async (result: IDKitResult) => {
    const res = await fetch(`${VERIFY_URL}/v1/idkit/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, wallet, idkitResponse: result }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error); // map with the table below
    setPass(body); // { pass, hookData, ... }
  }}
  onSuccess={() => {}}
/>;
```

## `POST /v1/idkit/verify`

Request: `{"ticker": "acme", "wallet": "0x7099…79C8", "idkitResponse": <the IDKit result object, unmodified>}`.

The backend checks the result (environment, action, protocol, credential `proof_of_human`, `signal_hash`), forwards it
as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`, asserts World's `success` / `environment` /
`action` / `nullifier`, then binds `(action, auction, nullifier) -> wallet` (UNIQUE both ways) and signs the pass.

Response `200` (values from the pinned vector `fixtures/pass-vectors.json`, case `acme-sepolia`):

```json
{
  "pass": {
    "nullifier": "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
    "wallet": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "auction": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "cap": "20000000",
    "expiry": 1762400600
  },
  "signature": "0x67d5c751398545e3a8fa4a231acf9a285b7fbbfabd6998edfc83e438c3908b350d2dceb29d8241096c85b244e1dd40e9a030ed460cf2c6e120d1f63b6ecde6be1c",
  "hookData": "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8000000000000000000000000709979…",
  "digest": "0x6e9fa2db500501e0e165fe3fea08dce8b2f8b693493dc5ae4fa9c05c8cbdba1e",
  "chainId": 11155111,
  "module": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "signer": "0x2954dED3C124849d85b92D7E1A01469EE9c60D37",
  "firstVerification": true
}
```

- `hookData` = `abi.encode((bytes32,address,address,uint128,uint64) pass, bytes signature)`. Pass it through unchanged.
- `expiry` is unix seconds, `now + PASS_TTL_SECONDS` (600). The pass works for **any number of bids** from that wallet
  until then; after it, verify again (same wallet, same person: a fresh pass, `firstVerification: false`).
- `cap` is cumulative **per person**, across every bid and pass: remaining budget =
  `cap - WorldPassModule.committed(WorldPassModule.nullifierOf(wallet))` (both are public views; `nullifierOf` is
  `0x0` until the first accepted bid).
- `digest` / `signature` / `signer` let you check the pass locally (viem `verifyTypedData` with `eip712` above).

### Errors

Every error body is `{"error": "<code>", "message": "<text>"}`, plus `world_code` when World rejected the proof.

| HTTP | `error` | When | Suggested UI |
|---|---|---|---|
| 400 | `invalid_json` / `invalid_request` | Body not JSON, missing `ticker` / `wallet` / `idkitResponse`, bad address | Bug |
| 400 | `unknown_request` | No open request for this wallet + listing: `rp_context.nonce` unknown, expired (5 min), for another wallet, or already used | "Verification timed out, try again" (call `/v1/idkit/request` again) |
| 400 | `environment_mismatch` | Proof (or World's answer) is from another environment than `WORLD_ENVIRONMENT` | "Use the World ID Simulator" (staging) / misconfiguration |
| 400 | `action_mismatch` | Proof for another action than `listingday-<ticker>` | Bug |
| 400 | `unsupported_proof` | Not one Proof of Human response (session proof, other credential, 3.0 proof while legacy is off) | "This listing needs World ID Proof of Human" |
| 400 | `signal_mismatch` | Proof's `signal_hash` is not for this wallet | "Verify with the wallet you bid from" |
| 400 | `world_verification_failed` | World's `/api/v4/verify` rejected it; `world_code` is World's code (e.g. `all_verifications_failed`, `app_not_migrated`) | "World ID verification failed" |
| 404 | `unknown_listing` | Ticker is not a configured human listing | "This listing is open to everyone" |
| 404 / 405 | `not_found` / `method_not_allowed` | Wrong route / method | Bug |
| 409 | `nullifier_bound_to_other_wallet` | **This person already verified another wallet** for this listing | "You already verified a different wallet. Bid from that wallet." |
| 409 | `wallet_bound_to_other_human` | This wallet was already verified by another person | "This wallet is linked to someone else" |
| 413 | `body_too_large` | Body over 64 KiB | Bug |
| 502 | `world_unavailable` | World's endpoint unreachable / 5xx. The request stays open: retry the same verify | "World ID is unavailable, retry" |
| 503 | `busy` | Too many open requests | Retry later |
| 500 | `internal` | Anything else | Retry later |

## Putting `hookData` into `submitBid`

Same flow as an open listing (USDC `approve(Permit2)`, `Permit2.approve(USDC, auction, amount, expiry)`), with the
pass as the last argument. The bid must come **from** the verified wallet and be **owned** by it.

```ts
import { encodeFunctionData } from "viem";

await walletClient.writeContract({
  address: pass.auction,            // the CCA
  abi: ccaAbi,                      // abis/IContinuousClearingAuction.json
  functionName: "submitBid",        // the 5-argument overload
  args: [maxPriceQ96, amount, wallet, prevTickPriceQ96, hookData],
  account: wallet,
});
```

`submitBid(uint256 maxPrice, uint128 amount, address owner, uint256 prevTickPrice, bytes hookData)`; points to Q96:
`points * 792281625142`; `prevTickPrice` = the floor (`100 * 792281625142`) is always a valid hint.

Rejected bids revert with the CCA's `ValidationHookCallFailed(bytes reason)` (`0x5d73cdc5`); decode `reason` with
`abis/IWorldPassModule.json` + `abis/IAuctionValidationHook.json` (see `contracts/errors.md`):

| Inner error | Meaning | UI |
|---|---|---|
| `NotEligible(0)` MissingPass | `hookData` empty | "Verify with World ID first" |
| `NotEligible(1)` InvalidPass | `hookData` malformed / zero nullifier | Bug |
| `NotEligible(2)` WrongSigner | Not signed by the module's `signer` (tampered or another backend) | Bug / misconfiguration |
| `NotEligible(3)` Expired | `block.timestamp > pass.expiry` | Verify again for a fresh pass |
| `NotEligible(4)` WrongWallet | Pass for another wallet than owner / sender | "Bid from the verified wallet" |
| `NotEligible(5)` WrongAuction | Pass for another auction | Verify again for this listing |
| `NotEligible(6)` NullifierBoundToOtherWallet | This person already bid from another wallet | "You already bid from another wallet" |
| `NotEligible(7)` WalletBoundToOtherNullifier | This wallet already bid as another person | "This wallet is linked to someone else" |
| `CapExceeded(newTotal, cap)` | Over the per-person cap | "You can still commit `cap - committed`" |

Pre-check with `eth_call` / `simulateContract` before sending: the same errors come back.

## Privacy

The backend stores only `(action, auction, nullifier, wallet)` in SQLite: no name, document, IP or proof. The pending
request map (nonce -> ticker, wallet, expiry) is in memory for at most 5 minutes. Nullifiers are per app and action, so
they don't link a person across apps or listings.
