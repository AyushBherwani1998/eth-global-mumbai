// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {IListingPolicy, ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {IListingPolicyReceiver} from "../../src/interfaces/IListingPolicyReceiver.sol";
import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {IStatusResolver} from "../../src/interfaces/IStatusResolver.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {MockStatusResolver} from "../../src/mocks/MockStatusResolver.sol";
import {CreReports, IKeystoneForwarderLike} from "../utils/CreReports.sol";
import {MockKeystoneForwarder} from "../utils/MockKeystoneForwarder.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Resolver that tries to inject a second report through the permissionless forwarder from inside
///         the ENS write (same tx, so tx.origin is still the broadcaster).
contract ReenteringResolver is IStatusResolver, CreReports {
    address internal immutable forwarder;
    bool public innerResult = true;

    constructor(address forwarder_) {
        forwarder = forwarder_;
    }

    function setText(bytes calldata, string calldata, string calldata) external {
        ListingPolicy memory p = _freshPolicy();
        p.asOf += 1;
        p.halted = true;
        innerResult = IKeystoneForwarderLike(forwarder)
            .route(bytes32(0), address(this), msg.sender, _metadata(), _encodeReport(p, "pwned"));
    }
}

contract ListingPolicyReceiverTest is CreReports {
    uint64 internal constant MAX_AGE = 1 hours;
    bytes internal constant ACME_DNS = hex"0461636d650a6c697374696e676461790365746800"; // acme.listingday.eth

    address internal owner = makeAddr("receiverOwner");
    address internal broadcaster = makeAddr("creBroadcaster");
    address internal attacker = makeAddr("attacker");

    MockKeystoneForwarder internal forwarder;
    ListingPolicyReceiver internal receiver;
    MockStatusResolver internal resolver;

    function setUp() public {
        vm.warp(1_762_400_000);
        forwarder = new MockKeystoneForwarder();
        receiver =
            new ListingPolicyReceiver(owner, address(forwarder), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, MAX_AGE);
        resolver = new MockStatusResolver(owner);
        vm.startPrank(owner);
        resolver.setWriter(address(receiver));
        receiver.setStatusMirror(resolver, ACME_DNS);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Calls `onReport` directly as `sender` with `origin` as tx.origin, expecting `revertData` if non-empty.
    function _onReport(address sender, address origin, bytes memory payload, bytes memory revertData) internal {
        vm.prank(sender, origin);
        if (revertData.length != 0) vm.expectRevert(revertData);
        receiver.onReport(_metadata(), payload);
    }

    function _apply(ListingPolicy memory p, string memory status) internal {
        assertTrue(_deliver(address(forwarder), address(receiver), broadcaster, _encodeReport(p, status)), "applied");
    }

    function _policyAt(uint64 asOf) internal view returns (ListingPolicy memory p) {
        p = _freshPolicy();
        p.asOf = asOf;
    }

    function _assertNothingApplied() internal view {
        ListingPolicy memory p = receiver.latestPolicy();
        assertEq(p.version, 0, "no policy applied");
        assertEq(p.asOf, 0);
        assertFalse(receiver.policy().halted);
    }

    function _assertEq(ListingPolicy memory a, ListingPolicy memory b) internal pure {
        assertEq(a.version, b.version, "version");
        assertEq(a.asOf, b.asOf, "asOf");
        assertEq(a.chainSelector, b.chainSelector, "chainSelector");
        assertEq(a.refSqrtPriceX96, b.refSqrtPriceX96, "refSqrtPriceX96");
        assertEq(a.normalBandBps, b.normalBandBps, "normalBandBps");
        assertEq(a.survBandBps, b.survBandBps, "survBandBps");
        assertEq(a.mode, b.mode, "mode");
        assertEq(a.halted, b.halted, "halted");
        assertEq(a.coolOffUntil, b.coolOffUntil, "coolOffUntil");
    }

    function _countLogs(Vm.Log[] memory logs, bytes32 topic0) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == topic0) n++;
        }
    }

    // ---------------------------------------------------------------- sender (forwarder) check

    function test_onReport_wrongSender_rejected() public {
        bytes memory payload = _encodeReport(_freshPolicy(), "");
        _onReport(
            attacker,
            broadcaster,
            payload,
            abi.encodeWithSelector(IListingPolicyReceiver.InvalidSender.selector, attacker, address(forwarder))
        );
        _onReport(
            broadcaster,
            broadcaster,
            payload,
            abi.encodeWithSelector(IListingPolicyReceiver.InvalidSender.selector, broadcaster, address(forwarder))
        );
        _assertNothingApplied();
    }

    /// @dev A different (equally permissionless) forwarder deployment is not the configured one: the report is
    ///      swallowed with `ReportProcessed.result == false`.
    function test_onReport_otherForwarder_reportProcessedFalse() public {
        MockKeystoneForwarder other = new MockKeystoneForwarder();
        assertFalse(_deliver(address(other), address(receiver), broadcaster, _encodeReport(_freshPolicy(), "")));
        _assertNothingApplied();
    }

    // ---------------------------------------------------------------- tx.origin (broadcaster) guard

    function test_onReport_wrongTxOrigin_rejected() public {
        _onReport(
            address(forwarder),
            attacker,
            _encodeReport(_freshPolicy(), ""),
            abi.encodeWithSelector(IListingPolicyReceiver.InvalidOrigin.selector, attacker, broadcaster)
        );
        _assertNothingApplied();
    }

    /// @dev The real attack: anyone can call the mock forwarder's `report` (or `route`) with a fake halt. The
    ///      forwarder check passes; the tx.origin guard rejects it and the forwarder swallows the revert.
    function test_onReport_spoofedHaltThroughPermissionlessForwarder_rejected() public {
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        bytes memory payload = _encodeReport(p, "");

        assertFalse(_deliver(address(forwarder), address(receiver), attacker, payload), "report() spoof");

        vm.prank(attacker, attacker);
        assertFalse(forwarder.route(bytes32(0), attacker, address(receiver), _metadata(), payload), "route() spoof");

        _assertNothingApplied();
        assertTrue(_deliver(address(forwarder), address(receiver), broadcaster, payload), "broadcaster");
        assertTrue(receiver.policy().halted);
    }

    function test_onReport_broadcasterGuardDisabled_acceptsAnyOrigin() public {
        vm.prank(owner);
        receiver.setBroadcaster(address(0));
        assertTrue(_deliver(address(forwarder), address(receiver), attacker, _encodeReport(_freshPolicy(), "")));
        assertEq(receiver.latestPolicy().version, 1);
    }

    // ---------------------------------------------------------------- freshness

    function test_onReport_asOfNotIncreasing_rejected() public {
        uint64 t = uint64(vm.getBlockTimestamp());
        _apply(_policyAt(t), "");

        bytes memory same = _encodeReport(_policyAt(t), "");
        _onReport(
            address(forwarder),
            broadcaster,
            same,
            abi.encodeWithSelector(IListingPolicyReceiver.StaleReport.selector, t, t)
        );
        bytes memory older = _encodeReport(_policyAt(t - 1), "");
        _onReport(
            address(forwarder),
            broadcaster,
            older,
            abi.encodeWithSelector(IListingPolicyReceiver.StaleReport.selector, t - 1, t)
        );
        // Replaying the accepted report through the forwarder is swallowed too.
        assertFalse(_deliver(address(forwarder), address(receiver), broadcaster, same));
        assertEq(receiver.latestPolicy().version, 1);

        vm.warp(vm.getBlockTimestamp() + 1);
        _apply(_policyAt(t + 1), "");
        assertEq(receiver.latestPolicy().version, 2);
    }

    function test_onReport_olderThanMaxAge_rejected() public {
        uint64 tooOld = uint64(vm.getBlockTimestamp() - MAX_AGE - 1);
        _onReport(
            address(forwarder),
            broadcaster,
            _encodeReport(_policyAt(tooOld), ""),
            abi.encodeWithSelector(IListingPolicyReceiver.ReportExpired.selector, tooOld, MAX_AGE)
        );
        _assertNothingApplied();

        _apply(_policyAt(uint64(vm.getBlockTimestamp() - MAX_AGE)), ""); // exactly maxAge old: still accepted
        assertEq(receiver.latestPolicy().version, 1);
    }

    function test_onReport_asOfInTheFuture_rejected() public {
        uint64 future = uint64(vm.getBlockTimestamp() + receiver.MAX_FUTURE_SKEW() + 1);
        _onReport(
            address(forwarder),
            broadcaster,
            _encodeReport(_policyAt(future), ""),
            abi.encodeWithSelector(IListingPolicyReceiver.ReportFromFuture.selector, future, vm.getBlockTimestamp())
        );
        _apply(_policyAt(uint64(vm.getBlockTimestamp() + receiver.MAX_FUTURE_SKEW())), "");
    }

    // ---------------------------------------------------------------- payload checks

    function test_onReport_wrongChainSelector_rejected() public {
        ListingPolicy memory p = _freshPolicy();
        p.chainSelector = 5_009_297_550_715_157_269; // ethereum-mainnet
        _onReport(
            address(forwarder),
            broadcaster,
            _encodeReport(p, ""),
            abi.encodeWithSelector(
                IListingPolicyReceiver.WrongChainSelector.selector, p.chainSelector, Sepolia.CRE_CHAIN_SELECTOR
            )
        );
        p.chainSelector = 0;
        _onReport(
            address(forwarder),
            broadcaster,
            _encodeReport(p, ""),
            abi.encodeWithSelector(IListingPolicyReceiver.WrongChainSelector.selector, 0, Sepolia.CRE_CHAIN_SELECTOR)
        );
        _assertNothingApplied();
    }

    function test_onReport_invalidPolicyOrStatus_rejected() public {
        bytes memory invalid = abi.encodeWithSelector(IListingPolicyReceiver.InvalidPolicy.selector);
        ListingPolicy memory p = _freshPolicy();
        p.normalBandBps = 10_000;
        _onReport(address(forwarder), broadcaster, _encodeReport(p, ""), invalid);
        p = _freshPolicy();
        p.survBandBps = 10_000;
        _onReport(address(forwarder), broadcaster, _encodeReport(p, ""), invalid);
        p = _freshPolicy();
        p.mode = 3;
        _onReport(address(forwarder), broadcaster, _encodeReport(p, ""), invalid);
        _onReport(
            address(forwarder),
            broadcaster,
            _encodeReport(_freshPolicy(), "this-status-is-longer-than-32-byt"),
            abi.encodeWithSelector(IListingPolicyReceiver.InvalidStatus.selector)
        );
        vm.prank(address(forwarder), broadcaster);
        vm.expectRevert();
        receiver.onReport(_metadata(), hex"deadbeef");
        _assertNothingApplied();
    }

    // ---------------------------------------------------------------- apply

    function test_onReport_emitsPolicyAppliedWithFields() public {
        ListingPolicy memory p = _freshPolicy();
        p.version = 77; // ignored: the receiver numbers reports itself
        p.refSqrtPriceX96 = 1_234_567_890_123_456_789_012_345;
        p.normalBandBps = 1500;
        p.survBandBps = 300;
        p.mode = 2;
        p.coolOffUntil = uint64(vm.getBlockTimestamp() - 1);

        ListingPolicy memory expected = p;
        expected.version = 1;
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.PolicyApplied(1, expected, "surveillance");
        _apply(p, "");
        _assertEq(receiver.latestPolicy(), expected);
        _assertEq(receiver.policy(), expected);
        assertEq(receiver.status(), "surveillance");

        vm.warp(vm.getBlockTimestamp() + 10);
        p.asOf = uint64(vm.getBlockTimestamp());
        p.mode = 0;
        p.halted = true;
        expected = p;
        expected.version = 2;
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.PolicyApplied(2, expected, "halted");
        _apply(p, "");
        _assertEq(receiver.policy(), expected);
    }

    function test_onReport_acceptsAnyMetadata() public {
        vm.prank(address(forwarder), broadcaster);
        receiver.onReport("", _encodeReport(_freshPolicy(), ""));
        assertEq(receiver.latestPolicy().version, 1);
    }

    function test_status_derivedOrExplicit() public {
        ListingPolicy memory p = _freshPolicy();
        _apply(p, "");
        assertEq(receiver.status(), "listed");

        vm.warp(vm.getBlockTimestamp() + 1);
        p.asOf = uint64(vm.getBlockTimestamp());
        p.mode = 1;
        _apply(p, "");
        assertEq(receiver.status(), "surveillance");

        vm.warp(vm.getBlockTimestamp() + 1);
        p.asOf = uint64(vm.getBlockTimestamp());
        p.coolOffUntil = uint64(vm.getBlockTimestamp() + 60);
        _apply(p, "");
        assertEq(receiver.status(), "halted", "cool-off reads as halted");

        vm.warp(vm.getBlockTimestamp() + 1);
        p.asOf = uint64(vm.getBlockTimestamp());
        p.coolOffUntil = 0;
        p.mode = 0;
        _apply(p, "auction");
        assertEq(receiver.status(), "auction", "explicit status from the console");
    }

    // ---------------------------------------------------------------- staleness rule

    function test_policy_beforeFirstReport_allZeros() public view {
        ListingPolicy memory p = receiver.policy();
        assertEq(p.version, 0);
        assertFalse(p.halted);
        assertFalse(receiver.isStale());
        assertEq(receiver.staleAt(), 0);
    }

    function test_policy_staleReadsHalted_nextReportLiftsIt() public {
        ListingPolicy memory p = _freshPolicy();
        p.mode = 1;
        _apply(p, "");
        assertEq(receiver.staleAt(), vm.getBlockTimestamp() + MAX_AGE + 1);

        vm.warp(vm.getBlockTimestamp() + MAX_AGE);
        assertFalse(receiver.isStale(), "exactly maxAge old is still fresh");
        assertFalse(receiver.policy().halted);

        vm.warp(vm.getBlockTimestamp() + 1);
        assertTrue(receiver.isStale());
        ListingPolicy memory served = receiver.policy();
        assertTrue(served.halted, "stale policy fails closed");
        assertEq(served.mode, 1, "other fields kept");
        assertFalse(receiver.latestPolicy().halted, "stored policy untouched");

        _apply(_freshPolicy(), "");
        assertFalse(receiver.isStale());
        assertFalse(receiver.policy().halted);
    }

    // ---------------------------------------------------------------- ENS status mirror

    function test_ensMirror_writesStatus_skipsWhenUnchanged() public {
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrored(address(resolver), "listed");
        _apply(_freshPolicy(), "");
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "listed");
        assertEq(receiver.mirroredStatusHash(), keccak256("listed"));

        vm.warp(vm.getBlockTimestamp() + 1);
        vm.recordLogs();
        vm.prank(address(forwarder), broadcaster);
        receiver.onReport(_metadata(), _encodeReport(_freshPolicy(), ""));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countLogs(logs, MockStatusResolver.TextChanged.selector), 0, "no ENS write when unchanged");
        assertEq(_countLogs(logs, IListingPolicyReceiver.PolicyApplied.selector), 1);

        vm.warp(vm.getBlockTimestamp() + 1);
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        _apply(p, "");
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "halted");
    }

    function test_ensMirror_off_noCall() public {
        vm.prank(owner);
        receiver.setStatusMirror(IStatusResolver(address(0)), "");
        vm.recordLogs();
        _apply(_freshPolicy(), "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countLogs(logs, IListingPolicyReceiver.StatusMirrored.selector), 0);
        assertEq(_countLogs(logs, IListingPolicyReceiver.StatusMirrorFailed.selector), 0);
        assertEq(receiver.latestPolicy().version, 1);
    }

    function test_ensWriteReverts_policyStillApplies() public {
        vm.prank(owner);
        resolver.setFailMode(MockStatusResolver.FailMode.Revert);
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrorFailed(
            address(resolver), "halted", abi.encodeWithSelector(MockStatusResolver.ForcedFailure.selector)
        );
        _apply(p, "");
        assertTrue(receiver.policy().halted, "halt applied despite the ENS failure");
        assertEq(receiver.mirroredStatusHash(), bytes32(0));
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "");
    }

    /// @dev The receiver lacks the ENS role (the resolver rejects its writer): same outcome.
    function test_ensWriteUnauthorized_policyStillApplies() public {
        vm.prank(owner);
        resolver.setWriter(makeAddr("someoneElse"));
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrorFailed(
            address(resolver),
            "listed",
            abi.encodeWithSelector(MockStatusResolver.Unauthorized.selector, address(receiver))
        );
        _apply(_freshPolicy(), "");
        assertEq(receiver.latestPolicy().version, 1);
    }

    /// @dev A resolver that burns all gas it gets: the gas cap and reserve keep `onReport` alive inside the
    ///      gas limit plan.md budgets for the CRE write (1.5M).
    function test_ensWriteOutOfGas_policyStillApplies_within1_5MGas() public {
        vm.prank(owner);
        resolver.setFailMode(MockStatusResolver.FailMode.BurnGas);
        ListingPolicy memory p = _freshPolicy();
        p.halted = true;
        bytes memory raw = _rawReport(keccak256("oog"), _encodeReport(p, ""));

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrorFailed(address(resolver), "halted", "");
        vm.expectEmit(address(forwarder));
        emit IKeystoneForwarderLike.ReportProcessed(address(receiver), keccak256("oog"), REPORT_ID, true);
        vm.prank(broadcaster, broadcaster);
        forwarder.report{gas: 1_500_000}(address(receiver), raw, "", new bytes[](0));
        assertTrue(receiver.policy().halted);
    }

    function test_ensResolverWithoutCode_policyStillApplies() public {
        address eoa = makeAddr("notAContract");
        vm.prank(owner);
        receiver.setStatusMirror(IStatusResolver(eoa), ACME_DNS);
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrorFailed(eoa, "listed", "");
        _apply(_freshPolicy(), "");
        assertEq(receiver.latestPolicy().version, 1);
    }

    function test_syncStatus_retriesAfterFailedMirror() public {
        vm.prank(owner);
        resolver.setFailMode(MockStatusResolver.FailMode.Revert);
        _apply(_freshPolicy(), "auction");
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "");

        vm.prank(owner);
        resolver.setFailMode(MockStatusResolver.FailMode.None);
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrored(address(resolver), "auction");
        vm.prank(attacker); // permissionless: it can only push the status the receiver already holds
        receiver.syncStatus();
        assertEq(resolver.text(ACME_DNS, "listingday.status"), "auction");
    }

    function test_ensMirror_reentryThroughForwarderBlocked() public {
        ReenteringResolver evil = new ReenteringResolver(address(forwarder));
        vm.prank(owner);
        receiver.setStatusMirror(evil, ACME_DNS);

        _apply(_freshPolicy(), "");
        assertFalse(evil.innerResult(), "injected report rejected");
        assertEq(receiver.latestPolicy().version, 1);
        assertFalse(receiver.policy().halted);
    }

    // ---------------------------------------------------------------- admin and ERC165

    function test_supportsInterface() public view {
        assertEq(type(IReceiver).interfaceId, IReceiver.onReport.selector);
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertTrue(receiver.supportsInterface(type(IListingPolicy).interfaceId));
        assertFalse(receiver.supportsInterface(0xffffffff));
    }

    function test_admin_onlyOwner() public {
        bytes memory onlyOwner = abi.encodeWithSelector(IListingPolicyReceiver.OnlyOwner.selector);
        vm.startPrank(attacker);
        vm.expectRevert(onlyOwner);
        receiver.setForwarder(attacker);
        vm.expectRevert(onlyOwner);
        receiver.setBroadcaster(attacker);
        vm.expectRevert(onlyOwner);
        receiver.setMaxAge(1);
        vm.expectRevert(onlyOwner);
        receiver.setStatusMirror(IStatusResolver(attacker), "");
        vm.stopPrank();
    }

    function test_admin_settersEmitAndValidate() public {
        address newForwarder = Sepolia.CRE_FORWARDER;
        vm.startPrank(owner);
        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.ForwarderSet(newForwarder);
        receiver.setForwarder(newForwarder);
        vm.expectRevert(IListingPolicyReceiver.ZeroAddress.selector);
        receiver.setForwarder(address(0));

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.BroadcasterSet(address(0));
        receiver.setBroadcaster(address(0));

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.MaxAgeSet(1 days);
        receiver.setMaxAge(1 days);
        vm.expectRevert(IListingPolicyReceiver.InvalidMaxAge.selector);
        receiver.setMaxAge(0);

        vm.expectEmit(address(receiver));
        emit IListingPolicyReceiver.StatusMirrorSet(address(resolver), ACME_DNS);
        receiver.setStatusMirror(resolver, ACME_DNS);
        vm.stopPrank();

        assertEq(receiver.forwarder(), newForwarder);
        assertEq(receiver.broadcaster(), address(0));
        assertEq(receiver.maxAge(), 1 days);
        assertEq(address(receiver.statusResolver()), address(resolver));
        assertEq(receiver.statusName(), ACME_DNS);

        // The old (mock) forwarder is no longer accepted.
        assertFalse(_deliver(address(forwarder), address(receiver), broadcaster, _encodeReport(_freshPolicy(), "")));
    }

    function test_constructor_validates() public {
        vm.expectRevert(IListingPolicyReceiver.ZeroAddress.selector);
        new ListingPolicyReceiver(address(0), address(forwarder), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, MAX_AGE);
        vm.expectRevert(IListingPolicyReceiver.ZeroAddress.selector);
        new ListingPolicyReceiver(owner, address(0), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, MAX_AGE);
        vm.expectRevert(IListingPolicyReceiver.InvalidMaxAge.selector);
        new ListingPolicyReceiver(owner, address(forwarder), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, 0);

        assertEq(receiver.owner(), owner);
        assertEq(receiver.forwarder(), address(forwarder));
        assertEq(receiver.broadcaster(), broadcaster);
        assertEq(receiver.chainSelector(), Sepolia.CRE_CHAIN_SELECTOR);
        assertEq(receiver.maxAge(), MAX_AGE);
        assertEq(receiver.STATUS_KEY(), "listingday.status");
    }
}
