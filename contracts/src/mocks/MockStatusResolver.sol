// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IStatusResolver} from "../interfaces/IStatusResolver.sol";

/// @title MockStatusResolver
/// @notice Unit-test stand-in for the issuer's ENSv2 Permissioned Resolver (the real one is covered by
///         `EnsNamespace.fork.t.sol`). Stores `setText` writes and can be told to fail, to exercise
///         `ListingPolicyReceiver`'s best-effort mirror.
/// @dev Like the real resolver's scoped role, only `writer` may set records (once `writer` is set).
contract MockStatusResolver is IStatusResolver {
    enum FailMode {
        None,
        Revert,
        BurnGas
    }

    error Unauthorized(address caller);
    error ForcedFailure();

    event TextChanged(bytes name, string key, string value);

    address public immutable owner;
    address public writer;
    FailMode public failMode;
    mapping(bytes32 nameKeyHash => string value) internal _text;

    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address owner_) {
        owner = owner_;
    }

    /// @notice Owner-only: restrict writes to `writer_` (address(0) = anyone).
    // forge-lint: disable-next-line(missing-zero-check)
    function setWriter(address writer_) external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        writer = writer_;
    }

    /// @notice Owner-only: make `setText` revert or run out of gas.
    function setFailMode(FailMode mode) external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        failMode = mode;
    }

    /// @inheritdoc IStatusResolver
    function setText(bytes calldata name, string calldata key, string calldata value) external {
        if (failMode == FailMode.Revert) revert ForcedFailure();
        if (failMode == FailMode.BurnGas) {
            while (true) {}
        }
        if (writer != address(0) && msg.sender != writer) revert Unauthorized(msg.sender);
        _text[keccak256(abi.encode(name, key))] = value;
        emit TextChanged(name, key, value);
    }

    /// @notice The stored text record.
    function text(bytes calldata name, string calldata key) external view returns (string memory) {
        return _text[keccak256(abi.encode(name, key))];
    }
}
