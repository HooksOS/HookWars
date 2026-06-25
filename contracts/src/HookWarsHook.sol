// SPDX-License-Identifier: GPL-2.0-or-later
// NOTE: GPL-2.0-or-later because this contract inherits Uniswap v4-periphery `BaseHook` (GPL-2.0).
// See docs/go-to-production.md §4 for the v4 licensing obligations.
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/utils/BaseHook.sol";

import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FeeMath
/// @notice Pure fee arithmetic shared by {HookWarsHook} and exercised directly by unit tests.
/// @dev Kept in a library of `internal` functions so the math is verifiable without deploying the
///      hook (a real hook deployment requires a permission-encoded CREATE2 address).
library FeeMath {
    /// @notice Basis-point denominator (100% = 10_000 bps).
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Compute `amount * feeBps / 10_000`, truncated toward zero.
    /// @param amount Principal amount the fee is charged on.
    /// @param feeBps Fee in basis points (1 bps = 0.01%).
    /// @return fee   The fee owed. Always `<= amount` for `feeBps <= 10_000`.
    function feeOn(uint256 amount, uint256 feeBps) internal pure returns (uint256 fee) {
        // amount and feeBps are bounded by their callers (uint128-scale swap deltas, feeBps <= 1000),
        // so `amount * feeBps` cannot overflow uint256.
        fee = (amount * feeBps) / BPS_DENOMINATOR;
    }
}

/// @title HookWarsHook
/// @author HookWars
/// @notice Uniswap v4 hook for the HookWars economy on Base. It does two real things on every swap:
///         1. `beforeSwap` enforces an optional anti-bot guard limiting a caller to one swap per block.
///         2. `afterSwap` skims a configurable fee (in bps) on exact-input swaps and routes it to the
///            protocol {Treasury}, funding tournaments / buybacks / reward pools.
/// @dev Inherits v4-periphery `BaseHook`; the constructor wires the {IPoolManager} and `BaseHook`
///      validates that this contract's address encodes the permission flags returned by
///      {getHookPermissions}. In v4, permission bits live in the hook's address, so production
///      deployment must mine a CREATE2 salt (e.g. `HookMiner`) for an address with the
///      BEFORE_SWAP + AFTER_SWAP + AFTER_SWAP_RETURNS_DELTA flags set.
///
///      ⚠️ HookOS wiring is UNVERIFIED (CLAUDE.md §6 / go-to-production.md §4): whether HookOS mines
///      and deploys this hook for you, or expects a pre-deployed permission-correct address, must be
///      confirmed against the live HookManager ABI before integration. Do not assume the mapping.
contract HookWarsHook is BaseHook, Ownable {
    /// @notice Hard upper bound on the protocol fee: 10% (1_000 bps). The owner can never exceed this.
    uint16 public constant MAX_FEE_BPS = 1_000;

    /// @notice Destination for routed protocol fees (the HookWars {Treasury}).
    address public treasury;

    /// @notice Protocol fee charged on the output of exact-input swaps, in basis points.
    uint16 public feeBps;

    /// @notice When true, `beforeSwap` rejects a caller's second swap within the same block.
    bool public antiBotEnabled;

    /// @notice Last block number in which a given caller swapped (used by the anti-bot guard).
    mapping(address caller => uint256 blockNumber) public lastSwapBlock;

    /// @notice Emitted when a fee is skimmed and routed to the treasury.
    /// @param currency Address of the currency taken (address(0) for native ETH).
    /// @param treasury Treasury that received the fee.
    /// @param amount   Fee amount taken from the pool and credited to the treasury.
    event FeeRouted(address indexed currency, address indexed treasury, uint256 amount);

    /// @notice Emitted when the fee rate changes.
    event FeeBpsUpdated(uint16 oldFeeBps, uint16 newFeeBps);

    /// @notice Emitted when the treasury address changes.
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @notice Emitted when the anti-bot guard is toggled.
    event AntiBotToggled(bool enabled);

    /// @notice Thrown when a zero address is supplied for the treasury/owner.
    error ZeroAddress();
    /// @notice Thrown when a fee above {MAX_FEE_BPS} is requested.
    error FeeTooHigh(uint16 requested, uint16 maxAllowed);
    /// @notice Thrown by the anti-bot guard when a caller tries to swap twice in one block.
    error OneSwapPerBlock(address caller);

    /// @param poolManager_  The Uniswap v4 PoolManager this hook is attached to.
    /// @param treasury_     Destination for routed fees (the HookWars {Treasury}).
    /// @param feeBps_       Initial fee in basis points (must be `<= MAX_FEE_BPS`).
    /// @param initialOwner_ Admin able to update fee/treasury/anti-bot (use a timelock/multisig).
    constructor(IPoolManager poolManager_, address treasury_, uint16 feeBps_, address initialOwner_)
        BaseHook(poolManager_)
        Ownable(initialOwner_)
    {
        if (treasury_ == address(0) || initialOwner_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_, MAX_FEE_BPS);

        treasury = treasury_;
        feeBps = feeBps_;
        antiBotEnabled = true;

        emit TreasuryUpdated(address(0), treasury_);
        emit FeeBpsUpdated(0, feeBps_);
        emit AntiBotToggled(true);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice Update the protocol fee. Capped at {MAX_FEE_BPS}.
    /// @param newFeeBps New fee in basis points.
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Update the treasury that receives routed fees.
    /// @param newTreasury New treasury address.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Enable or disable the per-block anti-bot guard.
    /// @param enabled New guard state.
    function setAntiBotEnabled(bool enabled) external onlyOwner {
        antiBotEnabled = enabled;
        emit AntiBotToggled(enabled);
    }

    // ---------------------------------------------------------------------------------------------
    // Hook permissions
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc BaseHook
    /// @dev Enables `beforeSwap` (anti-bot) and `afterSwap` (fee routing). `afterSwapReturnDelta` is
    ///      required because the fee is taken from the pool via `poolManager.take`, which must be
    ///      reflected in the returned hook delta so the swap settles correctly.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ---------------------------------------------------------------------------------------------
    // Hook callbacks (called by BaseHook's external entrypoints, guarded by onlyPoolManager)
    // ---------------------------------------------------------------------------------------------

    /// @notice Anti-bot guard: rejects a caller's second swap in the same block when enabled.
    /// @dev `sender` is the immediate caller of the PoolManager (typically a router). The guard is
    ///      therefore router/account-scoped; integrations that need per-end-user granularity should
    ///      pass the trader through `hookData` and extend this check. No price impact is applied, so a
    ///      zero `BeforeSwapDelta` and zero LP-fee override are returned.
    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (antiBotEnabled) {
            if (lastSwapBlock[sender] == block.number) revert OneSwapPerBlock(sender);
            lastSwapBlock[sender] = block.number;
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @notice Skims `feeBps` of the output of an exact-input swap and routes it to the treasury.
    /// @dev The fee is charged on the swap's *unspecified* currency. For an exact-input swap the
    ///      unspecified leg is the positive (output) amount; for exact-output swaps it is the negative
    ///      (input) leg, which we do not charge. The taken amount is returned as the hook's delta so
    ///      the PoolManager bills it to the swapper and the pool stays balanced.
    /// @param key    The pool being swapped.
    /// @param params The swap parameters (direction + amount).
    /// @param delta  The balance delta the swap produced for the swapper.
    /// @return selector The `afterSwap` selector required by `IHooks`.
    /// @return hookDelta The signed amount (in the unspecified currency) the hook took from the pool.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4 selector, int128 hookDelta)
    {
        selector = IHooks.afterSwap.selector;

        uint16 fee = feeBps;
        if (fee == 0) return (selector, int128(0));

        bool exactInput = params.amountSpecified < 0;

        // The unspecified currency is currency1 when (zeroForOne == exactInput), else currency0.
        (Currency feeCurrency, int128 unspecifiedAmount) = (params.zeroForOne == exactInput)
            ? (key.currency1, delta.amount1())
            : (key.currency0, delta.amount0());

        // Only charge when the unspecified leg is a positive output (i.e. exact-input swaps).
        if (unspecifiedAmount <= 0) return (selector, int128(0));

        uint256 outAmount = uint256(uint128(unspecifiedAmount));
        uint256 feeAmount = FeeMath.feeOn(outAmount, fee);
        if (feeAmount == 0) return (selector, int128(0));

        // Pull the fee out of the pool to the treasury and report it as the hook's delta so the
        // PoolManager charges the swapper for it (afterSwapReturnDelta is enabled).
        poolManager.take(feeCurrency, treasury, feeAmount);
        emit FeeRouted(Currency.unwrap(feeCurrency), treasury, feeAmount);

        // feeAmount <= outAmount <= type(uint128).max, so the cast is safe and positive.
        hookDelta = int128(int256(feeAmount));
    }
}
