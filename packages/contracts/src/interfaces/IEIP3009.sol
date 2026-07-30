// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IEIP3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external returns (bool);

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
