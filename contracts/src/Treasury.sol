// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HookWars Treasury
/// @author HookWars
/// @notice Minimal, owner-controlled vault that receives protocol fees (ETH and ERC-20) routed by
///         {HookWarsHook} and lets the owner withdraw them. This is intentionally a thin custody
///         contract: it holds value and exposes guarded withdrawals only.
/// @dev Ownership is expected to be a governance/timelock/multisig in production (CLAUDE.md §6).
///      All external withdrawals are `nonReentrant` and use the checks-effects-interactions pattern.
contract Treasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emitted when native ETH is received by the treasury.
    /// @param from   Address that sent the ETH.
    /// @param amount Amount of ETH received, in wei.
    event EthReceived(address indexed from, uint256 amount);

    /// @notice Emitted when native ETH is withdrawn from the treasury.
    /// @param to     Recipient of the ETH.
    /// @param amount Amount of ETH withdrawn, in wei.
    event EthWithdrawn(address indexed to, uint256 amount);

    /// @notice Emitted when an ERC-20 balance is withdrawn from the treasury.
    /// @param token  ERC-20 token withdrawn.
    /// @param to     Recipient of the tokens.
    /// @param amount Token amount withdrawn.
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);

    /// @notice Thrown when a zero address is supplied where a real recipient/owner is required.
    error ZeroAddress();
    /// @notice Thrown when a withdrawal amount is zero.
    error ZeroAmount();
    /// @notice Thrown when a native ETH transfer fails (e.g. recipient reverts).
    error EthTransferFailed();

    /// @param initialOwner Address that controls withdrawals (use a timelock/multisig in production).
    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
    }

    /// @notice Accept plain ETH transfers (e.g. fee routing, buybacks) and log them.
    receive() external payable {
        emit EthReceived(msg.sender, msg.value);
    }

    /// @notice Withdraw native ETH held by the treasury.
    /// @param to     Recipient of the ETH.
    /// @param amount Amount of ETH to withdraw, in wei.
    function withdrawEth(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        emit EthWithdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Withdraw the full ETH balance to `to`.
    /// @param to Recipient of the ETH.
    function withdrawAllEth(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert ZeroAmount();

        emit EthWithdrawn(to, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    /// @notice Withdraw an ERC-20 balance held by the treasury.
    /// @param token  ERC-20 token to withdraw.
    /// @param to     Recipient of the tokens.
    /// @param amount Token amount to withdraw.
    function withdrawToken(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        emit TokenWithdrawn(address(token), to, amount);
        token.safeTransfer(to, amount);
    }

    /// @notice Withdraw the treasury's full balance of a given ERC-20.
    /// @param token ERC-20 token to sweep.
    /// @param to    Recipient of the tokens.
    function withdrawAllToken(IERC20 token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert ZeroAmount();

        emit TokenWithdrawn(address(token), to, amount);
        token.safeTransfer(to, amount);
    }
}
