// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockSME
/// @notice Fixed-supply mock SME share token (110,000 shares, 18 decimals). NSE-inspired demo, not a security.
/// @dev The whole supply is minted to `recipient` in the constructor and there is no mint function, so the
///      supply can never grow. The issuer deposits it into LiquidityLauncher (`depositToken` +
///      `distributeToken` in one `multicall`) instead of using `createToken`, so the token address is known
///      before the validation hook is deployed and can be CREATE2-salted to sort above USDC.
contract MockSME is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 110_000e18;

    error ZeroRecipient();

    constructor(string memory name_, string memory symbol_, address recipient) ERC20(name_, symbol_) {
        if (recipient == address(0)) revert ZeroRecipient();
        _mint(recipient, TOTAL_SUPPLY);
    }
}
