// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingPolicy, ListingPolicy} from "./interfaces/IListingPolicy.sol";
import {IListingPolicyReceiver} from "./interfaces/IListingPolicyReceiver.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {IStatusResolver} from "./interfaces/IStatusResolver.sol";
import {ListingBand} from "./libraries/ListingBand.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ListingPolicyReceiver
/// @notice Chainlink CRE consumer that stores the Listing Day trading policy (reference price, bands, mode,
///         halt, cool-off) and serves it to `ListingHook` through `IListingPolicy` (`hook.setPolicySource`).
///         Mirrors `listingday.status` to the issuer's ENSv2 resolver on a best-effort basis.
/// @dev Acceptance rules for `onReport`, in order: caller is `forwarder`; `tx.origin` is `broadcaster` (hackathon
///      guard: the Sepolia MockKeystoneForwarder is permissionless, so the forwarder check alone proves nothing);
///      report chain selector matches; `asOf` strictly increases; `asOf` is at most `maxAge` old and at most
///      `MAX_FUTURE_SKEW` ahead; bands < 100% and mode <= 2; status <= 32 bytes. The policy is stored and
///      `PolicyApplied` emitted before the ENS call, which runs with a gas cap and a reserve inside try/catch, so
///      a failing resolver never blocks a policy.
///      Staleness rule: once `block.timestamp > asOf + maxAge`, `policy()` reports `halted = true` (fail closed:
///      no fresh surveillance data, no trading). Liquidity changes are unaffected (the hook sets no liquidity
///      flags). The next accepted report lifts it. Before the first report `policy()` is all zeros, i.e. the
///      hook's defaults with trading open.
///      Production path: point `forwarder` at the KeystoneForwarder (signature-checked) and clear `broadcaster`
///      (`tx.origin` is then a DON transmitter); add workflow id / owner checks on `metadata` if needed.
contract ListingPolicyReceiver is IListingPolicyReceiver {
    string public constant STATUS_KEY = "listingday.status";
    uint256 public constant MAX_FUTURE_SKEW = 5 minutes;
    uint256 public constant MAX_STATUS_LENGTH = 32;
    /// @notice Max gas forwarded to the ENS `setText`.
    uint256 public constant STATUS_MIRROR_GAS = 1_000_000;
    /// @dev Gas kept back from the ENS call for the bookkeeping and event after it.
    uint256 internal constant STATUS_MIRROR_RESERVE = 60_000;
    uint8 internal constant MAX_MODE = 2;
    /// @dev keccak256("listingday.ListingPolicyReceiver.lock") - 1. Transient reentrancy lock.
    uint256 internal constant LOCK_SLOT = 0x911e851a46347563b66c0e4c1d6dfc24a8e3e15f707e56da4534f65e7c0b9a8b;

    address public immutable owner;
    uint64 public immutable chainSelector;

    address public forwarder;
    address public broadcaster;
    uint64 public maxAge;
    IStatusResolver public statusResolver;
    bytes public statusName;
    bytes32 public mirroredStatusHash;
    string public status;

    ListingPolicy internal _policy;

    /// @param owner_ May change the forwarder, broadcaster, maxAge and the ENS mirror.
    /// @param forwarder_ CRE forwarder (Sepolia MockKeystoneForwarder for simulation).
    /// @param broadcaster_ Required tx.origin (the CRE_ETH_PRIVATE_KEY address); address(0) disables the guard.
    /// @param chainSelector_ CRE chain selector reports must target.
    /// @param maxAge_ Seconds a report may be old on arrival, and after which the stored policy halts trading.
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address owner_, address forwarder_, address broadcaster_, uint64 chainSelector_, uint64 maxAge_) {
        if (owner_ == address(0) || forwarder_ == address(0)) revert ZeroAddress();
        if (maxAge_ == 0) revert InvalidMaxAge();
        owner = owner_;
        chainSelector = chainSelector_;
        forwarder = forwarder_;
        broadcaster = broadcaster_;
        maxAge = maxAge_;
        emit ForwarderSet(forwarder_);
        emit BroadcasterSet(broadcaster_);
        emit MaxAgeSet(maxAge_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        uint256 locked;
        assembly ("memory-safe") {
            locked := tload(LOCK_SLOT)
        }
        if (locked != 0) revert Reentrancy();
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 1)
        }
        _;
        assembly ("memory-safe") {
            tstore(LOCK_SLOT, 0)
        }
    }

    // ---------------------------------------------------------------- CRE

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external nonReentrant {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender, forwarder);
        address expectedOrigin = broadcaster;
        // forge-lint: disable-next-line(tx-origin)
        if (expectedOrigin != address(0) && tx.origin != expectedOrigin) {
            revert InvalidOrigin(tx.origin, expectedOrigin);
        }

        (ListingPolicy memory p, string memory s) = abi.decode(report, (ListingPolicy, string));
        _validate(p, s);

        if (bytes(s).length == 0) s = _deriveStatus(p);
        p.version = _policy.version + 1;
        _policy = p;
        status = s;
        // forge-lint: disable-next-line(reentrancy-events)
        emit PolicyApplied(p.version, p, s);

        _mirrorStatus(s);
    }

    /// @inheritdoc IListingPolicyReceiver
    function syncStatus() external nonReentrant {
        _mirrorStatus(status);
    }

    // ---------------------------------------------------------------- views

    /// @notice The policy `ListingHook` enforces. Before the first report: all zeros (hook defaults, trading
    ///         open). Once stale (`block.timestamp > asOf + maxAge`): the stored policy with `halted = true`.
    function policy() external view returns (ListingPolicy memory p) {
        p = _policy;
        if (p.version != 0 && _stale(p.asOf)) p.halted = true;
    }

    /// @inheritdoc IListingPolicyReceiver
    function latestPolicy() external view returns (ListingPolicy memory) {
        return _policy;
    }

    /// @inheritdoc IListingPolicyReceiver
    function isStale() external view returns (bool) {
        return _policy.version != 0 && _stale(_policy.asOf);
    }

    /// @inheritdoc IListingPolicyReceiver
    function staleAt() external view returns (uint256) {
        if (_policy.version == 0) return 0;
        return uint256(_policy.asOf) + maxAge + 1;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IListingPolicy).interfaceId;
    }

    // ---------------------------------------------------------------- admin

    /// @inheritdoc IListingPolicyReceiver
    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert ZeroAddress();
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @inheritdoc IListingPolicyReceiver
    // forge-lint: disable-next-line(missing-zero-check)
    function setBroadcaster(address broadcaster_) external onlyOwner {
        broadcaster = broadcaster_;
        emit BroadcasterSet(broadcaster_);
    }

    /// @inheritdoc IListingPolicyReceiver
    function setMaxAge(uint64 maxAge_) external onlyOwner {
        if (maxAge_ == 0) revert InvalidMaxAge();
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    /// @inheritdoc IListingPolicyReceiver
    function setStatusMirror(IStatusResolver resolver, bytes calldata name) external onlyOwner {
        statusResolver = resolver;
        statusName = name;
        mirroredStatusHash = bytes32(0);
        emit StatusMirrorSet(address(resolver), name);
    }

    // ---------------------------------------------------------------- internal

    function _validate(ListingPolicy memory p, string memory s) internal view {
        if (p.chainSelector != chainSelector) revert WrongChainSelector(p.chainSelector, chainSelector);
        uint64 lastAsOf = _policy.asOf;
        if (p.asOf <= lastAsOf) revert StaleReport(p.asOf, lastAsOf);
        // forge-lint: disable-next-line(block-timestamp)
        if (p.asOf > block.timestamp + MAX_FUTURE_SKEW) revert ReportFromFuture(p.asOf, block.timestamp);
        if (_stale(p.asOf)) revert ReportExpired(p.asOf, maxAge);
        if (p.normalBandBps >= ListingBand.BPS || p.survBandBps >= ListingBand.BPS || p.mode > MAX_MODE) {
            revert InvalidPolicy();
        }
        if (bytes(s).length > MAX_STATUS_LENGTH) revert InvalidStatus();
    }

    function _stale(uint64 asOf) internal view returns (bool) {
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > uint256(asOf) + maxAge;
    }

    function _deriveStatus(ListingPolicy memory p) internal view returns (string memory) {
        // forge-lint: disable-next-line(block-timestamp)
        if (p.halted || block.timestamp < p.coolOffUntil) return "halted";
        if (p.mode != 0) return "surveillance";
        return "listed";
    }

    /// @dev Best effort: never reverts. Skips when the mirror is off or the status is already in ENS.
    function _mirrorStatus(string memory s) internal {
        IStatusResolver resolver = statusResolver;
        if (address(resolver) == address(0)) return;
        bytes32 h = keccak256(bytes(s));
        if (h == mirroredStatusHash) return;
        // A call to an address without code reverts in this frame, outside try/catch.
        if (address(resolver).code.length == 0) {
            // forge-lint: disable-next-line(reentrancy-events)
            emit StatusMirrorFailed(address(resolver), s, "");
            return;
        }
        uint256 available = gasleft();
        if (available <= STATUS_MIRROR_RESERVE) {
            // forge-lint: disable-next-line(reentrancy-events)
            emit StatusMirrorFailed(address(resolver), s, "");
            return;
        }
        uint256 gasForCall = available - STATUS_MIRROR_RESERVE;
        if (gasForCall > STATUS_MIRROR_GAS) gasForCall = STATUS_MIRROR_GAS;
        // Reentry through the permissionless mock forwarder is blocked by `nonReentrant` on both entry points.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        try resolver.setText{gas: gasForCall}(statusName, STATUS_KEY, s) {
            mirroredStatusHash = h;
            // forge-lint: disable-next-line(reentrancy-events)
            emit StatusMirrored(address(resolver), s);
        } catch (bytes memory reason) {
            // forge-lint: disable-next-line(reentrancy-events)
            emit StatusMirrorFailed(address(resolver), s, reason);
        }
    }
}
