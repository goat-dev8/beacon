// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEIP3009} from "./interfaces/IEIP3009.sol";

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title BeaconEscrow — lock USDT0 on authorize, release or refund by outcome
contract BeaconEscrow {
    IEIP3009 public immutable token;
    address public immutable payee;
    address public owner;

    struct Lock {
        address payer;
        uint256 amount;
        bool released;
        bool refunded;
    }

    mapping(bytes32 => Lock) public locks;

    event Locked(bytes32 indexed jobId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed jobId, address indexed payee, uint256 amount);
    event Refunded(bytes32 indexed jobId, address indexed payer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address token_, address payee_, address owner_) {
        token = IEIP3009(token_);
        payee = payee_;
        owner = owner_;
    }

    function lockWithAuthorization(
        bytes32 jobId,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(locks[jobId].payer == address(0), "already locked");
        bool ok = token.transferWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, signature
        );
        require(ok, "authorization failed");
        locks[jobId] = Lock({payer: payer, amount: amount, released: false, refunded: false});
        emit Locked(jobId, payer, amount);
    }

    function releaseToPayee(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.released = true;
        require(IERC20Transfer(address(token)).transfer(payee, entry.amount), "release failed");
        emit Released(jobId, payee, entry.amount);
    }

    function refund(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.refunded = true;
        require(IERC20Transfer(address(token)).transfer(entry.payer, entry.amount), "refund failed");
        emit Refunded(jobId, entry.payer, entry.amount);
    }
}
