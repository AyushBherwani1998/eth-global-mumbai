// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EligibilityPass} from "../../src/interfaces/IWorldPassModule.sol";
import {ListingDay, Sepolia} from "../../src/libraries/Constants.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {DemoBase} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Bid} from "continuous-clearing-auction/src/libraries/BidLib.sol";
import {ValidationHookLib} from "continuous-clearing-auction/src/libraries/ValidationHookLib.sol";
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
/// the bid window. Idempotent: a wallet that already bid (committed budget / bound a nullifier) is skipped. Every
/// wallet is checked for USDC and ETH before anything is sent.
///
/// Human listing (deployments file has `contracts.worldPassModule`): the script plays services/verify, so it needs
/// PASS_SIGNER_KEY and signs wallet i a 10-minute EligibilityPass for the stand-in nullifier `_demoNullifier(i)`
/// (no World ID proof involved; real bidders get their pass from the backend). It then asks the validation hook,
/// as the auction (simulated, nothing sent), to judge three bids that must fail and writes their revert data to
/// `.rejectedBids`: a second wallet with wallet 0's nullifier, an expired pass, and one USDC over the human's cap.
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
        uint256 maxPrice = ListingPrice.pointsToQ96(vm.envOr("BID_MAX_POINTS", ListingPrice.CAP_POINTS));

        bool[] memory todo = new bool[](amounts.length);
        uint256 pending;
        for (uint256 i; i < amounts.length && pending < maxBids; i++) {
            address wallet = vm.addr(keys[i]);
            if (_alreadyBid(d, wallet)) {
                console2.log("wallet", i, wallet, "already bid: skip");
                continue;
            }
            _preflight(i, wallet, amounts[i]);
            todo[i] = true;
            pending++;
        }

        for (uint256 i; i < amounts.length; i++) {
            if (todo[i]) _bid(d, i, keys[i], uint128(amounts[i]), maxPrice);
        }
        if (d.human) _rejections(d, vm.addr(keys[0]));

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

    function _alreadyBid(Deployment memory d, address wallet) internal view returns (bool) {
        return d.human ? d.worldPass.nullifierOf(wallet) != bytes32(0) : d.module.committed(wallet) != 0;
    }

    function _pass(Deployment memory d, uint256 i, address wallet, uint64 expiry)
        internal
        view
        returns (EligibilityPass memory)
    {
        return EligibilityPass({
            nullifier: _demoNullifier(i),
            wallet: wallet,
            auction: address(d.auction),
            cap: ListingDay.APPLICANT_CAP,
            expiry: expiry
        });
    }

    function _bid(Deployment memory d, uint256 i, uint256 key, uint128 amount, uint256 maxPrice) internal {
        address wallet = vm.addr(key);
        bytes memory hookData;
        if (d.human) {
            // forge-lint: disable-next-line(block-timestamp)
            hookData = _passHookData(d.worldPass, _pass(d, i, wallet, uint64(block.timestamp) + PASS_TTL));
        }
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
        _tx(
            d.human
                ? "CCA.submitBid(maxPrice, amount, owner = wallet, prevTick = floor, hookData = signed EligibilityPass)"
                : "CCA.submitBid(maxPrice, amount, owner = wallet, prevTick = floor, \"\")"
        );
        uint256 bidId = d.auction.submitBid(maxPrice, amount, wallet, ListingPrice.FLOOR_PRICE_Q96, hookData);
        vm.stopBroadcast();
        console2.log("  bidId", bidId);
        if (d.human) {
            require(d.worldPass.walletOf(_demoNullifier(i)) == wallet, "nullifier bound to the wallet");
            require(d.worldPass.committed(_demoNullifier(i)) == amount, "budget committed per human");
        } else {
            require(d.module.committed(wallet) == amount, "budget committed in the AllowAllModule");
        }
    }

    function _rejections(Deployment memory d, address wallet0) internal {
        bytes32 nullifier = d.worldPass.nullifierOf(wallet0);
        require(nullifier == _demoNullifier(0), "wallet 0 has no scripted pass bid yet");
        // forge-lint: disable-next-line(block-timestamp)
        uint64 live = uint64(block.timestamp) + PASS_TTL;
        address secondWallet = vm.addr(uint256(keccak256(abi.encode("listing-day second wallet", _label()))));
        EligibilityPass memory second = _pass(d, 0, secondWallet, live);
        EligibilityPass memory expired = _pass(d, 0, wallet0, live - PASS_TTL - 1);
        EligibilityPass memory valid = _pass(d, 0, wallet0, live);
        uint128 overCap = uint128(ListingDay.APPLICANT_CAP - d.worldPass.committed(nullifier) + 1);

        string memory o = "rejectedBids";
        vm.serializeString(o, "secondWallet", _reject(d, "NotEligible(6) NullifierBoundToOtherWallet", second, 1e6));
        vm.serializeString(o, "expiredPass", _reject(d, "NotEligible(3) Expired", expired, 1e6));
        o = vm.serializeString(o, "overCap", _reject(d, "CapExceeded", valid, overCap));
        if (!vm.keyExistsJson(_json(), ".rejectedBids")) vm.writeJson("{}", _file(), ".rejectedBids");
        _writeSection("rejectedBids", o);
    }

    /// @dev `hookError` is what the hook reverts with; `revertData` is what `submitBid` reverts with (the CCA wraps
    ///      it), i.e. what the frontend decodes.
    function _reject(Deployment memory d, string memory expected, EligibilityPass memory pass, uint128 amount)
        internal
        returns (string memory o)
    {
        address wallet = pass.wallet;
        bytes memory hookData = _passHookData(d.worldPass, pass);
        bytes memory err;
        vm.prank(address(d.auction));
        try d.validationHook.validate(ListingPrice.CAP_PRICE_Q96, amount, wallet, wallet, hookData) {
            revert(string.concat("hook accepted a bid that must fail: ", expected));
        } catch (bytes memory e) {
            err = e;
        }
        console2.log("rejected as expected:", expected);
        o = string.concat("rejected.", expected);
        vm.serializeString(o, "expected", expected);
        vm.serializeAddress(o, "wallet", wallet);
        vm.serializeUint(o, "amount", amount);
        vm.serializeBytes(o, "hookData", hookData);
        vm.serializeBytes(o, "hookError", err);
        o = vm.serializeBytes(
            o, "revertData", abi.encodeWithSelector(ValidationHookLib.ValidationHookCallFailed.selector, err)
        );
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
