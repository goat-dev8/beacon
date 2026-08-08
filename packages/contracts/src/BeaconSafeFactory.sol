// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BeaconAgentVault} from "./BeaconAgentVault.sol";

/// @title BeaconSafeFactory — one personal Beacon Safe per wallet
/// @notice Deploys BeaconAgentVault instances. Each wallet may own exactly one Safe.
///         Factory briefly owns the vault to seed token-transfer allowlists + default
///         policy, then transfers ownership to the user. Executor stays the global
///         Beacon settler so Agent Jobs / Safe swaps keep working without MetaMask.
/// @dev Legacy shared vault (if any) is NOT migrated here. Funds stay until the
///      legacy owner withdraws manually.
contract BeaconSafeFactory {
    bytes4 internal constant ERC20_TRANSFER = bytes4(keccak256("transfer(address,uint256)"));

    address public immutable token;
    address public immutable defaultExecutor;

    /// @dev Default policy: 10 USDT0 per tx, 50 USDT0 / 7d window, no session expiry.
    uint256 public immutable defaultMaxSpendPerTx;
    uint256 public immutable defaultRollingBudget;
    uint256 public immutable defaultRollingSeconds;

    mapping(address => address) public safeOf;
    address[] public allSafes;

    event SafeCreated(address indexed owner, address indexed safe, address indexed executor);

    error ZeroAddress();
    error BadWindow();
    error SafeExists(address owner, address existing);

    constructor(
        address token_,
        address defaultExecutor_,
        uint256 defaultMaxSpendPerTx_,
        uint256 defaultRollingBudget_,
        uint256 defaultRollingSeconds_
    ) {
        if (token_ == address(0) || defaultExecutor_ == address(0)) revert ZeroAddress();
        if (defaultRollingSeconds_ == 0) revert BadWindow();
        token = token_;
        defaultExecutor = defaultExecutor_;
        defaultMaxSpendPerTx = defaultMaxSpendPerTx_;
        defaultRollingBudget = defaultRollingBudget_;
        defaultRollingSeconds = defaultRollingSeconds_;
    }

    /// @notice Create a personal Beacon Safe for msg.sender (idempotent reject if exists).
    function createSafe() external returns (address safe) {
        return _createSafe(msg.sender);
    }

    /// @notice Predictable CREATE2 address for an owner (before or after deploy).
    function predictSafe(address owner) external view returns (address predicted) {
        bytes32 salt = _salt(owner);
        bytes memory init = abi.encodePacked(
            type(BeaconAgentVault).creationCode,
            abi.encode(token, address(this), defaultExecutor)
        );
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(init)));
        predicted = address(uint160(uint256(hash)));
    }

    function hasSafe(address owner) external view returns (bool) {
        return safeOf[owner] != address(0);
    }

    function safeCount() external view returns (uint256) {
        return allSafes.length;
    }

    function _createSafe(address owner) internal returns (address safe) {
        if (owner == address(0)) revert ZeroAddress();
        address existing = safeOf[owner];
        if (existing != address(0)) revert SafeExists(owner, existing);

        bytes32 salt = _salt(owner);
        // Factory is temporary owner so it can seed allowlists + default policy.
        BeaconAgentVault vault = new BeaconAgentVault{salt: salt}(token, address(this), defaultExecutor);
        safe = address(vault);

        vault.setAllowedTarget(token, true);
        vault.setAllowedSelector(ERC20_TRANSFER, true);
        vault.setPolicy(defaultMaxSpendPerTx, defaultRollingBudget, defaultRollingSeconds, 0);
        vault.transferOwnership(owner);

        safeOf[owner] = safe;
        allSafes.push(safe);
        emit SafeCreated(owner, safe, defaultExecutor);
    }

    function _salt(address owner) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("beacon.safe.v1", owner));
    }
}
