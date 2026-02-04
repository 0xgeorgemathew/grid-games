// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract USDCFaucet is Ownable {
    IERC20 public constant usdc =
        IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e); // Base Sepolia USDC

    uint256 public constant CLAIM_AMOUNT = 10 * 1e6; // 10 USDC (6 decimals)

    event Claimed(address indexed user, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Claim 10 USDC from the faucet
    function claim() external {
        require(usdc.balanceOf(address(this)) >= CLAIM_AMOUNT, "Faucet empty");
        usdc.transfer(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    /// @notice Owner can withdraw USDC
    function withdraw(uint256 amount) external onlyOwner {
        usdc.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
