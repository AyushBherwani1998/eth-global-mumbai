// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IEnsMockERC20, IEnsRegistry} from "../../src/interfaces/IEnsV2.sol";
import {SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames} from "../../src/libraries/EnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 1: register `listingday.eth` on the Sepolia ENSv2 `ETHRegistrar`, paid in the ENS test
///         `MockUSDC` (0x240b…14aa, minted here; not Circle USDC). Commit-reveal, so it takes two runs:
///
///   run 1: mint + approve MockUSDC, `commit(commitment)`               -> "committed: run again after <time>"
///   wait:  >= MIN_COMMITMENT_AGE (60 s) of chain time                   (script/ens/wait-for-commit.sh)
///   run 2: `register(label, owner, secret, 0, 0, duration, MockUSDC, 0)` -> "registered listingday.eth"
///
///   [ENS_OWNER_KEY=0x…] [ENS_DURATION=31536000] forge script script/ens/EnsName.s.sol --rpc-url $RPC --broadcast
///
/// `make ens-name` runs all three. Idempotent: does nothing once the name is ours, re-commits if the commitment
/// expired (24 h), and stops with a clear error if someone else holds the name. Subregistry and resolver are left
/// empty at registration; `EnsRegistry` sets the subregistry.
contract EnsName is EnsBase {
    function run() external {
        _ensStep("EnsName");
        string memory label = _parentLabel();
        address owner = vm.addr(_ensOwnerKey());
        uint256 labelId = uint256(EnsNames.labelhash(label));

        address current = ETH_REGISTRY.getOwner(labelId);
        if (current == owner) {
            console2.log(_parentName(), "already registered to", owner);
            console2.log("expiry", ETH_REGISTRY.getExpiry(labelId));
            _saveEns();
            return;
        }
        require(
            current == address(0) && REGISTRAR.isAvailable(label), string.concat(_parentName(), " is not available")
        );

        uint64 duration = _duration();
        (uint256 base, uint256 premium) = REGISTRAR.getRegisterPrice(label, duration, SepoliaEns.ENS_MOCK_USDC);
        uint256 price = base + premium;
        bytes32 commitment = _commitment();
        uint64 committedAt = REGISTRAR.commitmentAt(commitment);
        uint64 validFrom = committedAt + REGISTRAR.MIN_COMMITMENT_AGE();
        bool usable = committedAt != 0 && block.timestamp < committedAt + REGISTRAR.MAX_COMMITMENT_AGE();

        vm.startBroadcast(_ensOwnerKey());
        _payment(owner, price);
        if (!usable) {
            _tx("ETHRegistrar.commit(commitment)");
            REGISTRAR.commit(commitment);
            vm.stopBroadcast();
            console2.log("committed", vm.toString(commitment));
            console2.log(
                "register 60 s after the commit is mined, about timestamp",
                block.timestamp + REGISTRAR.MIN_COMMITMENT_AGE()
            );
            console2.log("next: script/ens/wait-for-commit.sh, then run EnsName again (make ens-name does both)");
            _saveEns();
            return;
        }
        require(
            block.timestamp >= validFrom,
            string.concat("commitment too new: wait until timestamp ", vm.toString(validFrom), " and run again")
        );
        _tx(string.concat("ETHRegistrar.register(\"", label, "\", owner, secret, 0, 0, duration, MockUSDC, 0)"));
        uint256 tokenId = REGISTRAR.register(
            label,
            owner,
            _secret(),
            IEnsRegistry(address(0)),
            address(0),
            duration,
            SepoliaEns.ENS_MOCK_USDC,
            bytes32(0)
        );
        vm.stopBroadcast();

        require(ETH_REGISTRY.getOwner(labelId) == owner, "registration failed");
        console2.log("registered", _parentName(), "to", owner);
        console2.log("tokenId", tokenId);
        console2.log("paid (ENS MockUSDC, 6 dec)", price);
        console2.log("expiry", ETH_REGISTRY.getExpiry(labelId));
        _saveEns();
    }

    /// @dev MockUSDC has a public `mint`; mint only the shortfall and approve the exact price.
    function _payment(address owner, uint256 price) internal {
        IEnsMockERC20 token = IEnsMockERC20(SepoliaEns.ENS_MOCK_USDC);
        uint256 balance = token.balanceOf(owner);
        if (balance < price) {
            _tx("ENS MockUSDC.mint(owner, shortfall)");
            token.mint(owner, price - balance);
        }
        if (token.allowance(owner, address(REGISTRAR)) < price) {
            _tx("ENS MockUSDC.approve(ETHRegistrar, price)");
            token.approve(address(REGISTRAR), price);
        }
    }
}
