// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingHook} from "../src/ListingHook.sol";
import {ListingPolicyReceiver} from "../src/ListingPolicyReceiver.sol";
import {IStatusResolver} from "../src/interfaces/IStatusResolver.sol";
import {Sepolia} from "../src/libraries/Constants.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Deploys `ListingPolicyReceiver` on Sepolia and optionally wires it up.
///
///   CRE_BROADCASTER=<address of CRE_ETH_PRIVATE_KEY> \
///   [LISTING_HOOK=<hook, if the deployer owns it>] [STATUS_RESOLVER=<resolver> STATUS_NAME=<dns-encoded name>] \
///   [CRE_FORWARDER=<default: Sepolia MockKeystoneForwarder>] [POLICY_MAX_AGE=<seconds, default 1 day>] \
///   [RECEIVER_OWNER=<default: deployer>] \
///   forge script script/DeployListingPolicyReceiver.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PK
///
/// With `RECEIVER_OWNER` set to someone else, the mirror and hook steps are skipped (the deployer can't call them).
contract DeployListingPolicyReceiver is Script {
    struct Params {
        address owner;
        address forwarder;
        address broadcaster;
        uint64 maxAge;
        address listingHook;
        address statusResolver;
        bytes statusName;
    }

    function run() external returns (ListingPolicyReceiver receiver) {
        Params memory p = Params({
            owner: vm.envOr("RECEIVER_OWNER", msg.sender),
            forwarder: vm.envOr("CRE_FORWARDER", Sepolia.CRE_MOCK_FORWARDER),
            broadcaster: vm.envAddress("CRE_BROADCASTER"),
            // forge-lint: disable-next-line(unsafe-typecast)
            maxAge: uint64(vm.envOr("POLICY_MAX_AGE", uint256(1 days))),
            listingHook: vm.envOr("LISTING_HOOK", address(0)),
            statusResolver: vm.envOr("STATUS_RESOLVER", address(0)),
            statusName: vm.envOr("STATUS_NAME", bytes(""))
        });
        vm.startBroadcast();
        receiver = deploy(p, msg.sender);
        vm.stopBroadcast();
        console2.log("ListingPolicyReceiver", address(receiver));
        console2.log("  forwarder  ", p.forwarder);
        console2.log("  broadcaster", p.broadcaster);
        console2.log("  maxAge     ", p.maxAge);
    }

    /// @dev Runs as `deployer` (the broadcaster in `run`, the test contract in tests).
    function deploy(Params memory p, address deployer) public returns (ListingPolicyReceiver receiver) {
        receiver = new ListingPolicyReceiver(p.owner, p.forwarder, p.broadcaster, Sepolia.CRE_CHAIN_SELECTOR, p.maxAge);
        if (p.owner != deployer) return receiver;
        if (p.statusResolver != address(0)) receiver.setStatusMirror(IStatusResolver(p.statusResolver), p.statusName);
        if (p.listingHook != address(0)) ListingHook(p.listingHook).setPolicySource(receiver);
    }
}
