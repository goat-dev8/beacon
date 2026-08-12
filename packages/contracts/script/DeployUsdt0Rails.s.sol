// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {X402Facilitator} from "../src/X402Facilitator.sol";
import {BeaconEscrow} from "../src/BeaconEscrow.sol";
import {BeaconSafeFactory} from "../src/BeaconSafeFactory.sol";
import {BeaconCoston2SwapDesk} from "../src/BeaconCoston2SwapDesk.sol";

/// @notice Deploy live Coston2 rails against official faucet USDT0.
/// @dev Token MUST be 0xC1A5B41512496B80903D1f32d6dEa3a73212E71F (do not invent).
contract DeployUsdt0Rails is Script {
    address internal constant OFFICIAL_COSTON2_USDT0 = 0xC1A5B41512496B80903D1f32d6dEa3a73212E71F;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYMENT_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address token = vm.envAddress("X402_TOKEN_ADDRESS");
        require(token == OFFICIAL_COSTON2_USDT0, "X402_TOKEN_ADDRESS must be official Coston2 faucet USDT0");

        address payee = vm.envAddress("X402_PAYEE_ADDRESS");
        address owner = vm.envOr("INITIAL_OWNER", deployer);
        address executor = vm.envOr("VAULT_EXECUTOR", vm.envOr("SETTLER_ADDRESS", deployer));
        address tokenOut = vm.envAddress("EXPECTED_FXRP_TOKEN");

        uint256 perTx = vm.envOr("SAFE_DEFAULT_MAX_SPEND", uint256(10_000_000));
        uint256 window = vm.envOr("SAFE_DEFAULT_WINDOW_BUDGET", uint256(50_000_000));
        uint256 secs = vm.envOr("SAFE_DEFAULT_WINDOW_SECONDS", uint256(7 days));
        uint256 rateX18 = vm.envOr("SWAP_DESK_RATE_X18", uint256(5e17));
        uint256 feeBps = vm.envOr("SWAP_DESK_FEE_BPS", uint256(30));

        vm.startBroadcast(deployerKey);
        X402Facilitator facilitator = new X402Facilitator();
        BeaconEscrow escrow = new BeaconEscrow(token, payee, owner);
        BeaconSafeFactory factory = new BeaconSafeFactory(token, executor, perTx, window, secs);
        BeaconCoston2SwapDesk desk = new BeaconCoston2SwapDesk(
            token,
            tokenOut,
            owner,
            executor,
            rateX18,
            feeBps
        );
        vm.stopBroadcast();

        console2.log("X402Facilitator", address(facilitator));
        console2.log("BeaconEscrow", address(escrow));
        console2.log("BeaconSafeFactory", address(factory));
        console2.log("BeaconCoston2SwapDesk", address(desk));
        console2.log("token", token);
        console2.log("tokenOut", tokenOut);
        console2.log("payee", payee);
        console2.log("owner", owner);
        console2.log("executor", executor);
    }
}
