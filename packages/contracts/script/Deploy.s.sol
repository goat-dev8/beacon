// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDT0} from "../src/mocks/MockUSDT0.sol";
import {X402Facilitator} from "../src/X402Facilitator.sol";
import {BeaconJobRegistry} from "../src/BeaconJobRegistry.sol";
import {BeaconEscrow} from "../src/BeaconEscrow.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address payee = vm.envAddress("X402_PAYEE_ADDRESS");
        address owner = vm.envOr("INITIAL_OWNER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        MockUSDT0 token = new MockUSDT0();
        X402Facilitator facilitator = new X402Facilitator();
        BeaconJobRegistry registry = new BeaconJobRegistry();
        BeaconEscrow escrow = new BeaconEscrow(address(token), payee, owner);

        // Seed deployer with test USDT0 for e2e
        token.mint(payee, 1_000_000_000_000); // 1_000_000 USDT0 (6 decimals)

        vm.stopBroadcast();

        console2.log("MockUSDT0", address(token));
        console2.log("X402Facilitator", address(facilitator));
        console2.log("BeaconJobRegistry", address(registry));
        console2.log("BeaconEscrow", address(escrow));
    }
}
