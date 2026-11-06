// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IValidationHook} from "continuous-clearing-auction/src/interfaces/IValidationHook.sol";

/// @notice Exposes the CCA views `AuctionValidationHook.setAuction` reads, and forwards bids to the hook the
///         way the CCA does (`sender` = caller of `submitBid`).
contract MockAuction {
    IValidationHook public validationHook;
    address public token;
    address public currency;
    uint64 public startBlock;

    constructor(address validationHook_, address token_, address currency_, uint64 startBlock_) {
        validationHook = IValidationHook(validationHook_);
        token = token_;
        currency = currency_;
        startBlock = startBlock_;
    }

    function submitBid(uint256 maxPrice, uint128 amount, address owner, bytes calldata hookData) external {
        validationHook.validate(maxPrice, amount, owner, msg.sender, hookData);
    }
}
