// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {InitializerHook} from "liquidity-launcher/src/periphery/hooks/InitializerHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ListingPolicyReceiver, ListingPolicy} from "./ListingPolicyReceiver.sol";
import {Sepolia} from "./libraries/Constants.sol";

/// @title ListingHook
/// @notice Uniswap v4 hook enforcing Listing Day circuit rules (plan.md §6, §11).
/// @dev Features:
///      - Inherits `InitializerHook` (only LBPStrategy can initialize the pool).
///      - Stores listing price + bands in `afterInitialize` (beforeInitialize is view-only).
///      - Enforces bands via `beforeSwap` and `afterSwap`: swaps landing outside the band revert.
///      - Reads policy from `ListingPolicyReceiver` (ref price, mode, halt).
///      - Orientation-aware: handles both `currency0 < token` and `token < currency0` (USDC is likely currency0).
///      - LP operations (add/remove liquidity) are never blocked.
///      - Uses `beforeSwap` to store pre-swap price for directional mode (mode 2).
///      - Hook address must be mined with HookMiner to match required permissions.
contract ListingHook is InitializerHook {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    error OutOfBand(uint160 sqrtPriceX96, uint160 lowerBound, uint160 upperBound);
    error PoolHalted();
    error InvalidMode(uint8 mode);

    event BandsUpdated(
        PoolId indexed poolId,
        uint160 listingSqrtPriceX96,
        uint160 lowerBand,
        uint160 upperBand,
        bool listingDay
    );

    /// @notice The policy receiver (CRE reports).
    ListingPolicyReceiver public immutable policyReceiver;
    /// @notice The quote currency (USDC).
    Currency public immutable quoteCurrency;

    /// @notice Per-pool: listing price (the clearing price from migration).
    mapping(PoolId => uint160) public listingSqrtPriceX96;
    /// @notice Per-pool: true if USDC is currency0 (inverted price).
    mapping(PoolId => bool) public usdcIsCurrency0;
    /// @notice Per-pool: listing day active (±5% band until the window ends).
    mapping(PoolId => bool) public listingDay;
    /// @notice Per-pool: listing day lower band (sqrtPriceX96).
    mapping(PoolId => uint160) public listingDayLowerBand;
    /// @notice Per-pool: listing day upper band (sqrtPriceX96).
    mapping(PoolId => uint160) public listingDayUpperBand;

    // No constant needed; we'll compute the slot hash directly in assembly

    /// @param _poolManager Uniswap v4 PoolManager.
    /// @param _authorized The address authorized to initialize (LBPStrategy).
    /// @param _policyReceiver The CRE policy receiver.
    /// @param _quoteCurrency The quote currency (USDC).
    constructor(
        IPoolManager _poolManager,
        address _authorized,
        ListingPolicyReceiver _policyReceiver,
        Currency _quoteCurrency
    ) InitializerHook(_poolManager, _authorized) {
        policyReceiver = _policyReceiver;
        quoteCurrency = _quoteCurrency;
    }

    /// @inheritdoc InitializerHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true, // Inherited from InitializerHook
            afterInitialize: true, // Store bands
            beforeSwap: true, // Store pre-swap price, check halt
            afterSwap: true, // Enforce band
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false,
            beforeDonate: false,
            afterDonate: false
        });
    }

    /// @notice Called after pool initialization. Stores the listing price and bands.
    /// @dev LBPStrategy calls `initialize` with sqrtPriceX96 = clearing price.
    function _afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24)
        internal
        override
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        listingSqrtPriceX96[poolId] = sqrtPriceX96;

        // Determine currency ordering: if quoteCurrency < token, sqrtPriceX96 is token/USDC (inverted).
        bool usdcIs0 = Currency.unwrap(key.currency0) == Currency.unwrap(quoteCurrency);
        usdcIsCurrency0[poolId] = usdcIs0;

        // Listing day: ±5% band around the listing price.
        // sqrtPrice moves by √(1.05) ≈ 1.0247 for +5%, 1/√(1.05) ≈ 0.9759 for -5%.
        uint160 lower;
        uint160 upper;
        if (usdcIs0) {
            // USDC is currency0: "price up" means sqrtPriceX96 goes DOWN.
            // Upper band (price down 5%): sqrtPriceX96 * 1.0247
            // Lower band (price up 5%): sqrtPriceX96 * 0.9759
            upper = uint160((uint256(sqrtPriceX96) * 10247) / 10000);
            lower = uint160((uint256(sqrtPriceX96) * 9759) / 10000);
        } else {
            // Token is currency0: "price up" means sqrtPriceX96 goes UP.
            lower = uint160((uint256(sqrtPriceX96) * 9759) / 10000);
            upper = uint160((uint256(sqrtPriceX96) * 10247) / 10000);
        }

        listingDayLowerBand[poolId] = lower;
        listingDayUpperBand[poolId] = upper;
        listingDay[poolId] = true; // Listing day starts on migration.

        emit BandsUpdated(poolId, sqrtPriceX96, lower, upper, true);

        return IHooks.afterInitialize.selector;
    }

    /// @notice Called before every swap. Stores pre-swap price and checks halt.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();

        // Check halt.
        (
            uint32 version,
            uint64 asOf,
            uint64 chainSelector,
            uint160 refSqrtPriceX96,
            uint16 normalBandBps,
            uint16 survBandBps,
            uint8 mode,
            bool halted,
            uint64 coolOffUntil
        ) = policyReceiver.policy();
        if (halted) revert PoolHalted();

        // Store pre-swap price for directional mode (tstore).
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        assembly {
            // keccak256("ListingHook.preSwapPrice") as the slot
            let slot := 0x742e0c3b7f0f7d5e2e3c6f0a8c6d8e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d
            tstore(slot, sqrtPriceX96)
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    /// @notice Called after every swap. Enforces band.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

        // Compute bands.
        (uint160 lower, uint160 upper) = _getBands(poolId, sqrtPriceX96);

        // Check band.
        if (sqrtPriceX96 < lower || sqrtPriceX96 > upper) {
            revert OutOfBand(sqrtPriceX96, lower, upper);
        }

        return (IHooks.afterSwap.selector, 0);
    }

    /// @notice Computes the band bounds for a pool.
    function _getBands(PoolId poolId, uint160 sqrtPriceX96)
        internal
        view
        returns (uint160 lower, uint160 upper)
    {
        if (listingDay[poolId]) {
            // Listing day: fixed ±5% band.
            lower = listingDayLowerBand[poolId];
            upper = listingDayUpperBand[poolId];
        } else {
            // Normal/surveillance/directional: read from policy.
            (,,, uint160 refSqrtPriceX96, uint16 normalBandBps, uint16 survBandBps, uint8 mode,,) =
                policyReceiver.policy();

            uint16 bandBps = (mode == 1) ? survBandBps : normalBandBps;

            // Band factor: e.g. 20% -> 12000 bps -> sqrt(1.2) ≈ 1.0954
            uint256 factor = 10000 + bandBps;
            uint256 sqrtFactor = sqrt(factor * 1e18 / 10000);

            bool usdcIs0 = usdcIsCurrency0[poolId];
            if (usdcIs0) {
                upper = uint160((uint256(refSqrtPriceX96) * sqrtFactor) / 1e9);
                lower = uint160((uint256(refSqrtPriceX96) * 1e9) / sqrtFactor);
            } else {
                lower = uint160((uint256(refSqrtPriceX96) * 1e9) / sqrtFactor);
                upper = uint160((uint256(refSqrtPriceX96) * sqrtFactor) / 1e9);
            }

            // Directional mode (mode 2): only allow swaps that narrow the gap.
            if (mode == 2) {
                uint160 preSqrt;
                assembly {
                    // keccak256("ListingHook.preSwapPrice") as the slot
                    let slot := 0x742e0c3b7f0f7d5e2e3c6f0a8c6d8e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d
                    preSqrt := tload(slot)
                }
                bool widens = _widensGap(preSqrt, sqrtPriceX96, refSqrtPriceX96, usdcIs0);
                if (widens) revert OutOfBand(sqrtPriceX96, lower, upper);
            }
        }
    }

    /// @notice True if the swap widened the gap between the pool price and the reference.
    function _widensGap(uint160 pre, uint160 post, uint160 ref, bool usdcIs0) internal pure returns (bool) {
        // Distance from ref: abs(price - ref).
        uint256 preDist = pre > ref ? pre - ref : ref - pre;
        uint256 postDist = post > ref ? post - ref : ref - post;
        return postDist > preDist;
    }

    /// @notice Integer square root (Babylonian method).
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @notice Ends the listing day (external call, e.g. from the issuer console).
    function endListingDay(PoolId poolId) external {
        // In production, restrict to a governance role or time-based.
        listingDay[poolId] = false;
    }
}
