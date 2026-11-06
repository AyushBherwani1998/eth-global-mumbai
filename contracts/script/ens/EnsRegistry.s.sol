// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Grant, IEnsRegistry, IEnsUserRegistry} from "../../src/interfaces/IEnsV2.sol";
import {SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 2: deploy the `listingday.eth` UserRegistry as a VerifiableFactory proxy of the Sepolia
///         `UserRegistryImpl`, initialized with our root roles (`ROLE_REGISTRAR | ROLE_UNREGISTER |
///         ROLE_SET_PARENT`, no admin or upgrade roles), make it canonical (`setParent(.eth registry,
///         "listingday")`), and hang it under the name (`ETHRegistry.setSubregistry`).
///
///   [ENS_OWNER_KEY=0x…] forge script script/ens/EnsRegistry.s.sol --rpc-url $RPC --broadcast
///
/// Idempotent: the proxy address is `predictProxyAddress(ENS owner, salt)`; each call is skipped when its effect is
/// already onchain.
contract EnsRegistry is EnsBase {
    function run() external {
        _ensStep("EnsRegistry");
        string memory label = _parentLabel();
        address owner = vm.addr(_ensOwnerKey());
        require(
            ETH_REGISTRY.getOwner(uint256(EnsNames.labelhash(label))) == owner,
            string.concat(_parentName(), " is not owned by ENS_OWNER_KEY: run EnsName first")
        );
        IEnsUserRegistry registry = _userRegistry();

        vm.startBroadcast(_ensOwnerKey());
        if (address(registry).code.length == 0) {
            Grant[] memory grants = new Grant[](1);
            grants[0] = Grant(owner, EnsRoles.LISTING_REGISTRY_ROOT_ROLES);
            _tx("VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([(owner, roles)]))");
            address deployed = FACTORY.deployProxy(
                SepoliaEns.USER_REGISTRY_IMPL, _registrySalt(), abi.encodeCall(IEnsUserRegistry.initialize, (grants))
            );
            require(deployed == address(registry), "proxy address mismatch");
        }
        (IEnsRegistry parent, string memory parentLabel) = registry.getParent();
        if (address(parent) != address(ETH_REGISTRY) || keccak256(bytes(parentLabel)) != keccak256(bytes(label))) {
            _tx(string.concat("UserRegistry.setParent(ETHRegistry, \"", label, "\")"));
            registry.setParent(ETH_REGISTRY, label);
        }
        if (address(ETH_REGISTRY.getSubregistry(label)) != address(registry)) {
            _tx("ETHRegistry.setSubregistry(findTokenId(label), UserRegistry)");
            ETH_REGISTRY.setSubregistry(ETH_REGISTRY.findTokenId(label), registry);
        }
        vm.stopBroadcast();

        require(registry.hasRootRoles(EnsRoles.LISTING_REGISTRY_ROOT_ROLES, owner), "root roles");
        require(address(ETH_REGISTRY.getSubregistry(label)) == address(registry), "subregistry");
        console2.log("UserRegistry", address(registry));
        console2.log("root roles of", owner, vm.toString(bytes32(registry.roles(0, owner))));
        _saveEns();
    }
}
