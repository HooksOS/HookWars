# `audit/` — Audit Sign-off Manifest

> Enforces **CLAUDE.md §1** ("Never deploy unaudited contracts", "Never approve deployment until
> audits pass") and **§2** (the structural Deploy Gate). This directory is the source of truth the
> `audit-signoff` CI gate checks before any contract can ship.

## What this is

`audit/signoff.json` is a machine-readable manifest recording the audit status of every smart
contract under `contracts/src`. The release pipeline runs
[`tools/ci/verify-audit-signoff.mjs`](../tools/ci/verify-audit-signoff.mjs), which:

1. Computes the set of **changed** contracts under `contracts/src/**/*.sol` (via `git diff` against
   the PR/merge base; CLI args or `$CHANGED_CONTRACTS` override it; a full scan is the fallback).
2. Requires that **every changed contract** has an entry in this manifest with:
   - `status` exactly `"passed"`,
   - a non-empty `auditor`,
   - a non-empty `report`.
3. Exits non-zero (blocking the gate, hence the whole release) if any changed contract is missing,
   not `passed`, or missing `auditor`/`report`.

**Deploy is blocked unless every changed contract is listed and `passed`.** There is no override,
no `--no-verify`, no skip.

## Schema

```jsonc
{
  "version": 1,                       // manifest format version (integer)
  "contracts": {                      // REQUIRED object, keyed by repo-relative POSIX path
    "contracts/src/<Name>.sol": {
      "status":     "passed",          // REQUIRED. Only "passed" satisfies the gate.
                                       //   Other values (e.g. "pending", "failed", "in-progress")
                                       //   block deploy.
      "auditor":    "Trail of Bits",   // REQUIRED, non-empty. Firm/individual that signed off.
      "report":     "docs/security/audits/<file>.pdf", // REQUIRED, non-empty. Path/URL to the report.
      "reportHash": "sha256:<hex>",    // OPTIONAL but recommended. Integrity hash of the report.
      "commit":     "<git sha>",       // OPTIONAL. Commit the audit covered.
      "date":       "YYYY-MM-DD",      // OPTIONAL. Sign-off date.
      "scope":      ["beforeSwap"],    // OPTIONAL. What was reviewed.
      "findings":   { "high": 0, "medium": 0, "low": 0, "informational": 0 }, // OPTIONAL.
      "notes":      "free text"        // OPTIONAL.
    }
  }
}
```

### Rules

- **Keys are repo-relative POSIX paths** (forward slashes), e.g. `contracts/src/HookWarsHook.sol`.
  The verifier normalises both manifest keys and changed-file paths, so case/OS separators don't
  matter, but keep keys POSIX for readability.
- A contract counts as **changed** if it is Added/Copied/Modified/Renamed between the base ref and
  `HEAD`. Renames require an entry under the **new** path.
- Only `status: "passed"` clears the gate. Any new or modified contract therefore needs a fresh
  audit sign-off (or re-confirmation) recorded here **in the same PR**.
- The `report` should point at the actual audit artifact committed under `docs/security/audits/`
  (or an immutable URL). Use `reportHash` to bind the manifest to the exact report bytes.

## How to add a sign-off

1. Complete the audit; commit the report under `docs/security/audits/`.
2. Add or update the contract's entry in `audit/signoff.json` with `status: "passed"`, the
   `auditor`, and the `report` path (plus `reportHash`/`commit`/`date`).
3. Push. The `audit-signoff` gate (and the matching PR check in `ci.yml`) will verify it.

## Local check

```bash
# Verify against the default base (origin/main):
node tools/ci/verify-audit-signoff.mjs

# Verify specific contracts explicitly:
node tools/ci/verify-audit-signoff.mjs contracts/src/HookWarsHook.sol

# Verify against an explicit base ref:
BASE_REF=origin/main node tools/ci/verify-audit-signoff.mjs
```

Exit codes: `0` = gate satisfied · `1` = a changed contract lacks a passed sign-off ·
`2` = configuration error (missing/invalid manifest).
