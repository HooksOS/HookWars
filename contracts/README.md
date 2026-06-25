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
| `test/HookWarsHook.t.sol` | forge-std unit tests for the fee math, the anti-bot predicate, and Treasury custody. |
| `foundry.toml` · `remappings.txt` | solc 0.8.26, Cancun, optimizer + IR, `[profile.ci]`, fuzz/invariant defaults, `base` RPC endpoint. |
| `slither.config.json` | Static-analysis config for the deploy gate (fails on high/medium). |
| `.env.example` | `BASE_RPC`, `DEPLOYER_KEY`, etc. — copy to `.env`. |

---

## Prerequisites

- **Foundry** (`forge`, `cast`, `anvil`): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Slither**: `pip install slither-analyzer` (needs Python 3.8+ and a matching `solc`)

---

## 1. Install dependencies

Dependencies are vendored as git submodules under `lib/` via `forge install`. From `contracts/`:

```bash
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
forge install vectorized/solady
forge install Uniswap/v4-core
forge install Uniswap/v4-periphery
forge install Uniswap/permit2
```

`remappings.txt` already maps these to the import paths used by the source
(`v4-periphery/…`, `v4-core/…`, `@openzeppelin/contracts/…`, `solady/…`, `forge-std/…`).

Pin exact versions/commits before audit so the build is reproducible (the deploy gate depends on it).

---

## 2. Build & unit test

```bash
forge build
forge test -vvv
```

The default unit tests (`test/HookWarsHook.t.sol`) cover the fee-routing arithmetic, the per-block
anti-bot predicate, and real Treasury ETH custody. They do **not** require a forked network.

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
