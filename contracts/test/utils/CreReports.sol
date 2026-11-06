// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice The forwarder entry point `cre workflow simulate --broadcast` calls, and its event.
interface IKeystoneForwarderLike {
    event ReportProcessed(
        address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result
    );

    function report(address receiver, bytes calldata rawReport, bytes calldata reportContext, bytes[] calldata sigs)
        external;
    function route(
        bytes32 transmissionId,
        address transmitter,
        address receiver,
        bytes calldata metadata,
        bytes calldata validatedReport
    ) external returns (bool);
}

/// @notice Builds CRE reports the way the simulator does and delivers them through a Keystone-style forwarder.
abstract contract CreReports is Test {
    /// @dev Placeholders the simulator puts in the metadata (decoded from a Sepolia `report` tx).
    bytes32 internal constant SIM_WORKFLOW_CID = 0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes10 internal constant SIM_WORKFLOW_NAME = bytes10("bb40b1888a");
    address internal constant SIM_WORKFLOW_OWNER = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
    bytes2 internal constant REPORT_ID = 0x0001;

    uint256 internal _executionNonce;

    /// @notice `abi.encode(ListingPolicy, string)`, the receiver's report payload.
    function _encodeReport(ListingPolicy memory p, string memory status) internal pure returns (bytes memory) {
        return abi.encode(p, status);
    }

    /// @notice The 64-byte metadata a forwarder passes to `onReport` (cid, name, owner, report id).
    function _metadata() internal pure returns (bytes memory) {
        return abi.encodePacked(SIM_WORKFLOW_CID, SIM_WORKFLOW_NAME, SIM_WORKFLOW_OWNER, REPORT_ID);
    }

    /// @notice Full `rawReport` for `forwarder.report`: 45-byte forwarder header, 64-byte metadata, payload.
    function _rawReport(bytes32 executionId, bytes memory payload) internal view returns (bytes memory) {
        return abi.encodePacked(
            uint8(1), executionId, uint32(vm.getBlockTimestamp()), uint32(1), uint32(1), _metadata(), payload
        );
    }

    /// @notice A policy for the Sepolia chain selector, `asOf` = now, everything else default.
    function _freshPolicy() internal view returns (ListingPolicy memory p) {
        p.chainSelector = Sepolia.CRE_CHAIN_SELECTOR;
        // forge-lint: disable-next-line(unsafe-typecast)
        p.asOf = uint64(vm.getBlockTimestamp());
    }

    /// @notice Sends `forwarder.report(receiver, ...)` from `sender` (also tx.origin) and returns
    ///         `ReportProcessed.result`.
    function _deliver(address forwarder, address receiver, address sender, bytes memory payload)
        internal
        returns (bool result)
    {
        return _deliver(forwarder, receiver, sender, payload, gasleft() - 100_000);
    }

    /// @notice Same, with the call gas capped like the workflow's `gasConfig.gasLimit`.
    function _deliver(address forwarder, address receiver, address sender, bytes memory payload, uint256 gasLimit)
        internal
        returns (bool result)
    {
        bytes32 executionId = keccak256(abi.encode("execution", ++_executionNonce));
        bytes memory raw = _rawReport(executionId, payload);
        vm.recordLogs();
        vm.prank(sender, sender);
        IKeystoneForwarderLike(forwarder).report{gas: gasLimit}(receiver, raw, "", new bytes[](0));
        return _reportProcessedResult(forwarder, receiver, executionId);
    }

    function _reportProcessedResult(address forwarder, address receiver, bytes32 executionId)
        internal
        view
        returns (bool)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (
                logs[i].emitter == forwarder && logs[i].topics[0] == IKeystoneForwarderLike.ReportProcessed.selector
                    && logs[i].topics[1] == bytes32(uint256(uint160(receiver))) && logs[i].topics[2] == executionId
            ) {
                assertEq(logs[i].topics[3], bytes32(REPORT_ID), "report id");
                return abi.decode(logs[i].data, (bool));
            }
        }
        revert("ReportProcessed not emitted");
    }
}
