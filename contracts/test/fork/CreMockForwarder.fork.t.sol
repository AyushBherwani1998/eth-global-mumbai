// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {IListingPolicyReceiver} from "../../src/interfaces/IListingPolicyReceiver.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {MockStatusResolver} from "../../src/mocks/MockStatusResolver.sol";
import {CreReports} from "../utils/CreReports.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";

interface ITypeAndVersion {
    function typeAndVersion() external view returns (string memory);
}

/// @notice `ListingPolicyReceiver` against the live Sepolia CRE MockKeystoneForwarder (what
///         `cre workflow simulate --broadcast` calls): the same `report` call the simulator sends, from the
///         broadcaster and from anyone else.
contract CreMockForwarderForkTest is SepoliaForkTest, CreReports {
    bytes internal constant ACME_DNS = hex"0461636d650a6c697374696e676461790365746800";

    address internal owner = makeAddr("receiverOwner");
    address internal broadcaster = makeAddr("creBroadcaster");
    address internal attacker = makeAddr("attacker");

    ListingPolicyReceiver internal receiver;
    MockStatusResolver internal resolver;

    function setUpFork() internal override {
        receiver = new ListingPolicyReceiver(
            owner, Sepolia.CRE_MOCK_FORWARDER, broadcaster, Sepolia.CRE_CHAIN_SELECTOR, 1 days
        );
        resolver = new MockStatusResolver(owner);
        vm.startPrank(owner);
        resolver.setWriter(address(receiver));
        receiver.setStatusMirror(resolver, ACME_DNS);
        vm.stopPrank();
    }

    function test_fork_liveForwarderIsTheMock() public view {
        assertEq(ITypeAndVersion(Sepolia.CRE_MOCK_FORWARDER).typeAndVersion(), "MockKeystoneForwarder 1.0.0");
        assertEq(ITypeAndVersion(Sepolia.CRE_FORWARDER).typeAndVersion(), "KeystoneForwarder 1.0.0");
    }

    /// @dev The Gate 0 check from plan.md §13: `ReportProcessed.result == true` and the receiver's own event.
    function test_fork_broadcasterReport_reportProcessedTrue_policyApplied() public {
        ListingPolicy memory p = _freshPolicy();
        p.refSqrtPriceX96 = 1 << 96;
        p.mode = 1;
        ListingPolicy memory expected = p;
        expected.version = 1;

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.PolicyApplied(1, expected, "surveillance");
        assertTrue(_deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, "")));
        assertEq(receiver.policy().mode, 1);
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "surveillance");
    }

    /// @dev Anyone can call the live mock forwarder. Without the tx.origin guard this would halt trading.
    function test_fork_spoofedReportThroughLiveForwarder_reportProcessedFalse() public {
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        assertFalse(_deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), attacker, _encodeReport(p, "")));
        assertEq(receiver.latestPolicy().version, 0);
        assertFalse(receiver.policy().halted);
    }

    function test_fork_receiverOnKeystoneForwarder_rejectsMockForwarder() public {
        ListingPolicyReceiver prod =
            new ListingPolicyReceiver(owner, Sepolia.CRE_FORWARDER, address(0), Sepolia.CRE_CHAIN_SELECTOR, 1 days);
        assertFalse(_deliver(Sepolia.CRE_MOCK_FORWARDER, address(prod), broadcaster, _encodeReport(_freshPolicy(), "")));
        assertEq(prod.latestPolicy().version, 0);
    }

    /// @dev ENS write burning all its gas on Sepolia, under the workflow's 1.5M gas limit: the forwarder still
    ///      reports success and the policy is in place.
    function test_fork_ensFailure_reportProcessedTrue() public {
        vm.prank(owner);
        resolver.setFailMode(MockStatusResolver.FailMode.BurnGas);
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        assertTrue(
            _deliver(Sepolia.CRE_MOCK_FORWARDER, address(receiver), broadcaster, _encodeReport(p, ""), 1_500_000)
        );
        assertTrue(receiver.policy().halted);
    }
}
