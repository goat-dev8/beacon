// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BeaconEscrow} from "../src/BeaconEscrow.sol";

/// @notice Redeploy BeaconEscrow with lockPrepaid (Safe-funded Bound Work) against existing MockUSDT0.
contract DeployEscrowPrepaid is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address token = vm.envAddress("X402_TOKEN_ADDRESS");
        address payee = vm.envAddress("X402_PAYEE_ADDRESS");
        address owner = vm.envOr("INITIAL_OWNER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);
        BeaconEscrow escrow = new BeaconEscrow(token, payee, owner);
        vm.stopBroadcast();

        console2.log("BeaconEscrow", address(escrow));
        console2.log("token", token);
        console2.log("payee", payee);
        console2.log("owner", owner);
    }
}
