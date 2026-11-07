// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bid} from "continuous-clearing-auction/src/libraries/BidLib.sol";
import {console2} from "forge-std/Script.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/// @notice Step 3: one bid per demo wallet with real Circle Sepolia USDC, the plan.md first-bid flow:
///         `USDC.approve(Permit2)` -> `Permit2.approve(USDC, auction, amount, expiry)` -> `submitBid`.
///
///   DEMO_WALLET_KEYS=0x…,0x…,… [BID_AMOUNTS=20000000,20000000,20000000,20000000,19000000] [BID_MAX_POINTS=190] \
///   [MAX_BIDS_PER_RUN=<all>] \
///   forge script script/demo/DemoBid.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Wallet i bids BID_AMOUNTS[i] raw USDC (6 decimals) at BID_MAX_POINTS. Run after `startBlock`, ideally inside
/// the bid window. Idempotent: a wallet that already committed budget in the AllowAllModule is skipped. Every
/// wallet is checked for USDC and ETH before anything is sent.
contract DemoBid is DemoBase {
    function run() external {
        _step("DemoBid");
        Deployment memory d = _load();
        _requireAuction(d);
        if (block.number < d.startBlock) {
            revert(
                string.concat(
                    "auction starts at block ",
                    vm.toString(d.startBlock),
                    "; now ",
                    vm.toString(block.number),
                    ": wait ~",
                    vm.toString((d.startBlock - block.number) * 12),
                    " s"
                )
            );
        }
        require(block.number < d.endBlock, "auction is over");

        uint256[] memory keys = _demoKeys();
        uint256[] memory amounts = _bidAmounts();
        require(amounts.length <= keys.length, "more BID_AMOUNTS than DEMO_WALLET_KEYS");
        uint256 maxBids = vm.envOr("MAX_BIDS_PER_RUN", amounts.length);
        uint256 maxPrice = _bidMaxPriceQ96();

        bool[] memory todo = new bool[](amounts.length);
        uint256 pending;
        for (uint256 i; i < amounts.length && pending < maxBids; i++) {
            address wallet = vm.addr(keys[i]);
            if (d.module.committed(wallet) != 0) {
                console2.log("wallet", i, wallet, "already bid: skip");
                continue;
            }
            _preflight(i, wallet, amounts[i]);
            todo[i] = true;
            pending++;
        }

        for (uint256 i; i < amounts.length; i++) {
            if (todo[i]) _bid(d, keys[i], uint128(amounts[i]), maxPrice);
        }

        if (block.number < d.startBlock + _bidWindow()) {
            console2.log("bid window (0 mps) ends at block", d.startBlock + _bidWindow());
        }
        _save(d);
    }

    function _preflight(uint256 i, address wallet, uint256 amount) internal view {
        uint256 usdc = IERC20(Sepolia.USDC).balanceOf(wallet);
        if (usdc < amount) {
            console2.log("wallet", i, wallet);
            console2.log("  USDC balance", usdc, "needed", amount);
            console2.log("  top up: make fund, or https://faucet.circle.com (20 USDC / 2 h / address)");
            revert("demo wallet short of USDC");
        }
        require(wallet.balance >= 0.002 ether, "demo wallet has no Sepolia ETH for gas: make fund");
    }

    function _bid(Deployment memory d, uint256 key, uint128 amount, uint256 maxPrice) internal {
        address wallet = vm.addr(key);
        console2.log("bid from", wallet, amount);
        vm.startBroadcast(key);
        if (IERC20(Sepolia.USDC).allowance(wallet, Sepolia.PERMIT2) < amount) {
            _tx("USDC.approve(Permit2, max)");
            IERC20(Sepolia.USDC).approve(Sepolia.PERMIT2, type(uint256).max);
        }
        (uint160 allowed, uint48 expiration,) =
            IAllowanceTransfer(Sepolia.PERMIT2).allowance(wallet, Sepolia.USDC, address(d.auction));
        if (allowed < amount || expiration < block.timestamp + 10 minutes) {
            _tx("Permit2.approve(USDC, auction, amount, +1 day)");
            IAllowanceTransfer(Sepolia.PERMIT2)
                .approve(Sepolia.USDC, address(d.auction), amount, uint48(block.timestamp + 1 days));
        }
        uint256 floorPriceQ96 = _floorPriceQ96();
        _tx("CCA.submitBid(maxPrice, amount, owner = wallet, prevTick = floor, \"\")");
        uint256 bidId = d.auction.submitBid(maxPrice, amount, wallet, floorPriceQ96, "");
        vm.stopBroadcast();
        console2.log("  bidId", bidId);
        require(d.module.committed(wallet) == amount, "budget committed in the AllowAllModule");
    }

    function _bidMaxPriceQ96() internal view returns (uint256) {
        uint256 issuePoints = vm.envOr("ISSUE_POINTS", uint256(100));
        uint256 capPct = vm.envOr("CAP_PERCENT", uint256(190));
        uint256 capPoints = (issuePoints * capPct) / 100;
        uint256 bidMaxPoints = vm.envOr("BID_MAX_POINTS", capPoints);
        return bidMaxPoints * ListingPrice.ONE_POINT_Q96;
    }

    function _floorPriceQ96() internal view returns (uint256) {
        uint256 floorPoints = vm.envOr("FLOOR_POINTS", uint256(80));
        return floorPoints * ListingPrice.ONE_POINT_Q96;
    }

    function _bidWindow() internal view returns (uint256) {
        return _jsonUint(_json(), ".auction.bidWindowBlocks");
    }

    /// @dev `.bids` lists every bid in the auction (including ones placed from the app), read from the CCA.
    function _save(Deployment memory d) internal {
        uint256 n = d.auction.nextBidId();
        string memory list = "[";
        for (uint256 id; id < n; id++) {
            Bid memory b = d.auction.bids(id);
            string memory o = string.concat("bid", vm.toString(id));
            vm.serializeUint(o, "id", id);
            vm.serializeAddress(o, "owner", b.owner);
            vm.serializeUint(o, "amount", b.amountQ96 >> 96);
            vm.serializeUint(o, "maxPriceQ96", b.maxPrice);
            vm.serializeUint(o, "maxPricePoints", ListingPrice.q96ToPoints(b.maxPrice));
            o = vm.serializeUint(o, "startBlock", b.startBlock);
            list = string.concat(list, id == 0 ? "" : ",", o);
        }
        list = string.concat(list, "]");
        string memory s = "bids";
        vm.serializeUint(s, "count", n);
        vm.serializeUint(s, "committedTotal", _committedTotal(d, n));
        s = vm.serializeString(s, "list", "");
        _writeSection("bids", s);
        _writeArray(".bids.list", list);
    }

    function _committedTotal(Deployment memory d, uint256 n) internal view returns (uint256 total) {
        for (uint256 id; id < n; id++) {
            total += d.auction.bids(id).amountQ96 >> 96;
        }
    }
}
