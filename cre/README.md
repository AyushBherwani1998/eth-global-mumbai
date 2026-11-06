# CRE workflow: listing policy

A Chainlink CRE workflow (TypeScript SDK `@chainlink/cre-sdk` 1.23, CLI ≥ 1.39) that carries the exchange's market
controls on-chain. On each run it:

1. Fires on a **cron** schedule (trigger 0), or on a **manual HTTP** trigger (trigger 1), whose body is ignored.
2. `GET`s the mock exchange policy ([`../services/mock-exchange`](../services/mock-exchange)), with identical-value consensus across nodes.
3. Converts it into the on-chain `ListingPolicy`:
   - points become the pool's `sqrtPriceX96`, bit-exact with `ListingPrice.pointsE2ToSqrtPriceX96`;
   - mode names become 0, 1 or 2;
   - `asOf` is the execution time;
   - the chain selector is the target chain's (Sepolia `16015286601757825753`).
4. Encodes the report as `abi.encode(ListingPolicy, string status)`, has it signed with `runtime.report`, and calls `writeReport` to `ListingPolicyReceiver` with `gasConfig.gasLimit = 1800000`.
5. Fails the run if the transaction fails or if the receiver rejected the report. The forwarder swallows receiver reverts into `ReportProcessed.result == false`; the workflow surfaces it through `receiverContractExecutionStatus`.

Contract side: [`../contracts/README.md`](../contracts/README.md#listingpolicyreceiver-chunk-4).

```
cre/
  project.yaml                 RPCs per target (staging-settings = Sepolia)
  .env.example                 CRE_ETH_PRIVATE_KEY (broadcast only), CRE_API_KEY
  listing-policy/
    main.ts                    entry point (Javy allows only a parameterless `main` export)
    workflow.ts                triggers + handlers (fetch -> encode -> report -> writeReport)
    policy.ts                  pure logic: API JSON validation, price math, ABI encoding
    workflow.yaml              workflow name + artifact paths per target
    config.staging.json        schedule, apiUrl, chainSelectorName, receiverAddress, usdcIsCurrency0, gasLimit
    fixtures/report-vectors.json  golden payloads, also checked by contracts/test/unit/CreReportFixture.t.sol
    policy.test.ts, workflow.test.ts
```

## Config (`config.staging.json`)

| Key | Value | |
| --- | --- | --- |
| `schedule` | `0 */1 * * * *` | 6-field cron (seconds first). The DON minimum is 30 s; simulation runs once per invocation |
| `apiUrl` | `http://127.0.0.1:8787/policy` | The simulator runs on your machine, so localhost works. A DON deployment needs a public URL |
| `chainSelectorName` | `ethereum-testnet-sepolia` | |
| `receiverAddress` | `0x000…000` | **Set this** to the deployed `ListingPolicyReceiver` |
| `usdcIsCurrency0` | `true` | Pool orientation. True on Sepolia, where MockSME is salted above USDC. Must match `ListingHook.usdcIsCurrency0()` |
| `gasLimit` | `"1800000"` | Forwarder plus receiver, including the best-effort ENS write (capped at 1M inside the receiver) |

## Tests (no CRE account needed)

```bash
cd cre/listing-policy
bun install           # Bun >= 1.2.21; also fetches the Javy plugin (cre-setup)
bun test              # 22 tests
bun run typecheck     # tsc over the workflow sources (the SDK types node:* as unavailable, so tests are excluded)
bun run build         # cre-compile main.ts -> /tmp/listing-policy.wasm (the same compiler `cre` uses)
```

- `policy.test.ts`: API validation, price math, ABI round-trip, and the golden vectors.
- `workflow.test.ts`: runs the real handlers on the SDK's test runtime (`@chainlink/cre-sdk/test`) against a live `services/mock-exchange` instance.
  - The console edits are real HTTP calls.
  - The HTTP capability mock serves the body fetched from the running API.
  - The EVM mock captures `writeReport`.
  - Each run's report payload must equal the golden vector, and the receiver address and gas limit are checked too.
  - Also covered: a receiver rejection, a reverted transaction and an API error each fail the run.
- `contracts/test/unit/CreReportFixture.t.sol` rebuilds the same vectors with Solidity (`ListingPrice` + `abi.encode`) and pushes them through a forwarder into the receiver. Encoding drift between TypeScript and Solidity fails one side or the other.
- After an intentional encoding change: `bun run fixtures`, then rerun both suites.

## Simulate (manual: needs a CRE account)

Every `cre` command, including `simulate`, requires `cre login` or `CRE_API_KEY`. No account was available when this
was built, so the steps below are **manual checks**. The offline evidence above covers the same code path, minus the
CLI host itself.

```bash
# 0. once
curl -sSL https://app.chain.link/cre/install.sh | bash  # cre CLI
cre login                                              # or: export CRE_API_KEY=...
cd cre/listing-policy && bun install && cd ..

# 1. mock exchange in another terminal
cd services/mock-exchange && MOCK_EXCHANGE_SECRET=change-me npm start

# 2. dry run (no transaction). From cre/:
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0
#    manual trigger instead of cron:
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 1 --http-payload '{}'
```

Expected output: the user logs show the decoded policy line and `report payload 0x…`. With the API at defaults and the
run at unix time `T`, the payload equals the `default` vector in `fixtures/report-vectors.json` with `asOf` replaced by
`T`, because `asOf` is the second 32-byte word of the payload. In a dry run `writeReport` is only prepared, so check the
payload, not the transaction.

## Broadcast to Sepolia (manual: needs a funded key)

```bash
# 1. Deploy the receiver; the broadcaster is the address of the key the CLI will send from.
cd contracts
CRE_BROADCASTER=$(cast wallet address --private-key 0x$CRE_ETH_PRIVATE_KEY) \
LISTING_HOOK=<ListingHook, if this key owns it> \
  forge script script/DeployListingPolicyReceiver.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key 0x$CRE_ETH_PRIVATE_KEY
#    (or later, from the hook owner: cast send <hook> "setPolicySource(address)" <receiver>)

# 2. Put the receiver into listing-policy/config.staging.json -> receiverAddress, and the key into cre/.env:
#    CRE_ETH_PRIVATE_KEY=<hex without 0x>   (funded with Sepolia ETH)

# 3. Broadcast: the CLI sends MockKeystoneForwarder.report(...) from CRE_ETH_PRIVATE_KEY.
cd ../cre
cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0 --broadcast

# 4. Verify on-chain. ReportProcessed must have result == true and PolicyApplied must be present:
cast receipt <txHash> --rpc-url $SEPOLIA_RPC_URL --json | jq '.logs[] | {address, topics, data}'
#    ReportProcessed topic0 0x3617b009e9785c42daebadb6d3fb553243a4bf586d07ea72d65d80013ce116b5, data = result (bool)
#    PolicyApplied  topic0 0x4a619e4f7dcb3d9c6f7a74ff80a459db28f4ba354851ff0e43c3db31ecb95e71
cast call <receiver> "latestPolicy()((uint32,uint64,uint64,uint160,uint16,uint16,uint8,bool,uint64))" --rpc-url $SEPOLIA_RPC_URL
```

Then edit the API, for example `{"halted": true}`, broadcast again, and swaps through the hook revert with `Halted()`.
`contracts/test/fork/ListingLifecycle.fork.t.sol` (`test_fork_creReceiver_haltAndResumeThroughLiveMockForwarder`)
runs this exact path against the live Sepolia forwarder on a fork.

**Manual trigger from the console.** Run `simulate --listen` with `--broadcast` to keep a local HTTP trigger server
on `localhost:2000`. The console POSTs to it after each edit, and each request runs the workflow once:

```bash
cre workflow simulate ./listing-policy --target staging-settings --trigger-index 1 --listen --broadcast
```

If a broadcast gets `ReportProcessed.result == false`, check the following. The workflow fails the run with
`ListingPolicyReceiver rejected the report`.

| Symptom | Cause |
| --- | --- |
| `InvalidOrigin` | The key in `.env` is not the receiver's `broadcaster`. Fix with `setBroadcaster` |
| `StaleReport` | Two runs in the same second, or a clock behind the last report |
| `ReportExpired` | The machine's clock is far behind the chain |
| `InvalidSender` | The receiver's forwarder is not `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, the forwarder the CLI uses on Sepolia |

## CRE risks (plan.md §14) and how they are handled

- **The simulation forwarder is permissionless.** It checks no signatures and `route()` is public. The receiver also requires `tx.origin == broadcaster` and holds a reentrancy lock, and spoofed reports are tested both locally and on a fork. Moving to a DON means `setForwarder(KeystoneForwarder 0xF8344CFd5c43616a4366C34E3EEE75af79a74482)` and `setBroadcaster(0)`.
- **Silent failures.** Receiver reverts don't fail the transaction, so the workflow checks `receiverContractExecutionStatus` and the console should watch `ReportProcessed.result`.
- **Gas.** The ENS write is bounded (1M, try/catch) inside a 1.8M limit. A fork test delivers an out-of-gas ENS failure within 1.5M and still applies the policy.
- **A stale feed.** It fails closed: the hook sees `halted` once `asOf + maxAge` passes.
- **Consensus.** Nodes must see an identical normalised policy. Edits that land mid-fetch can fail one round; the next run retries.
