// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IEIP3009} from "./interfaces/IEIP3009.sol";

interface IERC20VaultToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title BeaconAgentVault — prepaid agent spend under owner policy
/// @notice Pooled ERC20 budget (typically MockUSDT0 / USDT0) that an executor may spend
///         only within owner-set limits. Distinct from Bound Work per-job escrow
///         (`BeaconEscrow`): vault funds are prepaid agent budgets; escrow locks are
///         outcome-priced job holds and must not be conflated with this pool.
contract BeaconAgentVault {
    IERC20VaultToken public immutable token;

    address public owner;
    address public executor;

    bool public paused;
    uint256 private _status; // 1 = entered (reentrancy guard)

    uint256 public maxSpendPerTx;
    uint256 public rollingWindowBudget;
    uint256 public rollingWindowSeconds;
    uint256 public sessionExpiresAt;

    uint256 public windowStart;
    uint256 public windowSpent;
    uint256 public executeNonce;

    mapping(address => bool) public allowedTargets;
    mapping(bytes4 => bool) public allowedSelectors;
    mapping(uint256 => bool) public usedNonces;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event Deposited(address indexed from, uint256 amount, uint256 balanceAfter);
    event Withdrawn(address indexed to, uint256 amount, uint256 balanceAfter);
    event PolicyUpdated(
        uint256 maxSpendPerTx,
        uint256 rollingWindowBudget,
        uint256 rollingWindowSeconds,
        uint256 sessionExpiresAt
    );
    event TargetAllowlistUpdated(address indexed target, bool allowed);
    event SelectorAllowlistUpdated(bytes4 indexed selector, bool allowed);
    event PauseSet(bool paused);
    event Executed(
        address indexed executor,
        address indexed target,
        bytes4 indexed selector,
        uint256 spent,
        uint256 balanceBefore,
        uint256 balanceAfter,
        uint256 nonce
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "not executor");
        _;
    }

    modifier nonReentrant() {
        require(_status == 0, "reentrant");
        _status = 1;
        _;
        _status = 0;
    }

    constructor(address token_, address owner_, address executor_) {
        require(token_ != address(0) && owner_ != address(0), "zero address");
        token = IERC20VaultToken(token_);
        owner = owner_;
        executor = executor_;
        emit OwnershipTransferred(address(0), owner_);
        emit ExecutorUpdated(address(0), executor_);
    }

    // ─── Owner funds ─────────────────────────────────────────────────────────

    /// @notice Pull `amount` of `token` from the owner into the vault pool.
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        require(token.transferFrom(msg.sender, address(this), amount), "deposit failed");
        emit Deposited(msg.sender, amount, token.balanceOf(address(this)));
    }

    /// @notice Deposit via EIP-3009 (MockUSDT0 / USDT0 authorization pattern).
    function depositWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        require(from == owner, "from must be owner");
        bool ok = IEIP3009(address(token)).transferWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, signature
        );
        require(ok, "authorization failed");
        emit Deposited(from, amount, token.balanceOf(address(this)));
    }

    /// @notice Owner may withdraw any pooled tokens unilaterally (including while paused).
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "zero amount");
        require(token.transfer(owner, amount), "withdraw failed");
        emit Withdrawn(owner, amount, token.balanceOf(address(this)));
    }

    // ─── Owner policy (executor cannot call these) ───────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Rotate the executor. Executor cannot set itself or change policy.
    function setExecutor(address newExecutor) external onlyOwner {
        emit ExecutorUpdated(executor, newExecutor);
        executor = newExecutor;
    }

    function setPolicy(
        uint256 maxSpendPerTx_,
        uint256 rollingWindowBudget_,
        uint256 rollingWindowSeconds_,
        uint256 sessionExpiresAt_
    ) external onlyOwner {
        require(rollingWindowSeconds_ > 0, "bad window");
        maxSpendPerTx = maxSpendPerTx_;
        rollingWindowBudget = rollingWindowBudget_;
        rollingWindowSeconds = rollingWindowSeconds_;
        sessionExpiresAt = sessionExpiresAt_;
        // Reset rolling window on policy change so new budget is authoritative.
        windowStart = block.timestamp;
        windowSpent = 0;
        emit PolicyUpdated(maxSpendPerTx_, rollingWindowBudget_, rollingWindowSeconds_, sessionExpiresAt_);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        require(target != address(0), "zero target");
        allowedTargets[target] = allowed;
        emit TargetAllowlistUpdated(target, allowed);
    }

    function setAllowedSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedSelectors[selector] = allowed;
        emit SelectorAllowlistUpdated(selector, allowed);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseSet(paused_);
    }

    // ─── Executor spend ──────────────────────────────────────────────────────

    /// @notice Executor calls an allowlisted target; token spend is measured as exact
    ///         balance delta (before − after) and charged against per-tx + rolling budgets.
    /// @param target Allowlisted contract to call.
    /// @param data Calldata; first 4 bytes must be an allowlisted selector.
    /// @param maxSpend Cap for this call's token delta (also bounded by maxSpendPerTx).
    /// @param nonce_ Replay-protection nonce; must be unused.
    function execute(
        address target,
        bytes calldata data,
        uint256 maxSpend,
        uint256 nonce_
    ) external onlyExecutor nonReentrant returns (bytes memory result) {
        require(!paused, "paused");
        require(sessionExpiresAt == 0 || block.timestamp < sessionExpiresAt, "session expired");
        require(allowedTargets[target], "target not allowed");
        require(data.length >= 4, "no selector");
        bytes4 selector = bytes4(data[0:4]);
        require(allowedSelectors[selector], "selector not allowed");
        require(!usedNonces[nonce_], "nonce used");
        usedNonces[nonce_] = true;
        executeNonce = nonce_;

        uint256 balanceBefore = token.balanceOf(address(this));

        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "call failed");

        uint256 balanceAfter = token.balanceOf(address(this));
        require(balanceAfter <= balanceBefore, "unexpected credit");
        uint256 spent = balanceBefore - balanceAfter;
        require(spent <= maxSpend, "over maxSpend");
        require(spent <= maxSpendPerTx, "over per-tx budget");

        _consumeRollingBudget(spent);

        emit Executed(msg.sender, target, selector, spent, balanceBefore, balanceAfter, nonce_);
        return ret;
    }

    function _consumeRollingBudget(uint256 spent) internal {
        if (windowStart == 0 || block.timestamp >= windowStart + rollingWindowSeconds) {
            windowStart = block.timestamp;
            windowSpent = 0;
        }
        windowSpent += spent;
        require(windowSpent <= rollingWindowBudget, "over window budget");
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
