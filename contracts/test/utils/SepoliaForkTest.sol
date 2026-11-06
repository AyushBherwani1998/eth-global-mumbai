// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Base for Sepolia fork tests.
/// @dev Runs on a Sepolia fork when either `forge test --fork-url <sepolia rpc>` is used, or
///      `SEPOLIA_RPC_URL` is set (optionally pinned with `SEPOLIA_FORK_BLOCK`). Otherwise every test in the
///      inheriting contract is skipped with a reason, so `forge test` stays green offline.
abstract contract SepoliaForkTest is Test {
    string internal constant SKIP_REASON =
        "SEPOLIA_RPC_URL not set: skipping Sepolia fork test (set it or run forge test --fork-url $SEPOLIA_RPC_URL)";

    function setUp() public virtual {
        if (vm.getChainId() != Sepolia.CHAIN_ID) {
            string memory rpcUrl = vm.envOr("SEPOLIA_RPC_URL", string(""));
            if (bytes(rpcUrl).length == 0) {
                vm.skip(true, SKIP_REASON);
                return;
            }
            uint256 forkBlock = vm.envOr("SEPOLIA_FORK_BLOCK", uint256(0));
            if (forkBlock == 0) vm.createSelectFork(rpcUrl);
            else vm.createSelectFork(rpcUrl, forkBlock);
        }
        assertEq(vm.getChainId(), Sepolia.CHAIN_ID, "fork is not Sepolia");
        setUpFork();
    }

    /// @notice Fork-only setup, called after the Sepolia fork is selected.
    function setUpFork() internal virtual {}
}
