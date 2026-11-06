// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {CreReports} from "../utils/CreReports.sol";
import {MockKeystoneForwarder} from "../utils/MockKeystoneForwarder.sol";

/// @notice Cross-language check of the CRE report encoding. `cre/listing-policy/fixtures/report-vectors.json`
///         holds report payloads produced by the TypeScript workflow (`bun test` pins them); here each one is
///         rebuilt independently with `ListingPrice` + `abi.encode`, then delivered through a forwarder to the
///         receiver, which must decode and apply exactly the expected policy.
contract CreReportFixtureTest is CreReports {
    string internal constant FIXTURE = "../cre/listing-policy/fixtures/report-vectors.json";
    uint256 internal constant CASES = 5;

    address internal broadcaster = makeAddr("creBroadcaster");
    MockKeystoneForwarder internal forwarder;
    ListingPolicyReceiver internal receiver;
    string internal json;

    function setUp() public {
        json = vm.readFile(FIXTURE);
        vm.warp(1_762_400_000);
        forwarder = new MockKeystoneForwarder();
        receiver = new ListingPolicyReceiver(
            address(this), address(forwarder), broadcaster, Sepolia.CRE_CHAIN_SELECTOR, 1 days
        );
    }

    function _key(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".cases[", vm.toString(i), "].", field);
    }

    /// @dev Rebuilds case `i` from its decoded inputs with the Solidity price math.
    function _policy(uint256 i) internal view returns (ListingPolicy memory p, string memory status) {
        uint256 pointsE2 = vm.parseJsonUint(json, _key(i, "expected.pointsE2"));
        bool usdc0 = vm.parseJsonBool(json, _key(i, "usdcIsCurrency0"));
        p.asOf = uint64(vm.parseJsonUint(json, _key(i, "asOf")));
        p.chainSelector = uint64(vm.parseJsonUint(json, _key(i, "chainSelector")));
        p.refSqrtPriceX96 = pointsE2 == 0 ? 0 : ListingPrice.pointsE2ToSqrtPriceX96(pointsE2, usdc0);
        p.normalBandBps = uint16(vm.parseJsonUint(json, _key(i, "expected.normalBandBps")));
        p.survBandBps = uint16(vm.parseJsonUint(json, _key(i, "expected.survBandBps")));
        p.mode = uint8(vm.parseJsonUint(json, _key(i, "expected.mode")));
        p.halted = vm.parseJsonBool(json, _key(i, "expected.halted"));
        p.coolOffUntil = uint64(vm.parseJsonUint(json, _key(i, "expected.coolOffUntil")));
        status = vm.parseJsonString(json, _key(i, "expected.status"));
    }

    function test_fixture_hasAllCases() public view {
        assertEq(vm.parseJsonString(json, _key(CASES - 1, "name")), "share-currency0-ref-110-listed");
        vm.assertFalse(vm.keyExistsJson(json, _key(CASES, "name")), "update CASES when adding vectors");
    }

    function test_fixture_tsPayloadsMatchSolidityEncoding() public view {
        for (uint256 i; i < CASES; i++) {
            (ListingPolicy memory p, string memory status) = _policy(i);
            assertEq(p.chainSelector, Sepolia.CRE_CHAIN_SELECTOR, "chain selector");
            assertEq(
                uint256(p.refSqrtPriceX96), vm.parseJsonUint(json, _key(i, "expected.refSqrtPriceX96")), "sqrt price"
            );
            assertEq(_encodeReport(p, status), vm.parseJsonBytes(json, _key(i, "expected.payload")), "payload bytes");
        }
    }

    function test_fixture_receiverAppliesEveryVector() public {
        string[CASES] memory derived = ["listed", "halted", "surveillance", "surveillance", "listed"];
        for (uint256 i; i < CASES; i++) {
            (ListingPolicy memory want,) = _policy(i);
            vm.warp(want.asOf);
            assertTrue(
                _deliver(
                    address(forwarder),
                    address(receiver),
                    broadcaster,
                    vm.parseJsonBytes(json, _key(i, "expected.payload"))
                ),
                "ReportProcessed.result"
            );
            want.version = uint32(i + 1);
            assertEq(abi.encode(receiver.policy()), abi.encode(want), "applied policy");
            assertEq(receiver.status(), derived[i], "status");
        }
    }
}
