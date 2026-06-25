/**
 * hooks.ts — thin wrappers around the HookOS hook lifecycle (register / attach /
 * detach).
 *
 * ============================================================================
 *  UNVERIFIED — confirm param shape against @hookos/sdk before mainnet.
 * ============================================================================
 *
 * Per CLAUDE.md §6 and docs/go-to-production.md §4, the EXACT method signatures
 * and parameter shapes for `hookos.hooks.register / attach / detach` are NOT
 * verified against a public, pinned release of `@hookos/sdk`. We know from the
 * docs that hooks are "registered then attached", up to 8 composable hooks per
 * token, ~500k gas default each — but the field names below are our best-effort
 * model, NOT confirmed truth.
 *
 * Therefore this module:
 *   - Defines explicit, typed interfaces for the params we *intend* to send.
 *   - Casts at the SDK boundary (one narrow, clearly-marked `as` cast) so the
 *     code compiles and runs without pretending the shape is verified.
 *   - Is deliberately NOT called from the token-create happy path in launch.ts.
 *     The token-create flow (tokens.create) is the verified, solid path.
 *
 * Before enabling these against Base mainnet you MUST:
 *   1. Pin an exact @hookos/sdk version and read its TypeScript types.
 *   2. Replace the interfaces below with the SDK's real param/return types.
 *   3. Remove the boundary cast and the UNVERIFIED warning.
 *   4. Confirm the HookOS↔Uniswap-v4 permission-flag mapping (address-bit /
 *      CREATE2 mining) — do not assume HookOS's flags are 1:1 with
 *      Hooks.Permissions.
 */

import type { HookOS } from "@hookos/sdk";
import type { Address } from "viem";

/**
 * Our intended shape for registering a hook implementation with HookOS.
 *
 * UNVERIFIED: field names/types are provisional. `address` is the deployed hook
 * contract; `permissions` models the v4 callback flags HookOS expects.
 */
export interface RegisterHookParams {
  /** Deployed hook contract address (e.g. HookWarsHook). */
  readonly address: Address;
  /** Human label for logs/registry; may be ignored by the SDK. */
  readonly name?: string;
  /**
   * Uniswap v4 callback permissions this hook implements. These mirror the
   * mandated callbacks in CLAUDE.md §5. HookOS may encode them differently
   * (address-bit flags) — confirm the mapping before relying on this.
   */
  readonly permissions?: {
    readonly beforeSwap?: boolean;
    readonly afterSwap?: boolean;
    readonly beforeAddLiquidity?: boolean;
    readonly afterAddLiquidity?: boolean;
  };
}

/** Our intended shape for attaching a registered hook to a launched token. */
export interface AttachHookParams {
  /** The token the hook should govern (from tokens.create result). */
  readonly tokenAddress: Address;
  /** The (already-registered) hook contract address. */
  readonly hookAddress: Address;
}

/** Our intended shape for detaching a hook from a token. */
export interface DetachHookParams {
  readonly tokenAddress: Address;
  readonly hookAddress: Address;
}

/**
 * The slice of the SDK surface we touch here. We model it locally so a change
 * in the (unverified) SDK types is caught at this single boundary rather than
 * leaking casts across the codebase.
 *
 * UNVERIFIED: return types are modelled as opaque `unknown`-bearing results.
 */
interface HookManagerLike {
  register(params: RegisterHookParams): Promise<{ txResult: unknown }>;
  attach(params: AttachHookParams): Promise<{ txResult: unknown }>;
  detach(params: DetachHookParams): Promise<{ txResult: unknown }>;
}

/**
 * Narrow, single-point boundary cast. This is the ONLY place we assert the
 * unverified hook surface. Everything else uses our typed interfaces.
 */
function hookManager(hookos: HookOS): HookManagerLike {
  // UNVERIFIED — confirm `hookos.hooks` shape against @hookos/sdk before mainnet.
  return (hookos as unknown as { hooks: HookManagerLike }).hooks;
}

/**
 * Register a hook implementation with HookOS so it can later be attached.
 *
 * UNVERIFIED — confirm param shape against @hookos/sdk before mainnet.
 */
export async function registerHook(
  hookos: HookOS,
  params: RegisterHookParams,
): Promise<{ txResult: unknown }> {
  return hookManager(hookos).register(params);
}

/**
 * Attach a previously-registered hook to a launched token.
 *
 * UNVERIFIED — confirm param shape against @hookos/sdk before mainnet.
 */
export async function attachHook(
  hookos: HookOS,
  params: AttachHookParams,
): Promise<{ txResult: unknown }> {
  return hookManager(hookos).attach(params);
}

/**
 * Detach a hook from a token (reverse of attach).
 *
 * UNVERIFIED — confirm param shape against @hookos/sdk before mainnet.
 */
export async function detachHook(
  hookos: HookOS,
  params: DetachHookParams,
): Promise<{ txResult: unknown }> {
  return hookManager(hookos).detach(params);
}
