// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IListingHook} from "../../src/interfaces/IListingHook.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {DemoBase, IPositionManagerLike} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";

/// @notice Step 5b: halt the pool through `ListingPolicyReceiver`, show that swaps revert `Halted()`, and that
///         the treasury can still pull liquidity out of the LP NFT. `HALTED=false` sends the resume report.
///
///   CRE_BROADCASTER_KEY=0x… (default PRIVATE_KEY) [TREASURY_KEY=0x…] [HALTED=true] [LP_REMOVE_BPS=1000] \
///   forge script script/demo/DemoHalt.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Two ways a halt reaches the receiver, both through the Sepolia MockKeystoneForwarder with tx.origin = the
/// receiver's broadcaster:
/// - CRE path (the product): `PUT {"halted": true}` on the mock exchange, then
///   `cre workflow simulate ./listing-policy --target staging-settings --non-interactive --trigger-index 0 --broadcast`
///   (see ../cre/README.md). The CRE CLI key must be CRE_BROADCASTER_KEY.
/// - This script (operator/test path): it builds the same report the simulator writes (`abi.encode(policy, status)`
///   behind the 109-byte forwarder header) and calls `forwarder.report` from the broadcaster key. That is all the
///   simulator does onchain; the mock forwarder checks no signatures. The receiver has no owner halt function.
/// Success is `ReportProcessed(receiver, …, result = true)` from the forwarder, not the tx status (the forwarder
/// swallows receiver reverts). The report call has a fixed gas limit for the same reason.
contract DemoHalt is DemoBase {
    using StateLibrary for IPoolManager;

    struct Result {
        bool halted;
        bytes32 executionId;
        uint32 policyVersion;
        bytes haltedRevertData;
        uint256 lpTokenId;
        uint128 lpLiquidityBefore;
        uint128 lpRemoved;
    }

    function run() external {
        _step("DemoHalt");
        Deployment memory d = _load();
        require(address(d.hook.policySource()) == address(d.receiver), "hook does not read the receiver");
        bool halt = vm.envOr("HALTED", true);
        Result memory r;
        r.halted = halt;

        if (d.receiver.policy().halted == halt) {
            console2.log(halt ? "receiver already reports halted" : "receiver already reports trading open");
        } else {
            r.executionId = _sendReport(d, halt);
        }
        r.policyVersion = d.receiver.latestPolicy().version;
        require(d.receiver.policy().halted == halt, "receiver policy not updated");
        require(d.hook.effectivePolicy().halted == halt, "hook does not see the policy");
        console2.log("receiver.status()", d.receiver.status());

        if (halt) {
            if (address(d.swapRouter).code.length != 0) r.haltedRevertData = _expectHaltedSwap(d);
            (r.lpTokenId, r.lpLiquidityBefore, r.lpRemoved) = _removeSomeLiquidity(d);
        } else {
            string memory j = _json();
            if (vm.keyExistsJson(j, ".halt.haltedSwapRevertData")) {
                r.haltedRevertData = vm.parseJsonBytes(j, ".halt.haltedSwapRevertData");
            }
            r.lpTokenId = _jsonUint(j, ".halt.lpTokenId");
            r.lpLiquidityBefore = uint128(_jsonUint(j, ".halt.lpLiquidityBefore"));
            r.lpRemoved = uint128(_jsonUint(j, ".halt.lpRemovedLiquidity"));
        }
        _save(r);
    }

    function _sendReport(Deployment memory d, bool halt) internal returns (bytes32) {
        ListingPolicy memory p;
        p.halted = halt;
        return _sendPolicyReport(d.receiver, p, "", "listing-day/DemoHalt");
    }

    function _expectHaltedSwap(Deployment memory d) internal returns (bytes memory revertData) {
        address trader = vm.addr(_traderKey());
        PoolKey memory key = d.hook.poolKey();
        (uint160 sqrtP,,,) = IPoolManager(Sepolia.POOL_MANAGER).getSlot0(d.hook.poolId());
        uint160 target = _pointsSqrt(112, d.hook.usdcIsCurrency0());
        if (target == sqrtP) target = _pointsSqrt(111, d.hook.usdcIsCurrency0());
        bool ok;
        (ok, revertData) = _simulate(trader, address(d.swapRouter), _swapCall(key, sqrtP, target));
        require(!ok, "swap passed while halted");
        require(
            _selector(_unwrapHookRevert(revertData)) == IListingHook.Halted.selector, "expected Halted from the hook"
        );
        console2.log("swap while halted reverts: Halted()");
    }

    function _removeSomeLiquidity(Deployment memory d)
        internal
        returns (uint256 tokenId, uint128 liquidity, uint128 removed)
    {
        tokenId = d.lpTokenId;
        string memory j = _json();
        if (_jsonUint(j, ".halt.lpRemovedLiquidity") != 0) {
            console2.log("LP removal already done");
            return (
                tokenId,
                uint128(_jsonUint(j, ".halt.lpLiquidityBefore")),
                uint128(_jsonUint(j, ".halt.lpRemovedLiquidity"))
            );
        }
        IPositionManagerLike posm = IPositionManagerLike(Sepolia.POSITION_MANAGER);
        require(tokenId != 0 && posm.ownerOf(tokenId) == d.treasury, "LP NFT not owned by the treasury");
        require(vm.addr(_treasuryKey()) == d.treasury, "TREASURY_KEY is not the LP owner");
        liquidity = posm.getPositionLiquidity(tokenId);
        removed = uint128(uint256(liquidity) * vm.envOr("LP_REMOVE_BPS", uint256(1000)) / 10_000);
        PoolKey memory key = d.hook.poolKey();

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(removed), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, d.treasury);
        uint256 usdcBefore = IERC20(Sepolia.USDC).balanceOf(d.treasury);
        uint256 sharesBefore = d.token.balanceOf(d.treasury);

        vm.startBroadcast(_treasuryKey());
        _tx("PositionManager.modifyLiquidities(DECREASE_LIQUIDITY, TAKE_PAIR) while halted (treasury)");
        posm.modifyLiquidities(abi.encode(actions, params), block.timestamp + 1 hours);
        vm.stopBroadcast();

        require(posm.getPositionLiquidity(tokenId) == liquidity - removed, "liquidity removed while halted");
        require(IERC20(Sepolia.USDC).balanceOf(d.treasury) > usdcBefore, "USDC back to the LP");
        require(d.token.balanceOf(d.treasury) > sharesBefore, "shares back to the LP");
        console2.log("LP removal while halted ok: liquidity removed", removed);
    }

    function _save(Result memory r) internal {
        string memory h = "halt";
        vm.serializeBool(h, "halted", r.halted);
        vm.serializeBytes32(h, "lastExecutionId", r.executionId);
        vm.serializeUint(h, "policyVersion", r.policyVersion);
        vm.serializeBytes(h, "haltedSwapRevertData", r.haltedRevertData);
        vm.serializeUint(h, "lpTokenId", r.lpTokenId);
        vm.serializeUint(h, "lpLiquidityBefore", r.lpLiquidityBefore);
        h = vm.serializeUint(h, "lpRemovedLiquidity", r.lpRemoved);
        _writeSection("halt", h);
    }
}
