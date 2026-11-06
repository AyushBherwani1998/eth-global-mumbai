// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingBand} from "../../src/libraries/ListingBand.sol";
import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {ConstantsLib} from "continuous-clearing-auction/src/libraries/ConstantsLib.sol";
import {Test} from "forge-std/Test.sol";
import {TokenPricing} from "liquidity-launcher/src/libraries/TokenPricing.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract ListingPriceTest is Test {
    /// @dev floor(2^96 / 1e17)
    uint256 internal constant EXPECTED_ONE_POINT_Q96 = 792_281_625_142;
    uint256 internal constant EXPECTED_ISSUE_Q96 = 79_228_162_514_200;
    uint256 internal constant EXPECTED_FLOOR_Q96 = 63_382_530_011_360;
    uint256 internal constant EXPECTED_CAP_Q96 = 150_533_508_776_980;

    function test_onePoint_isQ96Over1e17() public pure {
        assertEq(ListingPrice.ONE_POINT_Q96, EXPECTED_ONE_POINT_Q96);
        assertEq(ListingPrice.ONE_POINT_Q96, (uint256(1) << 96) / 1e17);
    }

    /// (a) 100 points -> ~7.9e13 Q96, exact value, above the CCA minimum floor 2^32+1.
    function test_issue100Points_toQ96_exactAndAboveCcaMinFloor() public pure {
        uint256 issueQ96 = ListingPrice.pointsToQ96(100);
        assertEq(issueQ96, EXPECTED_ISSUE_Q96);
        assertEq(issueQ96, ListingPrice.ISSUE_PRICE_Q96);
        assertGe(issueQ96, 7.9e13);
        assertLt(issueQ96, 8e13);

        assertEq(ListingPrice.CCA_MIN_FLOOR_PRICE, ConstantsLib.MIN_FLOOR_PRICE);
        assertGt(issueQ96, ConstantsLib.MIN_FLOOR_PRICE);
        assertGt(ListingPrice.FLOOR_PRICE_Q96, ConstantsLib.MIN_FLOOR_PRICE);

        // plan.md formula: 0.001 USDC/share = 1e3 raw USDC per 1e18 raw shares, times 2^96.
        uint256 untruncated = ListingPrice.rawPriceToQ96(1e3, 1e18);
        assertEq(untruncated, 79_228_162_514_264);
        // Tick alignment truncates by < 1 raw unit per point.
        assertLt(untruncated - issueQ96, 100);
        // 1.00 USDC per 1,000-share lot gives the same untruncated price.
        assertEq(ListingPrice.rawPriceToQ96(ListingPrice.pointsToQuoteRawPerLot(100), 1000e18), untruncated);
    }

    /// (b) 190 points maps exactly to the cap constant; 80 points is the floor.
    function test_cap190Points_andFloor80Points_exact() public pure {
        assertEq(ListingPrice.pointsToQ96(190), ListingPrice.CAP_PRICE_Q96);
        assertEq(ListingPrice.CAP_PRICE_Q96, EXPECTED_CAP_Q96);
        assertEq(ListingPrice.pointsToQ96(80), ListingPrice.FLOOR_PRICE_Q96);
        assertEq(ListingPrice.FLOOR_PRICE_Q96, EXPECTED_FLOOR_Q96);

        assertEq(ListingPrice.q96ToPoints(ListingPrice.CAP_PRICE_Q96), 190);
        assertEq(ListingPrice.q96ToPoints(ListingPrice.FLOOR_PRICE_Q96), 80);
        assertEq(ListingPrice.q96ToPoints(ListingPrice.CAP_PRICE_Q96 + ListingPrice.ONE_POINT_Q96 - 1), 190);

        assertEq(ListingPrice.pointsToQuoteRawPerLot(190), 1.9e6);
        assertEq(ListingPrice.pointsToQuoteRawPerLot(80), 0.8e6);
        assertEq(ListingPrice.pointsToQuoteRawPerLot(110), 1.1e6);
    }

    function test_tickSpacing_onePoint_alignsFloorIssueCap() public pure {
        uint256 spacing = ListingPrice.tickSpacingQ96(1);
        assertEq(spacing, ListingPrice.TICK_SPACING_Q96);
        assertEq(spacing, ListingPrice.ONE_POINT_Q96);
        assertGe(spacing, ConstantsLib.MIN_TICK_SPACING);

        assertTrue(ListingPrice.isTickAligned(ListingPrice.FLOOR_PRICE_Q96, spacing));
        assertTrue(ListingPrice.isTickAligned(ListingPrice.ISSUE_PRICE_Q96, spacing));
        assertTrue(ListingPrice.isTickAligned(ListingPrice.CAP_PRICE_Q96, spacing));
        assertFalse(ListingPrice.isTickAligned(ListingPrice.CAP_PRICE_Q96 + 1, spacing));
        assertEq(
            ListingPrice.roundDownToTick(ListingPrice.CAP_PRICE_Q96 + spacing - 1, spacing), ListingPrice.CAP_PRICE_Q96
        );

        // 5-point ticks still align the demo prices (80, 100, 190 are multiples of 5).
        uint256 fivePoints = ListingPrice.tickSpacingQ96(5);
        assertTrue(ListingPrice.isTickAligned(ListingPrice.FLOOR_PRICE_Q96, fivePoints));
        assertTrue(ListingPrice.isTickAligned(ListingPrice.CAP_PRICE_Q96, fivePoints));
    }

    function testFuzz_pointsRoundTrip(uint32 points) public pure {
        uint256 priceQ96 = ListingPrice.pointsToQ96(points);
        assertEq(ListingPrice.q96ToPoints(priceQ96), points);
        assertTrue(ListingPrice.isTickAligned(priceQ96, ListingPrice.TICK_SPACING_Q96));
    }

    // ---------------------------------------------------------------- v4 pool prices

    /// The helper reproduces LBPStrategy's opening price (TokenPricing) in both token orders.
    function test_priceQ96ToSqrtPriceX96_matchesLbpStrategyTokenPricing() public pure {
        uint256 clearing = ListingPrice.pointsToQ96(110);
        for (uint256 i; i < 2; i++) {
            bool usdc0 = i == 0;
            uint160 expected = TokenPricing.convertToSqrtPriceX96(TokenPricing.convertToPriceX192(clearing, usdc0));
            assertEq(ListingPrice.priceQ96ToSqrtPriceX96(clearing, usdc0), expected);
            assertEq(ListingPrice.pointsToSqrtPriceX96(110, usdc0), expected);
        }
    }

    /// plan.md sanity: with USDC as currency0 the issue price is sqrtPriceX96 ~ 2.5e36, tick ~ +345,400.
    function test_issuePrice_usdcCurrency0_sqrtAndTick() public pure {
        uint160 sqrtIssue = ListingPrice.pointsToSqrtPriceX96(100, true);
        assertApproxEqRel(sqrtIssue, 2.505e36, 0.001e18);
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtIssue);
        assertGt(tick, 345_000);
        assertLt(tick, 345_500);
        // Higher share price = lower sqrt price when USDC is currency0, higher when it is currency1.
        assertLt(ListingPrice.pointsToSqrtPriceX96(110, true), sqrtIssue);
        assertGt(ListingPrice.pointsToSqrtPriceX96(110, false), ListingPrice.pointsToSqrtPriceX96(100, false));
    }

    function testFuzz_sqrtPricePointsRoundTrip(uint256 pointsE2, bool usdc0) public pure {
        pointsE2 = bound(pointsE2, 100, 1e7); // 1.00 to 100,000 points
        uint160 sqrtPrice = ListingPrice.pointsE2ToSqrtPriceX96(pointsE2, usdc0);
        assertApproxEqAbs(ListingPrice.sqrtPriceX96ToPointsE2(sqrtPrice, usdc0), pointsE2, 1);
    }

    /// Whole-point prices use the tick-truncated ONE_POINT_Q96, so they differ by < 1e-12 relative.
    function test_pointsE2_matchesWholePoints() public pure {
        assertApproxEqRel(
            ListingPrice.pointsE2ToSqrtPriceX96(11_000, true), ListingPrice.pointsToSqrtPriceX96(110, true), 1e6
        );
        assertApproxEqRel(
            ListingPrice.pointsE2ToSqrtPriceX96(11_000, false), ListingPrice.pointsToSqrtPriceX96(110, false), 1e6
        );
    }

    // ---------------------------------------------------------------- ListingBand

    /// ±5% around 110 is 104.5 to 115.5 points in both token orders.
    function test_band_listingDay5Percent_bothOrders() public pure {
        for (uint256 i; i < 2; i++) {
            bool usdc0 = i == 0;
            (uint160 lo, uint160 hi) = ListingBand.bounds(ListingPrice.pointsToSqrtPriceX96(110, usdc0), 500, usdc0);
            (uint256 lowE2, uint256 highE2) = usdc0
                ? (ListingPrice.sqrtPriceX96ToPointsE2(hi, true), ListingPrice.sqrtPriceX96ToPointsE2(lo, true))
                : (ListingPrice.sqrtPriceX96ToPointsE2(lo, false), ListingPrice.sqrtPriceX96ToPointsE2(hi, false));
            assertApproxEqAbs(lowE2, 10_450, 1);
            assertApproxEqAbs(highE2, 11_550, 1);
        }
    }

    function testFuzz_band_containsReference(uint160 ref, uint256 bps, bool usdc0) public pure {
        ref = uint160(bound(ref, TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE));
        bps = bound(bps, 0, 9999);
        (uint160 lo, uint160 hi) = ListingBand.bounds(ref, bps, usdc0);
        assertLe(lo, ref);
        assertGe(hi, ref);
        assertGe(lo, TickMath.MIN_SQRT_PRICE);
        assertLe(hi, TickMath.MAX_SQRT_PRICE);
    }

    function test_gapQ96_symmetricUnderInversion() public pure {
        uint160 ref = ListingPrice.pointsToSqrtPriceX96(90, true);
        uint160 refInv = ListingPrice.pointsToSqrtPriceX96(90, false);
        uint256 gap = ListingBand.gapQ96(ListingPrice.pointsToSqrtPriceX96(108, true), ref);
        uint256 gapInv = ListingBand.gapQ96(ListingPrice.pointsToSqrtPriceX96(108, false), refInv);
        assertApproxEqRel(gap, gapInv, 1e6);
        assertEq(ListingBand.gapQ96(ref, ref), 1 << 96);
    }
}
