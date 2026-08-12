// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";
import {X402Facilitator} from "../src/X402Facilitator.sol";
import {BeaconJobRegistry} from "../src/BeaconJobRegistry.sol";
import {BeaconEscrow} from "../src/BeaconEscrow.sol";
import {BeaconAgentVault} from "../src/BeaconAgentVault.sol";

/// @notice Local/fixture full stack. Deploys MockUSDT0 — NOT the live Coston2 rail.
///         Live rails: `DeployUsdt0Rails.s.sol` against official faucet USDT0.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address payee = vm.envAddress("X402_PAYEE_ADDRESS");
        address owner = vm.envOr("INITIAL_OWNER", deployer);
        address executor = vm.envOr("VAULT_EXECUTOR", owner);

        vm.startBroadcast(deployerKey);

        MockUSDT0 token = new MockUSDT0();
        X402Facilitator facilitator = new X402Facilitator();
        // Deploy registry under broadcaster so role grants succeed, then transfer ownership.
        BeaconJobRegistry registry = new BeaconJobRegistry(deployer);
        BeaconEscrow escrow = new BeaconEscrow(address(token), payee, owner);
        BeaconAgentVault vault = new BeaconAgentVault(address(token), owner, executor);
        registry.setAuthorizer(address(escrow), true);
        registry.setCloser(owner, true);
        if (owner != deployer) {
            registry.transferOwnership(owner);
        }

        // Seed deployer with test USDT0 for e2e
        token.mint(payee, 1_000_000_000_000); // 1_000_000 USDT0 (6 decimals)

        vm.stopBroadcast();

        console2.log("MockUSDT0", address(token));
        console2.log("X402Facilitator", address(facilitator));
        console2.log("BeaconJobRegistry", address(registry));
        console2.log("BeaconEscrow", address(escrow));
        console2.log("BeaconAgentVault", address(vault));
    }
}
