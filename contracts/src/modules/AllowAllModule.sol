// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IEligibilityModule} from "../interfaces/IEligibilityModule.sol";

/// @title AllowAllModule
/// @notice Phase 1 eligibility: any wallet may bid, up to a cumulative budget cap per wallet.
/// @dev The total only ever grows. Exits and refunds do not reduce it (deliberately simple, plan.md §4).
///      The hook has already enforced `sender == owner`, so the key is the bid owner.
contract AllowAllModule is IEligibilityModule {
    /// @notice Thrown by the constructor for a zero hook address.
    error ZeroAddress();
    /// @notice Thrown by the constructor for a zero cap.
    error InvalidCap();

    /// @notice Emitted on every accepted bid.
    /// @param owner Bid owner (the wallet whose cap is used).
    /// @param amount Budget of this bid (raw currency units).
    /// @param total Cumulative committed budget of `owner` after this bid.
    event BudgetCommitted(address indexed owner, uint128 amount, uint256 total);

    /// @inheritdoc IEligibilityModule
    address public immutable hook;
    /// @notice Per-wallet cumulative cap in raw currency units (20e6 = 20 USDC for the demo).
    uint256 public immutable cap;
    /// @notice Cumulative committed budget per wallet.
    mapping(address owner => uint256) public committed;

    /// @param hook_ The `AuctionValidationHook` that will call `check` (predict it before deploying the hook).
    /// @param cap_ Per-wallet cumulative cap in raw currency units.
    constructor(address hook_, uint256 cap_) {
        if (hook_ == address(0)) revert ZeroAddress();
        if (cap_ == 0) revert InvalidCap();
        hook = hook_;
        cap = cap_;
    }

    /// @inheritdoc IEligibilityModule
    function check(address owner, address, uint128 amount, bytes calldata) external {
        if (msg.sender != hook) revert OnlyHook();
        uint256 newTotal = committed[owner] + amount;
        if (newTotal > cap) revert CapExceeded(newTotal, cap);
        committed[owner] = newTotal;
        emit BudgetCommitted(owner, amount, newTotal);
    }

    /// @notice Budget `owner` can still commit.
    function remaining(address owner) external view returns (uint256) {
        uint256 used = committed[owner];
        return used >= cap ? 0 : cap - used;
    }
}
