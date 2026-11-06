// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ExportDeployments} from "../../script/demo/ExportDeployments.s.sol";
import {Test} from "forge-std/Test.sol";

/// @notice The tx-hash collector on a trimmed copy of a real anvil broadcast of DemoDeploy, plus an older run
///         holding a tx from an earlier block, a failed tx, and an unmined tx.
contract ExportDeploymentsTest is Test {
    ExportDeployments internal exporter;
    string internal dir;

    uint256 internal constant DEPLOY_BLOCK = 12_076_133;

    function setUp() public {
        exporter = new ExportDeployments();
        dir = string.concat(vm.projectRoot(), "/test/fixtures/broadcast/DemoDeploy.s.sol/31337");
    }

    function test_collect_readsEveryRunFileButNotRunLatest() public view {
        ExportDeployments.TxEntry[] memory txs = exporter.collect(dir, 0);
        assertEq(txs.length, 8, "6 from the latest run + 2 mined from the older run");

        assertEq(txs[0].hash, "0x1111111111111111111111111111111111111111111111111111111111111111");
        assertEq(txs[0].blockNumber, 12_076_032);
        assertEq(txs[0].status, 1);
        assertEq(txs[0].label, "create MockSME");

        assertEq(txs[1].status, 0, "failed tx is kept, with its status");
        assertEq(txs[1].label, "create AllowAllModule");

        for (uint256 i = 1; i < txs.length; i++) {
            assertGe(txs[i].blockNumber, txs[i - 1].blockNumber, "sorted by block");
            assertTrue(
                keccak256(bytes(txs[i].hash))
                    != keccak256("0x00000000000000000000000000000000000000000000000000000000000000bb"),
                "unmined tx dropped"
            );
        }
    }

    function test_collect_dropsTransactionsBeforeTheDeployBlock() public view {
        ExportDeployments.TxEntry[] memory txs = exporter.collect(dir, DEPLOY_BLOCK);
        assertEq(txs.length, 6);
        assertEq(txs[0].hash, "0xabc3c7b012d6c29e16715add93bc231b45a8b85f332f4daafca79c7c1dc005ef");
        assertEq(txs[0].blockNumber, DEPLOY_BLOCK);
        assertEq(txs[0].label, "create MockSME");
        assertEq(txs[3].label, "create ListingHook");
        assertEq(txs[5].hash, "0xd73b90a4e19f9e0dd26169a9ce666df8628a5ef2070a41284a08f9c3c54312d6");
        assertEq(txs[5].label, "ListingHook.setPolicySource(address)");
        for (uint256 i; i < txs.length; i++) {
            assertEq(txs[i].status, 1);
        }
    }

    function test_collect_missingDirectoryIsEmpty() public view {
        assertEq(exporter.collect(string.concat(vm.projectRoot(), "/test/fixtures/broadcast/none"), 0).length, 0);
    }
}
