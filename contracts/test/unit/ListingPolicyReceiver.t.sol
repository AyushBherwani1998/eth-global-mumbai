// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ListingPolicyReceiver, ListingPolicy} from "../../src/ListingPolicyReceiver.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";

contract ListingPolicyReceiverTest is Test {
    ListingPolicyReceiver internal receiver;
    address internal broadcaster = makeAddr("broadcaster");
    address internal attacker = makeAddr("attacker");
    bytes internal ensName = abi.encodePacked(uint8(4), "acme", uint8(11), "listingday", uint8(3), "eth", uint8(0));

    function setUp() public {
        receiver = new ListingPolicyReceiver(broadcaster, ensName);
    }

    function _buildPolicy(
        uint32 version,
        uint64 asOf,
        uint160 refSqrtPriceX96,
        uint16 normalBandBps,
        uint16 survBandBps,
        uint8 mode,
        bool halted
    ) internal pure returns (ListingPolicy memory) {
        return ListingPolicy({
            version: version,
            asOf: asOf,
            chainSelector: Sepolia.CRE_CHAIN_SELECTOR,
            refSqrtPriceX96: refSqrtPriceX96,
            normalBandBps: normalBandBps,
            survBandBps: survBandBps,
            mode: mode,
            halted: halted,
            coolOffUntil: 0
        });
    }

    function test_onReport_acceptsFirstPolicy() public {
        ListingPolicy memory pol = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report = abi.encode(pol);
        bytes memory metadata = new bytes(64);

        vm.prank(broadcaster, broadcaster); // Set both msg.sender and tx.origin
        receiver.onReport(metadata, report);

        (
            uint32 version,
            uint64 asOf,
            uint64 chainSelector,
            uint160 refSqrtPriceX96,
            uint16 normalBandBps,
            uint16 survBandBps,
            uint8 mode,
            bool halted,
            uint64 coolOffUntil
        ) = receiver.policy();

        assertEq(version, 1);
        assertEq(asOf, 1000);
        assertEq(chainSelector, Sepolia.CRE_CHAIN_SELECTOR);
        assertEq(refSqrtPriceX96, 1e18);
        assertEq(normalBandBps, 2000);
        assertEq(survBandBps, 500);
        assertEq(mode, 0);
        assertEq(halted, false);
    }

    function test_onReport_emitsPolicyApplied() public {
        ListingPolicy memory pol = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report = abi.encode(pol);
        bytes memory metadata = new bytes(64);

        vm.expectEmit(true, true, true, true);
        emit ListingPolicyReceiver.PolicyApplied(1, 1000, 1e18, 2000, 500, 0, false, 0);

        vm.prank(broadcaster, broadcaster); // Set both msg.sender and tx.origin
        receiver.onReport(metadata, report);
    }

    function test_onReport_revertsOnlyBroadcaster_whenWrongOrigin() public {
        ListingPolicy memory pol = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report = abi.encode(pol);
        bytes memory metadata = new bytes(64);

        vm.expectRevert(
            abi.encodeWithSelector(
                ListingPolicyReceiver.OnlyBroadcaster.selector, attacker, attacker, broadcaster
            )
        );
        vm.prank(attacker, attacker); // Set both msg.sender and tx.origin
        receiver.onReport(metadata, report);
    }

    function test_onReport_revertsInvalidChainSelector_whenWrongChain() public {
        ListingPolicy memory pol = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        pol.chainSelector = 1; // Wrong chain
        bytes memory report = abi.encode(pol);
        bytes memory metadata = new bytes(64);

        vm.expectRevert(
            abi.encodeWithSelector(ListingPolicyReceiver.InvalidChainSelector.selector, Sepolia.CRE_CHAIN_SELECTOR, 1)
        );
        vm.prank(broadcaster, broadcaster); // Set both msg.sender and tx.origin
        receiver.onReport(metadata, report);
    }

    function test_onReport_revertsStalePolicy_whenAsOfNotIncreasing() public {
        // First policy
        ListingPolicy memory pol1 = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report1 = abi.encode(pol1);
        bytes memory metadata = new bytes(64);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report1);

        // Second policy with same asOf
        ListingPolicy memory pol2 = _buildPolicy(1, 1000, 1e18, 2000, 500, 1, false);
        bytes memory report2 = abi.encode(pol2);

        vm.expectRevert(abi.encodeWithSelector(ListingPolicyReceiver.StalePolicy.selector, 1, 1000, 1000));
        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report2);
    }

    function test_onReport_revertsStalePolicy_whenAsOfDecreases() public {
        // First policy
        ListingPolicy memory pol1 = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report1 = abi.encode(pol1);
        bytes memory metadata = new bytes(64);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report1);

        // Second policy with earlier asOf
        ListingPolicy memory pol2 = _buildPolicy(1, 999, 1e18, 2000, 500, 1, false);
        bytes memory report2 = abi.encode(pol2);

        vm.expectRevert(abi.encodeWithSelector(ListingPolicyReceiver.StalePolicy.selector, 1, 999, 1000));
        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report2);
    }

    function test_onReport_acceptsNewVersion_withAsOfReset() public {
        // First policy version 1
        ListingPolicy memory pol1 = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report1 = abi.encode(pol1);
        bytes memory metadata = new bytes(64);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report1);

        // Second policy version 2 with asOf reset to 500 (allowed, different version)
        ListingPolicy memory pol2 = _buildPolicy(2, 500, 1e18, 2000, 500, 1, false);
        bytes memory report2 = abi.encode(pol2);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report2);

        (uint32 version, uint64 asOf,,,,,,, ) = receiver.policy();
        assertEq(version, 2);
        assertEq(asOf, 500);
    }

    function test_onReport_updatesPolicy_whenMonotonic() public {
        // First policy
        ListingPolicy memory pol1 = _buildPolicy(1, 1000, 1e18, 2000, 500, 0, false);
        bytes memory report1 = abi.encode(pol1);
        bytes memory metadata = new bytes(64);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report1);

        // Second policy with increasing asOf
        ListingPolicy memory pol2 = _buildPolicy(1, 2000, 2e18, 1500, 300, 1, true);
        bytes memory report2 = abi.encode(pol2);

        vm.prank(broadcaster, broadcaster);
        receiver.onReport(metadata, report2);

        (
            uint32 version,
            uint64 asOf,
            ,
            uint160 refSqrtPriceX96,
            uint16 normalBandBps,
            uint16 survBandBps,
            uint8 mode,
            bool halted,
        ) = receiver.policy();

        assertEq(version, 1);
        assertEq(asOf, 2000);
        assertEq(refSqrtPriceX96, 2e18);
        assertEq(normalBandBps, 1500);
        assertEq(survBandBps, 300);
        assertEq(mode, 1);
        assertEq(halted, true);
    }

    function test_constructor_setsImmutables() public {
        assertEq(receiver.broadcaster(), broadcaster);
        assertEq(receiver.ensName(), ensName);
    }
}
