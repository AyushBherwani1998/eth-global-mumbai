# Listing Day: an SME IPO on Uniswap CCA + v4

> **Public price discovery, private browsing.** A mock Indian SME IPO on Ethereum Sepolia.
> - **Discovery:** a Uniswap Continuous Clearing Auction (CCA).
> - **Graduation:** the token moves into a Uniswap v4 pool, where a `ListingHook` enforces NSE-inspired listing-day and circuit rules.
> - **Policy:** Chainlink CRE posts the listing and incident policy.
> - **Tickers:** ENSv2 gives every SME a ticker name (`acme.listingday.eth`) whose records point to its auction, pool and policy.
> - **Fairness:** World ID enforces one human, one application.
> - **Privacy:** Anon-RPC carries every app read.
> - **Jurisdiction (issuer-optional):** an issuer can restrict bidding (and optionally trading) by country; investors prove eligibility with a zkPassport proof and reveal one bit.

| | |
|---|---|
| Event | ETHGlobal Mumbai, Classic track |
| Deadline | **Sat Nov 7 2026, 09:00 IST** (03:30 UTC); confirmed on the official [event details page](https://ethglobal.com/events/mumbai/info/details). "Late submissions won't be accepted." |
| Built into the product | Uniswap · Chainlink CRE · EF Anon-RPC · ENSv2 · World ID (all 5) |
| Claimed at submission | **Up to 3 partner prizes.** Several tracks from the same partner count as **one** pick (official rule). See the [Pitch matrix](#2-pitch-matrix); decide after the MetaMask e2e checkpoint. |
| Chain | Ethereum Sepolia (11155111) |
| Client | Mobile-first Next.js PWA, wagmi + viem, MetaMask / WalletConnect |
| Scope | Design only; nothing has been built or deployed |
| Disclaimer | Every exchange rule is an **NSE-inspired mock**: not a regulated product, no regulatory claims. Jurisdiction gates are an extra privacy layer, **not KYC** |

Last updated Fri Nov 6 2026, ~14:00 IST (v3: validated against primary sources, country restrictions added; see [`VALIDATION.md`](VALIDATION.md)). Earlier versions live in git history. v2 referred to a `plan.v1.md`, but no such file is in the repo. If it exists locally, commit it: ETHGlobal's spec-driven rule requires "all spec files, prompts, and planning artifacts".

---

## Contents
1. [Pitch](#1-pitch)
2. [Pitch matrix](#2-pitch-matrix)
3. [Why CCA + v4 fits](#3-why-cca--v4-fits)
4. [IPO mechanics](#4-ipo-mechanics)
5. [Lifecycle](#5-lifecycle)
6. [Components](#6-components)
7. [ENSv2 ticker namespace](#7-ensv2-ticker-namespace)
8. [World ID eligibility](#8-world-id-eligibility)
9. [Country restrictions (issuer-optional)](#9-country-restrictions-issuer-optional)
10. [Mobile app and screens](#10-mobile-app-and-screens)
11. [Diagrams](#11-diagrams)
12. [Rule mapping (NSE-inspired mock)](#12-rule-mapping-nse-inspired-mock)
13. [Mock and demo plan](#13-mock-and-demo-plan)
14. [Build plan to Sat 09:00 IST](#14-build-plan-to-sat-0900-ist)
15. [Risks](#15-risks)
16. [Prize checklists](#16-prize-checklists)
17. [Validation notes](#17-validation-notes)
18. [Reference: addresses and interfaces](#18-reference-addresses-and-interfaces)

---

## 1. Pitch

Indian SME IPOs list through a 45-minute call auction followed by tight price bands. Listing Day rebuilds that flow onchain:

1. **CCA = the call auction.** Fixed supply. Each bid is a budget plus a max price, and everyone pays one uniform clearing price. Bids are capped at 190% of issue price.
2. **v4 pool = the secondary market.** `LBPStrategy` seeds it automatically at the clearing price.
3. **ListingHook = the rulebook.** ±5% listing-day band, 20% normal band, a 5% surveillance mode, a directional mode and a halt. Any swap that lands outside the band reverts. LP exits always work.
4. **CRE = the exchange notice board.** A signed policy report sets the reference price, mode and halt, and mirrors status onto the ticker's ENS record.
5. **ENSv2 = the ticker register.** `acme.listingday.eth` is an issuer-controlled subname. Its records are the IPO's single source of truth, and roles decide who may write which record.
6. **World ID = one human, one application.** A pluggable eligibility module on the auction hook adds a per-human allotment cap, the onchain cousin of NSE application limits.
7. **Anon-RPC = private browsing.** Investors can check a hot IPO without their IP being tied to the addresses they look up.
8. **Jurisdiction rule = the offer document's selling restrictions (issuer-optional).** The issuer can limit bidding, and optionally trading on our pool, to (or away from) listed countries. A zkPassport proof, turned into the same backend voucher, reveals only "eligible", never the nationality. It composes with World ID via AND/OR. See [§9](#9-country-restrictions-issuer-optional).

## 2. Pitch matrix

All five partners are built into the product, but only **3** partners can be claimed. Several tracks from the same partner count as one pick, so World Agent Pass + IDKit, or EF Anon-RPC + CROPS, cost one slot each. Each selected track's own requirements must still be met. EF places a project in at most one of its tracks (Anon-RPC, alt mempool, CROPS).

| Partner | Track (amount) | Key requirements | What we show them | Demo moment | Est. h |
|---|---|---|---|---|---|
| **Uniswap** | Build with Uniswap ($10k: 4/3/2/1k) | Public repo; `FEEDBACK.md`; feedback form linking it; README pointing to contract lines | CCA + LiquidityLauncher/LBPStrategy + v4 `ListingHook` (InitializerHook) + `AuctionValidationHook` | A bid at 200 reverts; graduation opens the pool at 110; a swap to 117 reverts `OutOfBand` | core |
| **Chainlink CRE** | Best workflow with CRE ($1.5k, single prize) | Workflow joins a blockchain with an external API and is meaningfully used; "simulation is enough" | Mock exchange API → report → `ListingPolicyReceiver` → hook policy + ENS status | Issuer taps "Surveillance": CRE sim broadcasts, the band tightens to 5% live | 2 |
| **EF Anon-RPC** | Best Use of Anon-RPC ($5k: 2.5/1.5/1k). Also select **Best CROPS App** ($3.5k: 2/1/0.5k) under the same EF pick; EF places us in at most one | App routes RPC reads through Anon-RPC **by default**; judged on end-to-end function, UX, share of traffic, shippability, depth. Say which traffic is excluded and why (wallet writes). *CROPS:* OSS licence, a README section titled "CROPS", no trackers, a video showing "the moment it matters" | viem transport = Anon-RPC worker on **Nox** (the only specifier published on Sepolia); tor-js as fallback; badge with a 100% read counter; no silent fallback | Phone shows "Reads via Nox mixnet · 100%" while browsing the IPO list | 2–4 |
| **ENS** | Best Use of ENSv2 ($7k: 3/2/1/1k) | Built on ENSv2 on mainnet **or Sepolia**; ENSv2 central, not cosmetic; functional, not hard-coded; live demo link; open source. Page names "edit only certain text records", non-transferable subnames and per-subname Permissioned Resolvers; **bonus for AI agents** | Ticker namespace: UserRegistry subnames, issuer Permissioned Resolver records, Enhanced Access Control roles (receiver may write only `listingday.status`) | Type "acme" → app resolves auction, pool and policy from ENS; a CRE halt flips the ENS status record | 3–4.5 |
| **World** | **World ID Agent Pass ($5k: 2.5/1.5/1k)** and/or Best Use of IDKit ($2.5k, up to 2 teams × $1,250); one World pick covers both, but select only the track you actually built | *Agent Pass:* official Agent Pass integration; full journey; a denied, expired or cancelled path; secure backend validation; debrief. *IDKit:* IDKit + ≥1 credential verified on server or onchain; explain why the credential is the minimum sufficient; success + alternative path; debrief | Eligibility module: bid needs a backend-signed voucher bound to one human (Agent Pass `sub` with Orb `acr`, or IDKit nullifier) with a per-human cap | A second wallet, same human, tries to apply → voucher denied, bid reverts `NotEligible` | 4–8 |

**Which World track fits:**
- **Agent Pass ($5k)** pays more. It provides a stable pairwise identifier per sector plus fresh authentication at the moment of the action, which maps to "protect scarce benefits / claim limits".
  - The track says it is "especially interested in agentic products" but any compelling use case is eligible.
  - Optional upside: a bidding agent that must pass a World human checkpoint before `submitBid`.
  - The default "Any account" setting admits unverified accounts. One human needs the Orb `acr` (see §8).
- **IDKit ($2.5k shared)** maps to "fair access to a scarce benefit" with a Proof of Human nullifier.
- Both run through the same backend voucher, so the module design doesn't change. **Build exactly one path per deployment.** Agent Pass `sub` and IDKit nullifiers live in separate identifier spaces, so offering both would let one person get two vouchers. Pick by which SDK reaches first success faster in the World spike.

**Strongest 3-combos (decide after the Sat 01:30 IST e2e checkpoint):**

| Combo | Max pool | Fit | Risk |
|---|---|---|---|
| **A. Uniswap + ENS + EF (Anon-RPC + CROPS)** | $22k | All three are on the critical path (tickers, rules, private reads) | ENS must be visibly central, not a lookup |
| **B. Uniswap + ENS + World (Agent Pass)** | $22k | Strongest "fair IPO" story | World backend + failure path takes 4–8 h |
| C. Uniswap + EF + World | $20k | Privacy + fairness | Needs World done |
| D. Uniswap + CRE + ENS | $18.5k | CRE is easy to prove via simulation | Smallest pool |

Default lean is **A**, switching to **B** if World lands cleanly by Sat 05:00 IST. The country module (§9) has no partner prize at Mumbai: there is no Self, zkPassport, Coinbase or Base track. It strengthens the Uniswap story (validation hooks as "compliance gating") and the overall judging, not a separate pick.

**Other Mumbai tracks considered:**
- Hedera "Tokenize Anything" ($5k) and Whitechain "Tokenize · Real World Finance" ($4k) fit tokenized equity, but each needs its own chain.
- Arc "Best DeFi" ($3k) needs Arc.
- Not worth a slot on Sepolia, and switching chains would break ENSv2, Anon-RPC/Nox and the LBPStrategy deployment. Stay on Sepolia.

## 3. Why CCA + v4 fits

- **The CCA whitepaper** cites IPO underpricing and names validation hooks and post-auction "compliance gating". Our cap and eligibility hook plus our listing hook are exactly those.
- **StablePair** ([Uniswap](https://x.com/Uniswap/status/2117633841917513745), [Alice Henshaw](https://x.com/hensha256/status/2098106537432510574)) sets a range around a reference price. Swaps pushing the price further off pay no fee; correcting swaps run a Dutch-auction fee. Our directional mode turns the reference-price idea into a circuit rule.
- **Tokenized stocks:** StablePair now pairs Robinhood and Ondo stock tokens ([Hayden](https://x.com/haydenzadams/status/2115123909511233625)), and CCA "is continuing to attract verified token launches" ([Hayden](https://x.com/haydenzadams/status/2115478207088697380)).
- **UHI8 "asset-class specific liquidity":** an SME equity needs listing-day and circuit rules that a generic pool lacks.
- **Routing:** Mark Toda describes default inclusion of hooked pools, with an auto-denylist for hooks that fail often ([post](https://x.com/MarkToda/status/1997286709126386128)). We demo via our own UI and the Universal Router.

## 4. IPO mechanics

| Parameter (issuer console) | Demo value | Onchain mapping |
|---|---|---|
| Fixed supply | **110,000 shares** (MockSME, 18 dec), no mint after launch | LiquidityLauncher `createToken` with fixed supply, or a pre-minted deposit |
| Split | 90,000 to auction / 20,000 reserved for LP | CCA `totalSupply`; `MigratorParameters.reservedTokenAmountForLP` |
| Issue price | 100 mUSDC | Policy v1; anchors range math |
| Discovery range | 80–190% of issue (80 → 190) | CCA `floorPrice` = 80 (Q96); `AuctionValidationHook` rejects `maxPrice` > 190 |
| Per-applicant cap | e.g. 200,000 mUSDC budget per wallet (Phase 1) or per human (Phase 2), a mock application limit | Eligibility module keeps a cumulative committed budget per key |
| % of raise to LP | e.g. 20% | `lpAllocationSchedule` brackets in MigratorParameters |
| Graduation threshold | e.g. 50% of the target raise | CCA `requiredCurrencyRaised` |

**Bids.** Each bid is a **budget** (`amount` in mUSDC) plus a **max price** (`maxPriceQ96`). The bid sheet converts "I'll pay up to ₹X per share with ₹Y" into those two fields. Bids can name an `owner` and carry `hookData`, which is where the World voucher rides.

**Uniform clearing.** Everyone filled pays the same clearing price.
- Bids above clearing are filled.
- Bids exactly at the clearing tick may be partly filled (`exitPartiallyFilledBid`).
- Bids below clearing are refunded via `exitBid`.
- Tokens are claimed after `claimBlock` (`claimTokens` or `claimTokensBatch`).

**Unsold supply.** LBPStrategy (v3.3.0) **requires** the auction's `fundsRecipient` to be the strategy and **rejects** the strategy as `tokensRecipient` (`InvalidFundsRecipient` / `InvalidTokensRecipient`). So:
- Unsold auction tokens stay in the CCA and go to `tokensRecipient` (set it to the **issuer treasury**) via `sweepUnsoldTokens()`.
- On migration, raised currency beyond the LP bracket, unused LP reserve tokens and position dust go to `MigratorParameters.recipient`.
- If the raise is below `requiredCurrencyRaised`, the auction doesn't graduate, every bid is refunded via `exitBid`, and the whole supply is sweepable to `tokensRecipient`.
- `migrationBlock` must be strictly after the auction's `endBlock`.

Show "unsold → issuer treasury" in the console and still walk the path once in the Gate 0 fork test.

**Per-applicant caps.** `IValidationHook.validate` is **non-view**, so the module can add `amount` to a running total per key (wallet, or human key) and revert past the cap. Exits don't reduce the total; that is deliberately simple. Require `sender == owner`, as Uniswap's own `GatedERC1155ValidationHook` does. Otherwise anyone who copies a voucher from the mempool can spend the victim's cap with their own funds.

## 5. Lifecycle

| # | Phase | What happens | Enforced by |
|---|---|---|---|
| 1 | Draft | Issuer creates the listing in the console (incl. eligibility: World on/off, optional jurisdiction rule), registers `acme.listingday.eth` and publishes policy v1 via CRE sim | Console, ENS, `ListingPolicyReceiver` |
| 2 | CCA live | Floor 80; bids with `maxPrice` > 190 revert; eligibility module checks the cap (and World voucher, and the issuer's jurisdiction rule if set) | CCA + `AuctionValidationHook` + module |
| 3 | Clears | Graduates if `currencyRaised >= requiredCurrencyRaised`; otherwise refunds | CCA |
| 4 | Migrate | `LBPStrategy.migrate()` initializes the v4 pool **at the clearing price** (~110) and mints LP; the console writes `listingday.pool` and `listingday.status=listed` to ENS | LBPStrategy + `ListingHook.beforeInitialize` (auth, `view`) / `afterInitialize` (store bands) |
| 5 | Listing day | ±5% band (104.5–115.5); `afterSwap` reverts swaps that land outside it | `ListingHook` |
| 6 | Normal trading | 20% band around the CRE reference or previous close; surveillance 5%; directional mode; optional halt; LP add and remove never blocked; CRE mirrors status to ENS | `ListingHook` + CRE + ENS |

**A revert can't persist a pause.** A breaching swap rolls back its own writes, so halts arrive only as successful CRE report transactions. Swaps never call CRE.

## 6. Components

| Component | Purpose | Inputs → outputs | Prize | Est. h |
|---|---|---|---|---|
| `MockSME` ERC-20 | Fixed-supply share token (110,000) | Launcher `createToken` or a deposit | Uni | 0.5 |
| `mUSDC` (6 dec) | Faucet quote token | `mint(to, amt)` | Uni | 0.5 |
| `ListingPolicyReceiver` | CRE policy store: version, `maxAge`, chain selector, monotonic `asOf`; best-effort ENS status mirror (try/catch). Emits its own `PolicyApplied` event. Hackathon guard: the mock forwarder is permissionless, so also require `tx.origin ==` our CRE broadcaster key | `onReport` → `policy()`; `setText(dnsEncode("acme.listingday.eth"), "listingday.status", …)` | CRE, ENS | 2 |
| `AuctionValidationHook` | 190% cap + delegates to a pluggable `IEligibilityModule` | `validate(maxPrice, amount, owner, sender, hookData)` | Uni, World | 1.5 |
| `AllowAllModule` (Phase 1) | Per-wallet cumulative cap only | owner, amount → ok / `CapExceeded` | Uni | 0.5 |
| `WorldVoucherModule` (Phase 2) | Checks an EIP-712 voucher signed by our verify backend: `{humanKey, owner, auction, cap, expiry, policyHash, claims}`; caps by `humanKey`; one wallet per human per auction | hookData voucher → ok / `NotEligible` / `CapExceeded` | World | 1.5 |
| `JurisdictionModule` + `AllOfModule` / `AnyOfModule` (optional) | Issuer country rule (allow/block list, `policyHash`), AND/OR composition with World | voucher `claims` + `policyHash` → ok / `JurisdictionBlocked` | Uni (story) | 1.5 |
| `JurisdictionRegistry` (stretch) | `owner → policyHash, expiry` for swap gating; written on voucher use or `register(voucher)` | voucher → `isEligible(trader, policyHash)` | Uni | 1 |
| Verify backend (Next.js API routes) | Agent Pass OIDC (or IDKit RP signature + `/v4/verify`), stores the human key, signs vouchers; also runs `zkPassport.verify` for the jurisdiction claim (or the mock-attestation fallback) | World / zkPassport result → voucher | World | 2.5–6 (+2–3 country) |
| CCA + LiquidityLauncher + LBPStrategy | Auction → automatic graduation | Params → auction → pool + LP NFT | Uni | 3 |
| `ListingHook` (inherits `InitializerHook`) | Bands, modes, halt; LP never blocked | `beforeInitialize` (inherited auth check; `view`, so no writes), `afterInitialize` (store listing price + bands), `beforeSwap`, `afterSwap` | Uni | 4 |
| CRE workflow (TS) | Cron or manual → HTTP GET mock exchange API → `writeReport` with `gasConfig.gasLimit` ≈ 1.5–2M (the ENS mirror is storage-heavy) | JSON → report → receiver | CRE | 2 |
| Mock exchange API | Editable JSON (ref price, mode, halt); the console edits it | Console → JSON | CRE | 0.5 |
| ENS namespace setup | `listingday.eth` → UserRegistry → `acme` subname owned by the issuer; issuer resolver records; scoped roles | Scripts + console | ENS | 3–4.5 |
| Mobile PWA (Next.js + wagmi/viem) | 7 screens incl. the issuer console | Reads via Anon-RPC; writes via the wallet | All | 7–9 |
| Anon-RPC layer | `@anon-rpc/browser-harness` `AnonRpcWorker` on the **Nox** specifier (Sepolia, ~1.8 MB bundle); `worker.fetch` as the viem `custom`/`http({ fetchFn })` transport; badge and counter; no fallback to direct RPC | All `eth_call` / `eth_getLogs` / ENS reads (CCIP-Read off or routed through `worker.fetch`) | EF | 2–4 |
| Charts (Lightweight Charts v5) | Pool vs reference, bands, markers, clearing per block | Logs + receipts → series | All | 2 |
| Demo wallets + scripts | 4–6 wallets; bids, swaps, failure paths | Foundry scripts | All | 1.5 |

### Contract sketches (design only)

```solidity
interface IEligibilityModule {
    /// MUST revert to reject. Non-view: may record usage.
    function check(address owner, address sender, uint128 amount, bytes calldata hookData) external;
}

contract AuctionValidationHook is ValidationHookIntrospection {
    uint256 public immutable capQ96;          // 1.9 × issue, Q96
    IEligibilityModule public immutable module;
    address public auction;                   // bound once via setAuction; cannot be immutable (see wiring note)
    function setAuction(address a) external;  // deployer-only, once, before startBlock;
                                              // require IContinuousClearingAuction(a).validationHook() == address(this)
    function validate(uint256 maxPrice, uint128 amount, address owner, address sender, bytes calldata hookData) external {
        if (msg.sender != auction) revert OnlyAuction();
        if (sender != owner) revert SenderMustBeOwner();
        if (maxPrice > capQ96) revert BidAboveCap(maxPrice, capQ96);
        module.check(owner, sender, amount, hookData);
    }
}

// Phase 2 voucher (EIP-712), signed by the verify backend after World (and, if set, jurisdiction) validation
struct EligibilityVoucher {
    bytes32 humanKey;   // keccak(Agent Pass iss|sub) or IDKit nullifier, scoped per auction action
    address owner;      // the bidding wallet; one wallet per humanKey per auction
    address auction;
    uint128 cap;        // per-human budget cap (mock application limit)
    uint64  expiry;     // short-lived → "expired" failure path
    bytes32 policyHash; // issuer jurisdiction rule satisfied (0 if none), §9
    uint8   claims;     // bit0 HUMAN, bit1 JURISDICTION
}

struct ListingPolicy {
    uint32 version; uint64 asOf; uint64 chainSelector; // 16015286601757825753 (Sepolia)
    uint160 refSqrtPriceX96; uint16 normalBandBps; uint16 survBandBps;
    uint8 mode; bool halted; uint64 coolOffUntil;
    bytes32 eligibilityHash; // modules + AND/OR + jurisdiction policyHash; frozen after startBlock (§9)
}
```

Note on wiring (verified in source): the CCA factory deploys with CREATE2 over init code that **includes `AuctionParameters`, and those contain `validationHook`**. The hook address must therefore exist before the auction address can be computed, so the hook **cannot** take the auction as an immutable constructor argument. That would be circular.
- **Use:** a one-time, deployer-only `setAuction(a)`, called right after the launcher multicall and before `startBlock`. It checks `IContinuousClearingAuction(a).validationHook() == address(this)` and `a.token() ==` the expected token. The auction address comes from the factory's `AuctionCreated` event or the strategy's `InitializerCreated` event.
- **Don't bind lazily to the first caller.** Anyone can deploy a CCA through the public factory that points at our hook and claim it first.
- **Alternative (fragile):** precompute with `factory.getAddress(token, auctionSupply, auctionParams, keccak256(abi.encode(keccak256(abi.encode(launcherCaller, salt)), migrationParams)), LBPStrategy)`. The launcher and strategy each re-hash the salt.
- Keep the `msg.sender == auction` check. Without it, anyone could call `validate` directly and burn another wallet's cap.
- The CCA wraps every hook revert as `ValidationHookCallFailed(bytes reason)`. The UI must decode the inner error (`BidAboveCap`, `NotEligible`, `CapExceeded`, `JurisdictionBlocked`).

ListingHook: compare prices in sqrtPriceX96 space with precomputed bounds and mind token order. Use `beforeSwap` to `tstore` the pre-price for directional mode. With no liquidity flags set, LPs are never blocked. `authorized` = LBPStrategy `0x9543…2000` (onchain `authorized()` on the reference hook confirms the strategy is a singleton); mine the address with HookMiner.
- A hook revert also makes the v4 Quoter revert. The trade sheet's "would revert: outside band" pre-check is just a failed quote.
- In a hook, `sender` is the router, not the trader. If swap-side jurisdiction gating is on, identify the trader through `IMsgSender(sender).msgSender()` for an allowlist of routers. Universal Router and V4Quoter on Sepolia both implement it. See [Country restrictions](#9-country-restrictions-issuer-optional).

## 7. ENSv2 ticker namespace

**Goal:** each SME ticker is an ENSv2 subname that the issuer controls, and the app resolves *everything* about an IPO from it. The UI hard-codes nothing beyond the parent name.

```
listingday.eth                    (ours, registered on Sepolia ENSv2 via ETHRegistrar / ENS app; paid in ENS MockUSDC)
 └─ subregistry: UserRegistry     (VerifiableFactory.deployProxy(impl, salt, initialize([(us, roleBitmap)])); we hold ROLE_REGISTRAR + ROLE_UNREGISTER)
     └─ acme  → owner: issuer wallet (ERC-1155 token), resolver: issuer's Permissioned Resolver
```

**Records** on `acme.listingday.eth` (issuer's Permissioned Resolver):

| Key | Value | Written by |
|---|---|---|
| `addr` (60) | MockSME token | Issuer |
| `listingday.auction` | CCA address | Issuer console after launch |
| `listingday.pool` | v4 PoolId (bytes32 hex) | Issuer console after migrate |
| `listingday.hook` | ListingHook address | Issuer |
| `listingday.policy` | `eip155:11155111:<ListingPolicyReceiver>` | Issuer |
| `listingday.status` | `draft` / `auction` / `listed` / `surveillance` / `halted` | **ListingPolicyReceiver only** (scoped role) |
| `listingday.eligibility` | `open` / `human` / `human+jurisdiction` / `human\|jurisdiction` | Issuer (before `startBlock`) |
| `listingday.jurisdiction` | e.g. `allow:nationality:IND` or `block:nationality:<sorted list>`; empty = off | Issuer (before `startBlock`); the app checks its hash equals the module's `policyHash` |
| `description`, `url`, `avatar` | Issuer profile | Issuer |

**Role-scoped records (Enhanced Access Control):**
- The issuer keeps admin roles on their resolver.
- `ListingPolicyReceiver` gets `ROLE_SET_TEXT` scoped to the single key `listingday.status`, via `grantSetterRoles(bytes setter, address account)`. `setter` is the ABI-encoded `setText(bytes name, string key, …)`. The granter needs `ROLE_SET_TEXT_ADMIN` on that resolver; plain `grantRoles` reverts. A CRE halt can flip the status but can't touch any other record.
- ENSv2 setters take a **DNS-encoded name**, not a `bytes32 node`: `setText(bytes name, string key, string value)` and `setAddress(bytes name, uint256 coinType, bytes value)`.
- Scoped setter roles apply across **every record bundle in that resolver**, so each issuer uses **their own** resolver instance (the ENSv2 default is one Permissioned Resolver per account). That keeps the receiver's write power limited to that issuer's names.
- Subname token roles: issuer gets `ROLE_SET_RESOLVER` and `ROLE_RENEW`. We withhold `ROLE_CAN_TRANSFER_ADMIN`, which can only be granted at registration; transfers then revert `TransferDisallowed`. So a ticker can't be sold away mid-IPO. We keep registry root roles only to unregister a delisted ticker.
- **Token ids regenerate** whenever roles change (`TokenRegenerated`). Index tickers by labelhash and look them up with `findTokenId(label)`, never by a cached token id.

**UI resolution.** The app resolves tickers through viem ENS actions (`getEnsAddress`, `getEnsText`). viem's `sepolia` chain already points `ensUniversalResolver` at the `0xeEeE…EeEe` proxy (`UpgradableUniversalResolverProxy` → UniversalResolverV2). These reads go through Anon-RPC too. Disable CCIP-Read (`ccipRead: false`) or route it through `worker.fetch`; otherwise gateway calls would bypass Anon-RPC. The IPO list is built from the UserRegistry's `LabelRegistered` / `LabelUnregistered` / `TokenRegenerated` events.

**Hours:**

| Task | Hours |
|---|---|
| Register `listingday.eth`: `commit`, wait 60 s–24 h, then `register(label, owner, secret, subregistry, resolver, duration ≥ 28 days, paymentToken, referrer)`; mint ENS MockUSDC `0x240b…14aa` (~8 USDC/yr) and `approve` first | 0.5 |
| UserRegistry deploy + `setSubregistry` | 1 |
| Register a ticker + records from the console | 1 |
| Scoped role for the receiver + status mirror | 0.5–1 |
| UI resolution | 1 |
| **Total** | **3–4.5** |

Confirm exact function signatures against `ensdomains/contracts-v2` at tag **`v2-mainnet-deployment-1`**, whose `contracts/deployments/sepolia/*.json` ABIs match the live addresses. Don't use `main`, which holds an older Sepolia deployment with a different resolver API. Also read the contract-developer tutorial before scripting.

## 8. World ID eligibility

**Phase 1 (MetaMask e2e first):** `AllowAllModule`, a per-wallet budget cap only. Everything works with plain MetaMask.

**Phase 2 (swap-in, 4–8 h):** `WorldVoucherModule`.
1. On the bid sheet, the user taps "Verify you're one applicant". This opens **one** of two paths, fixed per deployment: Agent Pass fresh authentication (OIDC), or the IDKit widget (Proof of Human; simulator/staging for the demo). Never offer both for the same auction. The identifier spaces differ, so one person could collect two vouchers.
2. The backend validates the result:
   - **Agent Pass:** request `max_age=0` and `claims={"id_token":{"acr":{"essential":true,"values":["https://world.org/oidc/acr/orb"]}}}`. Validate signature, `aud`, `nonce`, `auth_time`, `acr` and `amr`; the default "Any account" setting is **not** one human. Human key = hash(`iss`,`sub`). Use the sandbox IdP (`sandbox.auth.world.org`); hackathon proofs are mocked identities.
   - **IDKit:** the backend creates the request with `signRequest` (RP signing key, never in the client). Set `signal` = the bidder wallet and check it on the backend. Forward the payload to `POST https://developer.world.org/api/v4/verify/{rp_id}`, assert `environment`, and use human key = the nullifier for action `listingday-<ticker>`. Store it with `UNIQUE(nullifier, action)`.
3. The backend refuses if that human key is already bound to another wallet for this auction. Otherwise it signs a short-lived EIP-712 voucher.
4. The voucher rides in `submitBid(maxPriceQ96, amount, owner, prevTickPriceQ96, hookData)`. The module checks the signer and expiry, binds human key → owner, and enforces the per-human cap.

**Failure paths to demo** (both World tracks require one):
- The same human tries a second wallet → backend denies, no voucher.
- A forged or expired voucher → bid reverts `NotEligible`.
- Cancelled verification → bid button stays disabled.

**Why not verify onchain?** World ID 4.0's `WorldIDVerifier` is on World Chain only (production + staging). Arc has a `WorldIDSatellite` (production only). Ethereum Sepolia has neither. It has only the legacy v3 `WorldIDRouter` (`0x4694…2157`). That router is still live: the testnet identity manager is on Sepolia itself, the group-1 root updated today, and root expiry is 1 h. But it is Orb-only (`groupId = 1`) and takes legacy proofs. Backend validation + a signed voucher is what both World tracks ask for ("validate in a secure backend"). An onchain legacy-router path is a stretch only.

**Credential choice (IDKit judging asks for it):** Proof of Human is the minimum sufficient assurance. We need uniqueness per applicant, not identity documents. Generally available World credentials don't prove nationality: the 9303 passport credential carries no nationality field, and Agent Pass ID tokens carry no attributes. Only **Identity Check** (Preview, "contact us") can attest `nationality` / `issuing_country` as a boolean match. Jurisdiction is therefore a separate module ([§9](#9-country-restrictions-issuer-optional)), and Proof of Human stays the "minimum sufficient" credential.

## 9. Country restrictions (issuer-optional)

**Goal:** an issuer can say "this IPO is open only to holders of an Indian passport", or "open to everyone except a sanctions list and the US". The chain enforces that rule. The investor reveals **one bit**, eligible or not, and never their nationality. It is a third pluggable `IEligibilityModule` next to `AllowAllModule` and `WorldVoucherModule`. It is **off by default**.

### 9.1 Issuer choices (console → listing policy)

| Setting | Options | Demo value |
|---|---|---|
| Rule | Off · **Allow only** listed countries · **Block** listed countries | Allow only |
| Basis | **Nationality** (passport) · Issuing country (passport or residence permit) · Residency (stretch: Aadhaar) | Nationality |
| List | ISO 3166-1 alpha-3, sorted (zkPassport requires sorted lists for exclusion) | `IND` (+ the dev-mode mock country, see 9.3) |
| Applies to | **Bidding** · Bidding + trading on our pool | Bidding (trading = stretch) |
| Combine with World ID | **AND** (default) · OR | AND |

How the rule is recorded (one rule, three places, all must agree):
- **Onchain, immutable:** `JurisdictionModule` is deployed per listing with `policyHash = keccak256(abi.encode(rule, basis, sortedList, appliesToSwaps))`. It can't change mid-auction.
- **Listing policy:** `ListingPolicy` gains `bytes32 eligibilityHash`, committing to the module set, AND/OR and `policyHash`. The receiver rejects a CRE report that tries to change it after `startBlock`. CRE can still halt trading, but it can't quietly move the jurisdiction goalposts.
- **ENS:** issuer-written records `listingday.eligibility` = `human+jurisdiction` and `listingday.jurisdiction` = `allow:nationality:IND`. The app shows the rule from ENS and checks that its hash equals the module's `policyHash`.

### 9.2 Attestation sources (what exists on Sepolia today)

| Source | Proves | Ethereum Sepolia | Role here |
|---|---|---|---|
| **zkPassport** | Nationality or issuing country in or out of a list (inclusion proof hides *which* country), sanctions, age; proof bound to a wallet | **Yes.** `ZKPassportVerifier` `0x1D00…c0D8` has code. Dev-mode mock passports are rooted in the Sepolia registry. | **Primary.** Backend `verify({ devMode: true })` → voucher. Stretch: verify onchain. |
| **Backend-signed attestation** (+ optional EAS record) | Whatever our mock "KYC provider" asserts | Our module; EAS `0xC267…815e` has code | **Fallback.** Same voucher, a mock country picker in the demo. |
| Anon Aadhaar (PSE) | Aadhaar holder = **Indian resident** (not citizen); optional state/pincode | Yes. Test-key verifier `0x6bE8…E281` has code. | Pitch "next module". Low maintenance since 2025, so not tonight. |
| Self | Nationality denylist (private) or allowlist (**reveals** nationality); OFAC | No. Onchain mode is Celo / Celo Sepolia only; the open SDK is deprecated in favour of Self Enterprise. | Not used. |
| Coinbase Verified Country | Residence country (public, alpha-2) | No. Base / Base Sepolia only. | Not used. |
| World ID (Proof of Human) | Uniqueness only | Legacy v3 router only | Composes via AND/OR, not a country source. |
| World ID **Identity Check** (Preview) | Boolean `identity_attested` for `nationality` / `issuing_country` (alpha-3), `minimum_age`, `document_type`; country not revealed | No (backend verify) | Only if World enables the preview for our app; simulator support unverified. Would make World a single-SDK path for both claims. Ask at the World booth; don't plan on it. |

There is no Self, zkPassport, Coinbase or Base prize at ETHGlobal Mumbai. This feature earns points through the Uniswap and ENS stories and the pitch, not through a separate prize.

### 9.3 Flow

1. The bid sheet shows "Open to: Indian nationals · 1 per human". The user taps **Check eligibility**.
2. The PWA opens the zkPassport request: a QR code on desktop, or a deep link on the phone. The request uses `scope = listingday-<ticker>`, the query `.in("nationality", ["IND", …])` (or `.out(...)` for a block list), and `.bind("user_address", owner)`.
3. The verify backend runs `zkPassport.verify({ proofs, queryResult, scope, devMode })`. It checks the bound address is `owner` and the query matches the issuer's `policyHash`. It then signs the **same EIP-712 voucher type** as World, with two new fields:

```solidity
struct EligibilityVoucher {
    bytes32 humanKey;    // World key (0 if World not required)
    address owner;
    address auction;
    uint128 cap;
    uint64  expiry;
    bytes32 policyHash;  // NEW: the issuer jurisdiction rule this voucher satisfies
    uint8   claims;      // NEW: bit0 = HUMAN (World verified), bit1 = JURISDICTION
}
```

4. The voucher rides in `hookData`. `AuctionValidationHook` → module → reverts `JurisdictionBlocked` if the bit or `policyHash` is missing. The CCA wraps that error as `ValidationHookCallFailed`.
5. Nationality never reaches the chain or our database. The backend stores only `(policyHash, owner, expiry)`. Calldata carries only the claim bit.

**Dev-mode caveats (Gate 0 item):**
- All zkPassport mock passports share unique identifier `1`, so **uniqueness must come from World ID, not the passport**.
- Check which nationality the Zero Knowledge Republic mocks carry, and add that code to the demo allowlist. Label it "mock country" in the UI.
- Real Indian passports may not all be readable yet (ICAO 9303 chip coverage), so the fallback path matters.

### 9.4 Composition with World ID

```solidity
contract JurisdictionModule is IEligibilityModule {      // pluggable, like AllowAll / WorldVoucher
    bytes32 public immutable policyHash;  address public immutable signer;
    function check(address owner, address sender, uint128, bytes calldata hookData) external; // reverts JurisdictionBlocked
}
contract AllOfModule is IEligibilityModule { IEligibilityModule[] public modules; } // AND: every child must pass
contract AnyOfModule is IEligibilityModule { IEligibilityModule[] public modules; } // OR: first child that doesn't revert (try/catch)
```

- **AND (default):** `AllOf(WorldVoucher, Jurisdiction)` means one human, one application, and only from allowed countries. One backend issues one voucher with both claim bits, so the bidder signs nothing extra.
- **OR:** `AnyOf(WorldVoucher, Jurisdiction)` means "a verified human **or** a verified passport holder". It widens access without losing a person check. Because mock passports all share id `1`, OR is a design option only and not demoed.
- **Off:** `AllowAll` or `WorldVoucher` alone, exactly as in §8.
- Per-human caps stay in `WorldVoucherModule`. `JurisdictionModule` is stateless apart from replay protection.

### 9.5 Where the check runs

| Action | Enforced by | How |
|---|---|---|
| Bid | `AuctionValidationHook` → module | Voucher in `hookData`; `sender == owner` |
| Claim allotment | CCA | Tokens go to the `owner` already checked at bid time |
| Swap on our pool (if "bidding + trading") | `ListingHook.beforeSwap` | `trader = IMsgSender(sender).msgSender()` for allowlisted routers (Universal Router `0x3A9D…F98b` and 2.1.2 `0x7E4f…43f3`, V4Quoter `0x68aF…8244`); any other router reverts `UntrustedRouter`. `JurisdictionRegistry.isEligible(trader, policyHash)` must be true. The registry is written when a voucher is consumed, or via `register(voucher)` for secondary buyers. |
| LP add / remove | Not gated | "LP exits always work" stays true |

**Honest limitations (README + UI copy):**
- **IP/VPN geofencing is not enforcement.** We use the IP country only as a hint ("looks like you're outside India") and never as a gate.
- **Nationality ≠ residency.** Securities rules usually care about residence. A passport proves citizenship. Aadhaar proves residency (182+ days in India, including resident foreigners) but not citizenship.
- **Transfers bypass the pool check.** MockSME is a plain ERC-20 (UERC20 from `createToken`). After allotment, a holder can `transfer` to anyone or trade on another pool. Real transfer restrictions need a permissioned token (ERC-3643 style) deposited via `depositToken`. That is out of scope tonight, and we say so.
- **Wallets aren't people.** An eligible person can bid for someone else. That's why the default is AND with World ID, and why we never claim this is KYC.
- **The backend is a trust point.** It is the same signer as World: short expiry, key only in the backend env. The onchain zkPassport registry stretch removes it.

### 9.6 UX

**Issuer console:** a new **Eligibility** step in "Create listing":
- toggles for "One human, one application (World ID)" and "Jurisdiction rule";
- a country multi-select with presets ("India only", "Block OFAC + US");
- a basis selector and an AND/OR switch;
- "Applies to: Bidding / Bidding + trading";
- a live preview of what investors see.

On publish, the console writes the ENS records, includes `eligibilityHash` in policy v1 (CRE), and deploys the module. The step shows a fixed note: "Your KYC/AML obligations are unchanged; this is an extra, privacy-preserving gate".

**Mobile PWA:**
- **IPO list / detail:** a chip such as "IND only · nationality" / "Restricted: 12 countries" plus "1 per human", read from ENS.
- **Bid sheet:** an eligibility checklist (World ✓, Jurisdiction ✓). Each step deep-links to the World App or zkPassport app and returns to the PWA. Success copy: "Eligible. ACME and the chain learned only that you meet its rule". Denial copy: "This IPO is limited by the issuer to Indian nationals". There is no retry loop and no hint about how to get around the rule.
- **Trade sheet (if trading is gated):** a pre-check. Not registered gives "Verify to trade ACME"; ineligible gives a disabled button with the issuer's rule.

### 9.7 Pitch angle

- **The issuer chooses the jurisdiction rules; the protocol enforces them; the investor reveals one bit.**
- India's regulators already draw this line. SEBI's sandbox framework: "no exemptions would be granted from the extant investor protection framework, Know-Your-Customer (KYC) and Anti-Money Laundering (AML) rules" ([SEBI, Jun 2021, ¶24](https://www.sebi.gov.in/sebi_data/attachdocs/jun-2021/1623665266705.pdf)). IFSCA's 2020 sandbox framework has the same sentence ([¶16](https://ifsca.gov.in/Document/Legal/ifsca-circular-regulatory-sandbox_new19102020084227.pdf)). IFSCA's March 2026 FinTech Sandbox Framework replaced that document and doesn't repeat the sentence verbatim, so quote SEBI and present IFSCA as context.
- Listing Day doesn't relax KYC. It adds an onchain, privacy-preserving enforcement layer for issuer-chosen offering restrictions on top of intermediary KYC. An IFSC (GIFT City) style listing could open to foreign investors, while a domestic SME issue could stay India-only.
- Everything here is a mock, with no regulatory claims (see the disclaimer).

**Hours:** fallback backend attestation + `JurisdictionModule` + `AllOf` takes 1.5 h. zkPassport backend verify + PWA flow takes 2–3 h. Swap gating + registry takes 1.5 h (stretch). Onchain zkPassport registry is a stretch.

## 10. Mobile app and screens

**Stack:**
- Mobile-first Next.js PWA with wagmi + viem.
- MetaMask (mobile in-app browser) and WalletConnect first.
- **Anon-RPC for all reads by default**, through `@anon-rpc/browser-harness` on the Nox specifier. It is browser-only: a null-origin sandboxed iframe plus Web Worker plus WebRTC. The default `srcdoc` bootstrap needs CSP `'unsafe-inline'`, or we serve our own `iframeUrl`. Whether MetaMask Mobile's in-app browser allows WebRTC in a sandboxed iframe is a Gate 0 check; fall back to a regular mobile browser + WalletConnect.
- Writes, gas estimates and nonce reads go through the wallet's own RPC. MetaMask can't be pointed at Anon-RPC: there is no local HTTP endpoint, and MetaMask doesn't hand back raw signed txs. The README says so plainly, as the prize page asks ("just let us know"). If an embedded wallet is added later, route its reads through `worker.fetch`.

**Charts:** TradingView **Lightweight Charts** v5 (Apache-2.0). It requires the NOTICE attribution text *and* a link to tradingview.com. `attributionLogo` (default `true`) covers only the link, so the NOTICE text also goes on an About/Credits page. Advanced Charts is out: it needs license approval.
- Pool price line (from `Swap` logs via Anon-RPC) and a CRE reference line (from receiver events).
- Upper and lower band **price lines** (`createPriceLine`), updated on mode change.
- **Markers** (`createSeriesMarkers`):
  - Reverted swaps: these emit no logs, so markers come from the app's own tx receipts with `status = 0` plus the demo script's published hashes.
  - Circuit trips: CRE reports with mode or halt changes.
- A baseline series (`BaselineSeries`, `baseValue` = reference) to colour above and below the reference.
- CCA clearing price per block (`ClearingPriceUpdated` / checkpoints) on the auction screen.

**Screens:**

| Screen | Content |
|---|---|
| IPO list | Tickers from ENS, status chip from `listingday.status`, Anon-RPC badge |
| IPO detail + bid sheet | Range, clearing chart, budget + max price, cap remaining, eligibility chip from ENS, eligibility checklist (World verify; jurisdiction proof if the issuer set a rule, §9.6) |
| My bids / allotment | Bid states (active, outbid, partial, filled), exit and claim actions, refund amount |
| Live market chart + trade sheet | Lightweight Charts with band, reference and markers; quote via Quoter; swap via Universal Router; "would revert: outside band" pre-check (decoded Quoter revert); "Verify to trade" if trading is jurisdiction-gated |
| Circuit status banner | Global: Listing band / Normal / Surveillance / Directional / Halted, with the time it changed (IST) |
| Portfolio | MockSME balance, LP positions, PnL vs issue price |
| **Issuer console** | Create listing (supply 110,000, issue price, range 80–190%, cap, LP %), **Eligibility step** (World on/off, jurisdiction rule, basis, list, AND/OR, bidding vs trading; §9.6), register ENS ticker, publish policy (CRE sim), launch CCA, monitor bids and clearing, demo buttons (reference update, surveillance, directional, halt, resume) |

The console's demo buttons edit the mock exchange JSON and then run `cre workflow simulate --broadcast --non-interactive --trigger-index 0` from a local runner script. That needs a CRE account, `cre login`, and a funded `CRE_ETH_PRIVATE_KEY`; prebuild with `cre workflow build` to skip recompiling. The judge sees the Sepolia tx. Nothing pretends to be a deployed DON; real DON deployment needs `cre account access` approval.
- **Don't trust tx status.** The mock forwarder mines a *successful* tx even when `onReport` reverts, recording `ReportProcessed.result = false`. The UI shows "policy applied" only from the receiver's own event.

## 11. Diagrams

### 11.1 Architecture

```mermaid
flowchart LR
  subgraph Client["Mobile PWA (Next.js + wagmi/viem)"]
    UI[Investor screens]
    IC[Issuer console]
    CH[Lightweight Charts]
  end
  subgraph Off["Offchain services"]
    ANON[Anon-RPC worker\nNox mixnet; tor-js fallback]
    API[Mock exchange API]
    CRE[CRE workflow\nsimulate --broadcast]
    VB[Verify backend\nAgent Pass / IDKit / zkPassport → EIP-712 voucher]
    WID[World ID\nIdP / Developer Portal]
    ZKP[zkPassport app + SDK\ndev-mode mock passports]
  end
  subgraph Sepolia
    FWD[MockKeystoneForwarder]
    REC[ListingPolicyReceiver]
    ENS[ENSv2: UserRegistry + issuer\nPermissioned Resolver]
    UR[UniversalResolverV2]
    LL[LiquidityLauncher] --> LBP[LBPStrategy]
    LBP --> CCA[CCA]
    CCA -. validate .-> AVH[AuctionValidationHook]
    AVH --> MOD["Eligibility module\nAllowAll → AllOf: WorldVoucher + Jurisdiction"]
    JREG[JurisdictionRegistry\nstretch: swap gating]
    LBP -- migrate --> PM[PoolManager]
    PM --> LH[ListingHook]
  end
  UI & IC & CH -- all reads --> ANON --> UR & CCA & REC & PM
  UI -- verify --> VB <--> WID
  UI -- country proof --> ZKP --> VB
  LH -. trader eligible? .-> JREG
  UI -- bid + voucher via wallet --> CCA
  UI -- swap via wallet --> PM
  IC -- edit --> API --> CRE --> FWD --> REC
  IC -- register ticker, records --> ENS
  REC -- scoped setText status --> ENS
  LH -- reads policy --> REC
  UR --> ENS
```

### 11.2 Sequence: ticker to listing day

```mermaid
sequenceDiagram
  autonumber
  participant IS as Issuer console
  participant E as ENSv2
  participant C as CRE (sim)
  participant R as PolicyReceiver
  participant L as Launcher + LBP
  participant A as CCA
  participant V as ValidationHook + module
  participant B as Bidder app
  participant W as Verify backend (World + zkPassport)
  participant P as PoolManager
  participant H as ListingHook
  IS->>E: register acme.listingday.eth (issuer owner, records)
  IS->>E: grant receiver ROLE_SET_TEXT(key=listingday.status)
  IS->>C: publish policy v1
  C->>R: onReport(policy v1)
  R->>E: setText(status=draft)
  IS->>L: multicall(createToken 110,000, distribute)
  L->>A: create(validationHook=V, floor 80, tokensRecipient=issuer, fundsRecipient=LBP)
  IS->>V: setAuction(A) (once, before startBlock)
  IS->>E: setText(listingday.auction=A, status=auction)
  B->>E: resolve acme (via Anon-RPC)
  B->>W: World verify (Agent Pass / IDKit)
  B->>W: zkPassport proof (nationality in list, bound to B) if the issuer set a rule
  W-->>B: EIP-712 voucher {claims, policyHash} (or denied)
  B->>A: submitBid(maxPriceQ96, amount, owner=B, prevTickPriceQ96, hookData=voucher)
  A->>V: validate → cap 190, sender==owner, voucher, per-human cap, jurisdiction
  Note over A: ends, clears ≈ 110
  IS->>L: migrate(A) (after migrationBlock)
  L->>P: initialize(key{hooks=H}, sqrtP(110))
  P->>H: beforeInitialize ✓ / afterInitialize
  IS->>E: setText(listingday.pool, status=listed)
  B->>P: swap
  P->>H: afterSwap band check → revert OutOfBand if outside
  IS->>C: halt
  C->>R: onReport(halted)
  R->>E: setText(status=halted)
```

### 11.3 State diagram

```mermaid
stateDiagram-v2
  [*] --> Draft: ticker registered + policy v1
  Draft --> AuctionLive: launcher multicall
  AuctionLive --> Refunding: raised < required
  AuctionLive --> Cleared: raised >= required
  Refunding --> [*]
  Cleared --> ListingDay: migrate (pool at clearing)
  Cleared --> Recovered: migration fails (terminal)
  ListingDay --> Normal: window ends
  Normal --> Surveillance: CRE mode=1
  Surveillance --> Normal: CRE mode=0
  Normal --> Directional: CRE mode=2
  Directional --> Normal: CRE mode=0
  Normal --> Halted: CRE halted
  Surveillance --> Halted: CRE halted
  Halted --> Normal: CRE resume
  note right of Halted: swaps revert, LP exits ok, ENS status=halted
```

## 12. Rule mapping (NSE-inspired mock)

| Real NSE SME rule | Our onchain version | Fidelity |
|---|---|---|
| Opening range capped at 90% above issue (NSE/SME/62757, Jul 2024), floored at 20% below (NSE/CMTR/69388, Aug 2025) | CCA floor 80; hook rejects `maxPrice` > 190 | Close (opening discovery only) |
| Special pre-open: 45-min entry with random close, 10-min match, 5-min buffer; volume-maximising price | CCA uniform-price clearing over blocks | Inspired, not identical |
| No equilibrium → trades at issue price | Not graduated → refunds | Different by design |
| Application limits per applicant | Per-wallet (Phase 1) / per-human (Phase 2) budget cap | Inspired (mock values) |
| Listing day: 5% band if issue ≤ ₹250 Cr, 20% above | ±5% around clearing | Faithful for SME size |
| T2T for the first 10 days | Not modelled | — |
| Emerge normal band 20%; surveillance 5% / 2% | 20% default; CRE mode=1 → 5% (2% configurable) | Close |
| Orders beyond the limit are rejected, not halted | `afterSwap` revert | Faithful |
| — | Timed cool-off, directional mode | Our extensions |
| Market-wide index circuit breakers | Not modelled | — |

## 13. Mock and demo plan

**Example numbers (example data):**
- 110,000 shares (90,000 auctioned), issue 100, range 80–190.
- Clears around 110, so the listing band is 104.5–115.5.
- The CRE reference then shifts from 110 to 90 with directional mode on.

| Step | Pool | Ref | Result |
|---|---|---|---|
| Open | 110 | 110 | ok |
| Buy push | 114 | 110 | ok |
| Buy push | 117 | 110 | **revert** (>115.5) |
| Sell | 108 | 110 | ok |
| Window ends | 108 | 110 | band 88–132 |
| Ref → 90, mode=2 | 108 | 90 | — |
| Buy push | 111 | 90 | **revert** (widens gap) |
| Arb sell | 98 | 90 | ok |
| Halt | 98 | 90 | swaps revert; LP ok; ENS status=halted |

**Demo script (~3.5 min; 2–4 min hard limit, ≥720p, real voice, not sped up).** ETHGlobal rules say "DO NOT use mobile phones to record the video submission". Show the phone via screen mirroring or a device screen recording composited into a desktop capture.
1. **0:00 Pitch:** the NSE SME flow on one slide.
2. **0:20 Issuer console:** create ACME (110,000 shares, 80–190%, 20% to LP) and register `acme.listingday.eth`. The ENS explorer shows the records.
3. **0:45 Publish policy:** CRE sim `--broadcast`; the Sepolia tx appears and ENS status reads `draft`, then `auction`.
4. **1:00 Investor phone:** the IPO list resolves from ENS, with the badge "Reads via Nox mixnet · 100%". ACME's chip reads "IND only · 1 per human".
5. **1:15 Bid:** World verify + zkPassport (mock passport), then a bid. A second wallet for the same human is denied. A mock passport outside the list reverts `JurisdictionBlocked`, and the issuer's rule shows. A bid at 200 reverts `BidAboveCap`.
6. **1:50 Clearing:** the clearing chart moves per block. Graduation (pre-run) opens the pool at 110.
7. **2:10 Trade:** an in-band buy passes; a buy to 117 reverts, with a marker on the chart.
8. **2:35 Console:** reference 90 + directional mode. The widening buy reverts and the arb sell passes.
9. **3:00 Halt:** the banner turns red, ENS status reads `halted`, and LP removal still works.
10. **3:20 Close:** the architecture slide and the 3 claimed prizes.

Pre-record the auction phase: Sepolia blocks take ~12 s.

## 14. Build plan to Sat 09:00 IST

Re-based at **Fri ~14:00 IST: about 19 h remain** (was 21.5 h from 11:30). The original Gate 0 deadline of 13:30 has passed with nothing built, so every block before the Sat 01:30 checkpoint is 2.5 h shorter. **Order: MetaMask e2e first, then ENS, then the World ID swap-in, then the country module.** The total effort (~37–48 h with country) needs **two parallel lanes**. A solo builder should cut World and the country module, keep combo A, and describe §9 as design.

**Gate 0 (Fri 14:00–16:00 IST):** all of these must pass before anything else.
1. Nox Anon-RPC worker → Sepolia read from a phone. Try the MetaMask in-app browser first (WebRTC inside a sandboxed iframe), then a regular mobile browser + WalletConnect.
2. CRE `simulate --broadcast` → `onReport` on a stub receiver. Check `ReportProcessed.result == true` and the receiver event, not just tx status.
3. Fork test: Launcher multicall → CCA → `setAuction` → bids → `migrate()` into a pool with a mined InitializerHook-derived hook. Confirm `sweepUnsoldTokens` to the issuer `tokensRecipient`.
4. Register `listingday.eth` on Sepolia ENSv2: mint + approve MockUSDC, commit, wait 60 s, register.
5. (Lane B, 20 min) zkPassport dev mode: a mock-passport proof verifies on our backend with `devMode: true`. Note which nationality the mocks carry.

| Time (IST) | Lane A: contracts, CRE, ENS | Lane B: app, Anon-RPC, World |
|---|---|---|
| Fri 14:00–16:00 | Gate 0 (fork test, CRE stub, ENS name) | Gate 0 (Nox spike on a phone, zkPassport dev-mode spike) |
| 16:00–18:00 | Tokens, receiver (+ hackathon `tx.origin` guard), validation hook + `setAuction` + `AllowAllModule` + tests | PWA shell, wagmi, Nox transport + badge |
| 18:00–21:30 | `ListingHook` (`afterInitialize` bands) + HookMiner + fork tests | IPO list, detail + bid sheet, My bids |
| 21:30–23:30 | Launch script on Sepolia (params, bids, migrate) | Chart (Lightweight Charts) + trade sheet + circuit banner |
| 23:30–Sat 01:00 | CRE workflow + console runner | Issuer console (create, launch, monitor, demo buttons) |
| **Sat 01:30** | **Checkpoint: MetaMask e2e on Sepolia (bid → clear → trade → revert → halt)** | |
| 01:00–03:30 | ENS: UserRegistry, ticker, records, scoped status role, receiver mirror | ENS resolution in the UI; portfolio |
| 01:30–05:00 | — | World verify backend + `WorldVoucherModule` swap-in (cap 3.5 h; stop at 05:00) |
| 03:30–05:00 | `JurisdictionModule` + `AllOfModule` + mock-attestation fallback; ENS `listingday.eligibility` / `.jurisdiction` records | — |
| 05:00–05:45 | Support | zkPassport backend verify + bid-sheet step (hard stop 05:45; otherwise demo the fallback, labelled "mock attestation") |
| 05:45–07:30 | Joint: rehearsal, video (screen capture, not a phone), README line pointers, FEEDBACK.md + form, World/ENS debriefs, AI-use note, CROPS README section, licence | |
| 07:30–08:15 | Pick 3 partners and submit | |
| 08:15–09:00 | Buffer | |

**Cut list, in order:**
1. Ex-dividend (already cut).
2. Swap-side jurisdiction gating + `JurisdictionRegistry` (keep bid-side gating).
3. Real zkPassport proofs (keep the backend mock-attestation fallback, labelled honestly).
4. Country module entirely (keep §9 as design + console mock-up; no prize depends on it).
5. World ID: fall back to `AllowAllModule` per-wallet cap, combo A.
6. Directional mode.
7. Timed cool-off.
8. Portfolio screen.
9. Receiver's ENS status mirror (the console writes status instead).
10. Previous-close roll.

## 15. Risks

See [`VALIDATION.md`](VALIDATION.md#top-risks) for the ranked top risks.

| Risk | Mitigation |
|---|---|
| A pause can't persist in a reverting swap | Reject-only bands; halts only via CRE report transactions |
| InstantLaunch is hookless (and has no Sepolia deployment), so no fallback | LBPStrategy only, proven in Gate 0 |
| LBPStrategy rejects the hook (`InvalidHook`, `PoolIdOccupied`) | Inherit InitializerHook, mine the address; `PoolIdOccupied` only bites if a token is reused (a new token per run gives a new pool id); keep `beforeInitialize` `view` and write state in `afterInitialize` |
| Auction address is circular with the validation hook (verified: CREATE2 init code includes `validationHook`) | Deployer-only one-time `setAuction` before `startBlock`, checking `a.validationHook() == this`; never lazy-bind |
| LBPStrategy recipient rules (`InvalidFundsRecipient` / `InvalidTokensRecipient`) | `fundsRecipient` = strategy, `tokensRecipient` = issuer treasury; issuer calls `sweepUnsoldTokens` |
| Migration failure is terminal (one-shot; reserves recovered to `recipient`) | Fork-test first; keep a spare run; `migrationBlock` > `endBlock` |
| Routers may skip or denylist hooks that revert often | Own UI + Universal Router; frame reverts as rule enforcement |
| Anon-RPC on mobile: WebRTC inside a sandboxed iframe in MetaMask's in-app browser is untested; CSP `'unsafe-inline'` for `srcdoc` | Gate 0 on a real phone; **Nox first** (Sepolia specifier, ~1.8 MB). tor-js fallback needs a mainnet bootstrap read + demo gateway (~6.9 MB). Nym ~18 MB is out |
| Silent fallback to direct RPC | Never: error with retry; per-transport counter |
| Anon-RPC doesn't hide queried addresses; bootstrap read isn't private; ENS CCIP-Read could bypass it | Honest note in the UI and README; `ccipRead: false` or route via `worker.fetch` |
| ENS judged as cosmetic | The UI reads auction, pool and policy *only* from ENS; the CRE status write uses a scoped role; demo the role denial (the receiver can't set `url`) |
| ENS scoped roles span all bundles in a resolver | One resolver per issuer |
| ENSv2 contract API unfamiliar; `main` branch ABIs don't match Sepolia | Use tag `v2-mainnet-deployment-1` ABIs; DNS-encoded names; MockUSDC payment; budget 4.5 h; cut the status mirror first |
| ENS token ids regenerate on role changes | Index by labelhash, `findTokenId(label)` |
| World: no ID 4.0 verifier on Ethereum Sepolia | Backend validation + EIP-712 voucher (what the prize asks); onchain legacy router only as a stretch |
| World: Agent Pass default admits unverified accounts; offering Agent Pass *and* IDKit gives one person two vouchers | Require Orb `acr` + `max_age=0` and validate claims; one World path per deployment |
| World integration 4–8 h; Agent Pass proofs are mocked identities | Hard stop Sat 05:00 IST; never claim production-grade sybil resistance |
| Voucher signer key is a trust point (World and jurisdiction) | Short expiry, one wallet per human key, `sender == owner`, key only in backend env; stated in README |
| Jurisdiction gate bypassed by ERC-20 transfers or other pools; nationality ≠ residency; IP geofencing is not enforcement | State plainly in UI + README; gate only bids (and optionally our pool); permissioned token is future work |
| zkPassport mocks all share unique id `1`; mock nationality may not be `IND`; real Indian passport coverage is partial | Uniqueness from World only; add the mock country to the demo list, labelled; backend mock-attestation fallback |
| World Identity Check (nationality) is preview-only | Not on the plan's critical path; zkPassport is primary |
| CRE mock forwarder is permissionless (anyone can push a fake halt) and swallows `onReport` reverts | Hackathon `tx.origin` guard + README note; UI reads `ReportProcessed.result` / receiver event; prod path = KeystoneForwarder + workflow owner/name checks |
| CRE ENS mirror is storage-heavy; Sepolia gas repricing (Glamsterdam) | `gasConfig.gasLimit` ≈ 1.5–2M; keep try/catch; measure on Sepolia, not only a fork |
| Reverted swaps emit no logs | Chart markers come from app-observed receipts and demo hashes; label "rejected attempts seen by this app" |
| Lightweight Charts licence | NOTICE text on an About page + `attributionLogo` link to tradingview.com |
| ETHGlobal disqualifiers: phone-recorded video, big single commits, missing AI attribution / spec files | Screen capture ≥720p 2–4 min; commit steadily; AI-use section in README; keep `plan.md` + `VALIDATION.md` in the repo |

## 16. Prize checklists

Pick 3 at submission; prepare all 5 so the choice stays open.

**Uniswap ($10k)**
- [ ] Public open-source repo
- [ ] `FEEDBACK.md`: include the CCA factory constructor docs mismatch (docs say no params; source takes `_protocolFeeController`), CCA CHANGELOG still marking v2.0.0 "latest", and `getAuctionAddress` → `getAddress` rename
- [ ] Form at https://developers.uniswap.org/hackathon-feedback linking FEEDBACK.md
- [ ] README line pointers: `ListingHook.sol` afterSwap, `AuctionValidationHook.sol` validate + `setAuction`, eligibility modules, launch script
- [ ] CCA + LBPStrategy + v4 hook on Sepolia, with tx links

**Chainlink CRE ($1.5k)**
- [ ] External API + Sepolia write
- [ ] CRE drives the reference, mode, halt and ENS status
- [ ] `simulate --broadcast` tx hashes
- [ ] README links the workflow and receiver
- [ ] README states the mock forwarder is permissionless and shows the hackathon guard; demo shows receiver success (`ReportProcessed.result` / `PolicyApplied`), not just a mined tx

**EF Anon-RPC ($5k) + CROPS ($3.5k) under one EF pick; placed in at most one**
- [ ] Reads via Anon-RPC by default (incl. ENS resolution; CCIP-Read off or routed)
- [ ] Nox worker (tor-js fallback), not passthrough
- [ ] README lists excluded traffic (wallet writes, gas, nonce via MetaMask RPC) and why
- [ ] (CROPS) OSS licence, README section titled "CROPS", no trackers, video shows "the moment it matters"
- [ ] Transport + traffic-share UI
- [ ] No silent fallback; honest privacy note

**ENS Best ENSv2 ($7k)**
- [ ] Built on ENSv2 Sepolia (UserRegistry subnames + Permissioned Resolver + EAC roles)
- [ ] Central: the app resolves IPO addresses only from ENS; no hard-coded values
- [ ] Scoped role demo (receiver writes only `listingday.status`)
- [ ] Non-transferable ticker demo (`TransferDisallowed`) and per-issuer Permissioned Resolver, both named on the prize page
- [ ] (Optional bonus) an AI-agent angle, e.g. an agent that watches `listingday.status`
- [ ] Live demo link on the showcase + open-source repo

**World ($5k Agent Pass and/or $2.5k IDKit; one pick)**
- [ ] Official integration (Agent Pass with Orb `acr`, or IDKit + Proof of Human with `signal` = wallet); only the one built is selected
- [ ] Full journey: request → completion → backend-validated → bid accepted
- [ ] Failure path: second wallet denied / expired voucher / cancelled
- [ ] No client secrets; no trust in unvalidated client responses
- [ ] Debrief: time to first success, friction, missing docs, top improvement
- [ ] (IDKit) Explain why Proof of Human is the minimum sufficient credential, and why country is a separate module (no GA World credential proves nationality)

**ETHGlobal**
- [ ] Up to 3 partners selected (multi-track partners count once)
- [ ] Demo video 2–4 min, ≥720p, not recorded on a phone, not sped up, real voice; live demo link; submitted before Sat 09:00 IST
- [ ] README: AI-tool attribution (which files and assets); spec files kept (`plan.md`, `VALIDATION.md`, prompts)
- [ ] Steady commit history (no single giant commit)
- [ ] Country module (if built): README "limitations" section (transfers, nationality ≠ residency, VPN, not KYC)

## 17. Validation notes

Round 1 was checked Fri Nov 6 ~10:20 IST at Sepolia block 12,074,309. Round 2 was checked ~11:20 IST at block 12,074,560. **Round 3** (primary-source validation, ~13:30–14:00 IST, block ~12,075,280) is summarised below; the full claim-by-claim table with sources is in [`VALIDATION.md`](VALIDATION.md). Items corrected in Round 3 are marked *(corrected)* inline.

**Round 1:**
1. All Uniswap/CRE/Anon-RPC Sepolia addresses have code; PositionManager, StateView and Quoter → PoolManager `0xE03A…3543`.
2. LBPStrategy v3.3.0 `initializerFactory()` = CCA factory v2.1.0; its PositionManager and PoolManager match.
3. CCA factory v2.1.0 `protocolFeeController()` = `address(0)`, so no fees. There is a docs mismatch on constructor params.
4. `IValidationHook.validate(uint256,uint128,address,address,bytes)` must revert to reject.
5. LBPStrategy hook rules: pool uninitialized; ERC165 `IInitializerHook`; `authorized()` = LBPStrategy; valid address for the fee; BEFORE_INITIALIZE. Other permissions are unrestricted. `PoolIdOccupied` applies on reuse.
6. The reference InitializerHook on Sepolia has `authorized()` = LBPStrategy.
7. The pool opens at the clearing price.
8. CRE: Sepolia selector `16015286601757825753` (`ethereum-testnet-sepolia`); mock forwarder + `--broadcast`; prod metadata is 64 bytes; replay guards. *(corrected)* Simulation **does** send 64-byte metadata with placeholder workflowId/owner. The mock forwarder is permissionless and swallows `onReport` reverts.
9. The CRE prize accepts simulation.
10. Anon-RPC: reads by default; passthrough isn't private; bootstrap read isn't private; the RPC sees queried addresses.
11. NSE listing-day band is 5% (≤ ₹250 Cr) / 20%, not 2/5/10%.
12. The NSE FAQ "20% over" is a typo for below.
13. StablePair is fee-based; our blocking directional mode is our extension.
14. Mark Toda: default inclusion + a denylist for failing hooks, not blanket exclusion.
15. *(corrected)* The deadline is confirmed on the official details page: Sat Nov 7 09:00 IST. Up to 3 partner prizes; several tracks from one partner count as one.
16. LiquidityLauncher v3.2.0 is current.
17. Circle Sepolia USDC is 6 dec; we use a mintable mock.

**Round 2 (new facts):**

18. **ENSv2 is live on Sepolia.**
    - The ENS deployments page lists a full Sepolia (ENSv2) set, and the Sepolia ENS apps resolve through it.
    - The Sepolia ENSv1 contracts are "no longer in use".
    - Code confirmed on: RootRegistry `0xb458…c43f`, ETHRegistry `0xd4eb…a8b4`, ETHRegistrar `0xf633…a3d3`, UniversalResolverV2 `0x24e1…2d72`, VerifiableFactory `0xda70…2991`, UserRegistryImpl `0x9bd8…366a`, PermissionedResolverImpl `0x115e…2b2c`.
19. **Mainnet ENSv2 status is mixed.** The prize page says ENSv2 "is now live on Ethereum mainnet". The deployments page says mainnet v2 contracts are deployed "ahead of launch" and that mainnet resolution still runs through v1 until launch completes. Sepolia is explicitly allowed for Best ENSv2, so this doesn't matter for us. The "existing project" ENS prize is Continuity-only and mainnet-only, so it is not ours.
20. **ENS prize requirements:** ENSv2 central, not cosmetic; functional, not hard-coded; **live demo link** on the showcase; open source.
21. **ENS scoped setter roles apply across every record bundle in a resolver,** not just one name. Use one resolver per issuer. Subname ownership (UserRegistry token) and resolver write permission are separate.
22. **World tracks on the Mumbai page (Classic):**
    - World ID Agent Pass is **$5,000** (2.5/1.5/1k).
    - Best Use of IDKit is **$2,500 total, up to 2 teams × $1,250** (not $2,500 per team).
    - The $2,500 Agent Pass and "[Cont] IDKit" tracks are Continuity-only.
23. **Agent Pass is OIDC-based** (World IdP, pairwise `sub` per sector, fresh authentication). It is not IDKit. Agent Pass proofs use mocked identities for the hackathon.
24. **World requirements (both tracks):** backend validation, no client secrets, a demonstrated failed/denied/expired/cancelled path, and an integration debrief. IDKit also asks you to justify the minimum sufficient credential.
25. **World ID 4.0 onchain `WorldIDVerifier`** is deployed on World Chain (prod + staging). *(corrected)* Arc has `WorldIDSatellite` (prod only). **Ethereum Sepolia has only the legacy v3 `WorldIDRouter` `0x469449f2…2157`** (code present; Orb-only, legacy proofs). The design therefore uses backend validation (`POST /api/v4/verify/{rp_id}` or Agent Pass OIDC) plus an EIP-712 voucher checked onchain.
26. **IDKit 4.x needs a backend RP signature** (`signRequest` with the secret signing key). Use the simulator with `environment: "staging"` for the demo. The nullifier must be stored and checked for uniqueness.
27. **`IValidationHook.validate` is non-view,** so per-applicant cumulative caps can be stored. CCA `submitBid` carries `owner` and `hookData`, which is the voucher channel.
28. **CCA unsold tokens go to `tokensRecipient`.** Exits use `exitBid` / `exitPartiallyFilledBid`, and claims happen after `claimBlock`. *(corrected)* LBPStrategy **forbids** being `tokensRecipient` and **requires** being `fundsRecipient`. The issuer sweeps unsold tokens with `sweepUnsoldTokens()`.
29. **Lightweight Charts** (v5.2.1) is Apache-2.0 and requires the NOTICE attribution plus a link to tradingview.com. `attributionLogo` satisfies the link only; the NOTICE text must still be shown. Advanced Charts needs license approval, so it is out.
30. **Reverted transactions emit no logs.** Chart markers for reverted swaps can only come from receipts the app or scripts observed.

**Round 3 (new facts):**

31. **The validation hook ↔ auction address is circular.** The CCA factory CREATE2 init code includes `AuctionParameters.validationHook`. Use a one-time `setAuction`. The factory view is `getAddress(token, amount, configData, salt, sender)`.
32. **The CCA wraps hook reverts** as `ValidationHookCallFailed(bytes)`. Uniswap ships `GatedERC1155ValidationHook` (`sender == owner` + soulbound pass) as a reference.
33. **`InitializerHook._beforeInitialize` is `view`.** ListingHook writes its bands in `afterInitialize`.
34. **v4 Quoter and Universal Router implement `IMsgSender.msgSender()`** on Sepolia, so swap-side identity gating is possible.
35. **Anon-RPC:** only Nox's specifier is on Sepolia. tor-js (`0x700d…659e`) and Nym specifiers are on mainnet; no code at the tor-js address on Sepolia. Install `@anon-rpc/browser-harness`.
36. **ENSv2 Sepolia:** registration is paid in ERC-20 (MockUSDC/MockDAI), minimum 28 days, commit 60 s–24 h. Setters take DNS-encoded names. `grantSetterRoles(bytes setter, address)` needs `ROLE_SET_TEXT_ADMIN`. Token ids regenerate on role changes. Live ABIs are at tag `v2-mainnet-deployment-1`.
37. **World:** Agent Pass needs Orb `acr` + `max_age=0` for one-human; don't offer Agent Pass and IDKit on the same auction. Identity Check (Preview) is the only World credential that matches nationality.
38. **Country attestation:** zkPassport `ZKPassportVerifier` `0x1D00…c0D8` is live on Ethereum Sepolia; dev-mode mocks are rooted there and all share unique id `1`. Self onchain is Celo-only and its open SDK is deprecated. Coinbase Verified Country is Base-only. Anon Aadhaar test verifier `0x6bE8…E281` is on Sepolia. EAS `0xC267…815e` is on Sepolia.
39. **ETHGlobal rules:** no phone-recorded video; 2–4 min ≥720p; AI attribution and spec files required; large single commits risk disqualification.
40. **EF CROPS track** ($3.5k) can be selected with Anon-RPC under one EF pick (placed in at most one).

## 18. Reference: addresses and interfaces

**Uniswap / CRE / Anon-RPC (Sepolia)**

| Contract | Address |
|---|---|
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` |
| Universal Router | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` (2.1.2: `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`) |
| StateView | `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` |
| Quoter | `0x68aFa8b853cAa7a2D40B0F6AEE5C4DbC147C8244` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` |
| LiquidityLauncher v3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` |
| LBPStrategy v3.3.0 | `0x95434E898Af471945Cab33D5064d2aC1A6Ba2000` |
| InitializerHook v3.3.0 (ref) | `0x1600059B95A80d500fC42400ea9a88A9C29D2000` |
| CRE MockKeystoneForwarder | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| CRE KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |
| Anon-RPC Nox specifier (Sepolia) | `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` |
| Anon-RPC tor-js specifier (**mainnet**, fallback only) | `0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e` |
| UERC20Factory v2.0.0 (used by `createToken`) | `0x000000e200088D55C39a11F609E5F667729ad49b` |

Reference CCA validation hooks (source only, not deployed by us): `GatedERC1155ValidationHook`, `BaseERC1155ValidationHook` in `continuous-clearing-auction/src/periphery/validationHooks/`.

**ENSv2 (Sepolia)**

| Contract | Address |
|---|---|
| RootRegistry | `0xb458d6a3a77919449d03e7a6903c26827c1ec43f` |
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| UniversalResolverV2 | `0x24e1d8e068620b647ca097f961a61055f4f42d72` (proxy `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`) |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| MockUSDC (registration payment, 6 dec, public `mint`) | `0x240b0316df57887dbbe58b586508b19e633a14aa` |
| MockDAI (alt payment) | `0xf6fac8a58a0be13b9197f27c41b73162fe32572b` |

ABIs: `ensdomains/contracts-v2` tag `v2-mainnet-deployment-1`, `contracts/deployments/sepolia/*.json`.

**World ID (Ethereum Sepolia):** legacy v3 `WorldIDRouter` `0x469449f251692e0779667583026b5a1e99512157`. This is a stretch only; the plan uses backend verify.

**Country attestation (Ethereum Sepolia)**

| Contract | Address |
|---|---|
| zkPassport `ZKPassportVerifier` (same address on mainnet, Sepolia, Base) | `0x1D000001000EFD9a6371f4d90bB8920D5431c0D8` |
| Anon Aadhaar v2 (test key; next module) | `0x6bE8Cec7a06BA19c39ef328e8c8940cEfeF7E281` |
| Anon Aadhaar v2 (production key) | `0xd59C20F74056080e5ac4B0f55bBd77ff75E7a16e` |
| EAS (fallback attestation record) | `0xC2679fBD37d54388Ce493F1DB75320D236e1815e` |
| EAS SchemaRegistry | `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` |

**Sources**
- Uniswap: https://docs.uniswap.org/contracts/v4/deployments · https://docs.uniswap.org/contracts/liquidity-launchpad/deployments · https://github.com/Uniswap/liquidity-launcher · https://github.com/Uniswap/continuous-clearing-auction
- CRE: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts · https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts · https://github.com/smartcontractkit/chainlink-evm/blob/main/contracts/cre/src/dev/MockKeystoneForwarder.sol
- Anon-RPC: https://ethereum.github.io/anon-rpc/wallets/
- ENS: https://docs.ens.domains/learn/deployments · https://docs.ens.domains/ensv2/subnames · https://docs.ens.domains/ensv2/enhanced-access-control/ · https://docs.ens.domains/ensv2/tutorial-contract-developers/
- World: https://docs.world.org/world-id/idkit/integrate · https://docs.world.org/world-id/idkit/onchain-verification · https://auth.world.org/docs
- Prizes and rules: https://ethglobal.com/events/mumbai/prizes · https://ethglobal.com/events/mumbai/prizes/ens · https://ethglobal.com/events/mumbai/prizes/world · https://ethglobal.com/events/mumbai/info/details
- Country attestation: https://docs.zkpassport.id/getting-started/onchain · https://docs.zkpassport.id/getting-started/dev-mode · https://docs.self.xyz/docs/self-enterprise/flows/verification-modes/ · https://github.com/coinbase/verifications · https://documentation.anon-aadhaar.pse.dev/docs/proof · https://docs.world.org/world-id/idkit/credentials
- Regulatory framing: https://www.sebi.gov.in/sebi_data/attachdocs/jun-2021/1623665266705.pdf (¶24) · https://ifsca.gov.in/Document/Legal/ifsca-circular-regulatory-sandbox_new19102020084227.pdf (¶16)
- Charts: https://github.com/tradingview/lightweight-charts
- NSE: https://www.nseindia.com/static/products-services/equity-market-special-pre-open-session
