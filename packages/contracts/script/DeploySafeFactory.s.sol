// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BeaconSafeFactory} from "../src/BeaconSafeFactory.sol";

/// @notice Deploy BeaconSafeFactory on Coston2 (personal Safes).
/// @dev Does not migrate the legacy shared BeaconAgentVault.
contract DeploySafeFactory is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address token = vm.envAddress("X402_TOKEN_ADDRESS");
        address executor = vm.envOr("VAULT_EXECUTOR", vm.envOr("SETTLER_ADDRESS", vm.addr(deployerKey)));

        // 10 USDT0 per tx, 50 USDT0 / 7d (6 decimals)
        uint256 perTx = vm.envOr("SAFE_DEFAULT_MAX_SPEND", uint256(10_000_000));
        uint256 window = vm.envOr("SAFE_DEFAULT_WINDOW_BUDGET", uint256(50_000_000));
        uint256 secs = vm.envOr("SAFE_DEFAULT_WINDOW_SECONDS", uint256(7 days));

        vm.startBroadcast(deployerKey);
        BeaconSafeFactory factory = new BeaconSafeFactory(token, executor, perTx, window, secs);
        vm.stopBroadcast();

        console2.log("BeaconSafeFactory", address(factory));
        console2.log("token", token);
        console2.log("defaultExecutor", executor);
    }
}
