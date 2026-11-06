// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Sepolia} from "../../src/libraries/Constants.sol";
import {DemoBase} from "./DemoBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/Script.sol";

/// @notice Tops up the demo wallets with Circle Sepolia USDC and Sepolia ETH from a funder wallet, and prints
///         balances plus faucet guidance.
///
///   FUNDER_KEY=0x… (default PRIVATE_KEY) DEMO_WALLET_KEYS=0x…,… (or DEMO_WALLET_ADDRESSES=0x…,…) \
///   [FUND_USDC=20000000] [FUND_ETH=20000000000000000] \
///   forge script script/demo/FundDemoWallets.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///   forge script script/demo/FundDemoWallets.s.sol --rpc-url $SEPOLIA_RPC_URL --sig "balances()"   # read only
///
/// Every demo wallet is topped up to FUND_USDC (raw, 6 decimals) and FUND_ETH (wei); only the shortfall is sent,
/// so re-running is safe. A separate treasury or CRE broadcaster key also gets the ETH top-up (it sends txs).
contract FundDemoWallets is DemoBase {
    string internal constant FAUCET =
        "Circle faucet https://faucet.circle.com (Ethereum Sepolia): 20 USDC per request, 1 request / address / 2 h";

    function run() external {
        address funder = vm.addr(_funderKey());
        (address[] memory wallets, address[] memory gasOnly) = _wallets(funder);
        uint256 usdcTarget = vm.envOr("FUND_USDC", uint256(20e6));
        uint256 ethTarget = vm.envOr("FUND_ETH", uint256(0.02 ether));
        console2.log("=== FundDemoWallets: funder", funder);

        uint256 usdcNeeded;
        uint256 ethNeeded;
        for (uint256 i; i < wallets.length; i++) {
            usdcNeeded += _short(IERC20(Sepolia.USDC).balanceOf(wallets[i]), usdcTarget);
            ethNeeded += _short(wallets[i].balance, ethTarget);
        }
        for (uint256 i; i < gasOnly.length; i++) {
            ethNeeded += _short(gasOnly[i].balance, ethTarget);
        }
        uint256 funderUsdc = IERC20(Sepolia.USDC).balanceOf(funder);
        console2.log("USDC to send (raw)", usdcNeeded, "funder has", funderUsdc);
        console2.log("ETH to send (wei) ", ethNeeded, "funder has", funder.balance);
        if (funderUsdc < usdcNeeded) {
            _faucetGuidance(funder, wallets, usdcTarget);
            revert("funder is short of USDC (see faucet guidance above)");
        }
        require(funder.balance > ethNeeded + 0.01 ether, "funder is short of Sepolia ETH (keeps 0.01 for gas)");

        vm.startBroadcast(_funderKey());
        for (uint256 i; i < wallets.length; i++) {
            _topUp(wallets[i], usdcTarget, ethTarget);
        }
        for (uint256 i; i < gasOnly.length; i++) {
            _topUp(gasOnly[i], 0, ethTarget);
        }
        vm.stopBroadcast();

        for (uint256 i; i < wallets.length; i++) {
            require(IERC20(Sepolia.USDC).balanceOf(wallets[i]) >= usdcTarget, "USDC top-up");
            require(wallets[i].balance >= ethTarget, "ETH top-up");
        }
        _print(funder, wallets, gasOnly);
    }

    /// @notice Read-only: balances of the funder and every demo wallet, plus faucet guidance.
    function balances() external view {
        address funder = vm.addr(_funderKey());
        (address[] memory wallets, address[] memory gasOnly) = _wallets(funder);
        _print(funder, wallets, gasOnly);
        _faucetGuidance(funder, wallets, vm.envOr("FUND_USDC", uint256(20e6)));
    }

    function _topUp(address to, uint256 usdcTarget, uint256 ethTarget) internal {
        uint256 usdc = _short(IERC20(Sepolia.USDC).balanceOf(to), usdcTarget);
        if (usdc != 0) {
            _tx(string.concat("USDC.transfer(", vm.toString(to), ", ", vm.toString(usdc), ")"));
            require(IERC20(Sepolia.USDC).transfer(to, usdc), "USDC transfer");
        }
        uint256 eth = _short(to.balance, ethTarget);
        if (eth != 0) {
            _tx(string.concat("ETH transfer to ", vm.toString(to), " (wei ", vm.toString(eth), ")"));
            (bool ok,) = payable(to).call{value: eth}("");
            require(ok, "ETH transfer");
        }
    }

    function _funderKey() internal view returns (uint256) {
        return vm.envOr("FUNDER_KEY", _deployerKey());
    }

    /// @dev Demo wallets get USDC + ETH; the treasury and broadcaster keys (when not the funder) get ETH only.
    function _wallets(address funder) internal view returns (address[] memory wallets, address[] memory gasOnly) {
        address[] memory none = new address[](0);
        wallets = vm.envOr("DEMO_WALLET_ADDRESSES", ",", none);
        if (wallets.length == 0) {
            uint256[] memory keys = _demoKeys();
            wallets = new address[](keys.length);
            for (uint256 i; i < keys.length; i++) {
                wallets[i] = vm.addr(keys[i]);
            }
        }
        address treasury = vm.addr(_treasuryKey());
        address broadcaster = vm.addr(_broadcasterKey());
        uint256 n = (treasury != funder ? 1 : 0) + (broadcaster != funder && broadcaster != treasury ? 1 : 0);
        gasOnly = new address[](n);
        uint256 k;
        if (treasury != funder) gasOnly[k++] = treasury;
        if (broadcaster != funder && broadcaster != treasury) gasOnly[k] = broadcaster;
    }

    function _short(uint256 balance, uint256 target) internal pure returns (uint256) {
        return balance >= target ? 0 : target - balance;
    }

    function _print(address funder, address[] memory wallets, address[] memory gasOnly) internal view {
        console2.log("");
        console2.log("balances (USDC raw 6 dec | ETH wei)");
        _line("funder  ", funder);
        for (uint256 i; i < wallets.length; i++) {
            _line(string.concat("wallet ", vm.toString(i)), wallets[i]);
        }
        for (uint256 i; i < gasOnly.length; i++) {
            _line("gas-only", gasOnly[i]);
        }
    }

    function _line(string memory name, address who) internal view {
        console2.log(
            string.concat(
                name,
                " ",
                vm.toString(who),
                "  USDC ",
                vm.toString(IERC20(Sepolia.USDC).balanceOf(who)),
                "  ETH ",
                vm.toString(who.balance)
            )
        );
    }

    function _faucetGuidance(address funder, address[] memory wallets, uint256 usdcTarget) internal view {
        console2.log("");
        console2.log(FAUCET);
        console2.log("Request for the funder and re-run, or request directly for each wallet below the target:");
        if (IERC20(Sepolia.USDC).balanceOf(funder) < usdcTarget) console2.log("  funder", funder);
        for (uint256 i; i < wallets.length; i++) {
            if (IERC20(Sepolia.USDC).balanceOf(wallets[i]) < usdcTarget) console2.log("  wallet", i, wallets[i]);
        }
        console2.log(
            "Sepolia ETH: https://cloud.google.com/application/web3/faucet/ethereum/sepolia (or any PoW faucet)"
        );
    }
}
