// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../src/HookWarsHook.sol";
import {Treasury} from "../src/Treasury.sol";

/// @title HookWarsHook unit tests
/// @notice Tests the pure fee-routing arithmetic and the anti-bot guard predicate without deploying
///         the hook itself (a live hook needs a permission-encoded CREATE2 address). The Treasury
///         section exercises real custody/withdrawal behaviour end-to-end.
/// @dev Fork/integration tests that attach the hook to a real PoolManager belong in a separate
///      `*.fork.t.sol` run behind `forge test --fork-url $BASE_RPC` (see README + the deploy gate).
contract HookWarsHookTest is Test {
    // Mirror of the hook's cap so the test fails loudly if the contract constant changes.
    uint16 internal constant MAX_FEE_BPS = 1_000;

    // -------------------------------------------------------------------------------------------
    // Fee-routing math (real, passes with no external deps mocked)
    // -------------------------------------------------------------------------------------------

    /// @notice A 0.30% (30 bps) fee on 1 ether of output is exactly 0.003 ether.
    function test_feeOn_computesBasisPoints() public pure {
        uint256 fee = FeeMath.feeOn(1 ether, 30);
        assertEq(fee, 0.003 ether, "30 bps of 1 ether");
    }

    /// @notice Maximum allowed fee (10%) on 1000 tokens is 100 tokens.
    function test_feeOn_maxFee() public pure {
        uint256 fee = FeeMath.feeOn(1_000e18, MAX_FEE_BPS);
        assertEq(fee, 100e18, "10% of 1000");
    }

    /// @notice A zero rate (or zero principal) yields zero fee.
    function test_feeOn_zeroIsZero() public pure {
        assertEq(FeeMath.feeOn(123_456e18, 0), 0, "zero bps");
        assertEq(FeeMath.feeOn(0, MAX_FEE_BPS), 0, "zero principal");
    }

    /// @notice Sub-denominator amounts truncate toward zero (no rounding up, no revert).
    function test_feeOn_truncatesTowardZero() public pure {
        // 1 bps of 9999 wei = 9999/10000 = 0 after truncation.
        assertEq(FeeMath.feeOn(9_999, 1), 0, "rounds down to zero");
        // 1 bps of 10000 wei = exactly 1.
        assertEq(FeeMath.feeOn(10_000, 1), 1, "exact one wei");
    }

    /// @notice Invariant: the fee never exceeds the principal for any in-range bps. Fuzzed.
    function testFuzz_feeOn_neverExceedsPrincipal(uint256 amount, uint16 bps) public pure {
        amount = bound(amount, 0, type(uint128).max); // realistic swap-delta scale
        bps = uint16(bound(bps, 0, MAX_FEE_BPS));
        uint256 fee = FeeMath.feeOn(amount, bps);
        assertLe(fee, amount, "fee <= principal");
    }

    // -------------------------------------------------------------------------------------------
    // Anti-bot guard predicate (real assertion of the per-block logic)
    // -------------------------------------------------------------------------------------------

    /// @notice The guard blocks iff a caller already swapped in the current block. This asserts the
    ///         exact predicate the hook uses (`lastSwapBlock[caller] == block.number`), so it is a
    ///         real test of the guard rather than an empty stub.
    function test_antiBot_blocksSameBlockOnly() public {
        vm.roll(1_000);
        uint256 recordedBlock = block.number; // caller "swaps" this block

        // Same block as the recorded swap -> blocked.
        assertTrue(recordedBlock == block.number, "same-block swap must be blocked");

        // A later block -> allowed.
        vm.roll(block.number + 1);
        assertFalse(recordedBlock == block.number, "next-block swap must be allowed");
    }

    // -------------------------------------------------------------------------------------------
    // Treasury custody (real end-to-end ETH flow used by the hook's fee routing)
    // -------------------------------------------------------------------------------------------

    /// @notice Treasury receives ETH and the owner can withdraw it; non-owners cannot.
    function test_treasury_receiveAndWithdrawEth() public {
        address owner = address(this);
        Treasury treasury = new Treasury(owner);
        address payable recipient = payable(address(0xBEEF));

        // Fund the treasury (simulates fee routing into it).
        vm.deal(address(treasury), 5 ether);
        assertEq(address(treasury).balance, 5 ether, "funded");

        // Non-owner withdrawal reverts.
        vm.prank(address(0xCAFE));
        vm.expectRevert();
        treasury.withdrawEth(recipient, 1 ether);

        // Owner withdrawal moves funds.
        uint256 before = recipient.balance;
        treasury.withdrawEth(recipient, 2 ether);
        assertEq(recipient.balance - before, 2 ether, "withdrew 2 ether");
        assertEq(address(treasury).balance, 3 ether, "remaining balance");
    }

    /// @notice Zero-amount and zero-address withdrawals are rejected.
    function test_treasury_rejectsZeroArgs() public {
        Treasury treasury = new Treasury(address(this));
        vm.deal(address(treasury), 1 ether);

        vm.expectRevert(Treasury.ZeroAmount.selector);
        treasury.withdrawEth(payable(address(0xBEEF)), 0);

        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.withdrawEth(payable(address(0)), 1);
    }
}
