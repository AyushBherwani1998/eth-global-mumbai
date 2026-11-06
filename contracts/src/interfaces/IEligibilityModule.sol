// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IEligibilityModule
/// @notice Pluggable per-bid eligibility check behind `AuctionValidationHook`.
interface IEligibilityModule {
    /// @notice Caller is not the bound `AuctionValidationHook`.
    error OnlyHook();
    /// @notice The bid would take the applicant's cumulative committed budget above the cap.
    /// @param newTotal Committed budget including this bid (raw currency units).
    /// @param cap Per-applicant cap (raw currency units).
    error CapExceeded(uint256 newTotal, uint256 cap);

    /// @notice The only address allowed to call `check`.
    function hook() external view returns (address);

    /// @notice MUST revert to reject the bid. Non-view: may record usage.
    /// @dev Called by the hook after it has checked `msg.sender == auction` and `sender == owner`.
    function check(address owner, address sender, uint128 amount, bytes calldata hookData) external;
}
