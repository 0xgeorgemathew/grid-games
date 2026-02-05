// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract USDCFaucet is Ownable {
    IERC20 public constant usdc =
        IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e); // Base Sepolia USDC

    uint256 public claimAmount = 10 * 1e6; // 10 USDC (6 decimals)

    event Claimed(address indexed user, uint256 amount);
    event ClaimAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Claim USDC from the faucet
    function claim() external {
        require(usdc.balanceOf(address(this)) >= claimAmount, "Faucet empty");
        usdc.transfer(msg.sender, claimAmount);
        emit Claimed(msg.sender, claimAmount);
    }

    /// @notice Owner can set the claim amount
    function setClaimAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Amount must be > 0");
        uint256 oldAmount = claimAmount;
        claimAmount = newAmount;
        emit ClaimAmountUpdated(oldAmount, newAmount);
    }

    /// @notice Owner can withdraw USDC
    function withdraw(uint256 amount) external onlyOwner {
        usdc.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
