# Listing Day: plan validation

This file validates [`plan.md`](plan.md) against primary sources: official repos at pinned commits, deployment pages, docs, ETHGlobal Mumbai prize and rules pages, and `eth_call` / `eth_getCode` on Sepolia.

- **When:** Fri Nov 6 2026, ~13:30–14:00 IST, at Sepolia block ~12,075,280.
- **Source pins:**
  - `Uniswap/liquidity-launcher` `266c187` (main; tag `v3.3.0` has the same rules).
  - `Uniswap/continuous-clearing-auction` `ce78b4d` (main).
  - `Uniswap/v4-periphery` `c6e4754`.

**Status key:**
- **confirmed:** matches the source.
- **corrected:** the plan was wrong, and the fix is now in `plan.md`.
- **unverified:** couldn't be checked from a primary source.
- **risk:** true, but it can bite the build or the demo.

## 1. Claims checked

### Uniswap (CCA, LiquidityLauncher, LBPStrategy, v4)

| Claim | Status | Finding | Source |
|---|---|---|---|
| v4 Sepolia: PoolManager `0xE03A…3543`, PositionManager `0x429b…09b4`, UR `0x3A9D…F98b` + 2.1.2 `0x7E4f…43f3`, StateView `0xe1dd…7e4c`, Quoter `0x68aF…8244`, Permit2 | confirmed | All have code. Periphery `poolManager()` = `0xE03A…3543` | [v4 deployments](https://docs.uniswap.org/contracts/v4/deployments) |
| CCA factory v2.1.0 `0x0000…63F8` is latest | confirmed | README: "v2.1.0 is the latest version … recommended" | [CCA README](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/README.md) |
| LiquidityLauncher v3.2.0 `0x0000…19C0`, LBPStrategy v3.3.0 `0x9543…2000`, InitializerHook v3.3.0 `0x1600…2000` | confirmed | Listed for Sepolia. LBPStrategy is a **singleton** (v3.0.0 merged all variants and removed the strategy factories) | [LL README](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/README.md), [CHANGELOG](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/CHANGELOG.md) |
| `LBPStrategy.initializerFactory()` = CCA factory; hook `authorized()` = LBPStrategy | confirmed | Onchain `eth_call`. The hook address flags = `0x2000` (BEFORE_INITIALIZE) | Sepolia RPC |
| `protocolFeeController()` = 0, so no fees; factory constructor docs mismatch | confirmed | Docs say no constructor params; source takes `_protocolFeeController` | [factory L20-22](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/ContinuousClearingAuctionFactory.sol#L20-L22) |
| `IValidationHook.validate(uint256,uint128,address,address,bytes)`, non-view, revert to reject | confirmed | Called by the auction with `sender = msg.sender` of `submitBid`. Reverts are wrapped as `ValidationHookCallFailed(bytes)` | [IValidationHook](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/interfaces/IValidationHook.sol), [ValidationHookLib](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/libraries/ValidationHookLib.sol), [CCA L359](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/ContinuousClearingAuction.sol#L359) |
| Validation hook can hold `immutable auction` | **corrected** | Circular: the CREATE2 init code includes `AuctionParameters.validationHook`. Use a one-time `setAuction` that checks `a.validationHook() == this`. The view is `getAddress(...)`, not `getAuctionAddress` | [factory L37-69](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/ContinuousClearingAuctionFactory.sol#L37-L69), [LBPStrategy L91-93](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/strategies/lbp/LBPStrategy.sol#L91-L93), [Launcher L60](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/LiquidityLauncher.sol#L60) |
| Reference gating pattern | confirmed (new) | `GatedERC1155ValidationHook` requires `sender == owner` plus a soulbound pass. The plan now requires `sender == owner` | [validationHooks/](https://github.com/Uniswap/continuous-clearing-auction/tree/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/periphery/validationHooks) |
| `submitBid(budget, maxPrice, hookData)` (sequence diagram) | **corrected** | `submitBid(maxPriceQ96, amount, owner, prevTickPriceQ96, hookData)` plus a 4-argument overload | [ICCA L136-155](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/interfaces/IContinuousClearingAuction.sol#L136-L155) |
| Exit/claim/event names (`exitBid`, `exitPartiallyFilledBid`, `claimTokens(Batch)`, `ClearingPriceUpdated`, `CheckpointUpdated`) | confirmed | All present | same |
| "With LBPStrategy the strategy is the recipient and routes leftovers" | **corrected** | The strategy **must** be `fundsRecipient` and **must not** be `tokensRecipient`. The issuer (as `tokensRecipient`) calls `sweepUnsoldTokens()`. `migrationBlock` must be > `endBlock` | [LBPStrategy L369-386](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/strategies/lbp/LBPStrategy.sol#L369-L386) |
| LBPStrategy hook rules (uninitialized pool, ERC165 `IInitializerHook`, `authorized`, valid address, BEFORE_INITIALIZE; other permissions free; `PoolIdOccupied`) | confirmed | Exactly these four checks | [MigratorParams L142-157](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/libraries/MigratorParams.sol#L142-L157) |
| ListingHook can set up state in `beforeInitialize` | **corrected** | `InitializerHook._beforeInitialize` is `view`. Write bands in `afterInitialize` | [InitializerHook](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/periphery/hooks/InitializerHook.sol) |
| Pool opens at the clearing price; migration failure is terminal | confirmed | `initialPriceX96` → sqrtPrice; `try`/`catch` recovers reserves, one-shot | [LBPStrategy L160-274](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/strategies/lbp/LBPStrategy.sol#L160-L274) |
| InstantLaunch is hookless | confirmed | `hooks: address(0)`, native ETH only; no Sepolia deployment | [InstantLaunchStrategy](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/strategies/InstantLaunchStrategy.sol) |
| `createToken` gives a fixed supply | confirmed | UERC20 mints only in its constructor; UERC20Factory `0x0000…ad49b` has code | [uerc20-factory](https://github.com/Uniswap/uerc20-factory) |
| `afterSwap` revert + Quoter pre-check | confirmed | v4 wraps as `WrappedError`; Quoter reverts with the hook error, so it can be decoded for "would revert" | [v4-core Hooks.sol](https://github.com/Uniswap/v4-core/blob/main/src/libraries/Hooks.sol) |
| Quote currency = Circle Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (owner decision; replaces faucet `mUSDC`) | confirmed | Listed under "Ethereum Sepolia" on Circle's testnet table. Code present (1,798-byte proxy → `FiatTokenV2_2` `0xda31…9068`, 23,464 bytes); `decimals()` 6; `symbol()` `USDC` | [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), Sepolia RPC at block 12,075,416 |
| USDC supports EIP-2612 `permit` | confirmed + gotcha | A `permit` probe reverts `FiatTokenV2: permit is expired`, so the function exists. `DOMAIN_SEPARATOR` matches name **`"USDC"`**, version `"2"`, chain 11155111 (mainnet uses `"USD Coin"`) | Sepolia RPC |
| Faucet can fund bidders | confirmed + **risk** | "20 USDC on testnet every 2 hours, per address, and per blockchain"; more via Circle's Discord. Prices and cap are rescaled to fit (issue 0.001 USDC/share, cap 20 USDC) | [Circle faucet](https://faucet.circle.com/) |
| CCA pulls ERC-20 bids with plain `transferFrom` | **corrected** | It uses `SafeTransferLib.permit2TransferFrom`, which calls Permit2 AllowanceTransfer. Bidders need `approve(Permit2)` + `Permit2.approve(USDC, auction, …)`. The CCA has no permit or multicall entry | [CCA L475-480](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/src/ContinuousClearingAuction.sol#L475-L480) |
| 6-dec currency allowed by the CCA | confirmed | Only < 6 decimals and fee-on-transfer are disallowed. Minimum floor 2³²+1 Q96; 0.0008 USDC/share ≈ 6.3 × 10¹³ clears it | [TechnicalDocumentation](https://github.com/Uniswap/continuous-clearing-auction/blob/ce78b4d94cdf94fd41f20afb6f6e495b8b83a234/docs/TechnicalDocumentation.md) |
| LBPStrategy handles currency ordering | confirmed | Reverts `CurrencyMismatch` unless the migration currency = auction currency; sorts `currency0` by address and inverts the price (`TokenPricing`) when the currency sorts first | [LBPStrategy L105, L439, L471](https://github.com/Uniswap/liquidity-launcher/blob/266c18786c58822b72a7a9490f4e319294df0548/src/strategies/lbp/LBPStrategy.sol#L105) |
| Swap-side identity is possible | confirmed (new) | `IMsgSender.msgSender()` exists on Sepolia UR (both) and V4Quoter | [IMsgSender](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IMsgSender.sol) |

### Chainlink CRE

| Claim | Status | Finding | Source |
|---|---|---|---|
| Sepolia selector `16015286601757825753` | confirmed | `ethereum-testnet-sepolia` | [chain-selectors](https://github.com/smartcontractkit/chain-selectors/blob/main/selectors.yml) |
| MockKeystoneForwarder `0x15fC…9F88`, KeystoneForwarder `0xF834…4482` | confirmed | Both listed, both have code | [forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts) |
| `simulate --broadcast` writes; prize accepts simulation; DON deploy needs approval | confirmed | Without `--broadcast` it is a dry run. "simulation is enough!" DON deploy needs `cre account access` | [CRE docs](https://docs.chain.link/cre/ts/llms-full.txt), [prizes](https://ethglobal.com/events/mumbai/prizes) |
| "Mock forwarder sends no metadata" | **corrected** | 64-byte metadata with placeholder workflowId/owner (decoded sim txs) | Sepolia tx decode |
| Forwarder check secures the receiver in simulation | **risk** | The mock `report()` is "permissionless and skips all signature/config validations" and swallows `onReport` reverts (`ReportProcessed.result`). Add a hackathon `tx.origin` guard; show the receiver event, not tx status | [MockKeystoneForwarder.sol](https://github.com/smartcontractkit/chainlink-evm/blob/main/contracts/cre/src/dev/MockKeystoneForwarder.sol) |
| ENS `setText` inside `onReport` | risk | Gas-heavy; set `gasConfig.gasLimit` ≈ 1.5–2M; keep try/catch; measure on Sepolia | CRE docs |

### EF Anon-RPC

| Claim | Status | Finding | Source |
|---|---|---|---|
| Anon-RPC usable today for a Sepolia dapp | confirmed | `@anon-rpc/browser-harness`; `worker.fetch` plugs into a viem transport | [wallets guide](https://ethereum.github.io/anon-rpc/wallets/) |
| Nox specifier `0x3513…7A9A` | confirmed | "Published on the Sepolia testnet". Sphinx mixnet, ~1.8 MB bundle | same, [adopters.json5](https://github.com/ethereum/anon-rpc/blob/main/adopters.json5) |
| "Tor-js first"; badge "Reads via Tor" | **corrected** | The tor-js specifier `0x700d…659e` is on **mainnet** (no code on Sepolia) and uses a "demonstration gateway only". Nox is primary; the badge now says "Nox mixnet" | same |
| Wallet RPC can be overridden to Anon-RPC | **corrected / risk** | No local HTTP endpoint, so MetaMask can't be pointed at it. Wallet writes and gas go via MetaMask's RPC; declare it (the prize allows "just let us know") | same, [prizes](https://ethglobal.com/events/mumbai/prizes) |
| Works in the MetaMask Mobile in-app browser | unverified | Needs WebRTC inside a null-origin sandboxed iframe. Gate 0 check | wallets guide |
| ENS reads stay private | risk | CCIP-Read gateway fetches bypass the worker. Use `ccipRead: false` or route via `worker.fetch` | viem / wallets guide |

### ENSv2 (Sepolia)

| Claim | Status | Finding | Source |
|---|---|---|---|
| ENSv2 live on Sepolia; 8 addresses in plan §18 | confirmed | All have code and match the "Sepolia (ENSv2)" table; ENSv1 Sepolia "no longer in use" | [deployments](https://docs.ens.domains/learn/deployments) |
| Register `listingday.eth` via commit-reveal | confirmed + detail | Commit, wait 60 s–24 h, then register; **paid in ERC-20** MockUSDC `0x240b…14aa` (~8/yr) or MockDAI; minimum 28 days | deployments, contracts-v2 `v2-mainnet-deployment-1` |
| "Confirm signatures against contracts-v2" | **corrected** | Use tag `v2-mainnet-deployment-1`; `main` holds an older Sepolia deployment with a different resolver API | [contracts-v2](https://github.com/ensdomains/contracts-v2) |
| `grantSetterRoles` scopes a text key; scope spans all names in a resolver | confirmed | `grantSetterRoles(bytes setter, address)` needs `ROLE_SET_TEXT_ADMIN`. One resolver per issuer stays correct | [permissioned resolver](https://docs.ens.domains/ensv2/permissioned-resolver/), [EAC](https://docs.ens.domains/ensv2/enhanced-access-control/) |
| Setters keyed by node | **corrected** | DNS-encoded `bytes name` (`setText(bytes,string,string)`) | contracts-v2 tag |
| Subnames are ERC-1155; withholding `ROLE_CAN_TRANSFER_ADMIN` makes them non-transferable | confirmed | `TransferDisallowed`. **Risk:** token ids regenerate on role changes (`TokenRegenerated`) | [subnames](https://docs.ens.domains/ensv2/subnames) |
| viem resolves via the `0xeEeE…EeEe` proxy on Sepolia | confirmed | viem 2.57.x `sepolia.contracts.ensUniversalResolver`; live `getEnsText` tested | viem |
| ENS prize: ENSv2 mainnet **or Sepolia**, central, no hard-coding, live demo, OSS | confirmed | Also names scoped text records, non-transferable subnames, per-subname resolvers; **AI-agent bonus** | [ENS prizes](https://ethglobal.com/events/mumbai/prizes/ens) |

### World ID

| Claim | Status | Finding | Source |
|---|---|---|---|
| ID 4.0 `WorldIDVerifier` on World Chain **and Arc** | **corrected** | Verifier on World Chain (prod + staging). Arc has `WorldIDSatellite` (prod only). Nothing v4 on Ethereum Sepolia | [onchain verification](https://docs.world.org/world-id/idkit/onchain-verification) |
| Legacy v3 `WorldIDRouter` `0x4694…2157` on Sepolia | confirmed | Proxy with code; group-1 root updated today (1 h expiry); Orb-only, legacy proofs | Sepolia RPC, World contracts reference |
| IDKit 4.x: `signRequest` on the backend; `POST /api/v4/verify/{rp_id}`; simulator/staging | confirmed | Also bind `signal` = wallet; `UNIQUE(nullifier, action)` | [IDKit integrate](https://docs.world.org/world-id/idkit/integrate) |
| Agent Pass `hash(iss,sub)` = one human | **corrected** | The default "Any account" admits unverified users. Require Orb `acr` + `max_age=0` and validate `acr`/`amr`/`auth_time`/`nonce` | [auth.world.org docs](https://auth.world.org/docs) |
| Offer Agent Pass **or** IDKit in the same flow | **corrected** | Separate identifier spaces, so one person could get two vouchers. One path per deployment | same |
| Prize amounts: Agent Pass $5k (2.5/1.5/1k); IDKit $2.5k (2 × $1,250) | confirmed | Continuity variants not applicable | [World prizes](https://ethglobal.com/events/mumbai/prizes/world) |
| Plan reads the Agent Pass track correctly | confirmed | "Especially interested in agentic products, but any compelling use case is eligible"; the agentic angle is optional upside | same |
| World credential can prove nationality | confirmed (new, narrow) | Only **Identity Check (Preview, contact us)** gives a boolean `nationality` / `issuing_country` match. The 9303 passport credential and Agent Pass don't | [credentials](https://docs.world.org/world-id/idkit/credentials) |

### Other components, rules and framing

| Claim | Status | Finding | Source |
|---|---|---|---|
| Lightweight Charts Apache-2.0; `attributionLogo` satisfies attribution | **corrected (partly)** | v5.2.1 Apache-2.0. `attributionLogo` covers only the link; the NOTICE text must also be shown | [lightweight-charts](https://github.com/tradingview/lightweight-charts) |
| Deadline Sat Nov 7 09:00 IST ("secondary source") | **corrected** | Confirmed on the official details page | [details](https://ethglobal.com/events/mumbai/info/details) |
| Max 3 partner prizes; "one EF prize per project" | confirmed + detail | "Up to 3 Partner Prizes"; multi-track partners count once. EF places a project in at most one of Anon-RPC / alt mempool / CROPS | details, [prizes](https://ethglobal.com/events/mumbai/prizes) |
| Demo "recorded on a phone" | **corrected** | "DO NOT use mobile phones to record the video submission"; 2–4 min, ≥720p, no speed-up, no AI voiceover | details |
| SEBI: KYC/AML never relaxed | confirmed | Sandbox framework ¶24: "no exemptions would be granted from … KYC and AML rules" | [SEBI Jun 2021](https://www.sebi.gov.in/sebi_data/attachdocs/jun-2021/1623665266705.pdf) |
| IFSCA: KYC/AML never relaxed | risk (wording) | 2020 framework ¶16 has the same sentence. The March 2026 FinTech Sandbox Framework replaced it and doesn't repeat it verbatim, so quote SEBI | [IFSCA 2020](https://ifsca.gov.in/Document/Legal/ifsca-circular-regulatory-sandbox_new19102020084227.pdf), [IFSCA 2026](https://ifsca.gov.in/Common/PreviewPdf?fileName=IFSCA_FinTech_Sandbox_Framework_20260316_0338.pdf&id=d575554ec59b09e7fde503d3a85390cf) |
| NSE band rules, StablePair, Mark Toda posts (plan §3, §12) | unverified this round | Not re-checked; Round 1 notes stand | plan §17 |

### Country attestation (new feature)

| Claim | Status | Finding | Source |
|---|---|---|---|
| zkPassport verifiable on Ethereum Sepolia | confirmed | `ZKPassportVerifier` `0x1D00…c0D8` (code present). `compressed-evm` mode, `bind(user_address)`, `isNationalityIn`/`Out` (sorted lists) | [onchain](https://docs.zkpassport.id/getting-started/onchain) |
| zkPassport mocks for testing | confirmed + risk | Dev-mode mocks are rooted in the Sepolia registry. "All mock passport proofs have 1 as unique identifier", so uniqueness can't come from the passport in the demo | [dev mode](https://docs.zkpassport.id/getting-started/dev-mode) |
| Self usable on Ethereum Sepolia | no | Onchain mode is Celo / Celo Sepolia only. The open SDK is deprecated in favour of Self Enterprise. An allowlist reveals nationality | [Self modes](https://docs.self.xyz/docs/self-enterprise/flows/verification-modes/) |
| Coinbase Verified Country usable | no (on Sepolia) | Base / Base Sepolia EAS only; residence country is public | [coinbase/verifications](https://github.com/coinbase/verifications) |
| Anon Aadhaar on Sepolia | confirmed + risk | Test-key `0x6bE8…E281` and prod-key `0xd59C…a16e` have code. It proves residency, not citizenship. Low maintenance since 2025 | [anon-aadhaar sepolia.json](https://github.com/anon-aadhaar/anon-aadhaar/blob/main/packages/contracts/deployed-contracts/sepolia.json) |
| EAS on Sepolia for a fallback record | confirmed | EAS `0xC267…815e`, SchemaRegistry `0x0a7E…50D0` have code | [eas-contracts](https://github.com/ethereum-attestation-service/eas-contracts) |
| Any Mumbai prize for Self / zkPassport / Coinbase / Base / Celo | no | Sponsors: World, 1inch, 0G, Uniswap, Arc, Hedera, Arkiv, Whitechain, EF, ENS, Definitive, Chainlink | [prizes](https://ethglobal.com/events/mumbai/prizes) |

## 2. Track compatibility

### Requirements vs plan

| Partner (track) | Plan meets it? | Gaps to close |
|---|---|---|
| Uniswap: Build with Uniswap ($10k) | Yes: CCA + LBPStrategy + v4 hook + validation hook | `FEEDBACK.md` + [form](https://developers.uniswap.org/hackathon-feedback); README line pointers. The Continuity $5k track isn't ours |
| Chainlink: Best workflow with CRE ($1.5k) | Yes: HTTP API → report → Sepolia receiver; simulation accepted | README must admit the mock forwarder is spoofable; demo receiver success, not tx status |
| EF: Best Use of Anon-RPC ($5k) | Yes, if Nox runs on the phone | Declare excluded traffic (wallet writes); route ENS CCIP-Read. Optionally add **Best CROPS App** ($3.5k) under the same pick: OSS licence, "CROPS" README section, no trackers |
| ENS: Best Use of ENSv2 ($7k) | Yes: Sepolia allowed; UserRegistry + per-issuer Permissioned Resolver + scoped text role + non-transferable ticker | Live demo link; ERC-20 registration payment; AI-agent bonus unused |
| World: Agent Pass ($5k) / IDKit ($2.5k shared) | Yes, with fixes | Orb `acr` for Agent Pass; one World path only; IDKit `signal` = wallet; failure path + debrief; select only the track built |
| ETHGlobal rules | Partly | Screen-captured video (not a phone); AI attribution; spec files committed; steady commits |

**Other Mumbai tracks that fit the theme but not the chain:**
- Hedera "Tokenize Anything with Hedera Studios" ($5k) and Whitechain "Tokenize · Real World Finance" ($4k) fit tokenized equity, but each needs its own chain.
- Arc "Best DeFi" ($3k) needs Arc.
- No clearly better Sepolia-compatible track exists. EF CROPS is the only free addition.

### Coexistence on Ethereum Sepolia

| Pair | Compatible? | Notes |
|---|---|---|
| All five partners on Sepolia | Yes | Uniswap stack, CRE forwarders, Nox specifier, ENSv2 and the World legacy router are all live on Sepolia. World 4.0 is backend-only here, which both World tracks accept |
| CRE ↔ v4 `ListingHook` | Yes | The hook only *reads* the receiver; swaps never call CRE; halts are separate report txs. A spoofed mock report is the hackathon risk |
| CRE ↔ ENS | Yes | Receiver holds a text-key-scoped role; DNS-encoded name; gas limit ≈ 1.5–2M; try/catch |
| World / Jurisdiction ↔ CCA validation hook | Yes | Voucher in `hookData`; `sender == owner`; `setAuction` resolves the address circularity; UI decodes `ValidationHookCallFailed` |
| Jurisdiction ↔ ListingHook (swap gating) | Yes (stretch) | `IMsgSender(sender).msgSender()` on allowlisted routers (UR, Quoter); ERC-20 transfers still bypass it |
| Anon-RPC ↔ wallet | Partial | Reads through `worker.fetch`; MetaMask writes/gas use MetaMask's RPC (no override possible). Declared, not hidden |
| Sepolia USDC ↔ CCA / LBPStrategy / v4 / ENS | Yes | Same USDC for auction, migration and pool. USDC is likely `currency0`, so `ListingHook` must be orientation-aware. Bids need Permit2 approvals. ENS registration uses its own MockUSDC, a different token |
| Anon-RPC ↔ ENS | Yes, with care | viem ENS reads through the same transport; disable or route CCIP-Read |
| zkPassport ↔ World ID | Yes | AND by default; World supplies uniqueness (mock passports all share id `1`) |

**Chain choice:** stay on Ethereum Sepolia. Base Sepolia has LBPStrategy but no ENSv2, no Nox specifier and no zkPassport verifier (zkPassport is on Base mainnet only). World Chain lacks the Uniswap LBP deployment and ENSv2. No alternative is clearly better.

## 3. Top risks

The first five are ranked; the last two are worth watching.

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Time.** About 19 h remain for ~36.5–47.5 h of work. Gate 0 slipped 2.5 h with nothing built | Two lanes; the Sat 01:30 MetaMask e2e checkpoint is non-negotiable. Cut list: swap gating → real zkPassport → country module → World. A solo builder ships combo A |
| 2 | **LBP launch wiring.** `setAuction` circularity, recipient rules, mined hook, `afterInitialize`-only writes; migration is one-shot | Fork test Launcher → CCA → `setAuction` → bids → `migrate` in Gate 0; keep a spare token/run; issuer sweeps unsold |
| 3 | **Anon-RPC on mobile.** Nox in MetaMask's in-app browser (WebRTC in a sandboxed iframe, CSP) is untested | Gate 0 on a real phone; fall back to a mobile browser + WalletConnect; never fall back silently to direct RPC |
| 4 | **CRE trust and silent failure.** The mock forwarder is permissionless and swallows `onReport` reverts; the ENS mirror costs a lot of gas | `tx.origin` guard + README note; UI reads `ReportProcessed.result` / receiver event; `gasLimit` 1.5–2M; mirror is first to cut |
| 5 | **Identity correctness.** Agent Pass without Orb `acr` isn't one human; dual World paths double-issue; the backend signer is a trust point | Orb `acr` + `max_age=0`; one path; `signal`/`owner` binding; short expiry; stated limits |
| 6 | **Overclaiming the country gate.** Transfers and other pools bypass it; nationality ≠ residency; mocks share id `1` | UI + README limitations; World for uniqueness; "not KYC" disclaimer; mock-attestation fallback labelled |
| 6b | **USDC funding.** Demo wallets lack USDC at judging (faucet 20 USDC / 2 h / address) | Faucet rounds from Gate 0 every 2 h, ≈ 260 USDC across ~8 addresses by Sat 01:30; prices sized to faucet amounts |
| 7 | **ETHGlobal disqualifiers** | Screen-captured 2–4 min video; AI attribution; spec files; steady commits |

## 4. Recommended country-attestation approach

1. **Build:** a `JurisdictionModule` (plus an `AllOf` combinator with World), fed by the **same backend EIP-712 voucher**. The voucher gains `policyHash` and a `claims` bit.
2. **Primary source:** a zkPassport proof (`.in`/`.out("nationality", list)`, `.bind("user_address", owner)`), verified on our backend with `devMode: true`.
3. **Fallback:** a backend mock attestation, optionally mirrored to EAS on Sepolia, labelled "mock attestation".
4. **Stretch:** verify `compressed-evm` proofs onchain against `ZKPassportVerifier` on Sepolia, with no backend trust.
5. **Pitch only:** Anon Aadhaar as the India-residency module.
6. **Not used:** Self (Celo-only onchain) and Coinbase (Base-only). World Identity Check only if World enables the preview.
