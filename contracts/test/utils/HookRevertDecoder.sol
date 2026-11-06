// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";

/// @notice Unwraps CCA `ValidationHookCallFailed(bytes reason)` revert data the way the frontend will.
library HookRevertDecoder {
    error NotValidationHookCallFailed(bytes4 selector);

    function selectorOf(bytes memory revertData) internal pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 0x20))
        }
    }

    /// @return inner The hook's own revert data (selector + args).
    function unwrap(bytes memory revertData) internal pure returns (bytes memory inner) {
        bytes4 selector = selectorOf(revertData);
        if (selector != ValidationHookLib.ValidationHookCallFailed.selector) {
            revert NotValidationHookCallFailed(selector);
        }
        inner = abi.decode(stripSelector(revertData), (bytes));
    }

    function stripSelector(bytes memory data) internal pure returns (bytes memory args) {
        args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; i++) {
            args[i] = data[i + 4];
        }
    }
}
