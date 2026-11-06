// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Grant, IEnsPermissionedResolver, IEnsRegistry, IEnsUserRegistry} from "../../src/interfaces/IEnsV2.sol";
import {SepoliaEns} from "../../src/libraries/Constants.sol";
import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 3: the issuer deploys its own PermissionedResolver (VerifiableFactory proxy of the Sepolia
///         `PermissionedResolverImpl`, issuer holds `ALL_ROLES` as the ENS app does for an owner), then we register
///         the ticker `acme` in the UserRegistry to the issuer with that resolver and the roles
///         `ROLE_SET_RESOLVER | ROLE_RENEW`. `ROLE_CAN_TRANSFER_ADMIN` is withheld (it can only be given at
///         registration), so the ticker can't be transferred. Expiry = the parent's expiry.
///
///   [ISSUER_KEY=0x…] [ENS_OWNER_KEY=0x…] [ENS_TICKER=acme] \
///   forge script script/ens/EnsTicker.s.sol --rpc-url $RPC --broadcast
///
/// Idempotent: the resolver is `predictProxyAddress(issuer, salt)`; an existing ticker owned by the issuer is kept
/// (and only re-pointed at the resolver, by the issuer, if needed).
contract EnsTicker is EnsBase {
    function run() external {
        _ensStep("EnsTicker");
        IEnsUserRegistry registry = _userRegistry();
        require(
            address(ETH_REGISTRY.getSubregistry(_parentLabel())) == address(registry)
                && address(registry).code.length != 0,
            "UserRegistry not wired under the parent name: run EnsRegistry first"
        );
        address issuer = vm.addr(_issuerKey());
        IEnsPermissionedResolver resolver = _deployResolver(issuer);

        string memory label = _tickerLabel();
        uint256 labelId = uint256(EnsNames.labelhash(label));
        address owner = registry.getOwner(labelId);
        if (owner == address(0)) {
            uint64 expiry = ETH_REGISTRY.getExpiry(uint256(EnsNames.labelhash(_parentLabel())));
            vm.startBroadcast(_ensOwnerKey());
            _tx(
                string.concat("UserRegistry.register(\"", label, "\", issuer, 0, resolver, SET_RESOLVER|RENEW, expiry)")
            );
            registry.register(
                label, issuer, IEnsRegistry(address(0)), address(resolver), EnsRoles.ISSUER_TICKER_ROLES, expiry
            );
            vm.stopBroadcast();
        } else {
            require(owner == issuer, string.concat(_tickerName(), " is owned by someone other than ISSUER_KEY"));
            console2.log(_tickerName(), "already registered to the issuer");
            if (registry.getResolver(label) != address(resolver)) {
                vm.startBroadcast(_issuerKey());
                _tx("UserRegistry.setResolver(findTokenId(label), resolver) (issuer, ROLE_SET_RESOLVER)");
                registry.setResolver(registry.findTokenId(label), address(resolver));
                vm.stopBroadcast();
            }
        }

        require(registry.getOwner(labelId) == issuer, "ticker owner");
        require(registry.getResolver(label) == address(resolver), "ticker resolver");
        require(registry.hasRoles(labelId, EnsRoles.ISSUER_TICKER_ROLES, issuer), "issuer ticker roles");
        require(
            !registry.hasRoles(labelId, EnsRoles.ROLE_CAN_TRANSFER_ADMIN, issuer), "ticker must not be transferable"
        );
        console2.log("ticker", _tickerName());
        console2.log("  owner (issuer)", issuer);
        console2.log("  tokenId", registry.findTokenId(label));
        console2.log("  resolver (issuer's PermissionedResolver)", address(resolver));
        _saveEns();
    }

    function _deployResolver(address issuer) internal returns (IEnsPermissionedResolver resolver) {
        resolver = _issuerResolver();
        if (address(resolver).code.length != 0) return resolver;
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(issuer, EnsRoles.ALL_ROLES);
        vm.startBroadcast(_issuerKey());
        _tx("VerifiableFactory.deployProxy(PermissionedResolverImpl, salt, initialize([(issuer, ALL_ROLES)], []))");
        address deployed = FACTORY.deployProxy(
            SepoliaEns.PERMISSIONED_RESOLVER_IMPL,
            _resolverSalt(),
            abi.encodeCall(IEnsPermissionedResolver.initialize, (grants, new bytes[](0)))
        );
        vm.stopBroadcast();
        require(deployed == address(resolver), "resolver proxy address mismatch");
        require(resolver.hasRootRoles(EnsRoles.ALL_ROLES, issuer), "issuer owns the resolver");
    }
}
