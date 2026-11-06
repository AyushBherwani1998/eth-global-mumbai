// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract SepoliaUsdcForkTest is SepoliaForkTest {
    /// (c) The quote currency at the plan address is Circle USDC with 6 decimals.
    function test_fork_usdc_decimals6_symbolUSDC() public view {
        IERC20Metadata usdc = IERC20Metadata(Sepolia.USDC);
        assertGt(Sepolia.USDC.code.length, 0, "no code at USDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.decimals(), ListingPrice.QUOTE_DECIMALS);
        assertEq(usdc.symbol(), "USDC");
    }
}
