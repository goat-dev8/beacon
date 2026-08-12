// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEIP3009} from "./interfaces/IEIP3009.sol";

interface IERC20Pull {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title X402Facilitator — settle x402 payments
/// @notice Live Coston2 faucet USDT0 has no EIP-3009. Prefer `settleTransferFrom`
///         (payer approves this contract, settler pulls). `settlePayment` remains
///         for fixture MockUSDT0 / EIP-3009 tokens.
contract X402Facilitator {
    event PaymentVerified(address indexed token, address indexed payer, address indexed payee, uint256 amount);
    event PaymentSettled(address indexed token, address indexed payer, address indexed payee, uint256 amount, bytes32 nonce);

    function verifyPayment(
        address token,
        address payer,
        address payee,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external view returns (bool) {
        if (block.timestamp <= validAfter) return false;
        if (block.timestamp >= validBefore) return false;
        if (IEIP3009(token).authorizationState(payer, nonce)) return false;
        if (amount == 0 || payer == address(0) || payee == address(0)) return false;
        return signature.length == 65;
    }

    function settlePayment(
        address token,
        address payer,
        address payee,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external returns (bool) {
        require(
            this.verifyPayment(token, payer, payee, amount, validAfter, validBefore, nonce, signature),
            "invalid payment"
        );
        bool ok = IEIP3009(token).transferWithAuthorization(
            payer, payee, amount, validAfter, validBefore, nonce, signature
        );
        require(ok, "transfer failed");
        emit PaymentSettled(token, payer, payee, amount, nonce);
        return true;
    }

    /// @notice Pull ERC-20 from `payer` to `payee` after the payer approved this facilitator.
    /// @dev Official Coston2 faucet USDT0 path (6 decimals, standard transferFrom).
    function settleTransferFrom(
        address token,
        address payer,
        address payee,
        uint256 amount
    ) external returns (bool) {
        require(amount > 0 && payer != address(0) && payee != address(0), "bad args");
        require(IERC20Pull(token).transferFrom(payer, payee, amount), "pull failed");
        emit PaymentSettled(token, payer, payee, amount, bytes32(0));
        return true;
    }
}
