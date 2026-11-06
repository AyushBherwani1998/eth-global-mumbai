// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IListingPolicy, ListingPolicy} from "./IListingPolicy.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

/// @notice Constructor parameters of `ListingHook` (everything except the PoolManager and LBPStrategy).
struct ListingHookConfig {
    /// @notice May call `setPolicySource`.
    address owner;
    /// @notice Quote currency (Sepolia USDC).
    address usdc;
    /// @notice Listed share token (MockSME).
    address token;
    /// @notice LP fee of the one pool this hook serves (`MigratorParameters.poolParameters.fee`).
    uint24 fee;
    /// @notice Tick spacing of that pool (`MigratorParameters.poolParameters.tickSpacing`).
    int24 tickSpacing;
    /// @notice Listing-day band half-width in bps of the share price (500 = ±5%).
    uint16 listingDayBandBps;
    /// @notice Listing-day window length in seconds, counted from pool initialization.
    uint32 listingDayDuration;
    /// @notice Initial policy source; address(0) = defaults until `setPolicySource`.
    IListingPolicy policySource;
}

/// @title IListingHook
/// @notice Listing Day v4 hook: price bands, surveillance / directional modes, halt and cool-off.
/// @dev Pool callbacks revert inside the PoolManager, which wraps them as
///      `WrappedError(hook, IHooks.afterSwap.selector, reason, HookCallFailed())`; `reason` is an error below.
interface IListingHook {
    enum Phase {
        NotListed,
        ListingDay,
        Normal
    }

    /// @notice Pool key is not the one pool this hook was deployed for.
    error PoolKeyMismatch();
    /// @notice `afterInitialize` ran twice (cannot happen for a pinned key; defensive).
    error AlreadyListed();
    /// @notice Trading is halted by the policy.
    error Halted();
    /// @notice Trading is in a timed cool-off until `until`.
    error CoolingOff(uint64 until);
    /// @notice The swap would leave the pool outside the active band.
    error OutOfBand(uint160 sqrtPriceX96, uint160 sqrtPriceMinX96, uint160 sqrtPriceMaxX96);
    /// @notice Directional mode: the swap moves the price further from the reference, beyond the surveillance band.
    error DirectionalWidening(uint160 preSqrtPriceX96, uint160 postSqrtPriceX96, uint160 refSqrtPriceX96);
    /// @notice Caller is not the owner.
    error OnlyOwner();
    /// @notice Bad constructor config (zero/equal tokens, band >= 100%).
    error InvalidConfig();

    /// @notice The pool was initialized by LBPStrategy at the auction clearing price.
    event Listed(
        PoolId indexed poolId,
        uint160 listingSqrtPriceX96,
        int24 tick,
        bool usdcIsCurrency0,
        uint64 listingDayEndsAt,
        uint160 listingDaySqrtPriceMinX96,
        uint160 listingDaySqrtPriceMaxX96
    );
    /// @notice The policy source changed (e.g. from the mock to the CRE receiver).
    event PolicySourceSet(address indexed policySource);

    function owner() external view returns (address);
    function usdc() external view returns (address);
    function token() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function listingDayBandBps() external view returns (uint16);
    function listingDayDuration() external view returns (uint32);
    /// @notice Id of the one pool this hook serves (known before the pool exists).
    function poolId() external view returns (PoolId);
    /// @notice Key of the one pool this hook serves.
    function poolKey() external view returns (PoolKey memory);
    function policySource() external view returns (IListingPolicy);

    function listed() external view returns (bool);
    /// @notice True when USDC is currency0, i.e. the pool price is shares per USDC (higher share price = lower sqrt).
    function usdcIsCurrency0() external view returns (bool);
    function listedAt() external view returns (uint64);
    function listingDayEndsAt() external view returns (uint64);
    /// @notice Pool price at initialization (the CCA clearing price).
    function listingSqrtPriceX96() external view returns (uint160);
    function listingTick() external view returns (int24);
    function listingDaySqrtPriceMinX96() external view returns (uint160);
    function listingDaySqrtPriceMaxX96() external view returns (uint160);

    /// @notice NotListed before migration, ListingDay until `listingDayEndsAt`, Normal after.
    function phase() external view returns (Phase);
    /// @notice The policy with defaults filled in (reference = listing price if unset, bands, sanitized mode).
    function effectivePolicy() external view returns (ListingPolicy memory);
    /// @notice The band enforced on the next swap, as pool sqrtPriceX96 bounds.
    function currentBand() external view returns (uint160 sqrtPriceMinX96, uint160 sqrtPriceMaxX96);
    /// @notice The band enforced on the next swap as share prices in points x100 (10_450 = 1.045 USDC / lot).
    function currentBandPointsE2() external view returns (uint256 lowPointsE2, uint256 highPointsE2);
    /// @notice Current pool share price in points x100 (11_000 = 1.10 USDC / lot).
    function currentPointsE2() external view returns (uint256);

    /// @notice Owner-only: switch the policy source (e.g. to the CRE receiver).
    function setPolicySource(IListingPolicy policySource_) external;
}
