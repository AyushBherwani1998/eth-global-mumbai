// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

/// @notice Swap-to-price helpers and v4 hook-revert encoding shared by ListingHook unit and fork tests.
abstract contract PoolActions is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    /// @dev Large exact-input amount: the swap stops at the price limit and only pays what that takes.
    int256 internal constant SWAP_TO_LIMIT = -1e30;

    function _sqrtPrice(IPoolManager manager, PoolKey memory key) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(key.toId());
    }

    /// @notice Swaps from `trader` until the pool reaches `target` (a v4 sqrtPriceX96).
    function _swapTo(PoolSwapTest router, IPoolManager manager, PoolKey memory key, address trader, uint160 target)
        internal
    {
        _swapTo(router, manager, key, trader, target, "");
    }

    /// @notice Same, expecting the swap to revert with `revertData` (skipped when empty).
    function _swapTo(
        PoolSwapTest router,
        IPoolManager manager,
        PoolKey memory key,
        address trader,
        uint160 target,
        bytes memory revertData
    ) internal {
        bool zeroForOne = target < _sqrtPrice(manager, key);
        vm.prank(trader);
        if (revertData.length != 0) vm.expectRevert(revertData);
        router.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: SWAP_TO_LIMIT, sqrtPriceLimitX96: target}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @notice What the PoolManager reverts with when `hook` reverts with `reason` inside `hookSelector`.
    function _hookRevert(address hook, bytes4 hookSelector, bytes memory reason) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            hook,
            hookSelector,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    function _outOfBand(address hook, uint160 post, uint160 lo, uint160 hi) internal pure returns (bytes memory) {
        return _hookRevert(
            hook, IHooks.afterSwap.selector, abi.encodeWithSelector(IListingHook.OutOfBand.selector, post, lo, hi)
        );
    }
}
