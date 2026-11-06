// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {IListingPolicyReceiver} from "../../src/interfaces/IListingPolicyReceiver.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingBand} from "../../src/libraries/ListingBand.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {IPositionManagerExit, ListingForkFixture} from "../utils/ListingForkFixture.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";

/// @notice ListingHook trading rules after the listing day on a Sepolia fork: the pool is opened by the real
///         LiquidityLauncher -> LBPStrategy -> CCA -> `migrate()` flow, the hook reads `ListingPolicyReceiver`,
///         and every policy arrives as a CRE report through the live Sepolia MockKeystoneForwarder from the
///         broadcaster (the receiver's tx.origin guard). Covers the 20% normal band around the CRE reference,
///         surveillance (5%), directional mode in both directions, halt -> resume with cool-off, the staleness
///         halt, report version / asOf monotonicity, and LP add / remove in every mode.
/// @dev Prices are share prices in points x100 (11_000 = 1.10 USDC per lot); `_sqrtAt` maps them into the pool's
///      orientation, so every test runs unchanged for USDC as currency0 (production) and as currency1.
abstract contract ListingHookRulesForkBase is ListingForkFixture {
    uint64 internal constant MAX_AGE = 2 days;
    /// @dev The CRE workflow's `gasConfig.gasLimit` for `writeReport`.
    uint256 internal constant CRE_GAS_LIMIT = 1_500_000;
    /// @dev Full-range liquidity for the test LP: about 3.3 USDC and 3,000 shares at 110 points.
    uint256 internal constant LP_LIQUIDITY = 1e14;

    address internal broadcaster = makeAddr("creBroadcaster");
    address internal lp = makeAddr("lp");

    ListingPolicyReceiver internal receiver;
    PoolModifyLiquidityTest internal lpRouter;
    IPositionManagerExit internal posm = IPositionManagerExit(Sepolia.POSITION_MANAGER);
    uint256 internal lpTokenId;

    function setUpFork() internal override {
        super.setUpFork();
        _graduateAt110AndMigrate();
        assertEq(listingHook.usdcIsCurrency0(), _usdcIsCurrency0(), "pool orientation");
        assertEq(Currency.unwrap(_usdcIsCurrency0() ? key.currency0 : key.currency1), Sepolia.USDC);

        receiver = new ListingPolicyReceiver(
            issuer, Sepolia.CRE_MOCK_FORWARDER, broadcaster, Sepolia.CRE_CHAIN_SELECTOR, MAX_AGE
        );
        vm.prank(issuer);
        listingHook.setPolicySource(receiver);

        lpRouter = new PoolModifyLiquidityTest(manager);
        _fund(trader, 1_000_000e6, 50_000e18);
        _fund(lp, 1000e6, 10_000e18);

        lpTokenId = posm.nextTokenId() - 1;
        assertEq(posm.ownerOf(lpTokenId), treasury, "migrated LP NFT");
    }

    // ---------------------------------------------------------------- helpers

    function _fund(address who, uint256 usdcAmount, uint256 shares) internal {
        deal(Sepolia.USDC, who, usdcAmount);
        deal(address(token), who, shares);
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        token.approve(address(lpRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _sqrtAt(uint256 pointsE2) internal pure returns (uint160) {
        return ListingPrice.pointsE2ToSqrtPriceX96(pointsE2, _usdcIsCurrency0());
    }

    function _pointsNow() internal view returns (uint256) {
        return ListingPrice.sqrtPriceX96ToPointsE2(_sqrtPrice(manager, key), _usdcIsCurrency0());
    }

    function _swapToPoints(uint256 pointsE2) internal {
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(pointsE2));
        assertApproxEqAbs(_pointsNow(), pointsE2, 1, "pool did not reach target");
    }

    function _expectOutOfBand(uint256 pointsE2) internal {
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        uint160 target = _sqrtAt(pointsE2);
        uint160 before = _sqrtPrice(manager, key);
        _swapTo(swapRouter, manager, key, trader, target, _outOfBand(address(listingHook), target, lo, hi));
        assertEq(_sqrtPrice(manager, key), before, "rejected swap moved the price");
    }

    function _expectDirectional(uint256 pointsE2, uint256 refPointsE2) internal {
        uint160 pre = _sqrtPrice(manager, key);
        uint160 post = _sqrtAt(pointsE2);
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            post,
            _hookRevert(
                address(listingHook),
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(IListingHook.DirectionalWidening.selector, pre, post, _sqrtAt(refPointsE2))
            )
        );
        assertEq(_sqrtPrice(manager, key), pre, "rejected swap moved the price");
    }

    function _expectBeforeSwapRevert(uint256 pointsE2, bytes memory reason) internal {
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            _sqrtAt(pointsE2),
            _hookRevert(address(listingHook), IHooks.beforeSwap.selector, reason)
        );
    }

    /// @dev A buy and a sell from the current price both revert in `beforeSwap`.
    function _expectSwapsBlocked(bytes memory reason) internal {
        uint256 nowE2 = _pointsNow();
        _expectBeforeSwapRevert(nowE2 + 100, reason);
        _expectBeforeSwapRevert(nowE2 - 100, reason);
    }

    function _halted() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IListingHook.Halted.selector);
    }

    function _endListingDay() internal {
        vm.warp(listingHook.listingDayEndsAt());
        assertEq(uint8(listingHook.phase()), uint8(IListingHook.Phase.Normal));
    }

    function _refPolicy(uint256 refPointsE2, uint8 mode) internal pure returns (ListingPolicy memory p) {
        p.refSqrtPriceX96 = _sqrtAt(refPointsE2);
        p.mode = mode;
    }

    /// @dev A CRE report one second after the previous block, from the broadcaster through the live mock
    ///      forwarder, as `cre workflow simulate --broadcast` sends it. Returns what the receiver stored.
    function _report(ListingPolicy memory p) internal returns (ListingPolicy memory applied) {
        vm.warp(vm.getBlockTimestamp() + 1);
        p.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        // forge-lint: disable-next-line(unsafe-typecast)
        p.asOf = uint64(vm.getBlockTimestamp());
        uint32 nextVersion = receiver.latestPolicy().version + 1;
        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), CRE_GAS_LIMIT),
            "CRE report applied"
        );
        applied = receiver.latestPolicy();
        assertEq(applied.version, nextVersion, "version bumped by one");
        assertEq(applied.asOf, p.asOf);
        assertEq(listingHook.effectivePolicy().version, nextVersion, "hook reads the new policy");
    }

    /// @dev The live forwarder swallows the receiver's revert (`ReportProcessed.result == false`); replaying
    ///      `onReport` as the forwarder with the broadcaster as origin shows why, as errors.md describes.
    function _expectRejected(ListingPolicy memory p, bytes memory reason) internal {
        bytes memory payload = _encodeReport(p, "");
        vm.prank(Sepolia.CRE_MOCK_FORWARDER, broadcaster);
        vm.expectRevert(reason);
        receiver.onReport(_metadata(), payload);
        ListingPolicy memory before = receiver.latestPolicy();
        assertFalse(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, payload, CRE_GAS_LIMIT),
            "report rejected"
        );
        assertEq(keccak256(abi.encode(receiver.latestPolicy())), keccak256(abi.encode(before)), "policy unchanged");
    }

    function _modifyLp(int256 delta) internal {
        vm.prank(lp);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(POOL_TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(POOL_TICK_SPACING),
                liquidityDelta: delta,
                salt: 0
            }),
            ""
        );
    }

    /// @dev Full-range add then remove through the live PoolManager, plus a partial exit of the treasury's
    ///      migrated LP NFT through the live PositionManager. Neither touches the hook.
    function _assertLpUnblocked() internal {
        uint160 price = _sqrtPrice(manager, key);
        uint256 usdcBefore = usdc.balanceOf(lp);
        uint256 sharesBefore = token.balanceOf(lp);
        _modifyLp(int256(LP_LIQUIDITY));
        assertLt(usdc.balanceOf(lp), usdcBefore, "add pulled USDC");
        assertLt(token.balanceOf(lp), sharesBefore, "add pulled shares");
        _modifyLp(-int256(LP_LIQUIDITY));
        assertApproxEqAbs(usdc.balanceOf(lp), usdcBefore, 1, "remove returned USDC");
        assertApproxEqAbs(token.balanceOf(lp), sharesBefore, 1, "remove returned shares");

        uint128 liquidity = posm.getPositionLiquidity(lpTokenId);
        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(lpTokenId, uint256(liquidity / 10), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, treasury);
        uint256 treasuryUsdc = usdc.balanceOf(treasury);
        vm.prank(treasury);
        posm.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        assertEq(posm.getPositionLiquidity(lpTokenId), liquidity - liquidity / 10, "treasury LP decreased");
        assertGt(usdc.balanceOf(treasury), treasuryUsdc, "treasury got USDC back");

        assertEq(_sqrtPrice(manager, key), price, "LP changes do not move the price");
    }

    // ---------------------------------------------------------------- 1. normal band after the listing day

    /// @dev The ±5% listing-day band rules until `listingDayEndsAt`; from then on the default 20% band around the
    ///      listing price (no report yet: receiver policy all zeros).
    function test_fork_listingDayEnds_normal20PercentBandAroundListingPrice() public {
        vm.warp(listingHook.listingDayEndsAt() - 1);
        assertEq(uint8(listingHook.phase()), uint8(IListingHook.Phase.ListingDay));
        _expectOutOfBand(11_700);

        _endListingDay();
        assertEq(receiver.latestPolicy().version, 0, "no CRE report yet");
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        (uint160 expLo, uint160 expHi) = ListingBand.bounds(listingHook.listingSqrtPriceX96(), 2000, _usdcIsCurrency0());
        assertEq(lo, expLo);
        assertEq(hi, expHi);
        (uint256 lowE2, uint256 highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 8800, 1);
        assertApproxEqAbs(highE2, 13_200, 1);

        _swapToPoints(11_700); // rejected on the listing day, inside 88-132 now
        _swapToPoints(13_100);
        _expectOutOfBand(13_300);
        _swapToPoints(8900);
        _expectOutOfBand(8700);
        _assertLpUnblocked();
    }

    /// @dev A CRE report moves the reference; the 20% band (and a custom normal band) follow it.
    function test_fork_normalBand_followsCreReferencePrice() public {
        _endListingDay();
        _report(_refPolicy(10_000, 0));
        assertEq(receiver.status(), "listed");
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        (uint160 expLo, uint160 expHi) = ListingBand.bounds(_sqrtAt(10_000), 2000, _usdcIsCurrency0());
        assertEq(lo, expLo, "20% around the CRE reference");
        assertEq(hi, expHi);
        (uint256 lowE2, uint256 highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 8000, 1);
        assertApproxEqAbs(highE2, 12_000, 1);

        _swapToPoints(11_900);
        _expectOutOfBand(12_100);
        _swapToPoints(8100);
        _expectOutOfBand(7900);

        ListingPolicy memory p = _refPolicy(10_000, 0);
        p.normalBandBps = 1000;
        _report(p);
        (lowE2, highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 9000, 1, "10% around 100");
        assertApproxEqAbs(highE2, 11_000, 1);
        _expectOutOfBand(8900); // pool at 81 is outside 90-110; a swap that stays outside reverts
        _swapToPoints(10_900);
        _expectOutOfBand(11_100);
    }

    // ---------------------------------------------------------------- 2. surveillance (mode 1)

    function test_fork_surveillanceReport_tightensBandTo5Percent() public {
        _endListingDay();
        _swapToPoints(11_800); // fine in normal mode

        _report(_refPolicy(11_000, 1));
        assertEq(receiver.status(), "surveillance");
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        (uint160 expLo, uint160 expHi) = ListingBand.bounds(_sqrtAt(11_000), 500, _usdcIsCurrency0());
        assertEq(lo, expLo, "5% around the CRE reference");
        assertEq(hi, expHi);
        (uint256 lowE2, uint256 highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 10_450, 1);
        assertApproxEqAbs(highE2, 11_550, 1);

        _assertLpUnblocked(); // pool at 118 sits outside the new band
        _expectOutOfBand(11_700); // toward the band but still outside: rejected
        _swapToPoints(11_500);
        _expectOutOfBand(11_600);
        _swapToPoints(10_500);
        _expectOutOfBand(10_400);

        ListingPolicy memory p = _refPolicy(11_000, 1);
        p.survBandBps = 300;
        _report(p);
        (lowE2, highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 10_670, 1, "custom 3% surveillance band");
        assertApproxEqAbs(highE2, 11_330, 1);
        _swapToPoints(11_300);
        _expectOutOfBand(11_400);
    }

    /// @dev Policy mode and reference are ignored until the listing-day window closes, then apply at once.
    function test_fork_surveillanceReportDuringListingDay_appliesWhenWindowEnds() public {
        _report(_refPolicy(10_000, 1));
        assertEq(uint8(listingHook.phase()), uint8(IListingHook.Phase.ListingDay));
        (uint160 lo, uint160 hi) = listingHook.currentBand();
        assertEq(lo, listingHook.listingDaySqrtPriceMinX96());
        assertEq(hi, listingHook.listingDaySqrtPriceMaxX96());
        _swapToPoints(11_400); // outside 95-105 but inside the listing-day band
        _expectOutOfBand(11_700);

        _endListingDay();
        (uint256 lowE2, uint256 highE2) = listingHook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 9500, 1);
        assertApproxEqAbs(highE2, 10_500, 1);
        _expectOutOfBand(11_300);
        _swapToPoints(10_400);
    }

    // ---------------------------------------------------------------- 3. directional (mode 2)

    /// @dev plan.md §12: pool above the reference (107 vs 90). Buys widen the gap and revert; sells narrow it and
    ///      pass, including one that crosses the reference and ends inside the 5% tolerance (85.5-94.5); a sell
    ///      that ends beyond the tolerance reverts.
    function test_fork_directional_poolAboveReference_sellsPass_wideningBuysRevert() public {
        _swapToPoints(10_700);
        _endListingDay();
        _report(_refPolicy(9000, 2));
        assertEq(receiver.status(), "surveillance");
        assertEq(listingHook.effectivePolicy().mode, listingHook.MODE_DIRECTIONAL());

        _expectDirectional(10_800, 9000); // buy: widens, beyond the tolerance (and at the normal band edge)
        _swapToPoints(9800); // sell: narrows
        _expectDirectional(9900, 9000); // a small buy back widens again
        _swapToPoints(9200);
        _swapToPoints(8600); // crosses the reference: gap 2.2% -> 4.7%, inside the tolerance
        _expectDirectional(8400, 9000); // sell beyond the tolerance
        _swapToPoints(9000); // buy: narrows
        _assertLpUnblocked();
    }

    /// @dev Mirror image: pool below the reference (110 vs 125). Sells widen and revert; buys narrow and pass.
    function test_fork_directional_poolBelowReference_buysPass_wideningSellsRevert() public {
        _endListingDay();
        _report(_refPolicy(12_500, 2));

        _expectDirectional(10_500, 12_500); // sell: widens beyond the tolerance (118.75-131.25)
        _swapToPoints(12_000); // buy: narrows
        _expectDirectional(11_800, 12_500);
        _swapToPoints(12_400);
        _swapToPoints(13_000); // crosses: gap 0.8% -> 4%, inside the tolerance
        _expectDirectional(13_200, 12_500); // buy beyond the tolerance
        _swapToPoints(12_600); // sell: narrows
        _assertLpUnblocked();
    }

    /// @dev The same in-band widening buy passes in normal mode and reverts in directional mode.
    function test_fork_directional_rejectsInBandWideningThatNormalModeAllows() public {
        _endListingDay();
        _report(_refPolicy(9000, 0)); // band 72-108
        _swapToPoints(10_000);
        _swapToPoints(10_500);
        _swapToPoints(10_000);

        _report(_refPolicy(9000, 2));
        _expectDirectional(10_500, 9000);
        assertApproxEqAbs(_pointsNow(), 10_000, 1);
        _swapToPoints(9500);
    }

    /// @dev Directional mode still enforces the normal band: a sell toward the reference that stops outside the
    ///      20% band reverts OutOfBand; one that lands inside passes.
    function test_fork_directional_narrowingSwapOutsideNormalBand_revertsOutOfBand() public {
        _endListingDay();
        _report(_refPolicy(8500, 2)); // band 68-102, pool at 110
        _expectOutOfBand(10_500);
        _swapToPoints(10_000);
        _expectDirectional(10_100, 8500);
    }

    // ---------------------------------------------------------------- 4. halt, cool-off, staleness

    /// @dev CRE halt -> every swap reverts Halted; CRE resume with a cool-off -> swaps revert CoolingOff until
    ///      `coolOffUntil`, then trade again under the normal band. LP add / remove work throughout.
    function test_fork_creHaltThenResumeWithCoolOff_swapsBlockedUntilCoolOffEnds() public {
        _endListingDay();
        ListingPolicy memory p;
        p.halted = true;
        _report(p);
        assertEq(receiver.status(), "halted");
        _expectSwapsBlocked(_halted());
        _assertLpUnblocked();

        p.halted = false;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 until = uint64(vm.getBlockTimestamp() + 1 hours);
        p.coolOffUntil = until;
        _report(p);
        assertFalse(receiver.policy().halted);
        assertEq(receiver.status(), "halted", "cooling off is reported as halted");
        bytes memory coolingOff = abi.encodeWithSelector(IListingHook.CoolingOff.selector, until);
        _expectSwapsBlocked(coolingOff);
        _assertLpUnblocked();

        vm.warp(until - 1);
        _expectSwapsBlocked(coolingOff);

        vm.warp(until);
        _swapToPoints(11_700); // outside the listing-day band, inside the normal one
        _expectOutOfBand(13_300);
    }

    /// @dev No fresh report for `maxAge`: the receiver reports `halted` and swaps revert Halted (LP unaffected).
    ///      A report that is already older than `maxAge` is refused; the next fresh report reopens trading.
    function test_fork_stalePolicy_readsHalted_freshReportReopens() public {
        _endListingDay();
        ListingPolicy memory applied = _report(_refPolicy(11_000, 1));
        _swapToPoints(11_200);
        assertEq(receiver.staleAt(), uint256(applied.asOf) + MAX_AGE + 1);

        vm.warp(receiver.staleAt() - 1);
        assertFalse(receiver.isStale());
        _swapToPoints(11_300);

        vm.warp(receiver.staleAt());
        assertTrue(receiver.isStale());
        assertTrue(receiver.policy().halted, "stale reads as halted");
        assertFalse(receiver.latestPolicy().halted, "stored policy untouched");
        assertTrue(listingHook.effectivePolicy().halted);
        _expectSwapsBlocked(_halted());
        _assertLpUnblocked();

        vm.warp(vm.getBlockTimestamp() + 10);
        ListingPolicy memory late = _refPolicy(11_000, 0);
        late.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        // forge-lint: disable-next-line(unsafe-typecast)
        late.asOf = uint64(vm.getBlockTimestamp() - MAX_AGE - 1);
        _expectRejected(late, abi.encodeWithSelector(IListingPolicyReceiver.ReportExpired.selector, late.asOf, MAX_AGE));
        _expectSwapsBlocked(_halted());

        _report(_refPolicy(11_000, 0));
        assertFalse(receiver.isStale());
        _swapToPoints(11_700);
    }

    // ---------------------------------------------------------------- policy version / asOf monotonicity

    /// @dev `version` is the receiver's counter (the payload's is ignored) and `asOf` must strictly increase: a
    ///      replay, an older report or one too far in the future is refused through the live forwarder.
    function test_fork_policyVersionAndAsOf_monotonicThroughLiveForwarder() public {
        _endListingDay();
        ListingPolicy memory p = _refPolicy(11_000, 1);
        p.version = 999;
        ListingPolicy memory first = _report(p);
        assertEq(first.version, 1, "payload version ignored");

        ListingPolicy memory replay = _refPolicy(10_000, 0);
        replay.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        replay.asOf = first.asOf;
        _expectRejected(
            replay, abi.encodeWithSelector(IListingPolicyReceiver.StaleReport.selector, first.asOf, first.asOf)
        );
        replay.asOf = first.asOf - 1;
        _expectRejected(
            replay, abi.encodeWithSelector(IListingPolicyReceiver.StaleReport.selector, first.asOf - 1, first.asOf)
        );

        uint256 nowTs = vm.getBlockTimestamp();
        ListingPolicy memory future = _refPolicy(10_000, 0);
        future.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        // forge-lint: disable-next-line(unsafe-typecast)
        future.asOf = uint64(nowTs + receiver.MAX_FUTURE_SKEW() + 1);
        _expectRejected(
            future, abi.encodeWithSelector(IListingPolicyReceiver.ReportFromFuture.selector, future.asOf, nowTs)
        );

        ListingPolicy memory wrongChain = _refPolicy(10_000, 0);
        // forge-lint: disable-next-line(unsafe-typecast)
        wrongChain.asOf = uint64(nowTs);
        wrongChain.chainSelector = Sepolia.CRE_CHAIN_SELECTOR + 1;
        _expectRejected(
            wrongChain,
            abi.encodeWithSelector(
                IListingPolicyReceiver.WrongChainSelector.selector, wrongChain.chainSelector, Sepolia.CRE_CHAIN_SELECTOR
            )
        );

        // Still the first policy: surveillance around 110.
        assertEq(listingHook.effectivePolicy().version, 1);
        _expectOutOfBand(11_600);

        ListingPolicy memory second = _report(_refPolicy(10_000, 0));
        assertEq(second.version, 2);
        assertGt(second.asOf, first.asOf);
        _swapToPoints(11_900);
    }

    // ---------------------------------------------------------------- LP never blocked

    /// @dev One pool walked through every policy state; liquidity is added, removed and exited in each.
    function test_fork_lpAddRemove_neverBlocked_inEveryMode() public {
        _assertLpUnblocked(); // listing day, no report

        _endListingDay();
        _assertLpUnblocked(); // normal, defaults

        _report(_refPolicy(9000, 1)); // surveillance, pool outside the band
        _expectOutOfBand(10_500);
        _assertLpUnblocked();

        _report(_refPolicy(9000, 2)); // directional, pool outside the band
        _assertLpUnblocked();

        ListingPolicy memory p;
        p.halted = true;
        _report(p);
        _expectSwapsBlocked(_halted());
        _assertLpUnblocked();

        p.halted = false;
        // forge-lint: disable-next-line(unsafe-typecast)
        p.coolOffUntil = uint64(vm.getBlockTimestamp() + 1 hours);
        _report(p);
        _expectSwapsBlocked(abi.encodeWithSelector(IListingHook.CoolingOff.selector, p.coolOffUntil));
        _assertLpUnblocked();

        vm.warp(receiver.staleAt());
        _expectSwapsBlocked(_halted());
        _assertLpUnblocked();
    }
}

/// @notice The production orientation: MockSME sorts above Sepolia USDC, so USDC is currency0 and buying shares
///         lowers the pool's sqrtPriceX96.
contract ListingHookRulesForkTest is ListingHookRulesForkBase {}

/// @notice The same rules with MockSME sorted below Sepolia USDC (USDC is currency1).
contract ListingHookRulesUsdcCurrency1ForkTest is ListingHookRulesForkBase {
    function _usdcIsCurrency0() internal pure override returns (bool) {
        return false;
    }
}
