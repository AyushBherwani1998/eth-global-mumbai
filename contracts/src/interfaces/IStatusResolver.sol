// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IStatusResolver
/// @notice The one ENSv2 resolver setter `ListingPolicyReceiver` uses to mirror `listingday.status`.
/// @dev Same signature as the Sepolia ENSv2 `PermissionedResolverImpl` (0x115e…2b2c, contracts-v2 tag
///      `v2-mainnet-deployment-1`): the name is DNS-encoded, not a bytes32 node.
interface IStatusResolver {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
}
