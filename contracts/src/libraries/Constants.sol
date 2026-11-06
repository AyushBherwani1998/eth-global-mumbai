// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Sepolia
/// @notice Ethereum Sepolia (11155111) addresses used by Listing Day (plan.md §17).
/// @dev Each address was checked onchain at Sepolia block ~12,075,570 (code present, cross-links below).
///      The fork test `SepoliaAddresses.fork.t.sol` re-checks them against a live fork.
library Sepolia {
    uint256 internal constant CHAIN_ID = 11_155_111;

    // Quote currency: Circle Sepolia USDC (FiatTokenProxy, 6 decimals, symbol "USDC", EIP-712 name "USDC" v"2").
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    // FiatTokenV2_2 implementation behind the USDC proxy.
    address internal constant USDC_IMPLEMENTATION = 0xDa317C1d3E835dD5F1BE459006471aCAA1289068;
    // CCA pulls ERC-20 bids through Permit2 AllowanceTransfer.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Uniswap v4. PositionManager, StateView and Quoter all report poolManager() == POOL_MANAGER.
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    address internal constant UNIVERSAL_ROUTER_2_1_2 = 0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3;
    address internal constant STATE_VIEW = 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C;
    address internal constant QUOTER = 0x68aFa8b853cAa7a2D40B0F6AEE5C4DbC147C8244;

    // Uniswap Liquidity Launchpad.
    // CCA factory v2.1.0: protocolFeeController() == address(0).
    address internal constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8;
    // LiquidityLauncher v3.2.0.
    address internal constant LIQUIDITY_LAUNCHER = 0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0;
    // LBPStrategy v3.3.0 (singleton): initializerFactory() == CCA_FACTORY,
    // positionManager() == POSITION_MANAGER, poolManager() == POOL_MANAGER.
    address internal constant LBP_STRATEGY = 0x95434E898Af471945Cab33D5064d2aC1A6Ba2000;
    // Reference InitializerHook v3.3.0: authorized() == LBP_STRATEGY. Not used by us; ListingHook mines its own.
    address internal constant INITIALIZER_HOOK_REFERENCE = 0x1600059B95A80d500fC42400ea9a88A9C29D2000;
    // UERC20Factory v2.0.0 (backs LiquidityLauncher.createToken).
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    // Chainlink CRE forwarders and the CRE chain selector for ethereum-testnet-sepolia.
    address internal constant CRE_MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address internal constant CRE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;
    uint64 internal constant CRE_CHAIN_SELECTOR = 16_015_286_601_757_825_753;
}

/// @title SepoliaEns
/// @notice ENSv2 on Sepolia (plan.md §7, §17), from `ensdomains/contracts-v2` tag `v2-mainnet-deployment-1`
///         (commit 62778d8, `contracts/deployments/sepolia/addresses.md`).
/// @dev Checked onchain at Sepolia block ~12,076,285: code at every address, `RootRegistry.getSubregistry("eth")
///      == ETH_REGISTRY`, `ETH_REGISTRAR.ETH_REGISTRY() == ETH_REGISTRY` (and the registrar holds `ROLE_REGISTRAR`
///      there), both impls' `LABEL_STORE() == LABEL_STORE`, `UNIVERSAL_RESOLVER.implementation() ==
///      MANAGED_UNIVERSAL_RESOLVER_PROXY`, whose `implementation() == UNIVERSAL_RESOLVER_V2`, whose
///      `ROOT_REGISTRY() == ROOT_REGISTRY`. `SepoliaAddresses.fork.t.sol` re-checks all of it.
library SepoliaEns {
    address internal constant ROOT_REGISTRY = 0xB458D6a3a77919449d03e7A6903C26827c1eC43f;
    // The .eth PermissionedRegistry: owns `listingday`.
    address internal constant ETH_REGISTRY = 0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4;
    // Commit-reveal .eth registrar: MIN_COMMITMENT_AGE 60 s, MAX_COMMITMENT_AGE 1 day, MIN_REGISTER_DURATION 28 days.
    address internal constant ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address internal constant RENT_PRICE_ORACLE = 0x8196665D4ca7488B6474a9EC8E7d2719FB42263A;
    address internal constant LABEL_STORE = 0xed8246FF02203a4d4cb262bD78bEAA7408A57cAE;
    // `deployProxy(impl, salt, initData)`; proxy address depends on (msg.sender, salt) only.
    address internal constant VERIFIABLE_FACTORY = 0xDa70306C98E97eCe36F997a21368e53298572991;
    address internal constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;
    // What viem's `sepolia` chain uses as `ensUniversalResolver`. Two static-call hops: this proxy ->
    // MANAGED_UNIVERSAL_RESOLVER_PROXY -> UNIVERSAL_RESOLVER_V2.
    address internal constant UNIVERSAL_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;
    address internal constant MANAGED_UNIVERSAL_RESOLVER_PROXY = 0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1;
    address internal constant UNIVERSAL_RESOLVER_V2 = 0x24E1D8e068620B647CA097f961A61055f4f42D72;
    // ENS test payment token for .eth registration (6 decimals, public `mint`). NOT Circle USDC (`Sepolia.USDC`).
    address internal constant ENS_MOCK_USDC = 0x240b0316Df57887DBBE58b586508b19e633a14aa;
    address internal constant ENS_MOCK_DAI = 0xF6faC8A58a0BE13b9197f27C41B73162Fe32572b;
}

/// @title ListingDay
/// @notice Demo IPO parameters (plan.md §4). Prices live in `ListingPrice`.
library ListingDay {
    /// @notice MockSME fixed supply: 110,000 shares (18 decimals).
    uint256 internal constant TOTAL_SUPPLY = 110_000e18;
    /// @notice Shares sold in the CCA.
    uint128 internal constant AUCTION_SUPPLY = 90_000e18;
    /// @notice Shares reserved for the v4 LP (MigratorParameters.reservedTokenAmountForLP).
    uint128 internal constant LP_RESERVE = 20_000e18;
    /// @notice Per-applicant cumulative budget cap: 20 USDC (one Circle faucet request).
    uint128 internal constant APPLICANT_CAP = 20e6;
    /// @notice CCA requiredCurrencyRaised: 50% of the 90 USDC target raise.
    uint128 internal constant REQUIRED_CURRENCY_RAISED = 45e6;
}
