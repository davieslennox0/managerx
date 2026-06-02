// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ManagerPortfolioV2.sol";

contract DeployManagerV2 is Script {
    // Arbitrum One — Circle CCTP contracts
    address constant USDC_ARB      = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant CCTP_ARB      = 0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca;

    // Arbitrum Sepolia — Circle CCTP testnet contracts
    address constant USDC_ARB_SEP  = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant CCTP_ARB_SEP  = 0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agentAddr   = vm.envOr("AGENT_ADDRESS", vm.addr(deployerKey));
        bool    isMainnet   = vm.envOr("MAINNET", false);

        address usdcAddr = isMainnet ? USDC_ARB     : USDC_ARB_SEP;
        address cctpAddr = isMainnet ? CCTP_ARB     : CCTP_ARB_SEP;

        vm.startBroadcast(deployerKey);

        ManagerPortfolioV2 portfolio = new ManagerPortfolioV2(agentAddr, usdcAddr, cctpAddr);

        console.log("ManagerPortfolioV2 deployed:", address(portfolio));
        console.log("Agent:", agentAddr);
        console.log("USDC:", usdcAddr);
        console.log("CCTP Transmitter:", cctpAddr);
        console.log("Network:", isMainnet ? "Arbitrum One" : "Arbitrum Sepolia");

        vm.stopBroadcast();
    }
}
