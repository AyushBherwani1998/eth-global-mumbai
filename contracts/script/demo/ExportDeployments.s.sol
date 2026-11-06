// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DemoBase} from "./DemoBase.sol";
import {console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Collects the transaction hashes of every demo step from forge's broadcast logs
///         (`broadcast/<Step>.s.sol/<chainId>/run-*.json`) into the `txs` section of the deployments file, and
///         prints them with explorer links. Reads files only (no RPC needed).
///
///   [DEPLOYMENTS_FILE=deployments/sepolia.json] forge script script/demo/ExportDeployments.s.sol
///
/// Only transactions mined at or after the file's `deployBlock` are kept, so older listings' runs drop out.
/// Funding, the `listingday.eth` registration and its UserRegistry are listing-independent and usually run before
/// the deploy, so all of their transactions are kept.
/// Every run file is read (not only run-latest), so hashes survive idempotent re-runs.
contract ExportDeployments is DemoBase {
    struct TxEntry {
        string hash;
        uint256 blockNumber;
        uint256 status;
        string label;
    }

    function run() external {
        if (!vm.exists(_file())) {
            console2.log("no deployments file yet (", _file(), "): nothing to export");
            return;
        }
        string memory j = _json();
        uint256 chainId = vm.parseJsonUint(j, ".chainId");
        uint256 deployBlock = _jsonUint(j, ".deployBlock");
        console2.log("=== ExportDeployments", _file());

        (string[] memory steps, string[] memory scripts) = _steps();
        string[] memory lists = new string[](steps.length);
        string memory txs;
        for (uint256 i; i < steps.length; i++) {
            lists[i] = _stepJson(steps[i], scripts[i], chainId, deployBlock);
            txs = vm.serializeString("txs", steps[i], "");
        }
        _writeSection("txs", txs);
        for (uint256 i; i < steps.length; i++) {
            _writeArray(string.concat(".txs.", steps[i]), lists[i]);
        }
    }

    function _steps() internal pure returns (string[] memory steps, string[] memory scripts) {
        steps = new string[](12);
        scripts = new string[](12);
        (steps[0], scripts[0]) = ("fund", "FundDemoWallets.s.sol");
        (steps[1], scripts[1]) = ("deploy", "DemoDeploy.s.sol");
        (steps[2], scripts[2]) = ("launch", "DemoLaunch.s.sol");
        (steps[3], scripts[3]) = ("bids", "DemoBid.s.sol");
        (steps[4], scripts[4]) = ("settle", "DemoSettle.s.sol");
        (steps[5], scripts[5]) = ("trade", "DemoTrade.s.sol");
        (steps[6], scripts[6]) = ("halt", "DemoHalt.s.sol");
        (steps[7], scripts[7]) = ("ensName", "EnsName.s.sol");
        (steps[8], scripts[8]) = ("ensRegistry", "EnsRegistry.s.sol");
        (steps[9], scripts[9]) = ("ensTicker", "EnsTicker.s.sol");
        (steps[10], scripts[10]) = ("ensRecords", "EnsRecords.s.sol");
        (steps[11], scripts[11]) = ("ensStatusRole", "EnsStatusRole.s.sol");
    }

    function _listingIndependent(string memory step) internal pure returns (bool) {
        bytes32 h = keccak256(bytes(step));
        return h == keccak256("fund") || h == keccak256("ensName") || h == keccak256("ensRegistry");
    }

    function _stepJson(string memory step, string memory script, uint256 chainId, uint256 deployBlock)
        internal
        returns (string memory)
    {
        string memory dir = string.concat(vm.projectRoot(), "/broadcast/", script, "/", vm.toString(chainId));
        TxEntry[] memory entries = collect(dir, _listingIndependent(step) ? 0 : deployBlock);
        _print(step, entries, chainId);
        return _toJson(step, entries);
    }

    /// @notice Every transaction in `dir/run-<timestamp>.json` mined at or after `fromBlock`, oldest first.
    function collect(string memory dir, uint256 fromBlock) public view returns (TxEntry[] memory entries) {
        if (!vm.isDir(dir)) return entries;
        VmSafe.DirEntry[] memory files = vm.readDir(dir);
        TxEntry[] memory all = new TxEntry[](256);
        uint256 n;
        for (uint256 f; f < files.length; f++) {
            string memory path = files[f].path;
            if (files[f].isDir || !vm.contains(path, "/run-") || vm.contains(path, "run-latest")) continue;
            n = _collectFile(vm.readFile(path), fromBlock, all, n);
        }
        entries = new TxEntry[](n);
        for (uint256 i; i < n; i++) {
            entries[i] = all[i];
        }
        _sortByBlock(entries);
    }

    function _collectFile(string memory runJson, uint256 fromBlock, TxEntry[] memory all, uint256 n)
        internal
        view
        returns (uint256)
    {
        for (uint256 i; vm.keyExistsJson(runJson, string.concat(".transactions[", vm.toString(i), "]")); i++) {
            string memory t = string.concat(".transactions[", vm.toString(i), "]");
            string memory hash = vm.parseJsonString(runJson, string.concat(t, ".hash"));
            (bool mined, uint256 blockNumber, uint256 status) = _receipt(runJson, hash);
            if (!mined || blockNumber < fromBlock || n == all.length) continue;
            all[n++] = TxEntry({hash: hash, blockNumber: blockNumber, status: status, label: _txLabel(runJson, t)});
        }
        return n;
    }

    function _receipt(string memory runJson, string memory hash)
        internal
        view
        returns (bool found, uint256 blockNumber, uint256 status)
    {
        for (uint256 i; vm.keyExistsJson(runJson, string.concat(".receipts[", vm.toString(i), "]")); i++) {
            string memory r = string.concat(".receipts[", vm.toString(i), "]");
            if (
                keccak256(bytes(vm.parseJsonString(runJson, string.concat(r, ".transactionHash"))))
                    != keccak256(bytes(hash))
            ) {
                continue;
            }
            return (
                true,
                vm.parseJsonUint(runJson, string.concat(r, ".blockNumber")),
                vm.parseJsonUint(runJson, string.concat(r, ".status"))
            );
        }
    }

    /// @dev "ContractName.function(args)" for calls, "create ContractName" for deployments, else the target.
    function _txLabel(string memory runJson, string memory t) internal view returns (string memory) {
        string memory name = _optString(runJson, string.concat(t, ".contractName"));
        string memory fn = _optString(runJson, string.concat(t, ".function"));
        if (bytes(fn).length != 0) return bytes(name).length != 0 ? string.concat(name, ".", fn) : fn;
        string memory kind = _optString(runJson, string.concat(t, ".transactionType"));
        if (bytes(kind).length != 0 && vm.contains(kind, "CREATE")) return string.concat("create ", name);
        return string.concat("call ", _optString(runJson, string.concat(t, ".transaction.to")));
    }

    function _optString(string memory json, string memory key) internal view returns (string memory) {
        if (!vm.keyExistsJson(json, key)) return "";
        try vm.parseJsonString(json, key) returns (string memory s) {
            return keccak256(bytes(s)) == keccak256("null") ? "" : s;
        } catch {
            return "";
        }
    }

    function _sortByBlock(TxEntry[] memory a) internal pure {
        for (uint256 i = 1; i < a.length; i++) {
            TxEntry memory x = a[i];
            uint256 k = i;
            while (k > 0 && a[k - 1].blockNumber > x.blockNumber) {
                a[k] = a[k - 1];
                k--;
            }
            a[k] = x;
        }
    }

    function _toJson(string memory step, TxEntry[] memory entries) internal returns (string memory list) {
        list = "[";
        for (uint256 i; i < entries.length; i++) {
            string memory o = string.concat("tx-", step, "-", vm.toString(i));
            vm.serializeString(o, "hash", entries[i].hash);
            vm.serializeUint(o, "block", entries[i].blockNumber);
            vm.serializeUint(o, "status", entries[i].status);
            o = vm.serializeString(o, "label", entries[i].label);
            list = string.concat(list, i == 0 ? "" : ",", o);
        }
        list = string.concat(list, "]");
    }

    function _print(string memory step, TxEntry[] memory entries, uint256 chainId) internal pure {
        if (entries.length == 0) return;
        string memory explorer = chainId == 11_155_111 ? "https://sepolia.etherscan.io/tx/" : "";
        console2.log(string.concat("[", step, "]"));
        for (uint256 i; i < entries.length; i++) {
            console2.log(
                string.concat(
                    "  ",
                    explorer,
                    entries[i].hash,
                    "  block ",
                    vm.toString(entries[i].blockNumber),
                    entries[i].status == 1 ? "  ok  " : "  FAILED  ",
                    entries[i].label
                )
            );
        }
    }
}
