// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingPolicy, ListingPolicy} from "../interfaces/IListingPolicy.sol";

/// @title MockListingPolicy
/// @notice Owner-settable `IListingPolicy` for tests and manual demos. In the CRE flow,
///         `ListingHook.setPolicySource` points at `ListingPolicyReceiver` instead.
contract MockListingPolicy is IListingPolicy {
    error OnlyOwner();

    event PolicyUpdated(ListingPolicy policy);

    address public immutable owner;
    ListingPolicy internal _policy;

    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address owner_) {
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @inheritdoc IListingPolicy
    function policy() external view returns (ListingPolicy memory) {
        return _policy;
    }

    /// @notice Replaces the whole policy.
    function setPolicy(ListingPolicy calldata policy_) external onlyOwner {
        _policy = policy_;
        emit PolicyUpdated(policy_);
    }

    /// @notice Sets the reference price (pool sqrtPriceX96) and mode, bumping the version.
    function setReference(uint160 refSqrtPriceX96, uint8 mode) external onlyOwner {
        _policy.refSqrtPriceX96 = refSqrtPriceX96;
        _policy.mode = mode;
        _bump();
    }

    /// @notice Halts or resumes trading, bumping the version.
    function setHalted(bool halted) external onlyOwner {
        _policy.halted = halted;
        _bump();
    }

    function _bump() internal {
        _policy.version++;
        // forge-lint: disable-next-line(unsafe-typecast)
        _policy.asOf = uint64(block.timestamp);
        emit PolicyUpdated(_policy);
    }
}
