// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingHook} from "../../src/ListingHook.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IListingHook, ListingHookConfig} from "../../src/interfaces/IListingHook.sol";
import {IListingPolicy, ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {MockListingPolicy} from "../../src/mocks/MockListingPolicy.sol";
import {CreReports} from "../utils/CreReports.sol";
import {MockKeystoneForwarder} from "../utils/MockKeystoneForwarder.sol";
import {PoolActions} from "../utils/PoolActions.sol";
import {TestUSDC} from "../utils/TestUSDC.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

/// @notice `ListingPolicyReceiver` plugged into `ListingHook` through `setPolicySource`, driven only by CRE
///         reports delivered through a (local port of the) MockKeystoneForwarder. USDC is currency0, as on Sepolia.
contract ListingPolicyReceiverHookTest is PoolActions, CreReports {
    uint160 internal constant FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    );
    address internal constant USDC_AT = address(uint160(0x1111) << 144);
    address internal constant SME_AT = address(uint160(0xEEEE) << 144);
    address internal constant HOOK_AT = address((uint160(0x4444) << 144) | FLAGS);
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint32 internal constant WINDOW = 1 days;
    uint64 internal constant MAX_AGE = 2 days;
    uint256 internal constant LIQUIDITY = 1e15;

    address internal strategy = makeAddr("lbpStrategy");
    address internal issuer = makeAddr("issuer");
    address internal broadcaster = makeAddr("creBroadcaster");
    address internal trader = makeAddr("trader");
    address internal attacker = makeAddr("attacker");

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    TestUSDC internal usdc;
    MockSME internal sme;
    MockKeystoneForwarder internal forwarder;
    ListingPolicyReceiver internal receiver;
    ListingHook internal hook;
    PoolKey internal key;

    function setUp() public {
        vm.warp(1_762_400_000);
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);
        deployCodeTo("TestUSDC.sol:TestUSDC", "", USDC_AT);
        deployCodeTo("MockSME.sol:MockSME", abi.encode("Acme SME", "ACME", address(this)), SME_AT);
        usdc = TestUSDC(USDC_AT);
        sme = MockSME(SME_AT);

        // Deployed with the stub source, as before the receiver existed; then switched over by the issuer.
        MockListingPolicy stub = new MockListingPolicy(issuer);
        ListingHookConfig memory c = ListingHookConfig({
            owner: issuer,
            usdc: address(usdc),
            token: address(sme),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            listingDayBandBps: 500,
            listingDayDuration: WINDOW,
            policySource: stub
        });
        deployCodeTo("ListingHook.sol:ListingHook", abi.encode(manager, strategy, c), HOOK_AT);
        hook = ListingHook(HOOK_AT);
        key = hook.poolKey();

        forwarder = new MockKeystoneForwarder();
        receiver =
            new ListingPolicyReceiver(issuer, address(forwarder), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, MAX_AGE);
        vm.expectEmit(address(hook));
        emit IListingHook.PolicySourceSet(address(receiver));
        vm.prank(issuer);
        hook.setPolicySource(receiver);
        assertEq(address(hook.policySource()), address(receiver));

        vm.prank(strategy);
        manager.initialize(key, _sqrtAt(11_000));
        assertTrue(hook.usdcIsCurrency0());

        usdc.mint(address(this), 1000e6);
        usdc.mint(trader, 1000e6);
        sme.transfer(trader, 50_000e18);
        _approveAll(address(this));
        _approveAll(trader);
        _modifyLiquidity(int256(LIQUIDITY));
    }

    // ---------------------------------------------------------------- helpers

    function _approveAll(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        sme.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        sme.approve(address(lpRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _modifyLiquidity(int256 delta) internal {
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(TICK_SPACING),
                tickUpper: TickMath.maxUsableTick(TICK_SPACING),
                liquidityDelta: delta,
                salt: 0
            }),
            ""
        );
    }

    function _sqrtAt(uint256 pointsE2) internal pure returns (uint160) {
        return ListingPrice.pointsE2ToSqrtPriceX96(pointsE2, true);
    }

    function _pointsNow() internal view returns (uint256) {
        return ListingPrice.sqrtPriceX96ToPointsE2(_sqrtPrice(manager, key), true);
    }

    function _swapToPoints(uint256 pointsE2) internal {
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(pointsE2));
        assertApproxEqAbs(_pointsNow(), pointsE2, 1, "pool did not reach target");
    }

    function _haltedRevert() internal view returns (bytes memory) {
        return
            _hookRevert(address(hook), IHooks.beforeSwap.selector, abi.encodeWithSelector(IListingHook.Halted.selector));
    }

    /// @dev A CRE report from the broadcaster, one second after the previous one.
    function _report(ListingPolicy memory p, string memory status) internal {
        vm.warp(block.timestamp + 1);
        p.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        p.asOf = uint64(block.timestamp);
        assertTrue(_deliver(address(forwarder), address(receiver), broadcaster, _encodeReport(p, status)), "applied");
    }

    function _halt(bool halted) internal {
        ListingPolicy memory p;
        p.halted = halted;
        _report(p, "");
    }

    function _reference(uint256 refPoints, uint8 mode) internal {
        ListingPolicy memory p;
        p.refSqrtPriceX96 = ListingPrice.pointsToSqrtPriceX96(refPoints, true);
        p.mode = mode;
        _report(p, "");
    }

    // ---------------------------------------------------------------- tests

    function test_unpublishedReceiver_hookDefaults_tradingOpen() public {
        assertEq(hook.effectivePolicy().version, 0);
        _swapToPoints(11_400);
    }

    /// @dev plan.md demo step 9 through CRE: halt -> swaps revert, LP add/remove still work; resume -> trading.
    function test_haltReport_swapsRevert_lpWorks_resumeReportReopens() public {
        _halt(true);
        assertTrue(hook.effectivePolicy().halted);
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(11_200), _haltedRevert());
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(10_800), _haltedRevert());

        uint256 usdcBefore = usdc.balanceOf(address(this));
        _modifyLiquidity(int256(LIQUIDITY / 2));
        _modifyLiquidity(-int256(LIQUIDITY));
        assertGt(usdc.balanceOf(address(this)), usdcBefore, "LP removed while halted");

        _halt(false);
        _swapToPoints(11_200);
    }

    function test_haltReportFromWrongOrigin_noEffect() public {
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        assertFalse(_deliver(address(forwarder), address(receiver), attacker, _encodeReport(p, "")), "rejected");
        assertFalse(hook.effectivePolicy().halted);
        _swapToPoints(11_200);
    }

    /// @dev plan.md §12 after listing day: pool 108, CRE moves the reference 110 -> 90 with directional mode; a
    ///      buy to 111 widens the gap and reverts, the arb sell to 98 passes.
    function test_referenceAndDirectionalModeReport_changeBands() public {
        _swapToPoints(10_800);
        vm.warp(hook.listingDayEndsAt());

        // Default after the window: 20% around the listing price (88-132).
        (uint256 lowE2, uint256 highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 8800, 1);
        assertApproxEqAbs(highE2, 13_200, 1);

        _reference(90, 2);
        (lowE2, highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 7200, 1, "20% around 90");
        assertApproxEqAbs(highE2, 10_800, 1);

        uint160 pre = _sqrtPrice(manager, key);
        uint160 post = _sqrtAt(11_100);
        uint160 ref = ListingPrice.pointsToSqrtPriceX96(90, true);
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            post,
            _hookRevert(
                address(hook),
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(IListingHook.DirectionalWidening.selector, pre, post, ref)
            )
        );
        _swapToPoints(9800);
    }

    function test_surveillanceModeReport_narrowsBand() public {
        vm.warp(hook.listingDayEndsAt());
        _swapToPoints(12_000); // inside the default 88-132

        _reference(120, 1);
        (uint256 lowE2, uint256 highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 11_400, 1, "5% around 120");
        assertApproxEqAbs(highE2, 12_600, 1);
        (uint160 lo, uint160 hi) = hook.currentBand();
        uint160 at127 = _sqrtAt(12_700);
        _swapTo(swapRouter, manager, key, trader, at127, _outOfBand(address(hook), at127, lo, hi));
        _swapToPoints(12_500);
    }

    function test_coolOffReport_blocksUntilTimestamp() public {
        ListingPolicy memory p;
        p.coolOffUntil = uint64(block.timestamp + 1 hours);
        _report(p, "");
        _swapTo(
            swapRouter,
            manager,
            key,
            trader,
            _sqrtAt(11_200),
            _hookRevert(
                address(hook),
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(IListingHook.CoolingOff.selector, p.coolOffUntil)
            )
        );
        vm.warp(p.coolOffUntil);
        _swapToPoints(11_200);
    }

    /// @dev The documented staleness rule: no fresh report for `maxAge` -> swaps revert `Halted` (LP unaffected);
    ///      the next report reopens trading.
    function test_stalePolicy_haltsTrading_freshReportReopens() public {
        _reference(110, 0);
        _swapToPoints(11_200);

        vm.warp(block.timestamp + MAX_AGE + 1);
        assertTrue(receiver.isStale());
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(11_000), _haltedRevert());
        _modifyLiquidity(int256(LIQUIDITY / 2));

        _reference(110, 0);
        _swapToPoints(11_000);
    }

    function test_switchBackToNoSource_defaults() public {
        _halt(true);
        vm.prank(issuer);
        hook.setPolicySource(IListingPolicy(address(0)));
        _swapToPoints(11_200);
    }
}
