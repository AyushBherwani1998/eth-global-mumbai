// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {EligibilityPass} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {WorldPassModule} from "../../src/modules/WorldPassModule.sol";
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

    /// @notice Same wiring with the World ID pass module (a 'human' listing).
    function _deployHookAndWorldPass(address deployer_, address token_, address currency_, address passSigner)
        internal
        returns (AuctionValidationHook hook, WorldPassModule module)
    {
        address predictedHook = vm.computeCreateAddress(deployer_, vm.getNonce(deployer_) + 1);
        vm.startPrank(deployer_);
        module = new WorldPassModule(predictedHook, passSigner);
        hook = new AuctionValidationHook(module, token_, currency_, ListingPrice.CAP_PRICE_Q96);
        vm.stopPrank();
        assertEq(address(hook), predictedHook, "hook address prediction");
    }

    /// @notice `hookData` for `submitBid`: `abi.encode(pass, signature)` with `pass` signed by `signerKey` for
    ///         `module`'s EIP-712 domain (what services/verify returns as `hookData`).
    function _passHookData(WorldPassModule module, uint256 signerKey, EligibilityPass memory pass)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, module.hashPass(pass));
        return abi.encode(pass, abi.encodePacked(r, s, v));
    }
}
