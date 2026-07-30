// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";

contract MockUSDT0Test is Test {
    MockUSDT0 internal token;
    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal payee = address(0xBEEF);

    function setUp() public {
        token = new MockUSDT0();
        payer = vm.addr(payerKey);
        token.mint(payer, 1_000_000);
    }

    function testMintAndTransfer() public {
        vm.prank(payer);
        assertTrue(token.transfer(payee, 100_000));
        assertEq(token.balanceOf(payee), 100_000);
    }

    function testTransferWithAuthorization() public {
        bytes32 nonce = keccak256("nonce-1");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        uint256 value = 250_000;

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                ),
                payer,
                payee,
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
        bytes memory signature = abi.encodePacked(r, s, v);

        assertTrue(
            token.transferWithAuthorization(payer, payee, value, validAfter, validBefore, nonce, signature)
        );
        assertEq(token.balanceOf(payee), value);
        assertTrue(token.authorizationState(payer, nonce));
    }
}
