# Deploying the Listing Day demo to Sepolia

> **Manual step for the owner.** The real `--broadcast` run needs a funded deployer key and Circle Sepolia USDC,
> which CI and the build VM don't have. Everything below, including the ENSv2 steps (section 5), has been rehearsed on
> a Sepolia fork (`make demo-fork` / `make ens-fork`, also run in CI) and as separate broadcast processes against a
> local anvil fork of Sepolia (`make demo-anvil`), but **nothing has been broadcast to Sepolia yet** and
> `listingday.eth` is not registered. `deployments/sepolia.json` appears after you run it.

All commands run from `contracts/`. Every step is a `forge script` that reads and updates
`deployments/sepolia.json`, skips whatever is already done, and can be re-run after a failure (RPC hiccup, a wallet
without USDC, a step run too early). Every transaction the scripts send is logged as `tx: ...` and, after each step,
`make export-json` copies the hashes from forge's `broadcast/` logs into the `txs` section of the file, with Etherscan
links.

## 1. What you need

| Env var | Required | What |
|---|---|---|
| `SEPOLIA_RPC_URL` | yes | Sepolia RPC. A public one works (`https://ethereum-sepolia-rpc.publicnode.com`); a keyed one (Alchemy, Infura) is more reliable for `--broadcast --slow` |
| `PRIVATE_KEY` | yes | Deployer = issuer = hook owner = receiver owner. Also the funder, treasury and CRE broadcaster unless set below. Hex, `0x...` |
| `DEMO_WALLET_KEYS` | yes | Comma-separated private keys of the demo wallets, at least 6: wallets 0 to 4 bid, wallet 5 is the trader. Up to 8 is fine (6 and 7 are spares for the live demo) |
| `ETHERSCAN_API_KEY` | no | If set, `make deploy` verifies the contracts (`--verify`) |
| `TREASURY_KEY` | no | Treasury (auction `tokensRecipient`, LP NFT owner, sweeps and removes LP). Default `PRIVATE_KEY` |
| `CRE_BROADCASTER_KEY` | no | The key the receiver accepts reports from (`tx.origin` guard). **Use the same key as `CRE_ETH_PRIVATE_KEY` in `../cre/.env`** so the CRE workflow can also update the policy. Default `PRIVATE_KEY` |
| `FUNDER_KEY` | no | Who pays for `make fund`. Default `PRIVATE_KEY` |
| `DEMO_LABEL` | no | CREATE2 salt namespace, default `acme-v1`. Change it (e.g. `acme-v2`) to deploy a fresh listing next to an old one |
| `ENS_OWNER_KEY` | no | ENS step 5: the exchange key that owns `listingday.eth` and the UserRegistry root roles. Default `PRIVATE_KEY` |
| `ISSUER_KEY` | no | ENS step 5: owns `acme.listingday.eth` and its resolver, writes the records. Default `PRIVATE_KEY` (the deployer is the issuer) |

Copy `.env.example` to `.env` and fill it in; the Makefile loads it. Never commit `.env`.

Optional tuning (defaults are the plan.md §4/§12 demo):

| Env var | Default | Used by |
|---|---|---|
| `START_DELAY_BLOCKS` | 10 | launch: blocks between the launch and the auction's `startBlock` (the hook must be bound before it) |
| `BID_WINDOW_BLOCKS` | 30 | launch: zero-issuance blocks for bidding (about 6 min). Raise it if the bids may run late |
| `CLEAR_BLOCKS` | 20 | launch: blocks that release the 90,000 shares (must divide 1e7) |
| `BID_AMOUNTS` | `20000000,20000000,20000000,20000000,19000000` | bids: raw USDC per bidding wallet (99 USDC, clears at 110 points) |
| `BID_MAX_POINTS` | 190 | bids: every bid's max price (the cap) |
| `MAX_BIDS_PER_RUN` | all | bids: bid from at most this many wallets per run (spread bids over the window) |
| `TRADER_INDEX` | number of bidders (5) | trade: index in `DEMO_WALLET_KEYS` of the trader |
| `IN_BAND_POINTS` / `OUT_OF_BAND_POINTS` | 114 / 117 | trade |
| `LISTING_DAY_SECONDS` | 3600 | deploy: listing-day band duration after migration |
| `POLICY_MAX_AGE` | 86400 | deploy: receiver `maxAge` (policy fails closed to halted after this) |
| `LP_REMOVE_BPS` | 1000 | halt: share of the LP removed while halted (10%) |
| `FUND_USDC` / `FUND_ETH` | 20 USDC / 0.02 ETH | fund: target balance per demo wallet (only the shortfall is sent) |
| `DEPLOYMENTS_FILE` | `deployments/sepolia.json` | every step |
| `ENS_PARENT_LABEL` / `ENS_TICKER` | `listingday` / `acme` | ENS: the names |
| `ENS_DURATION` | 31536000 (1 year) | ENS: `listingday.eth` registration, at least 2419200 (28 days); about 8.0 MockUSDC per year |
| `ENS_ELIGIBILITY` | `open` | ENS records: `listingday.eligibility` (`human` once the World ID module is live) |
| `ENS_DESCRIPTION` / `ENS_URL` / `ENS_AVATAR` | MockSME name + summary / the repo / inline SVG | ENS records |
| `ENS_SECRET` | derived from `ENS_OWNER_KEY` | ENS: commit secret (deterministic so the reveal run recomputes it) |

### Balances

Gas measured on the anvil rehearsal, in gas units:

| Who | Steps | Gas |
|---|---|---|
| Deployer | deploy 43.6M, launch 30.9M, settle ~5M (exits, claims, migrate), trade 12.6M (swap router + approvals + swap), halt 1M | ~93M |
| Each bidder | `approve`, `Permit2.approve`, `submitBid` | ~2.1M |
| Treasury | sweep, LP removal | ~0.6M |
| CRE broadcaster | two `report` transactions (halt, resume) | ~0.5M |

At 5 gwei that's about 0.47 ETH for the deployer, so give it **at least 0.7 ETH** (deployer plus 0.02 ETH for each
demo wallet, treasury and broadcaster, which `make fund` sends). Check `cast gas-price --rpc-url $SEPOLIA_RPC_URL`
first; Sepolia is usually far cheaper.

USDC: the bids need 99 USDC and the trader a few. `make fund` tops every demo wallet up to 20 USDC, so the funder
needs 20 USDC times the number of wallets short of it (120 USDC for 6 empty wallets). The
[Circle faucet](https://faucet.circle.com) (Ethereum Sepolia) gives **20 USDC per request, one request per address
every 2 hours**, so either request it for the funder over several windows, or request it directly for each demo wallet
(the fund step then sends them only ETH). Sepolia ETH:
[Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or any PoW faucet.

Tools: Foundry 1.x (`foundryup`), `jq`, `make`, `bash`. From the repo root, `git submodule update --init` once.

## 2. Rehearse first (no keys, nothing broadcast)

```bash
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
make demo-fork     # whole flow in one process on a fork, every step twice, asserts after each step
make ens-fork      # the ENSv2 steps in one process on a fork (deploy + launch, listingday.eth, acme, records, status)
make demo-anvil    # every step, ENS included, as its own --broadcast process against a local anvil fork (needs anvil)
```

`make demo-fork` ends with `DemoFork: all steps passed; wrote deployments/sepolia-fork.json`, `make ens-fork` with
`EnsFork: all steps passed; wrote deployments/sepolia-ens-fork.json`. `make demo-anvil` ends with
`anvil rehearsal done: deployments/anvil.json` (`KEEP_ANVIL=1` leaves the chain running at `http://127.0.0.1:8546`
to point the frontend at). The files are git-ignored and show the shape of the real one.

## 3. The real run

```bash
cp .env.example .env && $EDITOR .env    # PRIVATE_KEY, DEMO_WALLET_KEYS, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY
make balances                            # read-only: funder and wallet balances + faucet links
make fund                                # USDC + ETH to the demo wallets (skip if they're already funded)
make demo-sepolia                        # deploy, launch, wait, bids, wait, settle, trade, halt
make ens-sepolia                         # section 5; best run right after `make launch`, see there
```

`make demo-sepolia` takes about 15 minutes: the auction opens 10 blocks after the launch, the bid window is 30
blocks and the clearing 20 more (12 s blocks). The two `wait-*` targets poll `cast block-number` and print the
remaining time. The individual targets, in order (run any of them again if it failed):

| Target | Script | What it does | Expected output (last lines) |
|---|---|---|---|
| `make deploy` | `DemoDeploy.s.sol` | MockSME (CREATE2 salt so MockSME > USDC, USDC is `currency0`), `AllowAllModule` + `AuctionValidationHook`, mined `ListingHook` (flags `0x30C0`), `ListingPolicyReceiver` (forwarder = Sepolia `MockKeystoneForwarder`, broadcaster = `CRE_BROADCASTER_KEY`'s address), `hook.setPolicySource(receiver)` | `ListingPolicyReceiver 0x... (deployed)`, `wrote deployments/sepolia.json` |
| `make launch` | `DemoLaunch.s.sol` | Permit2 approvals, `LiquidityLauncher.multicall(depositToken, distributeToken)` (110,000 shares: 90,000 auction, 20,000 LP, floor 80, 20% of the raise to LP, graduation 45 USDC), `setAuction` before `startBlock` | `auction (CCA) 0x...`, `startBlock`, `bid window end`, `endBlock`, `migrationBlock` |
| `make wait-start` | `wait-for-block.sh` | Waits for `startBlock` | `block N >= .auction.startBlock (N)` |
| `make bids` | `DemoBid.s.sol` | Per bidder: `USDC.approve(Permit2)`, `Permit2.approve(USDC, auction)`, `submitBid(190 points, amount, wallet, floor, "")`. Skips wallets that already bid; stops with the faucet link if a wallet is short | `bid from 0x... 20000000` ... `bidId 4` |
| `make wait-migration` | | Waits for `migrationBlock` | |
| `make settle` | `DemoSettle.s.sol` | `checkpoint`, `exitBid` + `claimTokens` for every bid, `sweepUnsoldTokens` (treasury), `LBPStrategy.migrate` with a fixed 5M gas limit. Checks the `Migrated` event and `hook.listed()`, not just the tx status (`migrate` swallows failures) | `graduated true`, `currencyRaised (raw USDC) 99000000`, `clearing price (points) 110`, `pool opened at: 109.99 points`, `LP NFT (PositionManager) tokenId N` |
| `make trade` | `DemoTrade.s.sol` | Deploys a `PoolSwapTest` router; the trader buys to 114 points (in band); simulates a buy to 117 points and decodes the revert | `band: 104.49 - 115.49 points`, `after the in-band buy: 113.99 points`, `buy to 117 points reverts: OutOfBand(sqrtPriceX96, min, max)` and a `cast send ...` command |
| `make halt` | `DemoHalt.s.sol` (`HALTED=true`) | Sends a halt policy through the `MockKeystoneForwarder` to the receiver, checks `ReportProcessed.result`, simulates a swap (`Halted()`), removes 10% of the LP from the treasury | `ReportProcessed.result = true, policy version 1`, `swap while halted reverts: Halted()`, `LP removal while halted ok` |
| `make resume` | `DemoHalt.s.sol` (`HALTED=false`) | Lifts the halt | `ReportProcessed.result = true, policy version 2` |
| `make export-json` | `ExportDeployments.s.sol` | Copies tx hashes into `.txs` (runs after every step) | `[deploy]` `https://sepolia.etherscan.io/tx/0x...  block N  ok  create MockSME` ... |

After the run, commit `deployments/sepolia.json` (it's meant to be committed; `broadcast/` is not needed by the app).

### The out-of-band revert onchain

`make trade` proves the 117-point buy reverts by simulating it (so the run doesn't stop), records the decoded error in
`.trade`, and prints a ready `cast send` for the same swap. To have a failed transaction on Etherscan for the demo:

```bash
export TRADER_KEY=<the trader's key: DEMO_WALLET_KEYS entry number TRADER_INDEX, default the 6th>
$(jq -r .trade.outOfBandCastCommand deployments/sepolia.json)
```

The explicit `--gas-limit` skips gas estimation, which would otherwise refuse to send a reverting tx. The receipt has
`status 0`; `cast run <hash> --rpc-url $SEPOLIA_RPC_URL` shows `OutOfBand`.

### Halt: CRE path vs. script path

The receiver has no owner halt function: the only way in is a report from the forwarder, sent by the broadcaster.

- **CRE path (the demo story).** Set the mock exchange policy to halted
  ([`../services/mock-exchange`](../services/mock-exchange/README.md)), then run the workflow simulation with
  broadcast, as in [`../cre/README.md`](../cre/README.md#broadcast-to-sepolia-manual-needs-a-funded-key):

  ```bash
  curl -s -X POST $API/policy -H "x-api-key: $S" -H 'content-type: application/json' -d '{"halted":true}'
  cd ../cre && cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0 --broadcast
  ```

  It needs `receiverAddress` in `../cre/listing-policy/config.staging.json` set to
  `jq -r .contracts.listingPolicyReceiver deployments/sepolia.json`, and `CRE_ETH_PRIVATE_KEY` in `../cre/.env` to be
  `CRE_BROADCASTER_KEY` without the `0x`. Each accepted report bumps `policyVersion`; after a CRE report, `make halt` /
  `make resume` still work (they send with `asOf` after the last accepted one).
- **Script path (fallback, and what `make halt` does).** `DemoHalt.s.sol` builds the same report the workflow would
  (CRE metadata + `abi.encode(ListingPolicy, "")`) and calls `MockKeystoneForwarder.report` from the broadcaster key.
  Same contract path, same checks, no CRE CLI needed. `make resume` sends the reopen.

### Verification

With `ETHERSCAN_API_KEY` set, `make deploy` passes `--verify`. If a contract doesn't verify (for example a transient
Etherscan error), re-run verification by hand; constructor arguments are in the broadcast log:

```bash
forge verify-contract $(jq -r .contracts.listingPolicyReceiver deployments/sepolia.json) \
  src/ListingPolicyReceiver.sol:ListingPolicyReceiver --chain sepolia --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "f(address,address,address,uint64,uint64)" \
    $(jq -r '.deployer, .receiverConfig.forwarder, .receiverConfig.broadcaster, .receiverConfig.chainSelector, .receiverConfig.maxAge' deployments/sepolia.json))
```

### If something goes wrong

| Symptom | Fix |
|---|---|
| `bids` says the auction hasn't started | `make wait-start`, then `make bids` |
| `bids` stops on a wallet short of USDC | Faucet that wallet (or `make fund`), re-run `make bids`; wallets that already bid are skipped |
| Bids ran past the bid window | Fine: bids are accepted until `endBlock`; the clearing price can then differ from 110 |
| `settle` says too early | `make wait-migration`, then `make settle` |
| `settle` logs `MigrationFailed` | The reason is printed. Re-run `make settle` (it checks `Migrated`, not the tx status) |
| The auction didn't graduate (< 45 USDC) | `settle` refunds every bid and stops before migration. Start a new listing with `DEMO_LABEL=acme-v2 make deploy launch ...` |
| `halt` fails with a broadcaster mismatch | `CRE_BROADCASTER_KEY` must be the key whose address is `receiverConfig.broadcaster` |
| A broadcast step died midway | Re-run the same target; forge's `--resume` is not needed |

## 4. What the frontend gets

- **`deployments/sepolia.json`**: everything the app needs, written by the steps above.
  - `chainId`, `label`, `deployBlock`, `deployer` (issuer), `issuer`, `treasury`, `creBroadcaster`
  - `contracts`: `mockSME`, `allowAllModule`, `auctionValidationHook`, `listingHook`, `listingPolicyReceiver`
  - `external`: `usdc`, `permit2`, `ccaFactory`, `liquidityLauncher`, `lbpStrategy`, `poolManager`, `positionManager`, `stateView`, `quoter`, `universalRouter`, `creMockForwarder`, `create2Factory`
  - `pool`: `poolId`, `poolKey` (`currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`), `usdcIsCurrency0`, `listingDayBandBps`, `listingDaySeconds`
  - `receiverConfig`: `forwarder`, `broadcaster`, `chainSelector` (string), `maxAge`
  - `params`: share supply, auction supply, LP reserve, floor / issue / cap points and their Q96 prices, applicant cap, graduation threshold, LP rate
  - `auction`: `address`, `startBlock`, `bidWindowEndBlock`, `endBlock`, `claimBlock`, `migrationBlock`, `floorPriceQ96`, `tickSpacingQ96`, `requiredCurrencyRaised`, `totalSupply`, `reservedTokenAmountForLP`, `tokensRecipient`, `fundsRecipient`, `validationHook`
  - `bids`: `count`, `committedTotal`, `list[]` of `{id, owner, amount, maxPriceQ96, maxPricePoints, startBlock}`
  - `results`: `graduated`, `currencyRaised`, `clearingPriceQ96`, `clearingPoints`, `totalCleared`, `unsoldSwept`, `migrated`, `listingSqrtPriceX96`, `listingPointsE2`, `listedAt`, `listingDayEndsAt`, `poolLiquidity`, `treasuryUsdc`, `treasuryShares`, `lpTokenId`
  - `trade`: `swapRouter` (PoolSwapTest), `trader`, the in-band result, the out-of-band error, revert data, band, and the `cast` command
  - `halt`: `halted`, `policyVersion`, `lastExecutionId`, `haltedSwapRevertData`, `lpTokenId`, `lpLiquidityBefore`, `lpRemovedLiquidity`
  - `ens` (section 5): `external` (ENSv2 addresses), `parent` (`listingday.eth`: `owner`, `tokenId`, `expiry`, `subregistry`, `dnsName`, `node`, `commit`), `userRegistry` (`address`, `rootAccount`, `rootRoles`, `emancipated`), `ticker` (`acme.listingday.eth`: `owner`, `tokenId`, `resolver`, `ownerRoles`, `transferable`, `dnsName`, `node`), `resolver` (`address`, `owner`), `records` (`addr60` and every text key, as read from the resolver), `statusRole` (`receiver`, `granted`, `mirrorResolver`, `mirrorName`, `receiverStatus`). Token ids change on role changes: the app should use `findTokenId(label)`, the file only shows the latest one
  - `txs`: per step (`fund`, `deploy`, `launch`, `bids`, `settle`, `trade`, `halt`, `ensName`, `ensRegistry`, `ensTicker`, `ensRecords`, `ensStatusRole`) a list of `{hash, block, status, label}`

  Numbers above 2^53 (token amounts in wei, sqrt prices, the chain selector) are JSON strings.
- **`abis/*.json`**: plain ABI arrays (`make abis` regenerates them from the build; CI checks they're current). Ours:
  `MockSME`, `AllowAllModule`, `AuctionValidationHook`, `ListingHook`, `ListingPolicyReceiver` and their interfaces
  `IListingHook`, `IListingPolicyReceiver`, `IAuctionValidationHook`, `IEligibilityModule`. External:
  `IContinuousClearingAuction`, `ILBPStrategy`, `ILiquidityLauncher`, `IAllowanceTransfer` (Permit2), `IPoolManager`,
  `IPositionManager`, `IStateView`, `IV4Quoter`, `PoolSwapTest`, `IERC20Metadata`. ENSv2 (official, from the
  contracts-v2 tag): `abis/ensv2/` `ETHRegistrar`, `ETHRegistry`, `UserRegistryImpl` (the `listingday.eth` registry),
  `PermissionedResolverImpl` (the issuer's resolver), `VerifiableFactory`, `UniversalResolverV2`,
  `StandardRentPriceOracle`, `MockUSDC`.
- ENS reads: the [frontend read guide](README.md#frontend-read-guide) (viem `getEnsAddress` / `getEnsText`, `ccipRead: false`).
- Error selectors and event topics: [`errors.md`](errors.md).

## 5. ENSv2 ticker namespace (chunk 6)

> **Manual step.** Registering `listingday.eth` and the ticker is a live `--broadcast` on Sepolia ENSv2 with funded
> keys, so it is not done here. It is rehearsed on a fork (`make ens-fork`, `EnsNamespace.fork.t.sol`, both in CI)
> and as broadcasts against anvil (`make demo-anvil`). Design and records: [README](README.md#ensv2-ticker-namespace-chunk-6).

**When.** Steps 1 and 2 (`listingday.eth`, the UserRegistry) don't depend on the listing and can run any time. Steps 3
to 5 read `deployments/sepolia.json`, so run them after `make deploy`. Best: right after `make launch` (so
`listingday.auction` is set) and before `make halt` (so the halt report lands in `listingday.status` live). Running
later is fine too: `ens-status-role` then mirrors the receiver's current status with `syncStatus()`.

**Keys.** `ENS_OWNER_KEY` (the exchange; default `PRIVATE_KEY`) and `ISSUER_KEY` (default `PRIVATE_KEY`) each need
Sepolia ETH (0.05 is plenty, gas below). ENS MockUSDC is minted by the script (public `mint`, ~8.0 per year), no faucet. `PRIVATE_KEY` must be the
receiver owner (the deployer) for `setStatusMirror`.

```bash
make ens-sepolia      # = ens-name ens-registry ens-ticker ens-records ens-status-role ens-read
```

| Target | Script | What it does | Expected output (last lines) |
|---|---|---|---|
| `make ens-name` | `EnsName.s.sol`, `wait-for-commit.sh`, `EnsName.s.sol` | Run 1: mint the MockUSDC shortfall, `approve(ETHRegistrar, price)`, `commit`. Wait until 60 s after the commit was mined (reads `commitmentAt` from chain, ~1–2 min). Run 2: `register` | run 1: `committed 0x...`; wait: `ready to register`; run 2: `registered listingday.eth to 0x...`, `paid (ENS MockUSDC, 6 dec) 8000021`, `expiry ...` |
| `make ens-registry` | `EnsRegistry.s.sol` | `VerifiableFactory.deployProxy(UserRegistryImpl, ...)` with our root roles, `setParent`, `ETHRegistry.setSubregistry` | `UserRegistry 0x...`, `root roles of 0x... 0x...1101` |
| `make ens-ticker` | `EnsTicker.s.sol` | Issuer: PermissionedResolver proxy. Exchange: `register("acme", issuer, 0, resolver, SET_RESOLVER\|RENEW, parentExpiry)` | `ticker acme.listingday.eth`, `owner (issuer) 0x...`, `tokenId ...`, `resolver (issuer's PermissionedResolver) 0x...` |
| `make ens-records` | `EnsRecords.s.sol` | One issuer `multicall` with the records that differ | `set addr(60) = 0x...` ... `set avatar = data:image/svg+xml;base64,...`, `tx: PermissionedResolver.multicall(9 setters)`; on a re-run `records already up to date` |
| `make ens-status-role` | `EnsStatusRole.s.sol` | Issuer `grantSetterRoles(setText(name, "listingday.status", ""), receiver)`; receiver owner `setStatusMirror(resolver, dnsName)`; `syncStatus()` if a report already landed | `receiver 0x... may set listingday.status`, `mirror 0x... 0x0461636d650a6c697374696e676461790365746800`, `listingday.status now: <empty or listed>` |
| `make ens-read` | `EnsRead.s.sol` | Read-only: all records through the Universal Resolver, compared with the deployments file | `resolver 0x...`, `addr(60) 0x...`, one line per key, `records match the deployments file` |

Every target ends with `make export-json` (tx hashes into `.txs.ens*`) and rewrites `.ens` from chain state. A
re-run of any target sends nothing that is already in place. Gas, measured on the anvil rehearsal:

| Signer | Transactions | Gas |
|---|---|---|
| `ENS_OWNER_KEY` | `mint` 141k, `approve` 128k, `commit` 127k, `register` 654k, registry `deployProxy` 903k, `setParent` 252k, `setSubregistry` 140k, ticker `register` 498k | ~2.85M |
| `ISSUER_KEY` | resolver `deployProxy` 791k, records `multicall` 4.36M (the avatar SVG is most of it), `grantSetterRoles` 259k | ~5.41M |
| `PRIVATE_KEY` | `setStatusMirror` 242k, `syncStatus` 275k (only if a report already landed) | ~0.52M |

These are Sepolia's current gas costs: anvil forks it with the live schedule, and a MockUSDC `approve` estimates the
same 128k on Sepolia itself. At 1–2 gwei that is about 0.003–0.006 ETH for the exchange and 0.006–0.011 ETH for the
issuer; fund each with 0.05 ETH to be safe. A halt or resume report with the mirror costs 351k / 241k gas, which the
CRE broadcaster pays, well under the workflow's 1.8M `gasLimit`.

After a fresh listing (`DEMO_LABEL=acme-v2 make deploy launch`), run `make ens-records ens-status-role` again. That
re-points the records and the mirror at the new contracts and grants the new receiver the status role. The old
receiver keeps its role until the issuer revokes it:
`cast send <resolver> "revokeRoles(uint256,uint256,address)" $(cast keccak listingday.status) 0x10 <old receiver> --private-key $ISSUER_KEY --rpc-url $SEPOLIA_RPC_URL`.

| Symptom | Fix |
|---|---|
| `listingday.eth is not available` | Someone else holds it: set `ENS_PARENT_LABEL` to another label (all steps use it) |
| `commitment too new` | The wait was cut short: run `make ens-name` again (it reuses the pending commitment) |
| `UserRegistry not wired under the parent name` / `ticker not registered` | Run the earlier ENS target first |
| `... is owned by someone other than ISSUER_KEY` | The ticker belongs to another issuer key: use that key, or another `ENS_TICKER` |
| `PRIVATE_KEY is not the receiver owner` | `setStatusMirror` is owner-only: `PRIVATE_KEY` must be the deployer |
| `listingday.status` didn't change after a report | Check the receiver's `StatusMirrorFailed` event; `EACUnauthorizedAccountRoles` means the role is missing (`make ens-status-role`). `syncStatus()` retries |
