// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEIP3009} from "./interfaces/IEIP3009.sol";

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title BeaconEscrow — lock USDT0 on authorize, release or refund by outcome
/// @notice Three compliant lock paths:
/// 1) `lockFrom` — ERC-20 approve + transferFrom (official Coston2 faucet USDT0)
/// 2) `lockPrepaid` — tokens already transferred in (Beacon Safe vault.execute transfer);
///    owner/settler records the lock. Refunds return to `payer` (the Safe).
/// 3) `lockWithAuthorization` — EIP-3009 (fixture MockUSDT0 / tokens that implement it).
///    Live Coston2 faucet USDT0 does not implement EIP-3009.
contract BeaconEscrow {
    IEIP3009 public immutable token;
    address public immutable payee;
    address public owner;

    /// @dev Sum of amounts in unsettled locks. Prepaid path requires free balance ≥ amount.
    uint256 public lockedTotal;

    struct Lock {
        address payer;
        uint256 amount;
        bool released;
        bool refunded;
    }

    mapping(bytes32 => Lock) public locks;

    event Locked(bytes32 indexed jobId, address indexed payer, uint256 amount);
    event LockedPrepaid(bytes32 indexed jobId, address indexed payer, uint256 amount);
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

    function freeBalance() public view returns (uint256) {
        uint256 bal = IERC20Transfer(address(token)).balanceOf(address(this));
        return bal > lockedTotal ? bal - lockedTotal : 0;
    }

    /// @notice Pull `amount` of token from `payer` (requires ERC-20 allowance to this escrow).
    /// @dev Live Coston2 USDT0 path. Anyone may submit after the payer has approved this contract.
    function lockFrom(bytes32 jobId, address payer, uint256 amount) external {
        require(locks[jobId].payer == address(0), "already locked");
        require(payer != address(0), "zero payer");
        require(amount > 0, "zero amount");
        require(IERC20Transfer(address(token)).transferFrom(payer, address(this), amount), "pull failed");
        lockedTotal += amount;
        locks[jobId] = Lock({payer: payer, amount: amount, released: false, refunded: false});
        emit Locked(jobId, payer, amount);
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
        lockedTotal += amount;
        locks[jobId] = Lock({payer: payer, amount: amount, released: false, refunded: false});
        emit Locked(jobId, payer, amount);
    }

    /// @notice Record a lock for tokens already held by this escrow (Safe prepaid path).
    /// @dev Caller must be owner (settler). Tokens must arrive first via ERC-20 transfer
    ///      (typically BeaconAgentVault.execute → token.transfer(escrow, amount)).
    function lockPrepaid(bytes32 jobId, address payer, uint256 amount) external onlyOwner {
        require(payer != address(0), "zero payer");
        require(amount > 0, "zero amount");
        require(locks[jobId].payer == address(0), "already locked");
        require(freeBalance() >= amount, "insufficient prepaid");
        lockedTotal += amount;
        locks[jobId] = Lock({payer: payer, amount: amount, released: false, refunded: false});
        emit LockedPrepaid(jobId, payer, amount);
        emit Locked(jobId, payer, amount);
    }

    function releaseToPayee(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.released = true;
        lockedTotal -= entry.amount;
        require(IERC20Transfer(address(token)).transfer(payee, entry.amount), "release failed");
        emit Released(jobId, payee, entry.amount);
    }

    function refund(bytes32 jobId) external onlyOwner {
        Lock storage entry = locks[jobId];
        require(entry.payer != address(0), "no lock");
        require(!entry.released && !entry.refunded, "settled");
        entry.refunded = true;
        lockedTotal -= entry.amount;
        require(IERC20Transfer(address(token)).transfer(entry.payer, entry.amount), "refund failed");
        emit Refunded(jobId, entry.payer, entry.amount);
    }
}
