# @hookwars/hookos-launch

Launches the **$BULLET** token on **Base** (chain id 8453) via **HookOS** (`@hookos/sdk`).

This is the SDK-driven launch path: `hookos.tokens.create(...)` **deploys the ERC-20 itself**.
It is real, runnable code — it only transacts when the environment is configured and `DRY_RUN=false`.

---

## What it does

1. Loads + validates environment (`src/config.ts`) — fails fast with clear errors if anything is missing.
2. Builds a `viem` wallet client (account from `DEPLOYER_PRIVATE_KEY`, `http` transport from `BASE_RPC_URL`,
   chain from `viem/chains`).
3. Instantiates `new HookOS({ walletClient })`.
4. Prints the launch plan.
5. **Dry run (default):** prints exactly what it *would* send and exits without transacting.
   **Live:** calls `hookos.tokens.create({ name: "Bullet", symbol: "BULLET", initialSupply, metadataURI })`
   and logs the returned `tokenAddress` / `txResult`.

`initialSupply` is `parseEther("1000000000")` — 1,000,000,000 BULLET at 18 decimals.

---

## Usage

```bash
# from the repo root (pnpm workspaces)
pnpm install

cd services/hookos-launch
cp .env.example .env        # then edit .env with real values

# Simulate (no transaction). DRY_RUN defaults to true.
pnpm launch

# Type-check / build
pnpm typecheck
pnpm build
```

### Going live

```bash
# Base Sepolia testnet (chain id 84532) — live spend on testnet:
CHAIN_ID=84532 DRY_RUN=false pnpm launch

# Base MAINNET (8453) — requires BOTH switches:
DRY_RUN=false CONFIRM_MAINNET_LAUNCH=I_UNDERSTAND_THIS_SPENDS_REAL_FUNDS pnpm launch
```

---

## Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BASE_RPC_URL` | yes | — | JSON-RPC endpoint for the target chain |
| `DEPLOYER_PRIVATE_KEY` | yes | — | 0x-prefixed 32-byte hex key; pays gas + launch fee, owns the token |
| `TOKEN_METADATA_URI` | yes | — | `ipfs://` or `https://` metadata URI for $BULLET |
| `DRY_RUN` | no | `true` | When true, print-only — never transacts |
| `CONFIRM_MAINNET_LAUNCH` | mainnet+live only | — | Must equal `I_UNDERSTAND_THIS_SPENDS_REAL_FUNDS` to arm a real mainnet launch |
| `CHAIN_ID` | no | `8453` | `8453` Base mainnet / `84532` Base Sepolia |

`DEPLOYER_PRIVATE_KEY` must be a real secret — never commit `.env`; use a secrets manager in CI/prod.

---

## Dry-run safety

- `DRY_RUN` defaults to **true**. Typos / unrecognized falsey values fall back to the safe side, and the
  flag must be *deliberately* set to `false` to spend.
- A live **Base-mainnet** launch needs a **second** switch (`CONFIRM_MAINNET_LAUNCH`) set to the exact phrase,
  so a real mainnet spend can never happen by accident.
- All errors are caught at the top level; the process exits non-zero on failure.

---

## Unverified hooks caveat

`src/hooks.ts` wraps the HookOS hook lifecycle (`register` / `attach` / `detach`). Per `CLAUDE.md §6` and
`docs/go-to-production.md §4`, the **exact SDK parameter shapes for hooks are UNVERIFIED**. Those wrappers:

- expose explicit, typed interfaces for what we *intend* to send,
- isolate the unverified SDK surface behind a single, clearly-marked boundary cast,
- are **not** on the token-create happy path.

The token-create flow (`tokens.create`) is the solid, verified path. Before enabling the hook calls against
mainnet you must pin an exact `@hookos/sdk` version, replace the provisional interfaces with the SDK's real
types, and confirm the HookOS ↔ Uniswap v4 permission-flag (address-bit / CREATE2) mapping.

---

## $BULLET bytecode & the audit gate

HookOS **deploys its own ERC-20** when you call `tokens.create`. That means **$BULLET's bytecode is
HookOS-provided and lives OUTSIDE the Foundry/Slither deploy gate** described in `CLAUDE.md §2`. This is an
accepted, documented provenance fact for the SDK launch path (`docs/go-to-production.md §4`, item 3) — it is
*not* the audited `BulletToken.sol` flowing through the gate. Track this distinction when reasoning about the
security posture of the launched token.

---

License: MIT
