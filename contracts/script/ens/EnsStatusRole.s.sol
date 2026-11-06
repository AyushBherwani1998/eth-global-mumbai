// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {IEnsPermissionedResolver} from "../../src/interfaces/IEnsV2.sol";
import {IStatusResolver} from "../../src/interfaces/IStatusResolver.sol";
import {EnsRoles} from "../../src/libraries/EnsV2.sol";
import {EnsBase} from "./EnsBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice ENS step 5: let the CRE `ListingPolicyReceiver` write `listingday.status`, and nothing else.
///   1. Issuer: `resolver.grantSetterRoles(abi.encodeCall(setText, (name, "listingday.status", "")), receiver)`.
///      `ROLE_SET_TEXT` scoped to that key's resource; the issuer needs `ROLE_SET_TEXT_ADMIN` (it holds ALL_ROLES).
///   2. Receiver owner (`PRIVATE_KEY`): `receiver.setStatusMirror(resolver, dnsEncode("acme.listingday.eth"))`.
///   3. If the receiver already has a status (a CRE report landed), `receiver.syncStatus()` mirrors it now.
///
///   [ISSUER_KEY=0x…] PRIVATE_KEY=0x… forge script script/ens/EnsStatusRole.s.sol --rpc-url $RPC --broadcast
///
/// Idempotent. Before the first CRE report the status record stays empty (the app shows that as "draft").
contract EnsStatusRole is EnsBase {
    function run() external {
        _ensStep("EnsStatusRole");
        ListingPolicyReceiver receiver = _receiver();
        require(address(receiver).code.length != 0, "no ListingPolicyReceiver in the deployments file: run DemoDeploy");
        IEnsPermissionedResolver resolver = _issuerResolver();
        require(address(resolver).code.length != 0, "issuer resolver not deployed: run EnsTicker first");
        bytes memory name = _tickerDns();
        uint256 resource = EnsRoles.textResource(KEY_STATUS);

        if (!resolver.hasRoles(resource, EnsRoles.ROLE_SET_TEXT, address(receiver))) {
            vm.startBroadcast(_issuerKey());
            _tx("PermissionedResolver.grantSetterRoles(setText(name, \"listingday.status\", \"\"), receiver) (issuer)");
            resolver.grantSetterRoles(
                abi.encodeCall(IEnsPermissionedResolver.setText, (name, KEY_STATUS, "")), address(receiver)
            );
            vm.stopBroadcast();
        }

        bool mirrorSet = address(receiver.statusResolver()) == address(resolver)
            && keccak256(receiver.statusName()) == keccak256(name);
        bool needsSync = bytes(receiver.status()).length != 0
            && keccak256(bytes(_resolveText(resolver, name, KEY_STATUS))) != keccak256(bytes(receiver.status()));
        if (!mirrorSet || needsSync) {
            require(vm.addr(_deployerKey()) == receiver.owner(), "PRIVATE_KEY is not the receiver owner");
            vm.startBroadcast(_deployerKey());
            if (!mirrorSet) {
                _tx("ListingPolicyReceiver.setStatusMirror(resolver, dnsEncode(name))");
                receiver.setStatusMirror(IStatusResolver(address(resolver)), name);
            }
            if (needsSync) {
                _tx(string.concat("ListingPolicyReceiver.syncStatus() -> \"", receiver.status(), "\""));
                receiver.syncStatus();
            }
            vm.stopBroadcast();
        }

        require(resolver.hasRoles(resource, EnsRoles.ROLE_SET_TEXT, address(receiver)), "scoped role");
        require(
            !resolver.hasRoles(EnsRoles.textResource(KEY_URL), EnsRoles.ROLE_SET_TEXT, address(receiver)),
            "receiver must not be able to set other keys"
        );
        console2.log("receiver", address(receiver), "may set", KEY_STATUS);
        console2.log("mirror", address(receiver.statusResolver()), vm.toString(receiver.statusName()));
        console2.log("listingday.status now:", _resolveText(resolver, name, KEY_STATUS));
        _saveEns();
    }
}
