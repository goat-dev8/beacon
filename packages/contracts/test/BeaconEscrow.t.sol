// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";
import {BeaconEscrow} from "../src/BeaconEscrow.sol";

contract BeaconEscrowTest is Test {
    MockUSDT0 internal token;
    BeaconEscrow internal escrow;

    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal payee = address(0xCAFE);
    address internal owner = address(0xABCD);

    function setUp() public {
        token = new MockUSDT0();
        escrow = new BeaconEscrow(address(token), payee, owner);
        payer = vm.addr(payerKey);
        token.mint(payer, 2_000_000);
    }

    function testHappyPathRelease() public {
        bytes32 jobId = keccak256("job-pass");
        uint256 amount = 500_000;
        _lock(jobId, amount);

        vm.prank(owner);
        escrow.releaseToPayee(jobId);

        assertEq(token.balanceOf(payee), amount);
        (,, bool released,) = escrow.locks(jobId);
        assertTrue(released);
    }

    function testRefundOnFailPath() public {
        bytes32 jobId = keccak256("job-fail");
        uint256 amount = 300_000;
        _lock(jobId, amount);

        vm.prank(owner);
        escrow.refund(jobId);

        assertEq(token.balanceOf(payer), 2_000_000);
        (,, , bool refunded) = escrow.locks(jobId);
        assertTrue(refunded);
    }

    function testCannotDoubleSettle() public {
        bytes32 jobId = keccak256("job-double");
        _lock(jobId, 100_000);
        vm.startPrank(owner);
        escrow.releaseToPayee(jobId);
        vm.expectRevert("settled");
        escrow.refund(jobId);
        vm.stopPrank();
    }

    function testLockPrepaidHappyPath() public {
        address vault = address(0xBEEF);
        uint256 amount = 250_000;
        token.mint(address(escrow), amount);
        assertEq(escrow.freeBalance(), amount);

        bytes32 jobId = keccak256("job-prepaid");
        vm.prank(owner);
        escrow.lockPrepaid(jobId, vault, amount);

        assertEq(escrow.lockedTotal(), amount);
        assertEq(escrow.freeBalance(), 0);
        (address lockedPayer, uint256 lockedAmt,,) = escrow.locks(jobId);
        assertEq(lockedPayer, vault);
        assertEq(lockedAmt, amount);

        vm.prank(owner);
        escrow.refund(jobId);
        assertEq(token.balanceOf(vault), amount);
        assertEq(escrow.lockedTotal(), 0);
    }

    function testLockPrepaidRequiresOwnerAndFreeBalance() public {
        address vault = address(0xBEEF);
        bytes32 jobId = keccak256("job-prepaid-fail");
        vm.expectRevert("insufficient prepaid");
        vm.prank(owner);
        escrow.lockPrepaid(jobId, vault, 1);

        token.mint(address(escrow), 100_000);
        vm.expectRevert("not owner");
        vm.prank(payer);
        escrow.lockPrepaid(jobId, vault, 50_000);
    }

    function _lock(bytes32 jobId, uint256 amount) internal {
        bytes32 nonce = keccak256(abi.encodePacked(jobId, "-lock"));
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        bytes memory signature = _signAuth(payer, address(escrow), amount, validAfter, validBefore, nonce);
        escrow.lockWithAuthorization(jobId, payer, amount, validAfter, validBefore, nonce, signature);
    }

    function _signAuth(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                ),
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(token.name())),
                keccak256(bytes(token.version())),
                block.chainid,
                address(token)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
