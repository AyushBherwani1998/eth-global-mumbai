// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {ListingHook} from "../../src/ListingHook.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IListingHook, ListingHookConfig} from "../../src/interfaces/IListingHook.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {MockListingPolicy} from "../../src/mocks/MockListingPolicy.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {CreReports} from "../utils/CreReports.sol";
import {HookFixture} from "../utils/HookFixture.sol";
import {PoolActions} from "../utils/PoolActions.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAuctionStorage} from "continuous-clearing-auction/src/interfaces/IAuctionStorage.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {Vm} from "forge-std/Vm.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {ILBPStrategy} from "liquidity-launcher/src/interfaces/ILBPStrategy.sol";
import {ILiquidityLauncher} from "liquidity-launcher/src/interfaces/ILiquidityLauncher.sol";
import {IMulticall} from "liquidity-launcher/src/interfaces/IMulticall.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "liquidity-launcher/src/libraries/MigratorParams.sol";
import {TokenPricing} from "liquidity-launcher/src/libraries/TokenPricing.sol";
import {InitializerHook} from "liquidity-launcher/src/periphery/hooks/InitializerHook.sol";
import {Distribution} from "liquidity-launcher/src/types/Distribution.sol";
import {PositionDefinition} from "liquidity-launcher/src/types/PositionPlannerTypes.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

/// @notice LBPStrategy's public pool-id reservation map (not part of ILBPStrategy).
interface IRegisteredPoolIds {
    function registeredPoolIds(PoolId poolId) external view returns (address initializer);
}

/// @notice The PositionManager calls used to exit the migrated LP position.
interface IPositionManagerExit {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Gate 0 lifecycle on a Sepolia fork, entirely through the deployed Uniswap contracts:
///         MockSME -> LiquidityLauncher multicall (depositToken + distributeToken) -> LBPStrategy v3.3.0 -> CCA
///         (factory v2.1.0) -> `setAuction` -> real Sepolia USDC bids via Permit2 -> clearing -> exits / claims
///         / sweeps -> `migrate()` into a v4 pool behind a mined ListingHook -> swaps through the hook -> CRE
///         reports through the live mock forwarder halting and reopening the pool.
contract ListingLifecycleForkTest is SepoliaForkTest, HookFixture, PoolActions, CreReports {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    uint64 internal constant AUCTION_BLOCKS = 100;
    uint32 internal constant LISTING_DAY = 1 days;
    /// @dev 20% of the raise goes to the LP (MigratorParameters.lpAllocationSchedule, in mps).
    uint24 internal constant LP_RATE_MPS = 2e6;
    bytes32 internal constant LAUNCH_SALT = keccak256("listing-day-lifecycle");
    uint160 internal constant LISTING_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    );

    address internal issuer = makeAddr("issuer");
    address internal treasury = makeAddr("issuerTreasury");
    address internal trader = makeAddr("trader");
    address internal attacker = makeAddr("attacker");
    address[5] internal bidders =
        [makeAddr("bidder1"), makeAddr("bidder2"), makeAddr("bidder3"), makeAddr("bidder4"), makeAddr("bidder5")];

    IPoolManager internal manager = IPoolManager(Sepolia.POOL_MANAGER);
    ILBPStrategy internal strategy = ILBPStrategy(Sepolia.LBP_STRATEGY);
    IERC20 internal usdc = IERC20(Sepolia.USDC);

    MockSME internal token;
    AuctionValidationHook internal validationHook;
    AllowAllModule internal module;
    MockListingPolicy internal policy;
    ListingHook internal listingHook;
    IContinuousClearingAuction internal cca;
    PoolSwapTest internal swapRouter;
    PoolKey internal key;

    uint64 internal startBlock;
    uint64 internal endBlock;
    uint64 internal migrationBlock;

    function setUpFork() internal override {
        token = _deployMockSMEAboveUsdc();
        (validationHook, module) = _deployHookAndModule(issuer, address(token), Sepolia.USDC, ListingDay.APPLICANT_CAP);
        policy = new MockListingPolicy(issuer);
        listingHook = _mineAndDeployListingHook();
        key = listingHook.poolKey();

        _launch();
        vm.prank(issuer);
        validationHook.setAuction(address(cca));

        swapRouter = new PoolSwapTest(manager);
    }

    // ---------------------------------------------------------------- setup steps

    /// @dev CREATE2 salt search so MockSME sorts above USDC: USDC is then currency0 (plan.md "Quote currency").
    function _deployMockSMEAboveUsdc() internal returns (MockSME sme) {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(MockSME).creationCode, abi.encode("Acme SME", "ACME", issuer)));
        uint256 salt;
        while (vm.computeCreate2Address(bytes32(salt), initCodeHash, address(this)) < Sepolia.USDC) salt++;
        sme = new MockSME{salt: bytes32(salt)}("Acme SME", "ACME", issuer);
        assertGt(uint160(address(sme)), uint160(Sepolia.USDC), "MockSME must sort above USDC");
    }

    function _mineAndDeployListingHook() internal returns (ListingHook hook) {
        ListingHookConfig memory c = ListingHookConfig({
            owner: issuer,
            usdc: Sepolia.USDC,
            token: address(token),
            fee: POOL_FEE,
            tickSpacing: POOL_TICK_SPACING,
            listingDayBandBps: 500,
            listingDayDuration: LISTING_DAY,
            policySource: policy
        });
        (address mined, bytes32 salt) = HookMiner.find(
            address(this),
            LISTING_HOOK_FLAGS,
            type(ListingHook).creationCode,
            abi.encode(manager, Sepolia.LBP_STRATEGY, c)
        );
        hook = new ListingHook{salt: salt}(manager, Sepolia.LBP_STRATEGY, c);
        assertEq(address(hook), mined, "mined hook address");
    }

    /// @dev Issuer: Permit2 approval, then LiquidityLauncher.multicall(depositToken, distributeToken). LBPStrategy
    ///      creates the CCA through the factory, takes the LP reserve and reserves the v4 pool id for our hook.
    function _launch() internal {
        startBlock = uint64(block.number + 10);
        endBlock = startBlock + AUCTION_BLOCKS;
        migrationBlock = endBlock + 1;

        AuctionParameters memory auctionParams = AuctionParameters({
            currency: Sepolia.USDC,
            tokensRecipient: treasury,
            fundsRecipient: Sepolia.LBP_STRATEGY,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: endBlock,
            tickSpacing: ListingPrice.TICK_SPACING_Q96,
            validationHook: address(validationHook),
            floorPrice: ListingPrice.FLOOR_PRICE_Q96,
            requiredCurrencyRaised: ListingDay.REQUIRED_CURRENCY_RAISED,
            auctionStepsData: abi.encodePacked(uint24(1e7 / AUCTION_BLOCKS), uint40(AUCTION_BLOCKS))
        });
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({lowerThreshold: 0, rate: LP_RATE_MPS});
        MigratorParameters memory migrationParams = MigratorParameters({
            token: address(token),
            currency: Sepolia.USDC,
            migrationBlock: migrationBlock,
            reservedTokenAmountForLP: ListingDay.LP_RESERVE,
            recipient: treasury,
            positionRecipient: treasury,
            poolParameters: PoolParameters({fee: POOL_FEE, tickSpacing: POOL_TICK_SPACING, hook: address(listingHook)}),
            positionDefinitions: abi.encode(new PositionDefinition[](0)),
            lpAllocationSchedule: abi.encode(brackets)
        });
        Distribution memory distribution = Distribution({
            strategy: Sepolia.LBP_STRATEGY,
            amount: uint128(ListingDay.TOTAL_SUPPLY),
            configData: abi.encode(migrationParams, abi.encode(auctionParams))
        });
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ILiquidityLauncher.depositToken, (address(token), uint160(ListingDay.TOTAL_SUPPLY)));
        calls[1] = abi.encodeCall(ILiquidityLauncher.distributeToken, (address(token), distribution, LAUNCH_SALT));

        vm.startPrank(issuer);
        token.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(
                address(token),
                Sepolia.LIQUIDITY_LAUNCHER,
                uint160(ListingDay.TOTAL_SUPPLY),
                uint48(block.timestamp + 1 hours)
            );
        vm.recordLogs();
        IMulticall(Sepolia.LIQUIDITY_LAUNCHER).multicall(calls);
        vm.stopPrank();

        cca = IContinuousClearingAuction(_initializerFromLogs());
        assertEq(cca.token(), address(token));
        assertEq(cca.currency(), Sepolia.USDC);
        assertEq(cca.totalSupply(), ListingDay.AUCTION_SUPPLY, "auction gets 90,000");
        assertEq(cca.fundsRecipient(), Sepolia.LBP_STRATEGY);
        assertEq(cca.tokensRecipient(), treasury);
        assertEq(token.balanceOf(address(cca)), ListingDay.AUCTION_SUPPLY);
        assertEq(token.balanceOf(issuer), 0, "issuer deposited the whole supply");
        assertEq(
            IRegisteredPoolIds(Sepolia.LBP_STRATEGY).registeredPoolIds(key.toId()),
            address(cca),
            "pool id reserved for this auction"
        );
    }

    function _initializerFromLogs() internal view returns (address) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (
                logs[i].emitter == Sepolia.LBP_STRATEGY && logs[i].topics[0] == ILBPStrategy.InitializerCreated.selector
            ) {
                return address(uint160(uint256(logs[i].topics[1])));
            }
        }
        revert("InitializerCreated not emitted");
    }

    // ---------------------------------------------------------------- auction helpers

    /// @dev The first-bid flow from plan.md: USDC.approve(Permit2), Permit2.approve(USDC, auction), submitBid.
    function _bid(address who, uint128 amount) internal returns (uint256 bidId) {
        deal(Sepolia.USDC, who, amount);
        vm.startPrank(who);
        usdc.approve(Sepolia.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Sepolia.PERMIT2)
            .approve(Sepolia.USDC, address(cca), amount, uint48(block.timestamp + 1 days));
        bidId = cca.submitBid(ListingPrice.CAP_PRICE_Q96, amount, who, ListingPrice.FLOOR_PRICE_Q96, "");
        vm.stopPrank();
        assertEq(usdc.balanceOf(who), 0, "bid pulled USDC via Permit2");
    }

    /// @dev All bids land in the first auction block at the 190-point cap, then the auction runs to its end block.
    function _runAuction(uint128[] memory amounts) internal returns (uint256[] memory bidIds) {
        vm.roll(startBlock);
        bidIds = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; i++) {
            bidIds[i] = _bid(bidders[i], amounts[i]);
        }
        vm.roll(endBlock);
        cca.checkpoint();
    }

    function _amounts99() internal pure returns (uint128[] memory a) {
        a = new uint128[](5);
        (a[0], a[1], a[2], a[3], a[4]) = (20e6, 20e6, 20e6, 20e6, 19e6);
    }

    function _amounts(uint128 a0, uint128 a1, uint128 a2) internal pure returns (uint128[] memory a) {
        a = new uint128[](3);
        (a[0], a[1], a[2]) = (a0, a1, a2);
    }

    function _exitAndClaimAll(uint256[] memory bidIds) internal returns (uint256 claimed) {
        for (uint256 i; i < bidIds.length; i++) {
            cca.exitBid(bidIds[i]);
            uint256 before = token.balanceOf(bidders[i]);
            cca.claimTokens(bidIds[i]);
            claimed += token.balanceOf(bidders[i]) - before;
        }
    }

    function _graduateAt110AndMigrate() internal returns (uint256[] memory bidIds) {
        bidIds = _runAuction(_amounts99());
        vm.roll(migrationBlock);
        strategy.migrate(ILBPInitializer(address(cca)));
        assertTrue(listingHook.listed(), "migration initialized the pool through the hook");
    }

    // ---------------------------------------------------------------- tests

    function test_fork_launch_lbpStrategyAcceptsListingHook() public view {
        assertEq(listingHook.authorized(), Sepolia.LBP_STRATEGY);
        assertEq(uint160(address(listingHook)) & Hooks.ALL_HOOK_MASK, LISTING_HOOK_FLAGS);
        assertEq(Currency.unwrap(key.currency0), Sepolia.USDC, "USDC is currency0");
        assertEq(address(key.hooks), address(listingHook));
        assertEq(validationHook.auction(), address(cca));
        assertEq(address(cca.validationHook()), address(validationHook));
        assertEq(token.balanceOf(Sepolia.LBP_STRATEGY), ListingDay.LP_RESERVE, "strategy holds the LP reserve");
        assertEq(uint8(listingHook.phase()), uint8(IListingHook.Phase.NotListed));
    }

    function test_fork_onlyLbpStrategyCanInitializeThePool() public {
        uint160 price = ListingPrice.pointsToSqrtPriceX96(110, true);
        vm.prank(attacker);
        vm.expectRevert(
            _hookRevert(
                address(listingHook),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(InitializerHook.InvalidInitializer.selector, attacker, Sepolia.LBP_STRATEGY)
            )
        );
        manager.initialize(key, price);

        vm.prank(issuer);
        vm.expectRevert();
        manager.initialize(key, price);
        assertFalse(listingHook.listed());
    }

    /// @dev 45 USDC of demand clears at the floor (80 points); currencyRaised == requiredCurrencyRaised graduates.
    ///      56,250 shares sell, the other 33,750 sweep to the issuer treasury.
    function test_fork_graduatesAt45UsdcRaised_unsoldSweptToTreasury() public {
        uint256[] memory bidIds = _runAuction(_amounts(20e6, 20e6, 5e6));

        assertTrue(cca.isGraduated(), "graduated");
        assertEq(IAuctionStorage(address(cca)).currencyRaised(), 45e6);
        assertEq(cca.clearingPrice(), ListingPrice.FLOOR_PRICE_Q96, "clears at the floor");

        uint256 sold = IAuctionStorage(address(cca)).totalCleared();
        assertApproxEqRel(sold, 56_250e18, 1e9, "45 USDC / 0.0008");

        uint256 unsold = IAuctionStorage(address(cca)).remainingSupply();
        assertApproxEqAbs(unsold, ListingDay.AUCTION_SUPPLY - sold, 1, "CCA rounding");
        vm.prank(treasury);
        cca.sweepUnsoldTokens();
        assertEq(token.balanceOf(treasury), unsold, "unsold to treasury");
        assertApproxEqRel(token.balanceOf(treasury), 33_750e18, 1e9);

        uint256 claimed = _exitAndClaimAll(bidIds);
        assertApproxEqAbs(claimed, sold, 10, "bidders claim what sold");
        assertApproxEqRel(token.balanceOf(bidders[0]), 25_000e18, 1e9, "20 USDC at 0.80 per lot");
        for (uint256 i; i < 3; i++) {
            assertEq(usdc.balanceOf(bidders[i]), 0, "fully spent at the floor");
        }
    }

    /// @dev 1 raw unit short of 45 USDC: no graduation, every bid gets its full budget back through exitBid, no
    ///      tokens are claimable, the whole auction supply sweeps to the treasury and migration recovers the LP
    ///      reserve to the treasury instead of opening a pool.
    function test_fork_below45_everyBidRefundedViaExitBid() public {
        uint128[] memory amounts = _amounts(20e6, 20e6, 5e6 - 1);
        uint256[] memory bidIds = _runAuction(amounts);
        assertFalse(cca.isGraduated());

        for (uint256 i; i < bidIds.length; i++) {
            cca.exitBid(bidIds[i]);
            assertEq(usdc.balanceOf(bidders[i]), amounts[i], "full refund");
            vm.expectRevert(IAuctionStorage.NotGraduated.selector);
            cca.claimTokens(bidIds[i]);
        }
        assertEq(usdc.balanceOf(address(cca)), 0, "nothing left in the auction");

        vm.prank(treasury);
        cca.sweepUnsoldTokens();
        assertEq(token.balanceOf(treasury), ListingDay.AUCTION_SUPPLY, "whole auction supply to treasury");

        vm.roll(migrationBlock);
        vm.expectEmit(Sepolia.LBP_STRATEGY);
        emit ILBPStrategy.FundsRecovered(ILBPInitializer(address(cca)), treasury, ListingDay.LP_RESERVE);
        strategy.migrate(ILBPInitializer(address(cca)));
        assertEq(token.balanceOf(treasury), ListingDay.TOTAL_SUPPLY, "LP reserve recovered too");
        assertFalse(listingHook.listed(), "no pool");
    }

    function test_fork_migrateBeforeAuctionEndReverts() public {
        _runAuctionUntil(endBlock - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ILBPStrategy.MigrationNotYetAllowed.selector, migrationBlock, endBlock - 1)
        );
        strategy.migrate(ILBPInitializer(address(cca)));

        vm.roll(endBlock);
        vm.expectRevert(abi.encodeWithSelector(ILBPStrategy.MigrationNotYetAllowed.selector, migrationBlock, endBlock));
        strategy.migrate(ILBPInitializer(address(cca)));
    }

    function _runAuctionUntil(uint64 blockNumber) internal {
        vm.roll(startBlock);
        uint128[] memory a = _amounts99();
        for (uint256 i; i < a.length; i++) {
            _bid(bidders[i], a[i]);
        }
        vm.roll(blockNumber);
    }

    /// @dev 99 USDC of demand over 90,000 shares clears at ~110 points; migrate() opens the pool there and the
    ///      ListingHook stores the listing price and the 104.5-115.5 band.
    function test_fork_poolOpensAt110PointsAfterMigrate() public {
        uint256[] memory bidIds = _runAuction(_amounts99());
        uint256 clearing = cca.clearingPrice();
        assertTrue(cca.isGraduated());
        assertEq(ListingPrice.q96ToPoints(clearing), 110, "clears at 110 points");
        assertLt(clearing - ListingPrice.pointsToQ96(110), 1000, "just above the 110 tick (between ticks)");

        uint256 raised = IAuctionStorage(address(cca)).currencyRaised();
        assertApproxEqAbs(raised, 99e6, 1);

        vm.roll(migrationBlock);
        strategy.migrate(ILBPInitializer(address(cca)));

        uint160 expected = TokenPricing.convertToSqrtPriceX96(TokenPricing.convertToPriceX192(clearing, true));
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());
        assertEq(sqrtPriceX96, expected, "pool opens at the clearing price");
        assertGt(manager.getLiquidity(key.toId()), 0, "LP minted");

        assertTrue(listingHook.listed());
        assertTrue(listingHook.usdcIsCurrency0());
        assertEq(listingHook.listingSqrtPriceX96(), sqrtPriceX96);
        assertEq(uint8(listingHook.phase()), uint8(IListingHook.Phase.ListingDay));
        assertApproxEqAbs(listingHook.currentPointsE2(), 11_000, 1, "1.10 USDC per lot");
        (uint256 lowE2, uint256 highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 10_450, 1);
        assertApproxEqAbs(highE2, 11_550, 1);

        // 80% of the raise beyond the LP bracket plus position dust goes to the treasury, as do unused LP shares.
        assertApproxEqRel(usdc.balanceOf(treasury), (raised * 8) / 10, 0.001e18, "non-LP USDC to treasury");
        assertGt(token.balanceOf(treasury), 0, "unused LP reserve to treasury");
        assertEq(token.balanceOf(Sepolia.LBP_STRATEGY), 0, "strategy keeps nothing");

        uint256 claimed = _exitAndClaimAll(bidIds);
        assertApproxEqRel(claimed, ListingDay.AUCTION_SUPPLY, 1e9, "all 90,000 shares sold and claimed");
    }

    /// @dev End to end through the real PoolManager: an in-band buy to 114 passes, a buy to 117 reverts
    ///      OutOfBand, a halt from the policy source blocks swaps.
    function test_fork_postMigrationSwap_inBandPasses_outOfBandReverts() public {
        _graduateAt110AndMigrate();

        deal(Sepolia.USDC, trader, 100e6);
        vm.prank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);

        uint160 at114 = ListingPrice.pointsToSqrtPriceX96(114, true);
        _swapTo(swapRouter, manager, key, trader, at114);
        assertEq(_sqrtPrice(manager, key), at114);
        assertGt(token.balanceOf(trader), 0, "trader bought shares");
        assertApproxEqAbs(listingHook.currentPointsE2(), 11_400, 1);

        uint160 at117 = ListingPrice.pointsToSqrtPriceX96(117, true);
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        _swapTo(swapRouter, manager, key, trader, at117, _outOfBand(address(listingHook), at117, lo, hi));
        assertEq(_sqrtPrice(manager, key), at114, "rejected swap left the price at 114");

        vm.prank(issuer);
        policy.setHalted(true);
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            ListingPrice.pointsToSqrtPriceX96(112, true),
            _hookRevert(
                address(listingHook), IHooks.beforeSwap.selector, abi.encodeWithSelector(IListingHook.Halted.selector)
            )
        );
    }

    /// @dev plan.md demo step 9: while halted every swap reverts, but the treasury can still pull liquidity out of
    ///      the LP NFT that migrate() minted, through the real PositionManager.
    function test_fork_halted_swapsRevert_lpStillExitsThroughPositionManager() public {
        _graduateAt110AndMigrate();
        IPositionManagerExit posm = IPositionManagerExit(Sepolia.POSITION_MANAGER);
        uint256 tokenId = posm.nextTokenId() - 1;
        assertEq(posm.ownerOf(tokenId), treasury, "LP NFT minted to positionRecipient");
        uint128 liquidity = posm.getPositionLiquidity(tokenId);
        assertGt(liquidity, 0);

        vm.prank(issuer);
        policy.setHalted(true);
        deal(Sepolia.USDC, trader, 10e6);
        vm.prank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            ListingPrice.pointsToSqrtPriceX96(112, true),
            _hookRevert(
                address(listingHook), IHooks.beforeSwap.selector, abi.encodeWithSelector(IListingHook.Halted.selector)
            )
        );

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(liquidity / 2), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, treasury);
        uint256 usdcBefore = usdc.balanceOf(treasury);
        uint256 sharesBefore = token.balanceOf(treasury);
        vm.prank(treasury);
        posm.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        assertEq(posm.getPositionLiquidity(tokenId), liquidity - liquidity / 2, "liquidity removed while halted");
        assertGt(usdc.balanceOf(treasury), usdcBefore, "USDC back to the LP");
        assertGt(token.balanceOf(treasury), sharesBefore, "shares back to the LP");
    }

    /// @dev Chunk 4 on the real stack: the issuer switches the hook from the stub to `ListingPolicyReceiver`,
    ///      then CRE reports sent through the live Sepolia MockKeystoneForwarder (as `cre workflow simulate
    ///      --broadcast` does) halt and reopen the migrated pool. A spoofed halt from another EOA is ignored.
    function test_fork_creReceiver_haltAndResumeThroughLiveMockForwarder() public {
        _graduateAt110AndMigrate();
        address broadcaster = makeAddr("creBroadcaster");
        ListingPolicyReceiver receiver = new ListingPolicyReceiver(
            issuer, Sepolia.CRE_MOCK_FORWARDER, broadcaster, Sepolia.CRE_CHAIN_SELECTOR, 1 days
        );
        vm.prank(issuer);
        listingHook.setPolicySource(receiver);

        deal(Sepolia.USDC, trader, 10e6);
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
        bytes memory halted = _hookRevert(
            address(listingHook), IHooks.beforeSwap.selector, abi.encodeWithSelector(IListingHook.Halted.selector)
        );

        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        assertFalse(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), attacker, _encodeReport(p, ""), 1_500_000),
            "spoofed halt"
        );
        _swapTo(swapRouter, manager, key, trader, ListingPrice.pointsToSqrtPriceX96(112, true));

        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), 1_500_000),
            "CRE halt"
        );
        _swapTo(swapRouter, manager, key, trader, ListingPrice.pointsToSqrtPriceX96(111, true), halted);

        vm.warp(block.timestamp + 1);
        p = _freshPolicy();
        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), 1_500_000),
            "CRE resume"
        );
        _swapTo(swapRouter, manager, key, trader, ListingPrice.pointsToSqrtPriceX96(111, true));
        assertApproxEqAbs(listingHook.currentPointsE2(), 11_100, 1);
    }
}
