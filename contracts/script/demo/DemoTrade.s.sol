// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

/// @notice Step 5a: swaps through the ListingHook pool (plan.md §12): an in-band buy to 114 points passes, a buy
///         to 117 points (above the 104.5-115.5 listing-day band) reverts `OutOfBand`.
///
///   DEMO_WALLET_KEYS=0x…,… [TRADER_INDEX=5] [IN_BAND_POINTS=114] [OUT_OF_BAND_POINTS=117] \
///   forge script script/demo/DemoTrade.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Swaps go through v4-core's `PoolSwapTest` router (CREATE2, shared by all listings), which takes a price limit.
/// The app uses the Universal Router instead. Forge can't broadcast a reverting tx, so the out-of-band buy is
/// simulated from the trader against the live state and its revert reason is decoded, logged and saved. The log
/// also prints a `cast send` with a fixed gas limit that puts the same revert onchain, for the explorer.
/// Idempotent: the in-band buy is skipped once the pool is at or above the target.
contract DemoTrade is DemoBase {
    using StateLibrary for IPoolManager;

    struct OutOfBand {
        uint256 targetPoints;
        bytes revertData;
        bytes reason;
        uint160 lo;
        uint160 hi;
        string cast;
    }

    function run() external {
        _step("DemoTrade");
        Deployment memory d = _load();
        require(d.hook.listed(), "pool not listed: run DemoSettle after migrationBlock");
        uint256 traderKey = _traderKey();
        address trader = vm.addr(traderKey);
        console2.log("trader", trader);
        console2.log("phase (0 NotListed, 1 ListingDay, 2 Normal)", uint8(d.hook.phase()));
        (uint256 lowE2, uint256 highE2) = d.hook.currentBandPointsE2();
        console2.log(string.concat("band: ", _fmtE2(lowE2), " - ", _fmtE2(highE2), " points"));
        require(IERC20(Sepolia.USDC).balanceOf(trader) >= 1e6, "trader needs >= 1 USDC: make fund");
        require(trader.balance >= 0.002 ether, "trader needs Sepolia ETH: make fund");

        vm.startBroadcast(_deployerKey());
        (address routerAddr, bool fresh) = _create2(
            keccak256("listing-day/PoolSwapTest"),
            abi.encodePacked(type(PoolSwapTest).creationCode, abi.encode(Sepolia.POOL_MANAGER))
        );
        if (fresh) _tx("PoolSwapTest router (CREATE2)");
        vm.stopBroadcast();

        uint256 inBand = vm.envOr("IN_BAND_POINTS", uint256(114));
        uint256 afterE2 = _inBandBuy(d, traderKey, routerAddr, inBand);
        OutOfBand memory o = _outOfBandBuy(d, trader, routerAddr, vm.envOr("OUT_OF_BAND_POINTS", uint256(117)));
        _save(d, PoolSwapTest(payable(routerAddr)), trader, inBand, afterE2, o);
    }

    function _inBandBuy(Deployment memory d, uint256 traderKey, address router, uint256 inBand)
        internal
        returns (uint256 afterE2)
    {
        address trader = vm.addr(traderKey);
        vm.startBroadcast(traderKey);
        if (IERC20(Sepolia.USDC).allowance(trader, router) < 1e12) {
            _tx("USDC.approve(router, max) (trader)");
            IERC20(Sepolia.USDC).approve(router, type(uint256).max);
        }
        if (d.token.allowance(trader, router) < 1e30) {
            _tx("MockSME.approve(router, max) (trader)");
            d.token.approve(router, type(uint256).max);
        }
        if (_pointsE2(d.hook) + 50 < inBand * 100) {
            _tx(string.concat("PoolSwapTest.swap: buy ACME to ", vm.toString(inBand), " points (in band)"));
            (bool ok,) =
                router.call(_swapCall(d.hook.poolKey(), _sqrt(d), _pointsSqrt(inBand, d.hook.usdcIsCurrency0())));
            require(ok, "in-band buy reverted");
        } else {
            console2.log("pool already at/above the in-band target: skip the buy");
        }
        vm.stopBroadcast();
        afterE2 = _pointsE2(d.hook);
        _logPointsE2("after the in-band buy", afterE2);
        require(afterE2 + 50 >= inBand * 100, "in-band buy did not reach the target");
    }

    function _outOfBandBuy(Deployment memory d, address trader, address router, uint256 target)
        internal
        returns (OutOfBand memory o)
    {
        bool usdc0 = d.hook.usdcIsCurrency0();
        o.targetPoints = target;
        bytes memory call = _swapCall(d.hook.poolKey(), _sqrt(d), _pointsSqrt(target, usdc0));
        bool passed;
        (passed, o.revertData) = _simulate(trader, router, call);
        require(!passed, "out-of-band buy did NOT revert");
        o.reason = _unwrapHookRevert(o.revertData);
        require(_selector(o.reason) == IListingHook.OutOfBand.selector, "expected OutOfBand from the ListingHook");
        uint160 post;
        (post, o.lo, o.hi) = abi.decode(_stripSelector(o.reason), (uint160, uint160, uint160));
        console2.log(
            string.concat("buy to ", vm.toString(target), " points reverts: OutOfBand(sqrtPriceX96, min, max)")
        );
        _logPointsE2("  would have landed at", ListingPrice.sqrtPriceX96ToPointsE2(post, usdc0));
        console2.log("  revert data:");
        console2.logBytes(o.revertData);
        o.cast = string.concat(
            "cast send ",
            vm.toString(router),
            " ",
            vm.toString(call),
            " --gas-limit 600000 --private-key $TRADER_KEY --rpc-url $SEPOLIA_RPC_URL"
        );
        console2.log("  to put the revert onchain (the tx fails by design):");
        console2.log(string.concat("  ", o.cast));
    }

    function _sqrt(Deployment memory d) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = IPoolManager(Sepolia.POOL_MANAGER).getSlot0(d.hook.poolId());
    }

    function _stripSelector(bytes memory data) internal pure returns (bytes memory body) {
        body = new bytes(data.length - 4);
        for (uint256 i; i < body.length; i++) {
            body[i] = data[i + 4];
        }
    }

    function _save(
        Deployment memory d,
        PoolSwapTest router,
        address trader,
        uint256 inBand,
        uint256 afterE2,
        OutOfBand memory o
    ) internal {
        bool usdc0 = d.hook.usdcIsCurrency0();
        string memory t = "trade";
        vm.serializeAddress(t, "swapRouter", address(router));
        vm.serializeAddress(t, "trader", trader);
        vm.serializeUint(t, "inBandTargetPoints", inBand);
        vm.serializeUint(t, "pointsE2AfterInBandBuy", afterE2);
        vm.serializeUint(t, "outOfBandTargetPoints", o.targetPoints);
        vm.serializeString(t, "outOfBandError", "OutOfBand(uint160,uint160,uint160)");
        vm.serializeBytes(t, "outOfBandRevertData", o.revertData);
        vm.serializeBytes(t, "outOfBandHookReason", o.reason);
        // With USDC as currency0 the lower sqrt bound is the higher share price.
        (uint160 forLow, uint160 forHigh) = usdc0 ? (o.hi, o.lo) : (o.lo, o.hi);
        vm.serializeUint(t, "bandLowPointsE2", ListingPrice.sqrtPriceX96ToPointsE2(forLow, usdc0));
        vm.serializeUint(t, "bandHighPointsE2", ListingPrice.sqrtPriceX96ToPointsE2(forHigh, usdc0));
        t = vm.serializeString(t, "outOfBandCastCommand", o.cast);
        _writeSection("trade", t);
    }
}
