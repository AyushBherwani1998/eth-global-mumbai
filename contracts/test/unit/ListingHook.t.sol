// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingHook} from "../../src/ListingHook.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IListingHook, ListingHookConfig} from "../../src/interfaces/IListingHook.sol";
import {IListingPolicy, ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {ListingBand} from "../../src/libraries/ListingBand.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {MockListingPolicy} from "../../src/mocks/MockListingPolicy.sol";
import {PoolActions} from "../utils/PoolActions.sol";
import {TestUSDC} from "../utils/TestUSDC.sol";
import {IInitializerHook} from "liquidity-launcher/src/interfaces/IInitializerHook.sol";
import {InitializerHook} from "liquidity-launcher/src/periphery/hooks/InitializerHook.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {ImmutableState} from "v4-periphery/src/base/ImmutableState.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

/// @notice Shared ListingHook suite on a local PoolManager. Runs once with USDC as currency0 (the Sepolia case:
///         pool price inverted) and once with USDC as currency1.
abstract contract ListingHookTestBase is PoolActions {
    uint160 internal constant FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    );
    address internal constant LOW = address(uint160(0x1111) << 144);
    address internal constant HIGH = address(uint160(0xEEEE) << 144);
    address internal constant HOOK = address((uint160(0x4444) << 144) | FLAGS);
    address internal constant HOOK2 = address((uint160(0x5555) << 144) | FLAGS);

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint32 internal constant WINDOW = 1 days;
    uint256 internal constant LIQUIDITY = 1e15;

    address internal strategy = makeAddr("lbpStrategy");
    address internal policyOwner = makeAddr("policyOwner");
    address internal hookOwner = makeAddr("hookOwner");
    address internal trader = makeAddr("trader");
    address internal attacker = makeAddr("attacker");

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    TestUSDC internal usdc;
    MockSME internal sme;
    MockListingPolicy internal policy;
    ListingHook internal hook;
    PoolKey internal key;
    bool internal usdc0;

    function usdcIsCurrency0() internal pure virtual returns (bool);

    function setUp() public {
        usdc0 = usdcIsCurrency0();
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        deployCodeTo("TestUSDC.sol:TestUSDC", "", usdc0 ? LOW : HIGH);
        deployCodeTo("MockSME.sol:MockSME", abi.encode("Acme SME", "ACME", address(this)), usdc0 ? HIGH : LOW);
        usdc = TestUSDC(usdc0 ? LOW : HIGH);
        sme = MockSME(usdc0 ? HIGH : LOW);

        policy = new MockListingPolicy(policyOwner);
        hook = _deployHook(HOOK);
        key = hook.poolKey();
        assertEq(Hooks.isValidHookAddress(IHooks(address(hook)), FEE), true);

        vm.prank(strategy);
        manager.initialize(key, _sqrtAt(11_000));

        usdc.mint(address(this), 1000e6);
        usdc.mint(trader, 1000e6);
        sme.transfer(trader, 50_000e18);
        _approveAll(address(this));
        _approveAll(trader);
        _addLiquidity(int256(LIQUIDITY));
    }

    // ---------------------------------------------------------------- helpers

    function _config() internal view returns (ListingHookConfig memory) {
        return ListingHookConfig({
            owner: hookOwner,
            usdc: address(usdc),
            token: address(sme),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            listingDayBandBps: 500,
            listingDayDuration: WINDOW,
            policySource: policy
        });
    }

    function _deployHook(address at) internal returns (ListingHook) {
        deployCodeTo("ListingHook.sol:ListingHook", abi.encode(manager, strategy, _config()), at);
        return ListingHook(at);
    }

    function _approveAll(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(swapRouter), type(uint256).max);
        sme.approve(address(swapRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        sme.approve(address(lpRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _addLiquidity(int256 delta) internal {
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

    /// @dev Pool sqrtPriceX96 for a share price in points x100 (11_000 = 1.10 USDC per lot).
    function _sqrtAt(uint256 pointsE2) internal view returns (uint160) {
        return ListingPrice.pointsE2ToSqrtPriceX96(pointsE2, usdc0);
    }

    function _pointsNow() internal view returns (uint256) {
        return ListingPrice.sqrtPriceX96ToPointsE2(_sqrtPrice(manager, key), usdc0);
    }

    function _swapToPoints(uint256 pointsE2) internal {
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(pointsE2));
        assertApproxEqAbs(_pointsNow(), pointsE2, 1, "pool did not reach target");
    }

    function _expectOutOfBand(uint256 pointsE2) internal {
        (uint160 lo, uint160 hi) = hook.currentBand();
        uint160 target = _sqrtAt(pointsE2);
        _swapTo(swapRouter, manager, key, trader, target, _outOfBand(address(hook), target, lo, hi));
    }

    function _expectBeforeSwapRevert(uint256 pointsE2, bytes memory reason) internal {
        bytes memory revertData = _hookRevert(address(hook), IHooks.beforeSwap.selector, reason);
        _swapTo(swapRouter, manager, key, trader, _sqrtAt(pointsE2), revertData);
    }

    function _directionalRevert(uint160 pre, uint160 post, uint160 ref) internal view returns (bytes memory) {
        return _hookRevert(
            address(hook),
            IHooks.afterSwap.selector,
            abi.encodeWithSelector(IListingHook.DirectionalWidening.selector, pre, post, ref)
        );
    }

    function _setPolicy(uint256 refPointsE2, uint8 mode) internal {
        vm.prank(policyOwner);
        policy.setReference(refPointsE2 == 0 ? 0 : _sqrtAt(refPointsE2), mode);
    }

    function _endListingDay() internal {
        vm.warp(hook.listingDayEndsAt());
        assertEq(uint8(hook.phase()), uint8(IListingHook.Phase.Normal));
    }

    // ---------------------------------------------------------------- permissions and LBPStrategy compatibility

    function test_permissions_noLiquidityFlags_addressEncodesThem() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeInitialize && p.afterInitialize && p.beforeSwap && p.afterSwap);
        assertFalse(p.beforeAddLiquidity || p.afterAddLiquidity || p.beforeRemoveLiquidity || p.afterRemoveLiquidity);
        assertFalse(p.beforeSwapReturnDelta || p.afterSwapReturnDelta);
        assertFalse(p.afterAddLiquidityReturnDelta || p.afterRemoveLiquidityReturnDelta);
        assertFalse(p.beforeDonate || p.afterDonate);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, FLAGS);
    }

    /// @dev The checks LBPStrategy's `MigratorParams.validateHook` runs, minus the "pool not initialized" one.
    function test_lbpStrategyHookChecks_pass() public view {
        assertTrue(hook.supportsInterface(type(IInitializerHook).interfaceId));
        assertEq(hook.authorized(), strategy);
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_INITIALIZE_FLAG));
        assertTrue(Hooks.isValidHookAddress(IHooks(address(hook)), FEE));
    }

    // ---------------------------------------------------------------- initialize

    function test_initialize_onlyStrategy() public {
        ListingHook fresh = _deployHook(HOOK2);
        PoolKey memory freshKey = fresh.poolKey();
        uint160 price = _sqrtAt(11_000);

        vm.prank(attacker);
        vm.expectRevert(
            _hookRevert(
                address(fresh),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(InitializerHook.InvalidInitializer.selector, attacker, strategy)
            )
        );
        manager.initialize(freshKey, price);

        // The issuer, or the hook owner, can't initialize either.
        vm.prank(hookOwner);
        vm.expectRevert();
        manager.initialize(freshKey, price);
        assertFalse(fresh.listed());

        vm.prank(strategy);
        manager.initialize(freshKey, price);
        assertTrue(fresh.listed());
    }

    function test_initialize_otherPoolKeyRejectedEvenForStrategy() public {
        ListingHook fresh = _deployHook(HOOK2);
        PoolKey memory otherFee = fresh.poolKey();
        otherFee.fee = 500;
        otherFee.tickSpacing = 10;

        vm.prank(strategy);
        vm.expectRevert(
            _hookRevert(
                address(fresh),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(IListingHook.PoolKeyMismatch.selector)
            )
        );
        manager.initialize(otherFee, _sqrtAt(11_000));
    }

    function test_hookCallbacks_onlyPoolManager() public {
        vm.expectRevert(ImmutableState.NotPoolManager.selector);
        hook.afterInitialize(strategy, key, _sqrtAt(11_000), 0);
    }

    // ---------------------------------------------------------------- bands stored at initialization

    function test_afterInitialize_storesListingPriceOrientationAndBands() public view {
        uint160 listing = _sqrtAt(11_000);
        assertTrue(hook.listed());
        assertEq(hook.usdcIsCurrency0(), usdc0, "orientation");
        assertEq(hook.listingSqrtPriceX96(), listing);
        assertEq(hook.listingTick(), TickMath.getTickAtSqrtPrice(listing));
        assertEq(hook.listedAt(), block.timestamp);
        assertEq(hook.listingDayEndsAt(), block.timestamp + WINDOW);
        assertEq(uint8(hook.phase()), uint8(IListingHook.Phase.ListingDay));

        uint160 lo = hook.listingDaySqrtPriceMinX96();
        uint160 hi = hook.listingDaySqrtPriceMaxX96();
        assertLt(lo, listing);
        assertGt(hi, listing);
        // 104.5 and 115.5 points; with USDC as currency0 the higher share price is the LOWER sqrt bound.
        uint160 at1045 = _sqrtAt(10_450);
        uint160 at1155 = _sqrtAt(11_550);
        assertApproxEqRel(usdc0 ? lo : hi, at1155, 1e6, "share-price upper bound");
        assertApproxEqRel(usdc0 ? hi : lo, at1045, 1e6, "share-price lower bound");

        (uint256 lowE2, uint256 highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 10_450, 1);
        assertApproxEqAbs(highE2, 11_550, 1);
        assertApproxEqAbs(hook.currentPointsE2(), 11_000, 1);
    }

    function test_afterInitialize_emitsListed() public {
        ListingHook fresh = _deployHook(HOOK2);
        uint160 price = _sqrtAt(11_000);
        (uint160 lo, uint160 hi) = ListingBand.bounds(price, 500, usdc0);
        vm.expectEmit(address(fresh));
        emit IListingHook.Listed(
            fresh.poolId(), price, TickMath.getTickAtSqrtPrice(price), usdc0, uint64(block.timestamp + WINDOW), lo, hi
        );
        PoolKey memory freshKey = fresh.poolKey();
        vm.prank(strategy);
        manager.initialize(freshKey, price);
    }

    // ---------------------------------------------------------------- listing day: ±5% around the clearing price

    function test_listingDay_buyTo114Passes_buyTo117Reverts() public {
        _swapToPoints(11_400);
        _expectOutOfBand(11_700);
        assertApproxEqAbs(_pointsNow(), 11_400, 1, "reverted swap left the price unchanged");
    }

    function test_listingDay_sellTo105Passes_sellTo104Reverts() public {
        _swapToPoints(10_500);
        _expectOutOfBand(10_400);
    }

    function test_listingDay_bandEdgesInclusive() public {
        _swapToPoints(11_549);
        _swapToPoints(10_451);
    }

    function test_listingDay_ignoresPolicyReferenceAndMode() public {
        _setPolicy(9000, 2);
        _swapToPoints(11_400);
        _expectOutOfBand(11_700);
    }

    // ---------------------------------------------------------------- after the window: 20% normal band

    function test_afterWindow_normal20PercentBandApplies() public {
        _endListingDay();
        (uint256 lowE2, uint256 highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 8800, 1);
        assertApproxEqAbs(highE2, 13_200, 1);

        _swapToPoints(11_700); // out of the listing-day band, inside 88-132
        _swapToPoints(13_100);
        _expectOutOfBand(13_300);
        _swapToPoints(8900);
        _expectOutOfBand(8700);
    }

    function test_afterWindow_boundaryIsListingDayEndsAt() public {
        vm.warp(hook.listingDayEndsAt() - 1);
        _expectOutOfBand(11_700);
        vm.warp(hook.listingDayEndsAt());
        _swapToPoints(11_700);
    }

    function test_afterWindow_policyNormalBandAroundReference() public {
        _endListingDay();
        ListingPolicy memory p;
        p.version = 1;
        p.refSqrtPriceX96 = _sqrtAt(10_000);
        p.normalBandBps = 1000;
        vm.prank(policyOwner);
        policy.setPolicy(p);

        _swapToPoints(10_900);
        _expectOutOfBand(11_100);
        _swapToPoints(9100);
        _expectOutOfBand(8900);
    }

    // ---------------------------------------------------------------- surveillance (mode 1)

    function test_surveillance_5PercentAroundReference() public {
        _endListingDay();
        _setPolicy(10_000, 1);
        (uint256 lowE2, uint256 highE2) = hook.currentBandPointsE2();
        assertApproxEqAbs(lowE2, 9500, 1);
        assertApproxEqAbs(highE2, 10_500, 1);

        _expectOutOfBand(10_600); // pool at 110 is outside 95-105; a swap that stays outside reverts
        _swapToPoints(10_400);
        _expectOutOfBand(9400);
    }

    // ---------------------------------------------------------------- directional (mode 2)

    /// @dev plan.md §12: pool 108, ref 110 -> 90 with mode=2; a buy to 111 widens the gap and reverts, the
    ///      arb sell to 98 passes.
    function test_directional_wideningBuyReverts_arbSellPasses() public {
        _swapToPoints(10_800);
        _endListingDay();
        _setPolicy(9000, 2);

        uint160 pre = _sqrtPrice(manager, key);
        uint160 post = _sqrtAt(11_100);
        _swapTo(swapRouter, manager, key, trader, post, _directionalRevert(pre, post, _sqrtAt(9000)));

        _swapToPoints(9800);
    }

    /// @dev The same in-band buy passes in normal mode and reverts in directional mode.
    function test_directional_rejectsInBandWideningThatNormalModeAllows() public {
        _endListingDay();
        _setPolicy(9000, 0); // band 72-108
        _swapToPoints(10_000);
        _swapToPoints(10_500);

        _setPolicy(9000, 2);
        _swapToPoints(10_000); // narrowing: fine
        uint160 pre = _sqrtPrice(manager, key);
        uint160 post = _sqrtAt(10_500);
        _swapTo(swapRouter, manager, key, trader, post, _directionalRevert(pre, post, _sqrtAt(9000)));
        assertApproxEqAbs(_pointsNow(), 10_000, 1);
    }

    function test_directional_wideningInsideSurveillanceBandAllowed() public {
        _endListingDay();
        _setPolicy(9000, 2); // tolerance 85.5-94.5
        _swapToPoints(9200);
        _swapToPoints(9400); // widening but still within 5% of the reference
        uint160 pre = _sqrtPrice(manager, key);
        uint160 post = _sqrtAt(9500);
        _swapTo(swapRouter, manager, key, trader, post, _directionalRevert(pre, post, _sqrtAt(9000)));
        _swapToPoints(8600); // crosses the reference: the gap grows from 4.4% to 4.7%, still inside the tolerance
    }

    // ---------------------------------------------------------------- halt and cool-off

    function test_halted_swapsRevert_addAndRemoveLiquidityWork() public {
        vm.prank(policyOwner);
        policy.setHalted(true);

        bytes memory halted = abi.encodeWithSelector(IListingHook.Halted.selector);
        _expectBeforeSwapRevert(11_200, halted);
        _expectBeforeSwapRevert(10_800, halted);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 smeBefore = sme.balanceOf(address(this));
        _addLiquidity(int256(LIQUIDITY / 2));
        assertLt(usdc.balanceOf(address(this)), usdcBefore, "add pulled USDC");
        assertLt(sme.balanceOf(address(this)), smeBefore, "add pulled shares");
        _addLiquidity(-int256(LIQUIDITY));
        assertGt(usdc.balanceOf(address(this)), usdcBefore, "remove returned USDC");
        assertGt(sme.balanceOf(address(this)), smeBefore, "remove returned shares");

        vm.prank(policyOwner);
        policy.setHalted(false);
        _swapToPoints(11_200);
    }

    function test_halted_alsoAfterListingDay() public {
        _endListingDay();
        vm.prank(policyOwner);
        policy.setHalted(true);
        _expectBeforeSwapRevert(11_200, abi.encodeWithSelector(IListingHook.Halted.selector));
    }

    function test_coolOff_swapsRevertUntilTimestamp() public {
        ListingPolicy memory p;
        p.version = 1;
        p.coolOffUntil = uint64(block.timestamp + 1 hours);
        vm.prank(policyOwner);
        policy.setPolicy(p);

        _expectBeforeSwapRevert(11_200, abi.encodeWithSelector(IListingHook.CoolingOff.selector, p.coolOffUntil));
        vm.warp(p.coolOffUntil);
        _swapToPoints(11_200);
    }

    // ---------------------------------------------------------------- policy source

    function test_setPolicySource_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(IListingHook.OnlyOwner.selector);
        hook.setPolicySource(IListingPolicy(address(0)));

        vm.prank(policyOwner);
        policy.setHalted(true);
        vm.expectEmit(address(hook));
        emit IListingHook.PolicySourceSet(address(0));
        vm.prank(hookOwner);
        hook.setPolicySource(IListingPolicy(address(0)));
        assertEq(address(hook.policySource()), address(0));
        // No source: defaults, so trading is open again.
        _swapToPoints(11_200);
    }

    function test_effectivePolicy_fillsDefaultsAndSanitizes() public {
        ListingPolicy memory p;
        p.version = 3;
        p.normalBandBps = 10_000;
        p.mode = 7;
        vm.prank(policyOwner);
        policy.setPolicy(p);

        ListingPolicy memory e = hook.effectivePolicy();
        assertEq(e.version, 3);
        assertEq(e.refSqrtPriceX96, hook.listingSqrtPriceX96());
        assertEq(e.normalBandBps, hook.DEFAULT_NORMAL_BAND_BPS());
        assertEq(e.survBandBps, hook.DEFAULT_SURVEILLANCE_BAND_BPS());
        assertEq(e.mode, hook.MODE_NORMAL());
    }

    function test_constructor_rejectsInvalidConfig() public {
        ListingHookConfig memory c = _config();
        c.listingDayBandBps = 10_000;
        _assertConstructorReverts(c, abi.encodeWithSelector(IListingHook.InvalidConfig.selector));

        c = _config();
        c.token = c.usdc;
        _assertConstructorReverts(c, abi.encodeWithSelector(IListingHook.InvalidConfig.selector));
    }

    /// @dev Runs the constructor at a flag-valid address (like `deployCodeTo`) but keeps the revert data.
    function _assertConstructorReverts(ListingHookConfig memory c, bytes memory expected) internal {
        vm.etch(HOOK2, abi.encodePacked(type(ListingHook).creationCode, abi.encode(manager, strategy, c)));
        (bool ok, bytes memory ret) = HOOK2.call("");
        assertFalse(ok);
        assertEq(ret, expected);
    }

    function test_poolId_matchesKey() public view {
        PoolKey memory k = hook.poolKey();
        assertEq(address(k.hooks), address(hook));
        assertEq(k.fee, FEE);
        assertEq(k.tickSpacing, TICK_SPACING);
        assertEq(Currency.unwrap(k.currency0) == address(usdc), usdc0);
    }
}

contract ListingHookUsdcCurrency0Test is ListingHookTestBase {
    function usdcIsCurrency0() internal pure override returns (bool) {
        return true;
    }
}

contract ListingHookUsdcCurrency1Test is ListingHookTestBase {
    function usdcIsCurrency0() internal pure override returns (bool) {
        return false;
    }
}

/// @notice The mined-address path used on Sepolia: HookMiner finds a CREATE2 salt whose address encodes the flags.
contract ListingHookMinerTest is PoolActions {
    function test_hookMiner_minedSaltDeploysListingHook() public {
        IPoolManager manager = new PoolManager(address(this));
        TestUSDC usdc = new TestUSDC();
        MockSME sme = new MockSME("Acme SME", "ACME", address(this));
        ListingHookConfig memory c = ListingHookConfig({
            owner: address(this),
            usdc: address(usdc),
            token: address(sme),
            fee: 3000,
            tickSpacing: 60,
            listingDayBandBps: 500,
            listingDayDuration: 1 days,
            policySource: IListingPolicy(address(0))
        });
        address strategy = makeAddr("lbpStrategy");
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
        );
        (address mined, bytes32 salt) =
            HookMiner.find(address(this), flags, type(ListingHook).creationCode, abi.encode(manager, strategy, c));
        ListingHook hook = new ListingHook{salt: salt}(manager, strategy, c);
        assertEq(address(hook), mined);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, flags);
        assertEq(hook.authorized(), strategy);
    }
}
