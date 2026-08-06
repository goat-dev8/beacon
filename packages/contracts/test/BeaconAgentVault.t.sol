// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";
import {BeaconAgentVault} from "../src/BeaconAgentVault.sol";

contract BeaconAgentVaultTest is Test {
    MockUSDT0 internal token;
    BeaconAgentVault internal vault;

    address internal owner = address(0xA11CE);
    address internal executor = address(0xE1);
    address internal stranger = address(0xBAD);
    address internal payee = address(0xB0B);

    bytes4 internal constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    function setUp() public {
        token = new MockUSDT0();
        vault = new BeaconAgentVault(address(token), owner, executor);

        token.mint(owner, 10_000_000); // 10 USDT0 (6 decimals)

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(5_000_000);
        vault.setPolicy({
            maxSpendPerTx_: 1_000_000,
            rollingWindowBudget_: 3_000_000,
            rollingWindowSeconds_: 1 days,
            sessionExpiresAt_: block.timestamp + 7 days
        });
        vault.setAllowedTarget(address(token), true);
        vault.setAllowedSelector(TRANSFER_SELECTOR, true);
        vm.stopPrank();
    }

    function testDepositIncreasesVaultBalance() public view {
        assertEq(vault.balance(), 5_000_000);
        assertEq(token.balanceOf(address(vault)), 5_000_000);
        assertEq(token.balanceOf(owner), 5_000_000);
    }

    function testWithdrawReturnsToOwner() public {
        vm.prank(owner);
        vault.withdraw(2_000_000);
        assertEq(vault.balance(), 3_000_000);
        assertEq(token.balanceOf(owner), 7_000_000);
    }

    function testNonOwnerCannotDepositOrWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        vault.deposit(1);

        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.withdraw(1);
    }

    function testSetPolicyEmitsAndResetsWindow() public {
        vm.prank(owner);
        vault.setPolicy(500_000, 2_000_000, 2 days, block.timestamp + 30 days);
        assertEq(vault.maxSpendPerTx(), 500_000);
        assertEq(vault.rollingWindowBudget(), 2_000_000);
        assertEq(vault.rollingWindowSeconds(), 2 days);
        assertEq(vault.windowSpent(), 0);
    }

    function testExecuteWithinBudget() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(400_000));
        vm.prank(executor);
        vault.execute(address(token), data, 400_000, 1);

        assertEq(token.balanceOf(payee), 400_000);
        assertEq(vault.balance(), 4_600_000);
        assertEq(vault.windowSpent(), 400_000);
        assertTrue(vault.usedNonces(1));
    }

    function testRejectOverPerTxBudget() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1_000_001));
        vm.prank(executor);
        vm.expectRevert("over per-tx budget");
        vault.execute(address(token), data, 1_000_001, 2);
    }

    function testRejectOverMaxSpendArg() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(100_000));
        vm.prank(executor);
        vm.expectRevert("over maxSpend");
        vault.execute(address(token), data, 50_000, 3);
    }

    function testRejectOverRollingWindowBudget() public {
        bytes memory data1 = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1_000_000));
        bytes memory data2 = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1_000_000));
        bytes memory data3 = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1_000_000));
        bytes memory data4 = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));

        vm.startPrank(executor);
        vault.execute(address(token), data1, 1_000_000, 10);
        vault.execute(address(token), data2, 1_000_000, 11);
        vault.execute(address(token), data3, 1_000_000, 12);
        vm.expectRevert("over window budget");
        vault.execute(address(token), data4, 1, 13);
        vm.stopPrank();
    }

    function testRollingWindowResetsAfterDuration() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1_000_000));
        vm.startPrank(executor);
        vault.execute(address(token), data, 1_000_000, 20);
        vault.execute(address(token), data, 1_000_000, 21);
        vault.execute(address(token), data, 1_000_000, 22);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(executor);
        vault.execute(address(token), data, 1_000_000, 23);
        assertEq(vault.windowSpent(), 1_000_000);
    }

    function testPauseBlocksExecuteButOwnerCanWithdraw() public {
        vm.prank(owner);
        vault.setPaused(true);

        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));
        vm.prank(executor);
        vm.expectRevert("paused");
        vault.execute(address(token), data, 1, 30);

        vm.prank(owner);
        vault.withdraw(100_000);
        assertEq(token.balanceOf(owner), 5_100_000);
    }

    function testRevokeExecutorBlocksExecute() public {
        vm.prank(owner);
        vault.setExecutor(address(0));

        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));
        vm.prank(executor);
        vm.expectRevert("not executor");
        vault.execute(address(token), data, 1, 40);
    }

    function testReplayProtection() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(10_000));
        vm.prank(executor);
        vault.execute(address(token), data, 10_000, 99);

        vm.prank(executor);
        vm.expectRevert("nonce used");
        vault.execute(address(token), data, 10_000, 99);
    }

    function testExecutorCannotSetPolicy() public {
        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.setPolicy(1, 1, 1 days, block.timestamp + 1);

        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.setAllowedTarget(stranger, true);

        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.setPaused(true);

        vm.prank(executor);
        vm.expectRevert("not owner");
        vault.setExecutor(stranger);
    }

    function testNonExecutorCannotExecute() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));
        vm.prank(stranger);
        vm.expectRevert("not executor");
        vault.execute(address(token), data, 1, 50);

        vm.prank(owner);
        vm.expectRevert("not executor");
        vault.execute(address(token), data, 1, 51);
    }

    function testSessionExpiryBlocksExecute() public {
        vm.warp(vault.sessionExpiresAt());
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));
        vm.prank(executor);
        vm.expectRevert("session expired");
        vault.execute(address(token), data, 1, 60);
    }

    function testTargetAndSelectorAllowlists() public {
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(1));
        vm.prank(owner);
        vault.setAllowedTarget(address(token), false);

        vm.prank(executor);
        vm.expectRevert("target not allowed");
        vault.execute(address(token), data, 1, 70);

        vm.startPrank(owner);
        vault.setAllowedTarget(address(token), true);
        vault.setAllowedSelector(TRANSFER_SELECTOR, false);
        vm.stopPrank();

        vm.prank(executor);
        vm.expectRevert("selector not allowed");
        vault.execute(address(token), data, 1, 71);
    }

    function testExactBeforeAfterSpendAccounting() public {
        uint256 before = vault.balance();
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, uint256(250_000));
        vm.prank(executor);
        vault.execute(address(token), data, 250_000, 80);
        assertEq(before - vault.balance(), 250_000);
        assertEq(vault.windowSpent(), 250_000);
    }

    function testDepositWithAuthorization() public {
        uint256 ownerKey = 0xA11CE;
        address ownerSigner = vm.addr(ownerKey);
        // Redeploy vault with signer as owner for EIP-3009 path.
        BeaconAgentVault authVault = new BeaconAgentVault(address(token), ownerSigner, executor);
        token.mint(ownerSigner, 1_000_000);

        bytes32 nonce = keccak256("vault-deposit-1");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 3600;
        uint256 amount = 500_000;

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                ),
                ownerSigner,
                address(authVault),
                amount,
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(ownerSigner);
        authVault.depositWithAuthorization(ownerSigner, amount, validAfter, validBefore, nonce, signature);
        assertEq(authVault.balance(), amount);
    }

    /// @notice Fuzz: any spend within configured per-tx and remaining window budget succeeds once.
    function testFuzzExecuteWithinBudgets(uint256 spend) public {
        uint256 remainingWindow = vault.rollingWindowBudget() - vault.windowSpent();
        uint256 cap = vault.maxSpendPerTx();
        if (remainingWindow < cap) cap = remainingWindow;
        if (cap == 0) return;
        spend = bound(spend, 1, cap);

        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, spend);
        vm.prank(executor);
        vault.execute(address(token), data, spend, uint256(keccak256(abi.encode(spend, "fuzz"))));
        assertEq(token.balanceOf(payee), spend);
    }
}

/// @dev Invariant: vault token balance never exceeds deposited − withdrawn − spent under handler ops.
contract VaultHandler is Test {
    MockUSDT0 public token;
    BeaconAgentVault public vault;
    address public owner;
    address public executor;
    address public payee;
    bytes4 public constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostSpent;
    uint256 public nextNonce = 1_000;

    constructor(MockUSDT0 token_, BeaconAgentVault vault_, address owner_, address executor_, address payee_) {
        token = token_;
        vault = vault_;
        owner = owner_;
        executor = executor_;
        payee = payee_;
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 1_000_000);
        uint256 ownerBal = token.balanceOf(owner);
        if (ownerBal < amount) {
            token.mint(owner, amount - ownerBal);
        }
        vm.startPrank(owner);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        ghostDeposited += amount;
    }

    function withdraw(uint256 amount) external {
        uint256 bal = vault.balance();
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(owner);
        vault.withdraw(amount);
        ghostWithdrawn += amount;
    }

    function executeSpend(uint256 amount) external {
        if (vault.paused()) return;
        if (vault.sessionExpiresAt() != 0 && block.timestamp >= vault.sessionExpiresAt()) return;
        uint256 bal = vault.balance();
        if (bal == 0) return;

        uint256 remainingWindow = vault.rollingWindowBudget() > vault.windowSpent()
            ? vault.rollingWindowBudget() - vault.windowSpent()
            : 0;
        uint256 cap = vault.maxSpendPerTx();
        if (remainingWindow < cap) cap = remainingWindow;
        if (cap > bal) cap = bal;
        if (cap == 0) return;

        amount = bound(amount, 1, cap);
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, payee, amount);
        uint256 nonce = nextNonce++;
        vm.prank(executor);
        vault.execute(address(token), data, amount, nonce);
        ghostSpent += amount;
    }
}

contract BeaconAgentVaultInvariantTest is Test {
    MockUSDT0 internal token;
    BeaconAgentVault internal vault;
    VaultHandler internal handler;

    address internal owner = address(0xA11CE);
    address internal executor = address(0xE1);
    address internal payee = address(0xB0B);
    bytes4 internal constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    function setUp() public {
        token = new MockUSDT0();
        vault = new BeaconAgentVault(address(token), owner, executor);
        token.mint(owner, 50_000_000);

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(10_000_000);
        vault.setPolicy(2_000_000, 20_000_000, 1 days, block.timestamp + 365 days);
        vault.setAllowedTarget(address(token), true);
        vault.setAllowedSelector(TRANSFER_SELECTOR, true);
        vm.stopPrank();

        handler = new VaultHandler(token, vault, owner, executor, payee);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = VaultHandler.deposit.selector;
        selectors[1] = VaultHandler.withdraw.selector;
        selectors[2] = VaultHandler.executeSpend.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice Conservation: vault ERC20 balance equals seed + handler deposits − withdrawals − spends.
    function invariant_balanceConservation() public view {
        uint256 expected = 10_000_000 + handler.ghostDeposited() - handler.ghostWithdrawn() - handler.ghostSpent();
        assertEq(vault.balance(), expected);
        assertEq(token.balanceOf(address(vault)), expected);
    }

    /// @notice Window spend never exceeds rolling budget within an active window.
    function invariant_windowBudgetRespected() public view {
        assertLe(vault.windowSpent(), vault.rollingWindowBudget());
    }
}
