// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionValidationHook} from "../../src/AuctionValidationHook.sol";
import {ListingHook} from "../../src/ListingHook.sol";
import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {MockSME} from "../../src/MockSME.sol";
import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {AllowAllModule} from "../../src/modules/AllowAllModule.sol";
import {IContinuousClearingAuction} from "continuous-clearing-auction/src/interfaces/IContinuousClearingAuction.sol";
import {Script, console2} from "forge-std/Script.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

/// @notice `AuctionStorage.sweepUnsoldTokensBlock` (public on the CCA, not in its interface).
interface ISweepState {
    function sweepUnsoldTokensBlock() external view returns (uint256);
}

/// @notice LBPStrategy's public pool-id reservation map (not part of ILBPStrategy).
interface IRegisteredPoolIds {
    function registeredPoolIds(bytes32 poolId) external view returns (address initializer);
}

/// @notice The PositionManager calls the demo uses on the migrated LP NFT.
interface IPositionManagerLike {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice The Keystone forwarder entry point `cre workflow simulate --broadcast` calls.
interface IKeystoneForwarder {
    event ReportProcessed(
        address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result
    );

    function report(address receiver, bytes calldata rawReport, bytes calldata reportContext, bytes[] calldata sigs)
        external;
}

/// @title DemoBase
/// @notice Shared config, keys and `deployments/<network>.json` state for the Listing Day demo scripts
///         (plan.md §4, §5, §12). Every step reads what earlier steps wrote, checks onchain state, and only sends
///         the transactions that are still missing, so any step can be re-run after a failure.
/// @dev Each step owns one top-level section of the json and rewrites only that section. `DemoDeploy` writes the
///      skeleton with every section present.
abstract contract DemoBase is Script {
    // ---------------------------------------------------------------- demo constants (plan.md §4)

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;
    /// @dev 20% of the raise goes to the LP (MigratorParameters.lpAllocationSchedule, in mps).
    uint24 internal constant LP_RATE_MPS = 2e6;
    uint16 internal constant LISTING_DAY_BAND_BPS = 500;
    uint160 internal constant LISTING_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    );
    /// @dev Fixed gas limits for the calls that swallow inner failures. Forge uses an explicit `{gas: ...}` as the
    ///      transaction gas limit; an `eth_estimateGas` value could be just enough for the outer call to succeed
    ///      while `tryMigrate` / `onReport` run out of gas (`MigrationFailed`, `ReportProcessed(result=false)`).
    uint256 internal constant MIGRATE_GAS = 5_000_000;
    uint256 internal constant REPORT_GAS = 1_500_000;
    /// @dev Exact-input amount large enough that swaps stop at their price limit.
    int256 internal constant SWAP_TO_LIMIT = -1e30;

    string internal constant DEFAULT_DEPLOYMENTS_FILE = "deployments/sepolia.json";
    string internal constant DEFAULT_LABEL = "acme-v1";

    // ---------------------------------------------------------------- state read back from the json

    struct Deployment {
        address deployer;
        address treasury;
        address creBroadcaster;
        MockSME token;
        AllowAllModule module;
        AuctionValidationHook validationHook;
        ListingHook hook;
        ListingPolicyReceiver receiver;
        IContinuousClearingAuction auction;
        uint64 startBlock;
        uint64 endBlock;
        uint64 claimBlock;
        uint64 migrationBlock;
        uint256 lpTokenId;
        PoolSwapTest swapRouter;
    }

    // ---------------------------------------------------------------- env

    function _file() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_FILE", string(DEFAULT_DEPLOYMENTS_FILE));
    }

    function _label() internal view returns (string memory) {
        return vm.envOr("DEMO_LABEL", string(DEFAULT_LABEL));
    }

    /// @dev Issuer: deploys everything, owns the hooks and the receiver, launches the auction.
    function _deployerKey() internal view returns (uint256) {
        return vm.envUint("PRIVATE_KEY");
    }

    /// @dev `tokensRecipient`, `recipient` and `positionRecipient` of the launch: sweeps unsold shares, owns the LP.
    function _treasuryKey() internal view returns (uint256) {
        return vm.envOr("TREASURY_KEY", _deployerKey());
    }

    /// @dev The receiver's `broadcaster` (required tx.origin). Use the CRE CLI key (`CRE_ETH_PRIVATE_KEY`) so both
    ///      `cre workflow simulate --broadcast` and `DemoHalt` are accepted.
    function _broadcasterKey() internal view returns (uint256) {
        return vm.envOr("CRE_BROADCASTER_KEY", _deployerKey());
    }

    function _demoKeys() internal view returns (uint256[] memory) {
        return vm.envUint("DEMO_WALLET_KEYS", ",");
    }

    /// @dev One bid per amount, from demo wallets 0..n-1. Default: 20+20+20+20+19 = 99 USDC, clears at 110 points.
    function _bidAmounts() internal view returns (uint256[] memory) {
        uint256[] memory d = new uint256[](5);
        (d[0], d[1], d[2], d[3], d[4]) = (20e6, 20e6, 20e6, 20e6, 19e6);
        return vm.envOr("BID_AMOUNTS", ",", d);
    }

    /// @dev Demo wallet that trades after migration (default: the first wallet after the bidders).
    function _traderKey() internal view returns (uint256) {
        uint256[] memory keys = _demoKeys();
        uint256 i = vm.envOr("TRADER_INDEX", _bidAmounts().length);
        require(i < keys.length, "TRADER_INDEX out of range of DEMO_WALLET_KEYS");
        return keys[i];
    }

    // ---------------------------------------------------------------- json

    function _json() internal view returns (string memory) {
        string memory path = _file();
        require(vm.exists(path), string.concat(path, " not found: run DemoDeploy first"));
        return vm.readFile(path);
    }

    function _jsonAddress(string memory json, string memory key) internal view returns (address) {
        return vm.keyExistsJson(json, key) ? vm.parseJsonAddress(json, key) : address(0);
    }

    function _jsonUint(string memory json, string memory key) internal view returns (uint256) {
        return vm.keyExistsJson(json, key) ? vm.parseJsonUint(json, key) : 0;
    }

    function _ensureParentDir(string memory path) internal {
        bytes memory p = bytes(path);
        uint256 slash = p.length;
        while (slash > 0 && p[slash - 1] != "/") slash--;
        if (slash <= 1) return;
        bytes memory dir = new bytes(slash - 1);
        for (uint256 i; i < dir.length; i++) {
            dir[i] = p[i];
        }
        if (!vm.exists(string(dir))) vm.createDir(string(dir), true);
    }

    /// @dev Replaces one top-level section of the deployments file.
    function _writeSection(string memory section, string memory sectionJson) internal {
        vm.writeJson(sectionJson, _file(), string.concat(".", section));
    }

    /// @dev `vm.serializeString` embeds objects but not arrays, so arrays are written in place at a key that
    ///      already exists in the file.
    function _writeArray(string memory key, string memory jsonArray) internal {
        vm.writeJson(jsonArray, _file(), key);
    }

    function _load() internal view returns (Deployment memory d) {
        string memory j = _json();
        d.deployer = _jsonAddress(j, ".deployer");
        d.treasury = _jsonAddress(j, ".treasury");
        d.creBroadcaster = _jsonAddress(j, ".creBroadcaster");
        d.token = MockSME(_jsonAddress(j, ".contracts.mockSME"));
        d.module = AllowAllModule(_jsonAddress(j, ".contracts.allowAllModule"));
        d.validationHook = AuctionValidationHook(_jsonAddress(j, ".contracts.auctionValidationHook"));
        d.hook = ListingHook(_jsonAddress(j, ".contracts.listingHook"));
        d.receiver = ListingPolicyReceiver(_jsonAddress(j, ".contracts.listingPolicyReceiver"));
        d.auction = IContinuousClearingAuction(_jsonAddress(j, ".auction.address"));
        d.startBlock = uint64(_jsonUint(j, ".auction.startBlock"));
        d.endBlock = uint64(_jsonUint(j, ".auction.endBlock"));
        d.claimBlock = uint64(_jsonUint(j, ".auction.claimBlock"));
        d.migrationBlock = uint64(_jsonUint(j, ".auction.migrationBlock"));
        d.lpTokenId = _jsonUint(j, ".results.lpTokenId");
        d.swapRouter = PoolSwapTest(payable(_jsonAddress(j, ".trade.swapRouter")));
        require(address(d.hook).code.length != 0, "ListingHook not deployed on this chain: run DemoDeploy");
    }

    function _requireAuction(Deployment memory d) internal view {
        require(address(d.auction).code.length != 0, "auction not launched: run DemoLaunch");
    }

    // ---------------------------------------------------------------- deploy helpers

    /// @dev Deterministic deploy through the CREATE2 factory (0x4e59…956C); returns the existing contract if the
    ///      address already has code. Must run inside a broadcast so the call is sent from the broadcaster.
    function _create2(bytes32 salt, bytes memory initCode) internal returns (address deployed, bool fresh) {
        deployed = vm.computeCreate2Address(salt, keccak256(initCode), CREATE2_FACTORY);
        if (deployed.code.length != 0) return (deployed, false);
        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        require(ok && deployed.code.length != 0, "CREATE2 deploy failed");
        fresh = true;
    }

    function _salt(string memory what) internal view returns (bytes32) {
        return keccak256(abi.encode("listing-day", _label(), what));
    }

    // ---------------------------------------------------------------- pool helpers

    /// @notice Swap calldata for `PoolSwapTest.swap` that moves the pool to `target` (exact input, price-limited).
    function _swapCall(PoolKey memory key, uint160 current, uint160 target) internal pure returns (bytes memory) {
        return abi.encodeCall(
            PoolSwapTest.swap,
            (
                key,
                SwapParams({zeroForOne: target < current, amountSpecified: SWAP_TO_LIMIT, sqrtPriceLimitX96: target}),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                bytes("")
            )
        );
    }

    /// @notice Runs `call` from `from` against the current state without broadcasting it, and returns the revert
    ///         data ("" if it succeeded). Used to capture the expected reverts (out of band, halted).
    function _simulate(address from, address to, bytes memory call) internal returns (bool ok, bytes memory ret) {
        vm.prank(from, from);
        (ok, ret) = to.call(call);
    }

    /// @notice Unwraps v4's `WrappedError(hook, selector, reason, details)` to the hook's own revert reason.
    function _unwrapHookRevert(bytes memory revertData) internal pure returns (bytes memory reason) {
        if (revertData.length < 4 || bytes4(revertData) != CustomRevert.WrappedError.selector) return revertData;
        bytes memory body = new bytes(revertData.length - 4);
        for (uint256 i; i < body.length; i++) {
            body[i] = revertData[i + 4];
        }
        (,, reason,) = abi.decode(body, (address, bytes4, bytes, bytes));
    }

    function _selector(bytes memory data) internal pure returns (bytes4) {
        return data.length < 4 ? bytes4(0) : bytes4(data);
    }

    function _pointsE2(ListingHook hook) internal view returns (uint256) {
        return IListingHook(address(hook)).currentPointsE2();
    }

    function _logPointsE2(string memory what, uint256 pointsE2) internal pure {
        console2.log(string.concat(what, ": ", _fmtE2(pointsE2), " points (USDC / 1,000-share lot x100)"));
    }

    /// @dev 11_000 -> "110.00".
    function _fmtE2(uint256 e2) internal pure returns (string memory) {
        uint256 frac = e2 % 100;
        return string.concat(vm.toString(e2 / 100), ".", frac < 10 ? "0" : "", vm.toString(frac));
    }

    function _pointsSqrt(uint256 points, bool usdcIsCurrency0) internal pure returns (uint160) {
        return ListingPrice.pointsToSqrtPriceX96(points, usdcIsCurrency0);
    }

    function _step(string memory name) internal view {
        console2.log("");
        console2.log(string.concat("=== ", name, " (", _label(), ", block ", vm.toString(block.number), ")"));
        console2.log("deployments file:", _file());
    }

    function _tx(string memory what) internal pure {
        console2.log(string.concat("  tx: ", what));
    }
}
