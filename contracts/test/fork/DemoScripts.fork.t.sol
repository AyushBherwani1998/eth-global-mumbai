// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DemoFork} from "../../script/demo/DemoFork.s.sol";
import {EnsFork} from "../../script/ens/EnsFork.s.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";

/// @notice The full Sepolia demo sequence (fund, deploy, launch, bids, settle, trade, halt, resume, export) on a
///         fork, every step run twice for idempotency, with the asserts in `DemoFork`; then the ENSv2 ticker
///         namespace steps with the asserts in `EnsFork`. `make demo-fork` / `make ens-fork` run the same scripts.
///         The demo runs twice: an `open` listing (AllowAllModule) and a `human` one (WorldPassModule).
/// @dev One test on purpose: the scripts take their config from process-wide env vars (`vm.setEnv`), and forge
///      runs test functions in parallel.
contract DemoScriptsForkTest is SepoliaForkTest {
    function test_demoScripts_endToEnd() public {
        vm.setEnv("ELIGIBILITY", "open");
        new DemoFork().run();
        vm.setEnv("ELIGIBILITY", "human");
        new DemoFork().run();
        new EnsFork().run();
    }
}
