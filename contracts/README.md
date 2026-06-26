# HookWars — Contracts (`contracts/`)

Foundry workspace for the HookWars on-chain economy on **Base (chain 8453)**: a Uniswap **v4 hook**
(`HookWarsHook`) plus a protocol `Treasury`. Built per the [Engineering Constitution](../CLAUDE.md) and
the [go-to-production plan](../docs/go-to-production.md). **No placeholders, no TODOs, no stubs that
revert as "not implemented"** — that is a hard rule here.

> ⚠️ **`$BULLET` is deployed by HookOS itself**, not by this workspace, so there is intentionally no
> `BulletToken.sol`. See *Unverified integration* below.

---

## Contents

| File | Purpose |
|---|---|
| `src/HookWarsHook.sol` | Uniswap v4 hook (v4-periphery `BaseHook`). `beforeSwap` anti-bot guard + `afterSwap` fee routing to the treasury. Includes the pure `FeeMath` library. |
| `src/Treasury.sol` | OpenZeppelin `Ownable` + `ReentrancyGuard` vault that receives and withdraws ETH / ERC-20. |
| `test/HookWarsHook.t.sol` | forge-std unit tests: the `FeeMath` arithmetic, the real anti-bot guard and hook-permissions of a hook deployed at a permission-encoded address (`deployCodeTo`), admin guards, and Treasury custody. |
| `foundry.toml` · `remappings.txt` | solc 0.8.26, Cancun, optimizer + IR, `[profile.ci]`, fuzz/invariant defaults, `base` RPC endpoint. |
| `slither.config.json` | Static-analysis config for the deploy gate (fails on high/medium). |
| `.env.example` | `BASE_RPC`, `DEPLOYER_KEY`, etc. — copy to `.env`. |

---

## Prerequisites

- **Foundry** (`forge`, `cast`, `anvil`): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Slither**: `pip install slither-analyzer` (needs Python 3.8+ and a matching `solc`)

---

## 1. Install dependencies

Dependencies are fetched at **pinned commits** by `install-deps.sh` (not vendored — `lib/` is gitignored).
This is deterministic: every environment and CI reproduces the exact commits that compile and pass tests.
From `contracts/`:

```bash
bash install-deps.sh   # pinned clones of forge-std, OZ, solady, permit2, and the matched v4 pair
```

### Pinned Uniswap v4 versions (matched pair — do not bump independently)

`v4-core` and `v4-periphery` **must** be a compatible pair, otherwise `BaseHook` and the core types
(`SwapParams`, `PoolKey`, `BeforeSwapDelta`, …) drift and the hook no longer compiles.

| Submodule | Pinned commit | Why this commit |
|---|---|---|
| `lib/v4-periphery` | `3779387e5d296f39df543d23524b050f89a62917` | Last commit that still ships `src/utils/BaseHook.sol` (it was removed one commit later in #510 "remove hooks and move to hook repo"). |
| `lib/v4-core` | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | The exact core commit that `v4-periphery@3779387` vendors (`lib/v4-periphery/lib/v4-core`); it has `src/types/PoolOperation.sol` (the `SwapParams`/`ModifyLiquidityParams` home in this layout). |

**Remapping note (`remappings.txt`):** both `v4-core/` and `@uniswap/v4-core/` are pointed at the
**single** vendored core inside periphery (`lib/v4-periphery/lib/v4-core/`). This is deliberate: our
hook imports `v4-core/…` and periphery's `BaseHook` imports `@uniswap/v4-core/…`, and they must resolve
to the **same physical source units** or Solidity treats `SwapParams`/`PoolKey` as distinct types and the
`_beforeSwap`/`_afterSwap` overrides fail to type-check.

```
v4-core/=lib/v4-periphery/lib/v4-core/src/
@uniswap/v4-core/=lib/v4-periphery/lib/v4-core/
v4-periphery/=lib/v4-periphery/src/
```

CI reproduces these via the pinned `install-deps.sh`, which fetches periphery's nested `lib/v4-core`
recursively, so `forge build` resolves the matched pair.

---

## 2. Build & unit test

```bash
forge build
forge test -vvv
```

The default unit tests (`test/HookWarsHook.t.sol`) cover the `FeeMath` fee-routing arithmetic, the real
per-block anti-bot guard and declared hook permissions (the hook is deployed at a permission-encoded
address with `deployCodeTo` and driven through its `onlyPoolManager` `beforeSwap` entrypoint), the admin
fee-cap/zero-address guards, and real Treasury ETH custody. They do **not** require a forked network.

The full `afterSwap` fee skim to the treasury via `poolManager.take` needs an initialized pool with
liquidity and a live PoolManager unlock context, so it lives in the fork suite (§3); the exact fee
arithmetic it routes is pinned by the `FeeMath` tests here.

Run with the CI profile (heavier optimization, 50k fuzz runs) the way the gate does:

```bash
FOUNDRY_PROFILE=ci forge test
```

---

## 3. Fork tests (Base)

Set `BASE_RPC` in `.env` (a keyed/private provider — not a public rate-limited endpoint), then:

```bash
cp .env.example .env            # then edit
source .env                     # or use direnv / `--env-file`
forge test --fork-url $BASE_RPC -vvv
```

Fork/integration tests that attach the hook to a live `PoolManager` (mining a permission-encoded
CREATE2 address via `HookMiner`) belong in a dedicated `*.fork.t.sol` file and run here. Forking is
required because a v4 hook only works at an address whose low bits encode its permission flags.

---

## 4. Static analysis (Slither)

```bash
slither . --config-file slither.config.json
```

Config excludes `lib/`, `test/`, `script/` and **fails the run on any unsuppressed high/medium finding**.

---

## 5. Deploy gate — read before deploying

Per **[CLAUDE.md §2](../CLAUDE.md)** and **[go-to-production.md §2](../docs/go-to-production.md)**,
deployment is **structurally blocked** unless **all** of these are green in CI:

1. **Slither** — clean (no unsuppressed high/medium).
2. **Fork tests** — `forge test --fork-url $BASE_RPC` all pass.
3. **Full unit/integration suite** — all pass.
4. **Audit sign-off** for any new/changed contract.

These are required status checks; there is **no `--no-verify`, no manual override**. If the gate is
red, the *entire* release is blocked, not just contracts. The Base deployer key lives only in the
protected `production` environment — never paste a funded mainnet key into a developer `.env`.

---

## Unverified integration (must confirm before wiring)

The exact **HookOS `HookManager` wiring is UNVERIFIED** and must be confirmed against the live
SDK/ABIs before any integration code is written (CLAUDE.md §6, go-to-production.md §4):

- Whether HookOS **mines and deploys** the permission-correct hook address for you, or expects a
  **pre-deployed** `HookWarsHook` — v4 encodes permission flags in the hook **address bits**.
- Whether HookOS's hook-flag enum maps 1:1 onto `Hooks.Permissions`. **Do not assume it does.**
- `$BULLET` provenance: HookOS deploys its **own** ERC-20 (bytecode outside this Slither/fork gate),
  which is why no `BulletToken.sol` exists here. If HookOS can instead adopt an audited token, prefer
  that; otherwise document that `$BULLET` bytecode is HookOS-provided and out of our audit gate.

## Licensing

- `Treasury.sol`: MIT.
- `HookWarsHook.sol`: **GPL-2.0-or-later** — it inherits v4-periphery `BaseHook` (GPL-2.0). `v4-core`
  is BUSL-1.1 (converts to MIT 2027-06-15). Confirm the BUSL commercial-use grant before mainnet. See
  go-to-production.md §4.
