// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BeaconAgentVault} from "../src/BeaconAgentVault.sol";

/// @notice Deploy BeaconAgentVault onto an existing Coston2 token (e.g. MockUSDT0).
/// @dev Does not redeploy escrow/registry. Set X402_TOKEN_ADDRESS to the live token.
contract DeployAgentVault is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address token = vm.envAddress("X402_TOKEN_ADDRESS");
        address owner = vm.envOr("INITIAL_OWNER", deployer);
        address executor = vm.envOr("VAULT_EXECUTOR", owner);

        vm.startBroadcast(deployerKey);
        BeaconAgentVault vault = new BeaconAgentVault(token, owner, executor);
        vm.stopBroadcast();

        console2.log("BeaconAgentVault", address(vault));
        console2.log("token", token);
        console2.log("owner", owner);
        console2.log("executor", executor);
    }
}
