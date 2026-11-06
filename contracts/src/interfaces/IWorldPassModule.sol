// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEligibilityModule} from "./IEligibilityModule.sol";

/// @notice Short-lived World ID eligibility pass (plan.md §6, §8), signed (EIP-712) by the verify backend after it
///         validated a World ID Proof of Human for action `listingday-<ticker>` with `signal` = `wallet`.
/// @param nullifier World ID nullifier for the listing's action (one per human per action).
/// @param wallet The bidding wallet; must equal the bid `owner` and `sender`.
/// @param auction The CCA the pass is for; must equal the auction bound to the validation hook.
/// @param cap Per-human cumulative budget cap (raw currency units, 6-decimal USDC).
/// @param expiry Unix seconds; the pass is valid while `block.timestamp <= expiry`.
struct EligibilityPass {
    bytes32 nullifier;
    address wallet;
    address auction;
    uint128 cap;
    uint64 expiry;
}

/// @title IWorldPassModule
/// @notice Phase 2 eligibility: every bid carries `hookData = abi.encode(EligibilityPass pass, bytes signature)`.
/// @dev The CCA wraps these errors as `ValidationHookCallFailed(bytes reason)` (see errors.md).
interface IWorldPassModule is IEligibilityModule {
    /// @notice Why a bid was rejected. ABI type `uint8`; values are stable (the frontend maps them to copy).
    enum Reason {
        // 0: `hookData` is empty: the bidder has no pass (verify with World ID first).
        MissingPass,
        // 1: `hookData` is too short to hold a pass, or the pass has a zero nullifier.
        InvalidPass,
        // 2: The signature is malformed or not from the configured backend signer (forged or tampered pass).
        WrongSigner,
        // 3: `block.timestamp > pass.expiry`: get a fresh pass from the verify backend.
        Expired,
        // 4: `pass.wallet` is not the bid owner / sender.
        WrongWallet,
        // 5: `pass.auction` is not this listing's auction.
        WrongAuction,
        // 6: This human (nullifier) already bid from another wallet.
        NullifierBoundToOtherWallet,
        // 7: This wallet already bid with another human's pass.
        WalletBoundToOtherNullifier
    }

    /// @notice The bid is not covered by a valid pass. Wrapped by the CCA in `ValidationHookCallFailed`.
    error NotEligible(Reason reason);
    /// @notice Constructor argument is the zero address.
    error ZeroAddress();

    /// @notice Emitted the first time a nullifier bids; the binding never changes afterwards.
    event NullifierBound(bytes32 indexed nullifier, address indexed wallet);
    /// @notice Emitted on every accepted bid.
    /// @param total Cumulative committed budget of this human after the bid.
    event BudgetCommitted(bytes32 indexed nullifier, address indexed wallet, uint128 amount, uint256 total);

    /// @notice Address whose EIP-712 signature makes a pass valid (the verify backend's pass signer).
    function signer() external view returns (address);
    /// @notice EIP-712 typehash of `EligibilityPass`.
    function PASS_TYPEHASH() external view returns (bytes32);
    /// @notice EIP-712 domain separator (name "ListingDay WorldPass", version "1", this chain, this module).
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    /// @notice EIP-712 digest the backend signs for `pass`.
    function hashPass(EligibilityPass calldata pass) external view returns (bytes32);
    /// @notice Wallet a nullifier is bound to (address(0) before its first bid).
    function walletOf(bytes32 nullifier) external view returns (address);
    /// @notice Nullifier a wallet is bound to (bytes32(0) before its first bid).
    function nullifierOf(address wallet) external view returns (bytes32);
    /// @notice Cumulative committed budget per human.
    function committed(bytes32 nullifier) external view returns (uint256);
}
