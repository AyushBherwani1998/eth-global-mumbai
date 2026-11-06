// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IReceiver} from "../../src/interfaces/IReceiver.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/// @notice Local port of Chainlink's `MockKeystoneForwarder` (chainlink-evm `contracts/cre/src/dev`), the contract
///         behind the Sepolia mock forwarder 0x15fC…9F88 that `cre workflow simulate --broadcast` calls. Same
///         report layout, same permissionless `report` and `route`, same ERC165 check, same swallowed revert.
///         Ownership, the forwarder registry and transmission bookkeeping are left out.
contract MockKeystoneForwarder {
    error InvalidReport();

    event ReportProcessed(
        address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result
    );

    uint256 internal constant METADATA_LENGTH = 109;
    uint256 internal constant FORWARDER_METADATA_LENGTH = 45;

    function route(bytes32, address, address receiver, bytes calldata metadata, bytes calldata validatedReport)
        public
        returns (bool success)
    {
        if (!ERC165Checker.supportsInterface(receiver, type(IReceiver).interfaceId)) return false;
        bytes memory payload = abi.encodeCall(IReceiver.onReport, (metadata, validatedReport));
        assembly ("memory-safe") {
            success := call(gas(), receiver, 0, add(payload, 0x20), mload(payload), 0x0, 0x0)
        }
    }

    function report(address receiver, bytes calldata rawReport, bytes calldata, bytes[] calldata) external {
        if (rawReport.length < METADATA_LENGTH) revert InvalidReport();
        bytes32 workflowExecutionId = bytes32(rawReport[1:33]);
        bytes2 reportId = bytes2(rawReport[107:109]);
        bool success = this.route(
            keccak256(bytes.concat(bytes20(uint160(receiver)), workflowExecutionId, reportId)),
            msg.sender,
            receiver,
            rawReport[FORWARDER_METADATA_LENGTH:METADATA_LENGTH],
            rawReport[METADATA_LENGTH:]
        );
        emit ReportProcessed(receiver, workflowExecutionId, reportId, success);
    }
}
