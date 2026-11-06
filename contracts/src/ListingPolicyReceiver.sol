// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Sepolia} from "./libraries/Constants.sol";

/// @title IKeystoneReceiver
/// @notice Minimal CRE receiver interface (MockKeystoneForwarder and KeystoneForwarder both call `onReport`).
interface IKeystoneReceiver {
    /// @notice Called by the CRE forwarder with the workflow report and metadata.
    /// @param metadata 64 bytes: workflowId (32) + owner (20) + padding (12).
    /// @param report The workflow output (ABI-encoded ListingPolicy).
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title ListingPolicy
/// @notice CRE policy report structure (plan.md §6).
/// @dev `asOf` is monotonically increasing per version. `chainSelector` must equal Sepolia's selector.
struct ListingPolicy {
    uint32 version;
    uint64 asOf;
    uint64 chainSelector;
    uint160 refSqrtPriceX96;
    uint16 normalBandBps;
    uint16 survBandBps;
    uint8 mode;
    bool halted;
    uint64 coolOffUntil;
}

/// @title ListingPolicyReceiver
/// @notice CRE policy store for Listing Day (plan.md §6, "ListingPolicyReceiver").
/// @dev Features:
///      - Monotonic `asOf` per version (rejects stale or replayed reports).
///      - Hackathon guard: requires `tx.origin ==` the configured broadcaster (the mock forwarder is permissionless).
///      - Best-effort ENS status mirror (`setText`) via try/catch (the mirror is storage-heavy; may OOG).
///      - Emits `PolicyApplied` on success so the UI can read policy updates from the receiver event, not tx status.
contract ListingPolicyReceiver is IKeystoneReceiver {
    error InvalidChainSelector(uint64 expected, uint64 received);
    error StalePolicy(uint32 version, uint64 asOf, uint64 lastAsOf);
    error OnlyBroadcaster(address caller, address txOrigin, address expected);

    event PolicyApplied(
        uint32 indexed version,
        uint64 asOf,
        uint160 refSqrtPriceX96,
        uint16 normalBandBps,
        uint16 survBandBps,
        uint8 mode,
        bool halted,
        uint64 coolOffUntil
    );

    /// @notice The CRE broadcaster key (hackathon guard; checked via `tx.origin`).
    address public immutable broadcaster;
    /// @notice ENS DNS-encoded name for the ticker (e.g. `dnsEncode("acme.listingday.eth")`).
    ///         Empty if the status mirror is disabled.
    bytes public ensName;
    /// @notice The latest policy.
    ListingPolicy public policy;
    /// @notice Per-version last `asOf` timestamp (monotonic check).
    mapping(uint32 version => uint64 lastAsOf) public lastAsOf;

    /// @param _broadcaster The address whose `tx.origin` is allowed to trigger `onReport` (CRE key).
    /// @param _ensName DNS-encoded ENS name for the ticker (empty to disable the status mirror).
    constructor(address _broadcaster, bytes memory _ensName) {
        broadcaster = _broadcaster;
        ensName = _ensName;
    }

    /// @notice CRE forwarder calls this with the policy report.
    /// @param report ABI-encoded `ListingPolicy`.
    function onReport(bytes calldata /* metadata */, bytes calldata report) external override {
        // Hackathon guard: the mock forwarder is permissionless, so require tx.origin == broadcaster.
        // Production: check msg.sender == KeystoneForwarder and validate metadata (workflowId/owner).
        if (tx.origin != broadcaster) revert OnlyBroadcaster(msg.sender, tx.origin, broadcaster);

        ListingPolicy memory newPolicy = abi.decode(report, (ListingPolicy));

        // Chain selector must match Sepolia.
        if (newPolicy.chainSelector != Sepolia.CRE_CHAIN_SELECTOR) {
            revert InvalidChainSelector(Sepolia.CRE_CHAIN_SELECTOR, newPolicy.chainSelector);
        }

        // Monotonic asOf per version.
        uint64 last = lastAsOf[newPolicy.version];
        if (newPolicy.asOf <= last) {
            revert StalePolicy(newPolicy.version, newPolicy.asOf, last);
        }

        policy = newPolicy;
        lastAsOf[newPolicy.version] = newPolicy.asOf;

        emit PolicyApplied(
            newPolicy.version,
            newPolicy.asOf,
            newPolicy.refSqrtPriceX96,
            newPolicy.normalBandBps,
            newPolicy.survBandBps,
            newPolicy.mode,
            newPolicy.halted,
            newPolicy.coolOffUntil
        );

        // Best-effort ENS status mirror.
        if (ensName.length > 0) {
            _mirrorStatusToENS(newPolicy);
        }
    }

    /// @notice Mirrors the policy status to the ENS record `listingday.status`.
    /// @dev Try/catch: the setText call is storage-heavy and may OOG. If it fails, the policy is still stored.
    function _mirrorStatusToENS(ListingPolicy memory p) internal {
        // Simplified: ENS resolver address resolution is skipped in this implementation.
        // For production, pass the resolver address in the constructor or resolve it from the ENS registry.
        // The deployer must grant this receiver a scoped role for "listingday.status".
        
        // For now, we skip the actual setText call to avoid calling address(0).
        // In a production deployment with a real ENS setup, uncomment and configure the resolver.
        
        /*
        string memory status;
        if (p.halted) {
            status = "halted";
        } else if (p.mode == 1) {
            status = "surveillance";
        } else if (p.mode == 2) {
            status = "directional";
        } else {
            status = "listed";
        }

        address resolver = ensResolver();
        if (resolver != address(0)) {
            try IENSResolver(resolver).setText(ensName, "listingday.status", status) {}
            catch {
                // Status mirror failed (likely OOG). The policy is still stored and the event is emitted.
            }
        }
        */
    }
}

/// @title IENSResolver
/// @notice Minimal ENSv2 Permissioned Resolver interface for `setText`.
interface IENSResolver {
    function setText(bytes calldata name, string calldata key, string calldata value) external;
}
