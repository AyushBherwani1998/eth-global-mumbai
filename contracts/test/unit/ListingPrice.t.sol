// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ListingPrice} from "../../src/libraries/ListingPrice.sol";
import {ConstantsLib} from "continuous-clearing-auction/src/libraries/ConstantsLib.sol";
import {Test} from "forge-std/Test.sol";

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
}
