// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconCoston2SwapDesk} from "../src/BeaconCoston2SwapDesk.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";

contract MockFxrp {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BeaconCoston2SwapDeskTest is Test {
    MockUSDT0 usdt;
    MockFxrp fxrp;
    BeaconCoston2SwapDesk desk;
    address owner = address(0xA11CE);
    address operator = address(0xB0B);
    address user = address(0xC0FFEE);

    function setUp() public {
        usdt = new MockUSDT0();
        fxrp = new MockFxrp();
        desk = new BeaconCoston2SwapDesk(
            address(usdt),
            address(fxrp),
            owner,
            operator,
            5e17, // 0.5 FXRP per USDT0
            30
        );
        usdt.mint(address(this), 1_000_000e6);
        fxrp.mint(address(desk), 100e6);
    }

    function test_quote_applies_fee() public view {
        uint256 out = desk.quote(1e6);
        // gross 0.5e6, fee 0.30% → 498500
        assertEq(out, 498_500);
    }

    function test_fulfill_after_credit() public {
        usdt.transfer(address(desk), 2e6);
        vm.prank(operator);
        uint256 out = desk.fulfill(user, 2e6, 900_000);
        assertEq(out, 997_000);
        assertEq(fxrp.balanceOf(user), 997_000);
        assertEq(desk.accountedTokenIn(), 2e6);
    }

    function test_fulfill_reverts_without_credit() public {
        vm.prank(operator);
        vm.expectRevert("insufficient credited tokenIn");
        desk.fulfill(user, 1e6, 1);
    }
}
