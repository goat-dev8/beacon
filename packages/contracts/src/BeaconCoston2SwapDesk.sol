// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IERC20SwapToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title BeaconCoston2SwapDesk — Coston2 Safe-funded USDT0→FXRP desk
/// @notice SparkDEX SwapRouter has empty bytecode on Coston2. This desk lets the
///         Beacon Safe executor spend pooled faucet USDT0 for FXRP without MetaMask
///         or Mainnet chain switches. Rate is owner-set (API syncs from FTSO).
/// @dev Flow: vault.execute(tokenIn, transfer(desk, amountIn)) then
///      desk.fulfill(recipient, amountIn, minOut). Inventory is real FXRP
///      transferred onto the desk — never invented accounting.
contract BeaconCoston2SwapDesk {
    IERC20SwapToken public immutable tokenIn;
    IERC20SwapToken public immutable tokenOut;

    address public owner;
    address public operator;

    /// @notice FXRP raw out per 1 raw tokenIn, 1e18 fixed-point (both tokens 6 dp).
    uint256 public fxrpOutPerUsdt0X18;
    uint256 public feeBps; // e.g. 30 = 0.30%
    uint256 public accountedTokenIn;
    bool private _locked;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event RateUpdated(uint256 fxrpOutPerUsdt0X18, uint256 feeBps);
    event Swapped(
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut,
        uint256 accountedAfter
    );
    event TokenOutWithdrawn(address indexed to, uint256 amount);
    event TokenInWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "not operator");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor(
        address tokenIn_,
        address tokenOut_,
        address owner_,
        address operator_,
        uint256 fxrpOutPerUsdt0X18_,
        uint256 feeBps_
    ) {
        require(tokenIn_ != address(0) && tokenOut_ != address(0) && owner_ != address(0), "zero");
        require(feeBps_ <= 500, "fee too high");
        require(fxrpOutPerUsdt0X18_ > 0, "bad rate");
        tokenIn = IERC20SwapToken(tokenIn_);
        tokenOut = IERC20SwapToken(tokenOut_);
        owner = owner_;
        operator = operator_;
        fxrpOutPerUsdt0X18 = fxrpOutPerUsdt0X18_;
        feeBps = feeBps_;
        emit OwnershipTransferred(address(0), owner_);
        emit OperatorUpdated(address(0), operator_);
        emit RateUpdated(fxrpOutPerUsdt0X18_, feeBps_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setOperator(address newOperator) external onlyOwner {
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setRate(uint256 fxrpOutPerUsdt0X18_, uint256 feeBps_) external onlyOwner {
        require(fxrpOutPerUsdt0X18_ > 0, "bad rate");
        require(feeBps_ <= 500, "fee too high");
        fxrpOutPerUsdt0X18 = fxrpOutPerUsdt0X18_;
        feeBps = feeBps_;
        emit RateUpdated(fxrpOutPerUsdt0X18_, feeBps_);
    }

    function quote(uint256 amountIn) public view returns (uint256 amountOut) {
        uint256 gross = (amountIn * fxrpOutPerUsdt0X18) / 1e18;
        uint256 fee = (gross * feeBps) / 10_000;
        amountOut = gross - fee;
    }

    function availableTokenIn() public view returns (uint256) {
        uint256 bal = tokenIn.balanceOf(address(this));
        return bal > accountedTokenIn ? bal - accountedTokenIn : 0;
    }

    /// @notice Settle a Safe-funded swap after vault transferred `amountIn` tokenIn here.
    function fulfill(
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyOperator nonReentrant returns (uint256 amountOut) {
        require(recipient != address(0), "zero recipient");
        require(amountIn > 0, "zero in");
        require(availableTokenIn() >= amountIn, "insufficient credited tokenIn");

        amountOut = quote(amountIn);
        require(amountOut >= minAmountOut, "slippage");
        require(tokenOut.balanceOf(address(this)) >= amountOut, "insufficient FXRP inventory");

        accountedTokenIn += amountIn;
        require(tokenOut.transfer(recipient, amountOut), "FXRP transfer failed");
        emit Swapped(recipient, amountIn, amountOut, accountedTokenIn);
    }

    function withdrawTokenOut(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0) && amount > 0, "bad args");
        require(tokenOut.transfer(to, amount), "withdraw out failed");
        emit TokenOutWithdrawn(to, amount);
    }

    function withdrawTokenIn(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0) && amount > 0, "bad args");
        uint256 free = availableTokenIn();
        require(amount <= free, "exceeds free tokenIn");
        // Reclassify accounted so free pool shrinks correctly when sweeping unaccounted dust.
        // Owner may only withdraw unaccounted inventory (availableTokenIn).
        require(tokenIn.transfer(to, amount), "withdraw in failed");
        emit TokenInWithdrawn(to, amount);
    }
}
