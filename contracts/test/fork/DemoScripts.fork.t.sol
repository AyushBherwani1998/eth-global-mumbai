// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DemoFork} from "../../script/demo/DemoFork.s.sol";
import {SepoliaForkTest} from "../utils/SepoliaForkTest.sol";

/// @notice The full Sepolia demo sequence (fund, deploy, launch, bids, settle, trade, halt, resume, export) on a
///         fork, every step run twice for idempotency, with the asserts in `DemoFork`. `make demo-fork` runs the
///         same thing as a forge script.
contract DemoScriptsForkTest is SepoliaForkTest {
    function test_demoScripts_endToEnd() public {
        new DemoFork().run();
    }
}
