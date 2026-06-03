// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ManagerPortfolio.sol";

contract Deploy is Script {
    // Arbitrum Mainnet USDC
    address constant USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        vm.startBroadcast(deployerKey);
        ManagerPortfolio portfolio = new ManagerPortfolio(USDC, agent);
        vm.stopBroadcast();

        console.log("ManagerPortfolio deployed:", address(portfolio));
        console.log("USDC:", USDC);
        console.log("Agent:", agent);
    }
}
