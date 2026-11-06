// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {IPositionManagerExit, ListingForkFixture} from "../utils/ListingForkFixture.sol";
import {IAuctionStorage} from "continuous-clearing-auction/src/interfaces/IAuctionStorage.sol";
import {ILBPInitializer} from "liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {ILBPStrategy} from "liquidity-launcher/src/interfaces/ILBPStrategy.sol";
import {TokenPricing} from "liquidity-launcher/src/libraries/TokenPricing.sol";
import {InitializerHook} from "liquidity-launcher/src/periphery/hooks/InitializerHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";

/// @notice Gate 0 lifecycle on a Sepolia fork, entirely through the deployed Uniswap contracts:
///         MockSME -> LiquidityLauncher multicall (depositToken + distributeToken) -> LBPStrategy v3.3.0 -> CCA
///         (factory v2.1.0) -> `setAuction` -> real Sepolia USDC bids via Permit2 -> clearing -> exits / claims
///         / sweeps -> `migrate()` into a v4 pool behind a mined ListingHook -> swaps through the hook -> CRE
///         reports through the live mock forwarder halting and reopening the pool.
contract ListingLifecycleForkTest is ListingForkFixture {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

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

        vm.warp(vm.getBlockTimestamp() + 1);
        p = _freshPolicy();
        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), 1_500_000),
            "CRE resume"
        );
        _swapTo(swapRouter, manager, key, trader, ListingPrice.pointsToSqrtPriceX96(111, true));
        assertApproxEqAbs(listingHook.currentPointsE2(), 11_100, 1);
    }
}
