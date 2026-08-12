// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";
import {X402Facilitator} from "../src/X402Facilitator.sol";

/// @notice Fixture-only MockUSDT0 is used here to unit-test ERC-20 pull settle.
contract X402FacilitatorTest is Test {
    MockUSDT0 internal token;
    X402Facilitator internal facilitator;
    address internal payer = address(0xA11CE);
    address internal payee = address(0xCAFE);

    function setUp() public {
        token = new MockUSDT0();
        facilitator = new X402Facilitator();
        token.mint(payer, 1_000_000);
    }

    function testSettleTransferFromPullsApprovedTokens() public {
        vm.prank(payer);
        token.approve(address(facilitator), 250_000);

        bool ok = facilitator.settleTransferFrom(address(token), payer, payee, 250_000);
        assertTrue(ok);
        assertEq(token.balanceOf(payee), 250_000);
        assertEq(token.balanceOf(payer), 750_000);
    }

    function testSettleTransferFromRevertsWithoutAllowance() public {
        vm.expectRevert("insufficient allowance");
        facilitator.settleTransferFrom(address(token), payer, payee, 1);
    }
}
