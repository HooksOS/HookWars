# `tools/ci/` — Deploy Gate Enforcement

> Implements **CLAUDE.md §2** ("making it structurally impossible to deploy without Slither + fork
> tests passing — mandatory") and **§3** (atomic, in-sync release). If the gate is red, **nothing
> deploys** — and per §3 the *entire* release is blocked, not just contracts.

## Contents

| File | Purpose |
|---|---|
| `verify-audit-signoff.mjs` | The audit-sign-off gate. Fails CI unless every **changed** contract under `contracts/src` has a `"passed"` entry in [`audit/signoff.json`](../../audit/signoff.json). Real, dependency-free Node ESM. |
| `setup-branch-protection.sh` | One-time admin script (`gh api`) that makes the gate **binding**: configures branch protection on `main` requiring the status checks `slither`, `forge-fork`, `unit-int`, `audit-signoff`, `lint` (strict/up-to-date), with `enforce_admins=true` and required PR reviews. Idempotent. See "Required GitHub repo settings" below. |
| `README.md` | This file. |

Related workflows: [`.github/workflows/release.yml`](../../.github/workflows/release.yml) (deploy
pipeline) and [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (PR required checks).

## The four gate jobs

A contract deploy is allowed **only** when all four are green (CLAUDE.md §2):

1. **`slither`** — static analysis clean (no unsuppressed high/medium).
2. **`forge-fork`** — `forge test --fork-url $BASE_RPC` (Base) all green.
3. **`unit-int`** — full unit + integration suite (Foundry + pnpm/turbo) green.
4. **`audit-signoff`** — `node tools/ci/verify-audit-signoff.mjs` passes (every changed contract audited).

## Three independent enforcement layers

No single layer is trusted alone. To deploy a contract you must defeat **all three**, which is not
possible without an org admin deliberately dismantling the protections.

### Layer 1 — Branch protection (required status checks)
The four gate job names (plus `lint`) from `ci.yml` are configured as **required status checks** on
`main`. A PR cannot merge unless they pass. With "require branches up to date" + "do not allow
bypass", even admins cannot merge a red gate. This stops unaudited code from ever reaching `main`,
the only branch `release.yml` deploys from.

### Layer 2 — `needs:` DAG (in-pipeline data dependency)
In `release.yml`, `deploy-contracts` declares:

```yaml
needs: [slither, forge-fork, unit-int, audit-signoff, build-images]
```

GitHub Actions will **not schedule** a job until all of its `needs:` succeed. If any gate job fails
or is skipped, `deploy-contracts` (and `release-fleet`) never run. `build-images` likewise needs all
four gate jobs, so even the fleet images aren't built on a red gate (§3 all-or-nothing).
`deploy-contracts` also re-runs `verify-audit-signoff.mjs` at the door (defence in depth).

### Layer 3 — Protected `production` environment (secret custody)
`deploy-contracts` and `release-fleet` run with `environment: production`. The Base **deployer
private key** (`BASE_DEPLOYER_PRIVATE_KEY`) and the GitOps push token exist **only** as
environment-scoped secrets there, behind **required reviewers**. So even if someone rewired the
`needs:` DAG, the deploy step still cannot obtain a signing key without a human approval gate — and
the key lives nowhere else. This is the ultimate structural lock.

## Required GitHub repo settings (admin checklist)

An organization/repo admin MUST configure the following. Until these are set, the gate is only
*advisory*; these settings make it *binding*.

> **Automated path (recommended):** instead of clicking through the UI below, an admin can run
> [`setup-branch-protection.sh`](./setup-branch-protection.sh) once — it applies exactly the rule in
> §A via `gh api` (idempotent; re-runnable):
>
> ```bash
> # Authenticated as a repo admin (gh auth status). Auto-detects owner/repo:
> tools/ci/setup-branch-protection.sh
> # or target explicitly / require 2 approvals:
> REPO=HooksOS/HookWars REVIEWS=2 tools/ci/setup-branch-protection.sh
> ```
>
> It still does NOT create the protected `production` environment (§B) — GitHub requires that be set
> up separately; do it via the UI as described in §B.

### A. Branch protection rule on `main`
Settings → Branches → Add rule → Branch name pattern `main` (or run the script above):
- **Require a pull request before merging** ✓ (≥1 approval recommended)
- **Require status checks to pass before merging** ✓ → **Require branches to be up to date** ✓
- Add these **required status checks** (exact names — they must match the job `name:` values in
  `.github/workflows/ci.yml`):
  - `slither`
  - `forge-fork`
  - `unit-int`
  - `audit-signoff`
  - `lint`
- **Require conversation resolution before merging** ✓
- **Do not allow bypassing the above settings** ✓ (applies the rule to admins too)
- **Restrict who can push to matching branches** ✓ (no direct pushes; PR-only)
- Optionally enable the **merge queue** (`ci.yml` already handles `merge_group`).

### B. Protected `production` environment
Settings → Environments → New environment → `production`:
- **Required reviewers** ✓ (the people allowed to authorize a mainnet deploy)
- **Deployment branches**: restrict to `main` (and `v*` tags) only.
- Add **environment secrets** (NOT repo-wide — scope them here so only `production` jobs can read them):
  - `BASE_DEPLOYER_PRIVATE_KEY` — the Base deployer key (exists nowhere else).
  - `BASE_RPC_URL` — Base RPC endpoint (also needed repo-wide for fork tests; see C).
  - `BASESCAN_API_KEY` — for `forge ... --verify`.
  - `GITOPS_TOKEN` — push token for the `infra-gitops` repo (fleet bump).

### C. Repository secrets (available to gate jobs)
Settings → Secrets and variables → Actions:
- `BASE_RPC_URL` — required by the `forge-fork` gate (and convenient for `production`).

### D. Actions hardening (recommended)
- Settings → Actions → General → **Allow select actions** and require **actions pinned to a full
  commit SHA**. Then repin every `uses:` in both workflows from its `@vX` tag to a SHA (each line is
  already commented `# pin to SHA in prod`).
- Set workflow permissions to **read-only by default**; the workflows request the minimum extra
  scopes (`packages: write`, `id-token: write`) explicitly.

## Local usage of the audit verifier

```bash
node tools/ci/verify-audit-signoff.mjs                          # diff vs origin/main
node tools/ci/verify-audit-signoff.mjs contracts/src/HookWarsHook.sol  # explicit target
BASE_REF=origin/main node tools/ci/verify-audit-signoff.mjs     # explicit base ref
CHANGED_CONTRACTS="contracts/src/HookWarsHook.sol" node tools/ci/verify-audit-signoff.mjs
```

Exit codes: `0` ok · `1` a changed contract lacks a passed sign-off · `2` config error
(missing/invalid `audit/signoff.json`). See [`audit/README.md`](../../audit/README.md) for the
manifest schema.
