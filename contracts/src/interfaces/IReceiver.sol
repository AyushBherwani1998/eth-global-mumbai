// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver
/// @notice Chainlink CRE report consumer, as in smartcontractkit/chainlink-evm
///         `contracts/cre/src/v1/interfaces/IReceiver.sol`. Forwarders check it through ERC165 before calling.
interface IReceiver is IERC165 {
    /// @notice Handles an incoming CRE report.
    /// @param metadata Workflow identity (64 bytes from the forwarders: workflow id/cid, name, owner, report id).
    /// @param report The workflow's ABI-encoded payload.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
