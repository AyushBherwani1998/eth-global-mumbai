// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAuctionValidationHook} from "./interfaces/IAuctionValidationHook.sol";
import {IEligibilityModule} from "./interfaces/IEligibilityModule.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {
    ValidationHookIntrospection
} from "continuous-clearing-auction/src/periphery/validationHooks/ValidationHookIntrospection.sol";

/// @title AuctionValidationHook
/// @notice CCA validation hook for a Listing Day IPO: rejects bids priced above the cap, requires
///         `sender == owner`, and delegates eligibility (per-applicant cap, World ID pass) to a module.
/// @dev The CCA factory's CREATE2 init code includes `AuctionParameters.validationHook`, so the auction
///      address depends on this hook's address and cannot be a constructor argument. The deployer binds it
///      once via `setAuction`, which checks the auction really points at this hook. Never bind lazily to
///      the first caller: anyone can deploy a CCA through the public factory that names this hook.
contract AuctionValidationHook is IAuctionValidationHook, ValidationHookIntrospection {
    /// @inheritdoc IAuctionValidationHook
    uint256 public immutable capQ96;
    /// @inheritdoc IAuctionValidationHook
    IEligibilityModule public immutable module;
    /// @inheritdoc IAuctionValidationHook
    address public immutable token;
    /// @inheritdoc IAuctionValidationHook
    address public immutable currency;
    /// @inheritdoc IAuctionValidationHook
    address public immutable deployer;
    /// @inheritdoc IAuctionValidationHook
    address public auction;

    /// @param module_ Eligibility module; its `hook()` must already be this contract's address.
    /// @param token_ Token the auction sells (MockSME).
    /// @param currency_ Currency the auction raises (Sepolia USDC). The cap is only meaningful for this currency.
    /// @param capQ96_ Max bid price in Q96 (`ListingPrice.CAP_PRICE_Q96` for the demo listing).
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(IEligibilityModule module_, address token_, address currency_, uint256 capQ96_) {
        if (address(module_) == address(0) || token_ == address(0)) revert ZeroAddress();
        if (capQ96_ == 0) revert InvalidCap();
        address moduleHook = module_.hook();
        if (moduleHook != address(this)) revert ModuleHookMismatch(moduleHook);

        module = module_;
        token = token_;
        currency = currency_;
        capQ96 = capQ96_;
        deployer = msg.sender;
    }

    /// @inheritdoc IAuctionValidationHook
    function setAuction(address auction_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (auction != address(0)) revert AuctionAlreadySet();
        if (auction_ == address(0)) revert ZeroAddress();

        IContinuousClearingAuction cca = IContinuousClearingAuction(auction_);
        address auctionHook = address(cca.validationHook());
        if (auctionHook != address(this)) revert ValidationHookMismatch(auctionHook);
        address auctionToken = cca.token();
        if (auctionToken != token) revert TokenMismatch(token, auctionToken);
        address auctionCurrency = cca.currency();
        if (auctionCurrency != currency) revert CurrencyMismatch(currency, auctionCurrency);
        uint64 startBlock = cca.startBlock();
        if (block.number >= startBlock) revert AuctionAlreadyStarted(startBlock);

        auction = auction_;
        emit AuctionSet(auction_);
    }

    /// @notice Called by the CCA on every `submitBid`. MUST revert to reject.
    /// @dev `sender` is the `msg.sender` of `submitBid`. Requiring `sender == owner` stops a third party
    ///      from spending someone else's per-applicant cap (or replaying their pass) with their own funds.
    function validate(uint256 maxPrice, uint128 amount, address owner, address sender, bytes calldata hookData)
        external
    {
        if (msg.sender != auction) revert OnlyAuction();
        if (sender != owner) revert SenderMustBeOwner();
        if (maxPrice > capQ96) revert BidAboveCap(maxPrice, capQ96);
        module.check(owner, sender, amount, hookData);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IAuctionValidationHook).interfaceId || super.supportsInterface(interfaceId);
    }
}
