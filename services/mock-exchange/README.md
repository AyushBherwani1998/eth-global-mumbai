# mock-exchange

The "exchange" side of Listing Day's market controls. It holds one editable listing policy as JSON:

- The issuer console edits it (halt, cool-off, surveillance or directional mode, reference price, bands).
- The CRE workflow in [`../../cre`](../../cre) `GET`s it on every run, encodes it into a `ListingPolicy` report and writes it to `ListingPolicyReceiver` on Sepolia.
- `ListingHook` enforces the receiver's policy on every swap.

It has no runtime dependencies. Node ≥ 22.18 runs the TypeScript directly through type stripping.

```bash
cd services/mock-exchange
npm install                       # dev deps only (typescript, @types/node)
MOCK_EXCHANGE_SECRET=change-me npm start   # http://127.0.0.1:8787
npm test                          # node:test unit tests (get / edit / auth / persistence)
npm run typecheck
```

| Env | Default | |
| --- | --- | --- |
| `MOCK_EXCHANGE_SECRET` | random, printed at startup | Shared secret for every write |
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` (or `0.0.0.0` when `PORT` is set) | Use `0.0.0.0` to expose it; hosts that inject `PORT` (Railway, …) bind `0.0.0.0` automatically |
| `TICKER` | `ACME` | Initial ticker |
| `STATE_FILE` | unset (in-memory) | JSON file loaded at start and rewritten after every edit |

## HTTP contract

All bodies are JSON. Every response carries `Cache-Control: no-store` and permissive CORS headers (`*`, allowed headers `content-type, x-api-key, authorization`), so a browser console can call it directly.

### `GET /policy` (no auth)

```json
{
  "ticker": "ACME",
  "refPricePoints": null,
  "mode": "normal",
  "halted": false,
  "coolOffUntil": 0,
  "bands": { "normalBps": 2000, "surveillanceBps": 500 },
  "status": "",
  "revision": 0,
  "updatedAt": 1762400000
}
```

| Field | Type | Meaning, and how the CRE workflow maps it into the on-chain `ListingPolicy` |
| --- | --- | --- |
| `ticker` | string, 1–16 chars | Informational only, not on-chain |
| `refPricePoints` | number > 0 with ≤ 2 decimals, or `null` | Reference share price in points (100 = 1.00 USDC per 1,000-share lot). Converted to `refSqrtPriceX96`; `null` becomes `0`, meaning the hook uses the listing price |
| `mode` | `"normal"`, `"surveillance"` or `"directional"` | `mode` 0, 1 or 2. Writes also accept the numbers `0`, `1` and `2` |
| `halted` | boolean | `halted`: every swap reverts and LPs can still exit |
| `coolOffUntil` | integer unix seconds, `0` for none | `coolOffUntil`: swaps revert until then |
| `bands.normalBps` | integer 0–9999 | `normalBandBps`; `0` means the hook default of 2000 (±20%) |
| `bands.surveillanceBps` | integer 0–9999 | `survBandBps`; `0` means the hook default of 500 (±5%) |
| `status` | `""`, `"draft"`, `"auction"`, `"listed"`, `"surveillance"` or `"halted"` | ENS `listingday.status` override. `""` lets the receiver derive it: `halted` while halted or cooling off, `surveillance` when the mode is not normal, otherwise `listed` |
| `revision` | integer | Read-only; bumped on every successful write |
| `updatedAt` | integer unix seconds | Read-only; time of the last write |

`asOf`, `version` and `chainSelector` are not part of the API. The workflow sets `asOf` to the execution time and the chain selector from its target network, and the receiver assigns `version`.

### Writes (auth required)

Send the secret as `x-api-key: <secret>` or `Authorization: Bearer <secret>`. A missing or wrong key returns `401 {"error":"unauthorized"}` and leaves the policy unchanged.

| Request | Effect |
| --- | --- |
| `POST /policy` with a partial body, e.g. `{"halted": true}` | Merges the given fields. `bands` merges per field |
| `PUT /policy` with a full body | Replaces the policy. Omitted fields go back to their defaults; `ticker` is kept |
| `POST /policy/reset` | Restores the defaults |

Each write returns `200` with the new policy, in the same shape as `GET`.

Errors:

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error":"invalid_policy","details":["mode must be one of ...", ...]}` | Validation failed: unknown or read-only fields, wrong types, out-of-range values. The response lists every problem, and nothing is applied |
| `400` | `{"error":"invalid_json"}` | The body is not JSON |
| `401` | `{"error":"unauthorized"}` | Missing or wrong secret |
| `404` | `{"error":"not_found"}` | Unknown path |
| `405` | `{"error":"method_not_allowed"}` (with an `Allow` header) | Unsupported method |
| `413` | `{"error":"body_too_large"}` | The body is over 16 KiB |

`GET /health` returns `{"ok": true}`.

### Examples

```bash
S=change-me; API=http://127.0.0.1:8787
curl -s $API/policy
curl -s -X POST $API/policy -H "x-api-key: $S" -H 'content-type: application/json' -d '{"halted":true}'
curl -s -X POST $API/policy -H "x-api-key: $S" -H 'content-type: application/json' \
  -d '{"halted":false,"coolOffUntil":'$(($(date +%s)+600))'}'
curl -s -X POST $API/policy -H "x-api-key: $S" -H 'content-type: application/json' \
  -d '{"mode":"directional","refPricePoints":90}'
curl -s -X POST $API/policy/reset -H "x-api-key: $S"
```

Changes reach the chain on the next workflow run: the cron schedule, or an HTTP trigger, which the console can fire through `cre workflow simulate --listen`, as described in [`cre/README.md`](../../cre/README.md).
