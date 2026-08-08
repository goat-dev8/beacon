// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconSafeFactory} from "../src/BeaconSafeFactory.sol";
import {BeaconAgentVault} from "../src/BeaconAgentVault.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";

contract BeaconSafeFactoryTest is Test {
    MockUSDT0 internal token;
    BeaconSafeFactory internal factory;
    address internal executor = address(0xE1);
    address internal alice = address(0xA1);
    address internal bob = address(0xB2);

    uint256 internal constant PER_TX = 10e6;
    uint256 internal constant WINDOW = 50e6;
    uint256 internal constant SECONDS_ = 7 days;

    function setUp() public {
        token = new MockUSDT0();
        factory = new BeaconSafeFactory(address(token), executor, PER_TX, WINDOW, SECONDS_);
    }

    function test_createSafe_isolatesOwners() public {
        vm.prank(alice);
        address safeA = factory.createSafe();

        vm.prank(bob);
        address safeB = factory.createSafe();

        assertTrue(safeA != safeB);
        assertEq(factory.safeOf(alice), safeA);
        assertEq(factory.safeOf(bob), safeB);
        assertEq(BeaconAgentVault(safeA).owner(), alice);
        assertEq(BeaconAgentVault(safeB).owner(), bob);
        assertEq(BeaconAgentVault(safeA).executor(), executor);
        assertEq(BeaconAgentVault(safeB).executor(), executor);
    }

    function test_createSafe_rejectsDuplicate() public {
        vm.prank(alice);
        factory.createSafe();
        vm.prank(alice);
        vm.expectRevert();
        factory.createSafe();
    }

    function test_balances_isolated() public {
        vm.prank(alice);
        address safeA = factory.createSafe();
        vm.prank(bob);
        address safeB = factory.createSafe();

        token.mint(alice, 100e6);
        token.mint(bob, 100e6);

        // EIP-3009 path not needed for unit test — use deposit via approve+transferFrom
        // MockUSDT0 may be EIP-3009 only; mint directly to safes for isolation check.
        token.mint(safeA, 25e6);
        token.mint(safeB, 7e6);

        assertEq(BeaconAgentVault(safeA).balance(), 25e6);
        assertEq(BeaconAgentVault(safeB).balance(), 7e6);
    }

    function test_policy_isolated() public {
        vm.prank(alice);
        address safeA = factory.createSafe();
        vm.prank(bob);
        address safeB = factory.createSafe();

        vm.prank(alice);
        BeaconAgentVault(safeA).setPolicy(1e6, 5e6, 1 days, 0);

        assertEq(BeaconAgentVault(safeA).maxSpendPerTx(), 1e6);
        assertEq(BeaconAgentVault(safeB).maxSpendPerTx(), PER_TX);
    }

    function test_bob_cannot_withdraw_alice() public {
        vm.prank(alice);
        address safeA = factory.createSafe();
        token.mint(safeA, 10e6);

        vm.prank(bob);
        vm.expectRevert("not owner");
        BeaconAgentVault(safeA).withdraw(1e6);
    }

    function test_bob_cannot_set_alice_policy() public {
        vm.prank(alice);
        address safeA = factory.createSafe();

        vm.prank(bob);
        vm.expectRevert("not owner");
        BeaconAgentVault(safeA).setPolicy(1e6, 1e6, 1 days, 0);
    }

    function test_predictSafe_matches_create() public {
        address predicted = factory.predictSafe(alice);
        vm.prank(alice);
        address created = factory.createSafe();
        assertEq(predicted, created);
    }

    function test_allowlists_seeded() public {
        vm.prank(alice);
        address safeA = factory.createSafe();
        assertTrue(BeaconAgentVault(safeA).allowedTargets(address(token)));
        assertTrue(BeaconAgentVault(safeA).allowedSelectors(bytes4(keccak256("transfer(address,uint256)"))));
    }
}
