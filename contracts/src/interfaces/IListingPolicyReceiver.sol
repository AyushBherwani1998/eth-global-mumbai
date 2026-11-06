// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IListingPolicy, ListingPolicy} from "./IListingPolicy.sol";
import {IReceiver} from "./IReceiver.sol";
import {IStatusResolver} from "./IStatusResolver.sol";

/// @title IListingPolicyReceiver
/// @notice CRE consumer that stores the `ListingPolicy` read by `ListingHook` (plan.md §6).
/// @dev Report payload: `abi.encode(ListingPolicy policy, string status)`. `policy.version` in the report is
///      ignored (the receiver numbers applied reports itself); `status` is the ENS `listingday.status` value, or
///      empty to derive it from the policy (`halted` when halted or cooling off, `surveillance` in mode 1 or 2,
///      else `listed`).
///      `onReport` reverts on every rejected report. The CRE forwarders swallow that revert and emit
///      `ReportProcessed(receiver, workflowExecutionId, reportId, false)`, so a mined tx is not success:
///      check `ReportProcessed.result` or this contract's `PolicyApplied`.
interface IListingPolicyReceiver is IReceiver, IListingPolicy {
    /// @notice `onReport` caller is not the configured CRE forwarder.
    error InvalidSender(address sender, address expected);
    /// @notice Hackathon guard: the transaction was not sent by the configured CRE broadcaster key.
    error InvalidOrigin(address origin, address expected);
    /// @notice The report targets another chain.
    error WrongChainSelector(uint64 chainSelector, uint64 expected);
    /// @notice `asOf` is not newer than the stored policy's (replay or out-of-order report).
    error StaleReport(uint64 asOf, uint64 lastAsOf);
    /// @notice `asOf` is more than `maxAge` seconds old when the report lands.
    error ReportExpired(uint64 asOf, uint64 maxAge);
    /// @notice `asOf` is more than `MAX_FUTURE_SKEW` ahead of the block (it would block later reports).
    error ReportFromFuture(uint64 asOf, uint256 blockTimestamp);
    /// @notice A band is >= 100% or the mode is not 0, 1 or 2.
    error InvalidPolicy();
    /// @notice The status string is longer than `MAX_STATUS_LENGTH` bytes.
    error InvalidStatus();
    error OnlyOwner();
    error ZeroAddress();
    /// @notice `maxAge` is zero.
    error InvalidMaxAge();
    error Reentrancy();

    /// @notice A report was accepted. `policy.version` is the receiver-assigned version.
    event PolicyApplied(uint32 indexed version, ListingPolicy policy, string status);
    /// @notice `listingday.status` was written to the ENS resolver.
    event StatusMirrored(address indexed resolver, string status);
    /// @notice The ENS write failed (no code, revert or out of gas); the policy was still applied.
    event StatusMirrorFailed(address indexed resolver, string status, bytes reason);
    event ForwarderSet(address indexed forwarder);
    event BroadcasterSet(address indexed broadcaster);
    event MaxAgeSet(uint64 maxAge);
    event StatusMirrorSet(address indexed resolver, bytes name);

    function owner() external view returns (address);
    /// @notice CRE chain selector reports must carry (16015286601757825753 on Sepolia).
    function chainSelector() external view returns (uint64);
    /// @notice The only `onReport` caller (Sepolia MockKeystoneForwarder for `cre workflow simulate`).
    function forwarder() external view returns (address);
    /// @notice Required `tx.origin` (the `CRE_ETH_PRIVATE_KEY` address); address(0) disables the check.
    function broadcaster() external view returns (address);
    /// @notice Seconds after `asOf` until a policy is stale.
    function maxAge() external view returns (uint64);
    /// @notice ENS resolver for the status mirror; address(0) = mirror off.
    function statusResolver() external view returns (IStatusResolver);
    /// @notice DNS-encoded ENS name whose `listingday.status` is mirrored (e.g. acme.listingday.eth).
    function statusName() external view returns (bytes memory);
    /// @notice keccak256 of the last status successfully written to ENS.
    function mirroredStatusHash() external view returns (bytes32);
    /// @notice Status of the last applied report (explicit or derived).
    function status() external view returns (string memory);

    /// @notice The stored policy exactly as last applied, without the staleness rule.
    function latestPolicy() external view returns (ListingPolicy memory);
    /// @notice True once a policy exists and `block.timestamp > asOf + maxAge`.
    function isStale() external view returns (bool);
    /// @notice First timestamp at which the current policy is stale (0 before the first report).
    function staleAt() external view returns (uint256);

    /// @notice Permissionless: re-sends the current status to ENS if it differs from the last mirrored one.
    function syncStatus() external;

    function setForwarder(address forwarder_) external;
    function setBroadcaster(address broadcaster_) external;
    function setMaxAge(uint64 maxAge_) external;
    function setStatusMirror(IStatusResolver resolver, bytes calldata name) external;
}
