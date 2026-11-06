// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EnsNames, EnsRoles} from "../../src/libraries/EnsV2.sol";
import {Test} from "forge-std/Test.sol";

/// @notice DNS encoding and namehash against `cast namehash` / `cast keccak` vectors.
contract EnsNamesTest is Test {
    function test_dnsEncode() public pure {
        assertEq(EnsNames.dnsEncode("acme.listingday.eth"), hex"0461636d650a6c697374696e676461790365746800");
        assertEq(EnsNames.dnsEncode("eth"), hex"0365746800");
        assertEq(EnsNames.dnsEncode(""), hex"00");
    }

    function test_namehash() public pure {
        assertEq(EnsNames.namehash(hex"00"), bytes32(0));
        assertEq(
            EnsNames.namehash(EnsNames.dnsEncode("eth")),
            0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae
        );
        assertEq(
            EnsNames.namehash(EnsNames.dnsEncode("listingday.eth")),
            0x77014c455514cd279247dc21c1ca0c9324e9f5022bc363c7b33c4d3d633ed5e2
        );
        assertEq(
            EnsNames.namehash(EnsNames.dnsEncode("acme.listingday.eth")),
            0x42fda8b2a317e700428cbde662bc0a8d5711828ee563cb6276bc6423c3635734
        );
    }

    function test_labelhashAndTextResource() public pure {
        assertEq(EnsNames.labelhash("acme"), 0xe29dae06ef4c3e336b7538b6d4f52ca1ecec009b1df6fb501320e11b223aeeaf);
        assertEq(
            EnsRoles.textResource("listingday.status"),
            uint256(0x0b39d70a5047006ca3eb61a7c8f6168ce949db726a9c7b2e5afade13229ff1e4)
        );
    }

    function test_dnsEncode_rejectsEmptyLabels() public {
        vm.expectRevert(abi.encodeWithSelector(EnsNames.InvalidName.selector, "acme..eth"));
        this.encode("acme..eth");
        vm.expectRevert(abi.encodeWithSelector(EnsNames.InvalidName.selector, ".eth"));
        this.encode(".eth");
        vm.expectRevert(abi.encodeWithSelector(EnsNames.InvalidName.selector, "eth."));
        this.encode("eth.");
    }

    function test_roles() public pure {
        assertEq(EnsRoles.ISSUER_TICKER_ROLES, 0x1010000, "SET_RESOLVER | RENEW");
        assertEq(EnsRoles.LISTING_REGISTRY_ROOT_ROLES, 0x1101, "REGISTRAR | SET_PARENT | UNREGISTER");
        assertEq(EnsRoles.ISSUER_TICKER_ROLES & EnsRoles.ROLE_CAN_TRANSFER_ADMIN, 0, "not transferable");
    }

    function encode(string calldata name) external pure returns (bytes memory) {
        return EnsNames.dnsEncode(name);
    }
}
