// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/USDCFaucet.sol";

contract DeployFaucet is Script {
    USDCFaucet public faucet;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy the faucet
        faucet = new USDCFaucet();

        vm.stopBroadcast();

        console.log("USDCFaucet deployed to:");
        console.log(address(faucet));

        // After deployment, verify with:
        // forge verify-contract <ADDRESS> src/USDCFaucet.sol:USDCFaucet --chain-id 84532
    }
}
