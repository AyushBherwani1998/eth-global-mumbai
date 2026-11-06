// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAuctionValidationHook} from "../interfaces/IAuctionValidationHook.sol";
import {IEligibilityModule} from "../interfaces/IEligibilityModule.sol";
import {EligibilityPass, IWorldPassModule} from "../interfaces/IWorldPassModule.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title WorldPassModule
/// @notice Phase 2 eligibility (plan.md §8): one human, one wallet, one budget. Every bid must carry an EIP-712
///         `EligibilityPass` signed by the verify backend, which issues it only after validating a World ID Proof of
///         Human for action `listingday-<ticker>` with `signal` = the bidding wallet.
/// @dev Checks, in order: signer, expiry, `wallet == owner == sender`, `auction ==` the hook's bound auction; then
///      binds nullifier <-> wallet one-to-one on first use and adds `amount` to the human's total against `cap`.
///      A pass may be reused for several bids until it expires; the cap is cumulative per nullifier. Like
///      `AllowAllModule`, exits and refunds never reduce the total. One module per hook, one hook per auction, so
///      the bindings are per auction.
contract WorldPassModule is IWorldPassModule, EIP712 {
    /// @inheritdoc IWorldPassModule
    bytes32 public constant PASS_TYPEHASH =
        keccak256("EligibilityPass(bytes32 nullifier,address wallet,address auction,uint128 cap,uint64 expiry)");

    /// @dev `abi.encode(EligibilityPass, bytes)`: 5 static words, the bytes offset and the bytes length.
    uint256 internal constant MIN_HOOK_DATA_LENGTH = 7 * 32;

    /// @inheritdoc IEligibilityModule
    address public immutable hook;
    /// @inheritdoc IWorldPassModule
    address public immutable signer;

    /// @inheritdoc IWorldPassModule
    mapping(bytes32 nullifier => address wallet) public walletOf;
    /// @inheritdoc IWorldPassModule
    mapping(address wallet => bytes32 nullifier) public nullifierOf;
    /// @inheritdoc IWorldPassModule
    mapping(bytes32 nullifier => uint256) public committed;

    /// @param hook_ The `AuctionValidationHook` that will call `check` (predict it before deploying the hook).
    /// @param signer_ The verify backend's pass signer (`PASS_SIGNER_KEY` in services/verify).
    constructor(address hook_, address signer_) EIP712("ListingDay WorldPass", "1") {
        if (hook_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        hook = hook_;
        signer = signer_;
    }

    /// @inheritdoc IEligibilityModule
    function check(address owner, address sender, uint128 amount, bytes calldata hookData) external {
        if (msg.sender != hook) revert OnlyHook();
        EligibilityPass memory pass = _signedPass(hookData);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > pass.expiry) revert NotEligible(Reason.Expired);
        if (pass.wallet != owner || pass.wallet != sender) revert NotEligible(Reason.WrongWallet);
        if (pass.auction != IAuctionValidationHook(hook).auction()) revert NotEligible(Reason.WrongAuction);

        bytes32 nullifier = pass.nullifier;
        address bound = walletOf[nullifier];
        if (bound == address(0)) {
            if (nullifierOf[owner] != bytes32(0)) revert NotEligible(Reason.WalletBoundToOtherNullifier);
            walletOf[nullifier] = owner;
            nullifierOf[owner] = nullifier;
            // forge-lint: disable-next-line(reentrancy-events)
            emit NullifierBound(nullifier, owner);
        } else if (bound != owner) {
            revert NotEligible(Reason.NullifierBoundToOtherWallet);
        }

        uint256 newTotal = committed[nullifier] + amount;
        if (newTotal > pass.cap) revert CapExceeded(newTotal, pass.cap);
        committed[nullifier] = newTotal;
        // forge-lint: disable-next-line(reentrancy-events)
        emit BudgetCommitted(nullifier, owner, amount, newTotal);
    }

    /// @inheritdoc IWorldPassModule
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IWorldPassModule
    function hashPass(EligibilityPass calldata pass) external view returns (bytes32) {
        return _hashPass(pass);
    }

    function _hashPass(EligibilityPass memory pass) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(PASS_TYPEHASH, pass.nullifier, pass.wallet, pass.auction, pass.cap, pass.expiry))
        );
    }

    /// @dev Decodes `hookData` and requires the configured signer. OpenZeppelin's `tryRecover` rejects malleable
    ///      (high-s) and malformed signatures, which map to `WrongSigner` like any other bad signature.
    function _signedPass(bytes calldata hookData) internal view returns (EligibilityPass memory pass) {
        if (hookData.length == 0) revert NotEligible(Reason.MissingPass);
        if (hookData.length < MIN_HOOK_DATA_LENGTH) revert NotEligible(Reason.InvalidPass);
        bytes memory signature;
        (pass, signature) = abi.decode(hookData, (EligibilityPass, bytes));
        if (pass.nullifier == bytes32(0)) revert NotEligible(Reason.InvalidPass);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashPass(pass), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert NotEligible(Reason.WrongSigner);
    }
}
