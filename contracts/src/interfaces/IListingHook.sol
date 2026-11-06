// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title IListingHook
/// @notice Interface for ListingHook (errors and events for the frontend ABI).
interface IListingHook {
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

    function policyReceiver() external view returns (address);
    function quoteCurrency() external view returns (address);
    function listingSqrtPriceX96(PoolId poolId) external view returns (uint160);
    function usdcIsCurrency0(PoolId poolId) external view returns (bool);
    function listingDay(PoolId poolId) external view returns (bool);
    function listingDayLowerBand(PoolId poolId) external view returns (uint160);
    function listingDayUpperBand(PoolId poolId) external view returns (uint160);
    function endListingDay(PoolId poolId) external;
}
