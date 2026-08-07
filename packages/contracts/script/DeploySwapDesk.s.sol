// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {BeaconCoston2SwapDesk} from "../src/BeaconCoston2SwapDesk.sol";

/// @notice Deploy BeaconCoston2SwapDesk on Coston2 (MockUSDT0 ↔ FXRP inventory desk).
contract DeploySwapDesk is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address tokenIn = vm.envAddress("X402_TOKEN_ADDRESS");
        address tokenOut = vm.envAddress("EXPECTED_FXRP_TOKEN");
        address owner = vm.envOr("INITIAL_OWNER", deployer);
        address operator = vm.envOr("VAULT_EXECUTOR", owner);
        // Default ~0.5 FXRP per USDT0 if XRP≈$2; API will refresh from FTSO.
        uint256 rateX18 = vm.envOr("SWAP_DESK_RATE_X18", uint256(5e17));
        uint256 feeBps = vm.envOr("SWAP_DESK_FEE_BPS", uint256(30));

        vm.startBroadcast(deployerKey);
        BeaconCoston2SwapDesk desk = new BeaconCoston2SwapDesk(
            tokenIn,
            tokenOut,
            owner,
            operator,
            rateX18,
            feeBps
        );
        vm.stopBroadcast();

        console2.log("BeaconCoston2SwapDesk", address(desk));
        console2.log("tokenIn", tokenIn);
        console2.log("tokenOut", tokenOut);
        console2.log("owner", owner);
        console2.log("operator", operator);
        console2.log("rateX18", rateX18);
        console2.log("feeBps", feeBps);
    }
}
