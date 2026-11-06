// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ListingPolicy} from "../ListingPolicyReceiver.sol";

/// @title IListingPolicyReceiver
/// @notice Interface for ListingPolicyReceiver (used by ListingHook and the frontend).
interface IListingPolicyReceiver {
    error InvalidChainSelector(uint64 expected, uint64 received);
    error StalePolicy(uint32 version, uint64 asOf, uint64 lastAsOf);
    error OnlyBroadcaster(address caller, address txOrigin, address expected);

    event PolicyApplied(
        uint32 indexed version,
        uint64 asOf,
        uint160 refSqrtPriceX96,
        uint16 normalBandBps,
        uint16 survBandBps,
        uint8 mode,
        bool halted,
        uint64 coolOffUntil
    );

    function broadcaster() external view returns (address);
    function ensName() external view returns (bytes memory);
    function policy() external view returns (ListingPolicy memory);
    function lastAsOf(uint32 version) external view returns (uint64);
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
