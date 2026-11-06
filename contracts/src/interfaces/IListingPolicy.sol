// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Trading policy for a listed pool (plan.md §6 `ListingPolicy`). Published by the CRE receiver
///         (`ListingPolicyReceiver`) or, for tests and manual demos, by `MockListingPolicy`.
/// @dev Zero values mean "use the ListingHook default", so an unpublished policy (`version == 0`) is a plain
///      20% band around the listing price with trading open.
struct ListingPolicy {
    /// @notice Policy version; 0 = nothing published yet (the hook then uses its defaults for every field).
    uint32 version;
    /// @notice Timestamp of the source data. Freshness (`maxAge`) is the receiver's job (a stale receiver policy
    ///         reads as halted); the hook does not check it.
    uint64 asOf;
    /// @notice CRE chain selector the report targets (16015286601757825753 for Sepolia).
    uint64 chainSelector;
    /// @notice Reference price as the pool's own sqrtPriceX96 (currency1 per currency0, so mind
    ///         `ListingHook.usdcIsCurrency0`; use `ListingPrice.pointsToSqrtPriceX96`). 0 = the listing price.
    uint160 refSqrtPriceX96;
    /// @notice Normal band half-width around the reference, in bps of the share price. 0 = 2000 (20%).
    uint16 normalBandBps;
    /// @notice Surveillance band half-width (mode 1, and the directional-mode tolerance). 0 = 500 (5%).
    uint16 survBandBps;
    /// @notice 0 = normal, 1 = surveillance, 2 = directional. Unknown values behave as normal.
    uint8 mode;
    /// @notice Trading halt: every swap reverts, liquidity changes still work.
    bool halted;
    /// @notice Timed cool-off: swaps revert while `block.timestamp < coolOffUntil`.
    uint64 coolOffUntil;
}

/// @title IListingPolicy
/// @notice Policy source read by `ListingHook` on every swap.
interface IListingPolicy {
    /// @notice The current policy.
    function policy() external view returns (ListingPolicy memory);
}
