// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath, HookWarsHook} from "../src/HookWarsHook.sol";
import {Treasury} from "../src/Treasury.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";

/// @title HookWarsHook unit tests
/// @notice Tests the pure fee-routing arithmetic (FeeMath), the real anti-bot guard against a
///         deployed hook (placed at a permission-encoded address with {deployCodeTo}), the hook's
///         declared permissions, and the Treasury custody/withdrawal flow end-to-end.
/// @dev Full `afterSwap` fee-skim-to-treasury via `poolManager.take` requires an initialized pool
///      with liquidity and a live PoolManager unlock context; that is covered by a separate
///      `*.fork.t.sol` run behind `forge test --fork-url $BASE_RPC` (see README + the deploy gate).
///      The FeeMath suite below pins the exact arithmetic that `_afterSwap` routes.
contract HookWarsHookTest is Test {
    // Mirror of the hook's cap so the test fails loudly if the contract constant changes.
    uint16 internal constant MAX_FEE_BPS = 1_000;

    /// @dev The permission bits HookWarsHook requires encoded into its address: beforeSwap (anti-bot),
    ///      afterSwap (fee routing), and afterSwapReturnDelta (the fee is taken via the hook delta).
    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

    /// @notice Deploy HookWarsHook at an address whose low bits encode {HOOK_FLAGS}, satisfying
    ///         BaseHook's constructor-time `validateHookAddress` check. The high bits are namespaced
    ///         well above the precompile/cheatcode range.
    function _deployHook(address poolManager, address treasury, uint16 feeBps, address owner)
        internal
        returns (HookWarsHook hook)
    {
        address hookAddr = address(uint160(uint160(0x4444) << 144) | HOOK_FLAGS);
        deployCodeTo(
            "HookWarsHook.sol:HookWarsHook",
            abi.encode(IPoolManager(poolManager), treasury, feeBps, owner),
            hookAddr
        );
        hook = HookWarsHook(hookAddr);
    }

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
    // Hook permissions + anti-bot guard (real, against the deployed hook)
    // -------------------------------------------------------------------------------------------

    /// @notice The hook must enable exactly beforeSwap + afterSwap + afterSwapReturnDelta and nothing
    ///         else, and must wire the PoolManager/treasury/owner it was constructed with. Deploying
    ///         it at all proves its address encodes those permissions (BaseHook validates this in the
    ///         constructor and reverts otherwise).
    function test_hookPermissions_enableSwapHooksOnly() public {
        address poolManager = makeAddr("poolManager");
        HookWarsHook hook = _deployHook(poolManager, address(0xBEEF), 30, address(this));

        assertEq(address(hook.poolManager()), poolManager, "poolManager wired");
        assertEq(hook.treasury(), address(0xBEEF), "treasury wired");
        assertEq(hook.feeBps(), 30, "feeBps wired");
        assertEq(hook.owner(), address(this), "owner wired");
        assertTrue(hook.antiBotEnabled(), "anti-bot on by default");

        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeSwap, "beforeSwap enabled");
        assertTrue(p.afterSwap, "afterSwap enabled");
        assertTrue(p.afterSwapReturnDelta, "afterSwapReturnDelta enabled");
        assertFalse(p.beforeSwapReturnDelta, "beforeSwapReturnDelta off");
        assertFalse(p.beforeAddLiquidity, "addLiquidity hooks off");
        assertFalse(p.afterAddLiquidity, "addLiquidity hooks off");
        assertFalse(p.beforeInitialize, "initialize hooks off");
    }

    /// @notice The anti-bot guard lets a caller swap once per block: the first `beforeSwap` in a block
    ///         succeeds and records the block, the second from the same sender reverts
    ///         `OneSwapPerBlock`, and a later block is allowed again. Driven through the real hook's
    ///         `onlyPoolManager` entrypoint.
    function test_antiBot_blocksSecondSwapInSameBlock() public {
        address poolManager = makeAddr("poolManager");
        HookWarsHook hook = _deployHook(poolManager, address(0xBEEF), 30, address(this));

        PoolKey memory key; // ignored by the guard
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        address trader = makeAddr("trader");

        vm.roll(1_000);

        // First swap of the block: succeeds, returns the IHooks selector, records the block.
        vm.prank(poolManager);
        (bytes4 sel,,) = hook.beforeSwap(trader, key, params, "");
        assertEq(sel, IHooks.beforeSwap.selector, "beforeSwap selector");
        assertEq(hook.lastSwapBlock(trader), block.number, "block recorded");

        // Second swap, same block, same sender: blocked.
        vm.prank(poolManager);
        vm.expectRevert(abi.encodeWithSelector(HookWarsHook.OneSwapPerBlock.selector, trader));
        hook.beforeSwap(trader, key, params, "");

        // Next block: allowed again.
        vm.roll(1_001);
        vm.prank(poolManager);
        (bytes4 sel2,,) = hook.beforeSwap(trader, key, params, "");
        assertEq(sel2, IHooks.beforeSwap.selector, "next-block swap allowed");
        assertEq(hook.lastSwapBlock(trader), 1_001, "new block recorded");
    }

    /// @notice Disabling the guard lets a caller swap repeatedly in one block and records nothing.
    function test_antiBot_disabledAllowsRepeatedSwaps() public {
        address poolManager = makeAddr("poolManager");
        HookWarsHook hook = _deployHook(poolManager, address(0xBEEF), 0, address(this));
        hook.setAntiBotEnabled(false);
        assertFalse(hook.antiBotEnabled(), "guard disabled");

        PoolKey memory key;
        SwapParams memory params = SwapParams({zeroForOne: false, amountSpecified: -1e18, sqrtPriceLimitX96: 0});
        address trader = makeAddr("trader");
        vm.roll(7);

        vm.prank(poolManager);
        hook.beforeSwap(trader, key, params, "");
        // Same block, same sender: no revert because the guard is off.
        vm.prank(poolManager);
        hook.beforeSwap(trader, key, params, "");

        assertEq(hook.lastSwapBlock(trader), 0, "disabled guard records nothing");
    }

    /// @notice Only the PoolManager may invoke the hook callbacks (BaseHook `onlyPoolManager`).
    function test_beforeSwap_revertsForNonPoolManager() public {
        address poolManager = makeAddr("poolManager");
        HookWarsHook hook = _deployHook(poolManager, address(0xBEEF), 30, address(this));

        PoolKey memory key;
        SwapParams memory params;
        // Caller is this test contract, not the PoolManager -> NotPoolManager().
        vm.expectRevert();
        hook.beforeSwap(makeAddr("trader"), key, params, "");
    }

    /// @notice Admin guards: fee cap is enforced and zero treasury is rejected.
    function test_admin_feeCapAndZeroTreasury() public {
        address poolManager = makeAddr("poolManager");
        HookWarsHook hook = _deployHook(poolManager, address(0xBEEF), 30, address(this));

        vm.expectRevert(abi.encodeWithSelector(HookWarsHook.FeeTooHigh.selector, MAX_FEE_BPS + 1, MAX_FEE_BPS));
        hook.setFeeBps(MAX_FEE_BPS + 1);

        hook.setFeeBps(MAX_FEE_BPS);
        assertEq(hook.feeBps(), MAX_FEE_BPS, "fee updated to cap");

        vm.expectRevert(HookWarsHook.ZeroAddress.selector);
        hook.setTreasury(address(0));
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
