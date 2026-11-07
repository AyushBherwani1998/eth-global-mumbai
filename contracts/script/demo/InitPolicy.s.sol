// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPolicyReceiver} from "../../src/ListingPolicyReceiver.sol";
import {ListingPolicy} from "../../src/interfaces/IListingPolicy.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {Sepolia} from "../../src/libraries/Constants.sol";
import {DemoBase} from "./DemoBase.sol";
import {console2} from "forge-std/Script.sol";

/// @notice Send initial baseline policy report to receiver: normal mode, 20% band, not halted.
///         Sets reference price = issue price for the listing.
///
///   DEPLOYMENTS_FILE=deployments/sepolia-jiofin.json ISSUE_POINTS=100 \
///   forge script script/demo/InitPolicy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow
///
/// Run once per listing after receiver deployed. Idempotent: can re-run with updated reference.
contract InitPolicy is DemoBase {
    function run() external {
        _step("InitPolicy");
        Deployment memory d = _load();
        require(address(d.receiver) != address(0), "receiver not deployed: run DemoDeploy");

        uint256 issuePoints = vm.envOr("ISSUE_POINTS", uint256(100));
        console2.log("Issue price:", issuePoints, "points");
        
        // Check current policy
        ListingPolicy memory current = d.receiver.policy();
        if (current.asOf > 0) {
            console2.log("Policy already exists, version:", current.version);
            console2.log("Current halted:", current.halted);
            console2.log("Current normalBandBps:", current.normalBandBps);
        }

        // Initial policy: normal mode, 20% band, not halted
        ListingPolicy memory p;
        p.refSqrtPriceX96 = _issueToSqrtPrice(issuePoints, d.hook.usdcIsCurrency0());
        p.normalBandBps = 2000; // 20%
        p.survBandBps = 500;    // 5% (surveillance, not used)
        p.mode = 0;             // normal
        p.halted = false;       // UNHALTED
        // asOf and chainSelector filled by _sendPolicyReport

        console2.log("Sending initial policy:");
        console2.log("  Reference price:", issuePoints, "points");
        console2.log("  Normal band: 20% (+/-", issuePoints * 20 / 100, "points)");
        console2.log("  Mode: 0 (normal)");
        console2.log("  Halted: false");

        _sendPolicyReport(d.receiver, p, "listed", "init-policy");
        
        // Verify
        ListingPolicy memory applied = d.receiver.policy();
        console2.log("");
        console2.log("=== Policy Applied ===");
        console2.log("Version:", applied.version);
        console2.log("Halted:", applied.halted);
        console2.log("Mode:", applied.mode);
        console2.log("NormalBandBps:", applied.normalBandBps);
        console2.log("AsOf:", applied.asOf);
        require(!applied.halted, "Policy should not be halted");
        require(applied.mode == 0, "Policy should be normal mode");
        require(applied.normalBandBps == 2000, "Band should be 2000 bps");
    }

    function _issueToSqrtPrice(uint256 points, bool usdcIsCurrency0) internal pure returns (uint160) {
        return ListingPrice.pointsToSqrtPriceX96(points, usdcIsCurrency0);
    }
}
