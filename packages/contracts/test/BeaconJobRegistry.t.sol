// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeaconJobRegistry} from "../src/BeaconJobRegistry.sol";

contract BeaconJobRegistryTest is Test {
    BeaconJobRegistry internal registry;

    address internal owner = address(0xA11CE);
    address internal escrow = address(0xE5C);
    address internal settler = address(0x5E11);
    address internal stranger = address(0xBAD);
    address internal payer = address(0xB0B);

    bytes32 internal offerId = keccak256("offer-1");
    bytes32 internal jobId = keccak256("job-1");

    function setUp() public {
        registry = new BeaconJobRegistry(owner);
        vm.startPrank(owner);
        registry.setAuthorizer(escrow, true);
        registry.setCloser(settler, true);
        vm.stopPrank();

        registry.commitOffer(offerId, jobId, keccak256("brief"), keccak256("rubric"), 100_000);
    }

    function testCommitOfferOpen() public {
        bytes32 oid = keccak256("offer-2");
        bytes32 jid = keccak256("job-2");
        vm.prank(stranger);
        registry.commitOffer(oid, jid, bytes32(0), bytes32(0), 1);
        (bytes32 storedJobId,,,,,,,) = registry.offers(oid);
        assertEq(storedJobId, jid);
    }

    function testAuthorizerCanAuthorize() public {
        vm.prank(escrow);
        registry.authorize(offerId, payer);

        (,,,, address p, bool authorized,,) = registry.offers(offerId);
        assertEq(p, payer);
        assertTrue(authorized);
    }

    function testOwnerCanAuthorize() public {
        vm.prank(owner);
        registry.authorize(offerId, payer);
        (,,,,, bool authorized,,) = registry.offers(offerId);
        assertTrue(authorized);
    }

    function testStrangerCannotAuthorize() public {
        vm.prank(stranger);
        vm.expectRevert("not authorizer");
        registry.authorize(offerId, payer);
    }

    function testCloserCanClose() public {
        vm.prank(escrow);
        registry.authorize(offerId, payer);

        vm.prank(settler);
        registry.closeJob(offerId, BeaconJobRegistry.JobResult.Pass);

        (,,,,,, bool closed, BeaconJobRegistry.JobResult result) = registry.offers(offerId);
        assertTrue(closed);
        assertEq(uint8(result), uint8(BeaconJobRegistry.JobResult.Pass));
    }

    function testStrangerCannotClose() public {
        vm.prank(escrow);
        registry.authorize(offerId, payer);

        vm.prank(stranger);
        vm.expectRevert("not closer");
        registry.closeJob(offerId, BeaconJobRegistry.JobResult.Fail);
    }

    function testAuthorizerCannotCloseUnlessAlsoCloser() public {
        vm.prank(escrow);
        registry.authorize(offerId, payer);

        vm.prank(escrow);
        vm.expectRevert("not closer");
        registry.closeJob(offerId, BeaconJobRegistry.JobResult.Pass);
    }

    function testRevokeAuthorizer() public {
        vm.prank(owner);
        registry.setAuthorizer(escrow, false);

        vm.prank(escrow);
        vm.expectRevert("not authorizer");
        registry.authorize(offerId, payer);
    }

    function testCannotDoubleAuthorizeOrClose() public {
        vm.prank(escrow);
        registry.authorize(offerId, payer);

        vm.prank(escrow);
        vm.expectRevert("already authorized");
        registry.authorize(offerId, payer);

        vm.prank(settler);
        registry.closeJob(offerId, BeaconJobRegistry.JobResult.Fail);

        vm.prank(settler);
        vm.expectRevert("already closed");
        registry.closeJob(offerId, BeaconJobRegistry.JobResult.Pass);
    }
}
