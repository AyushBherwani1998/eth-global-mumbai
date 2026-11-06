// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {Test} from "forge-std/Test.sol";

abstract contract HookFixture is Test {
    /// @notice Deploys AllowAllModule then AuctionValidationHook from `deployer_`. The module needs the hook
    ///         address up front, so it is predicted from `deployer_`'s next-but-one CREATE nonce.
    function _deployHookAndModule(address deployer_, address token_, address currency_, uint256 cap_)
        internal
        returns (AuctionValidationHook hook, AllowAllModule module)
    {
        address predictedHook = vm.computeCreateAddress(deployer_, vm.getNonce(deployer_) + 1);
        vm.startPrank(deployer_);
        module = new AllowAllModule(predictedHook, cap_);
        hook = new AuctionValidationHook(module, token_, currency_, ListingPrice.CAP_PRICE_Q96);
        vm.stopPrank();
        assertEq(address(hook), predictedHook, "hook address prediction");
    }
}
