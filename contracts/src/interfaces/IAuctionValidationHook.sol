// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEligibilityModule} from "./IEligibilityModule.sol";

/// @title IAuctionValidationHook
/// @notice Listing Day CCA validation hook: 190% price cap + pluggable eligibility module.
/// @dev The CCA wraps every revert from `validate` as `ValidationHookCallFailed(bytes reason)`;
///      `reason` is the ABI-encoded error below (or an `IEligibilityModule` error).
interface IAuctionValidationHook {
    /// @notice `validate` was called by an address other than the bound auction (or before `setAuction`).
    error OnlyAuction();
    /// @notice The bid `sender` differs from its `owner`.
    error SenderMustBeOwner();
    /// @notice The bid `maxPrice` is above the 190-point cap.
    error BidAboveCap(uint256 maxPrice, uint256 capQ96);
    /// @notice `setAuction` caller is not the hook deployer.
    error OnlyDeployer();
    /// @notice `setAuction` was already called.
    error AuctionAlreadySet();
    /// @notice A required address argument is zero.
    error ZeroAddress();
    /// @notice The cap passed to the constructor is zero.
    error InvalidCap();
    /// @notice The module's `hook()` is not this contract.
    error ModuleHookMismatch(address moduleHook);
    /// @notice The auction's `validationHook()` is not this contract.
    error ValidationHookMismatch(address auctionValidationHook);
    /// @notice The auction's `token()` is not the expected token.
    error TokenMismatch(address expected, address actual);
    /// @notice The auction's `currency()` is not the expected currency.
    error CurrencyMismatch(address expected, address actual);
    /// @notice `setAuction` was called at or after the auction's `startBlock`.
    error AuctionAlreadyStarted(uint64 startBlock);

    /// @notice Emitted once when the auction is bound.
    event AuctionSet(address indexed auction);

    /// @notice Max allowed bid price (Q96), 190 points for the demo listing.
    function capQ96() external view returns (uint256);
    /// @notice The eligibility module every bid is delegated to.
    function module() external view returns (IEligibilityModule);
    /// @notice The token the bound auction must sell.
    function token() external view returns (address);
    /// @notice The currency the bound auction must raise (Sepolia USDC).
    function currency() external view returns (address);
    /// @notice The only address allowed to call `setAuction`.
    function deployer() external view returns (address);
    /// @notice The bound auction, or address(0) before `setAuction`.
    function auction() external view returns (address);

    /// @notice Binds the auction. Deployer-only, once, strictly before the auction's `startBlock`.
    function setAuction(address auction_) external;
}
