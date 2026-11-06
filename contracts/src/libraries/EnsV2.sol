// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title EnsRoles
/// @notice ENSv2 Enhanced Access Control role bits (contracts-v2 tag `v2-mainnet-deployment-1`:
///         `RegistryRolesLib`, `PermissionedResolverLib`, `EACBaseRolesLib`). One nybble per role; the admin
///         variant sits 128 bits higher. Effective roles on a resource are `root | resource`.
library EnsRoles {
    // ---------------------------------------------------------------- registry (PermissionedRegistry)

    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_SET_PARENT = 1 << 8;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
    uint256 internal constant ROLE_RENEW = 1 << 16;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_SET_SUBREGISTRY_ADMIN = ROLE_SET_SUBREGISTRY << 128;
    uint256 internal constant ROLE_SET_RESOLVER_ADMIN = ROLE_SET_RESOLVER << 128;
    /// @dev Checked on the token owner at transfer; only grantable at registration (token admin roles can't be
    ///      granted later). Without it every transfer reverts.
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;

    /// @dev `ETHRegistrar.REGISTRATION_ROLE_BITMAP`: what the .eth owner (us, for `listingday.eth`) receives.
    uint256 internal constant ETH_REGISTRATION_ROLES = ROLE_SET_SUBREGISTRY | ROLE_SET_SUBREGISTRY_ADMIN
        | ROLE_SET_RESOLVER | ROLE_SET_RESOLVER_ADMIN | ROLE_CAN_TRANSFER_ADMIN;

    // ---------------------------------------------------------------- resolver (PermissionedResolver)

    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;

    /// @dev `EACBaseRolesLib.ALL_ROLES`: every role and admin role. The ENS app grants this to a resolver's owner.
    uint256 internal constant ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;

    /// @notice EAC resource a `PermissionedResolver` checks for `setText(*, key, *)` (besides root).
    function textResource(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }

    // ---------------------------------------------------------------- Listing Day policy (plan.md §7)

    /// @notice Our root roles on the `listingday.eth` UserRegistry: register tickers, unregister delisted ones, and
    ///         set the registry's canonical parent. No admin roles, no upgrade role.
    uint256 internal constant LISTING_REGISTRY_ROOT_ROLES = ROLE_REGISTRAR | ROLE_UNREGISTER | ROLE_SET_PARENT;
    /// @notice The issuer's roles on its ticker token: point it at a resolver and renew it. Not
    ///         `ROLE_CAN_TRANSFER_ADMIN`, so the ticker can't be transferred away mid-IPO.
    uint256 internal constant ISSUER_TICKER_ROLES = ROLE_SET_RESOLVER | ROLE_RENEW;
}

/// @title EnsNames
/// @notice DNS wire encoding (RFC 1035, what every ENSv2 setter and the Universal Resolver take) and ENSIP-1
///         namehash, for dot-separated names. No normalization: pass already-normalized ASCII labels.
library EnsNames {
    error InvalidName(string name);

    /// @notice "acme.listingday.eth" -> 0x04 "acme" 0x0a "listingday" 0x03 "eth" 0x00. "" -> 0x00.
    function dnsEncode(string memory name) internal pure returns (bytes memory out) {
        bytes memory s = bytes(name);
        if (s.length == 0) return hex"00";
        out = new bytes(s.length + 2);
        uint256 lenAt;
        for (uint256 i; i <= s.length; i++) {
            if (i == s.length || s[i] == ".") {
                uint256 len = i - lenAt;
                if (len == 0 || len > 255) revert InvalidName(name);
                // casting to 'uint8' is safe because len <= 255 is checked above
                // forge-lint: disable-next-line(unsafe-typecast)
                out[lenAt] = bytes1(uint8(len));
                lenAt = i + 1;
            } else {
                out[i + 1] = s[i];
            }
        }
    }

    /// @notice ENSIP-1 namehash of a DNS-encoded name.
    function namehash(bytes memory dnsName) internal pure returns (bytes32 node) {
        return _namehash(dnsName, 0);
    }

    function labelhash(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _namehash(bytes memory dnsName, uint256 offset) private pure returns (bytes32) {
        if (offset >= dnsName.length) revert InvalidName("");
        uint256 len = uint8(dnsName[offset]);
        if (len == 0) return bytes32(0);
        if (offset + 1 + len >= dnsName.length) revert InvalidName("");
        bytes32 labelHash;
        assembly ("memory-safe") {
            labelHash := keccak256(add(add(dnsName, 33), offset), len)
        }
        return keccak256(abi.encodePacked(_namehash(dnsName, offset + 1 + len), labelHash));
    }
}
