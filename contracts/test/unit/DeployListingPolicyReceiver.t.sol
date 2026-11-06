// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeployListingPolicyReceiver} from "../../script/DeployListingPolicyReceiver.s.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {MockStatusResolver} from "../../src/mocks/MockStatusResolver.sol";
import {Test} from "forge-std/Test.sol";

contract DeployListingPolicyReceiverTest is Test {
    function test_run_defaultsToSepoliaMockForwarderAndOneDayMaxAge() public {
        address broadcaster = makeAddr("creBroadcaster");
        vm.setEnv("CRE_BROADCASTER", vm.toString(broadcaster));
        ListingPolicyReceiver receiver = new DeployListingPolicyReceiver().run();

        assertEq(receiver.forwarder(), Sepolia.CRE_MOCK_FORWARDER);
        assertEq(receiver.broadcaster(), broadcaster);
        assertEq(receiver.chainSelector(), Sepolia.CRE_CHAIN_SELECTOR);
        assertEq(receiver.maxAge(), 1 days);
        assertEq(receiver.owner(), address(this), "the caller of run()");
    }

    function test_deploy_configuresTheStatusMirrorWhenTheDeployerOwnsIt() public {
        DeployListingPolicyReceiver script = new DeployListingPolicyReceiver();
        MockStatusResolver resolver = new MockStatusResolver(address(this));
        DeployListingPolicyReceiver.Params memory p = DeployListingPolicyReceiver.Params({
            owner: address(script),
            forwarder: Sepolia.CRE_MOCK_FORWARDER,
            broadcaster: makeAddr("creBroadcaster"),
            maxAge: 1 hours,
            listingHook: address(0),
            statusResolver: address(resolver),
            statusName: hex"0461636d650a6c697374696e676461790365746800"
        });
        ListingPolicyReceiver receiver = script.deploy(p, address(script));
        assertEq(address(receiver.statusResolver()), address(resolver));
        assertEq(receiver.statusName(), p.statusName);

        p.owner = makeAddr("someoneElse");
        receiver = script.deploy(p, address(script));
        assertEq(address(receiver.statusResolver()), address(0), "skipped: deployer is not the owner");
    }
}
