#!/usr/bin/env bash
# =============================================================================
# HookWars — One-time branch-protection setup for the Deploy Gate (CLAUDE.md §2)
# -----------------------------------------------------------------------------
# Run ONCE by a repo/org admin to make the four gate jobs (+ lint) BINDING as
# required status checks on `main`, so no PR can merge — and therefore nothing
# can ever reach the only branch release.yml deploys from — unless the gate is
# green. This is Layer 1 of the three enforcement layers (see README.md).
#
# It configures, on `main`:
#   • Required status checks (strict / up-to-date): slither, forge-fork,
#     unit-int, audit-signoff, lint  — names MUST match the job `name:` values
#     in .github/workflows/ci.yml.
#   • Required pull-request reviews (≥1 approval, dismiss stale, require last
#     pusher's review by code owners where configured).
#   • enforce_admins = true  (the rule applies to admins too — "do not allow
#     bypassing").
#   • Required conversation resolution + linear history + no force-push/delete.
#
# Idempotent: re-running converges to the same state (the GitHub API call is a
# full PUT replace of the protection object). Safe to run repeatedly.
#
# Requirements: GitHub CLI (`gh`) authenticated as an admin of the repo, with
# the `repo` scope. Verify with `gh auth status`.
#
# Usage:
#   tools/ci/setup-branch-protection.sh                 # auto-detects owner/repo
#   REPO=HooksOS/HookWars tools/ci/setup-branch-protection.sh
#   BRANCH=main REVIEWS=2 tools/ci/setup-branch-protection.sh
# =============================================================================
set -euo pipefail

# ----- Configuration (override via env) --------------------------------------
BRANCH="${BRANCH:-main}"
REVIEWS="${REVIEWS:-1}"   # required approving review count

# The required status checks — keep in lockstep with ci.yml job names.
CONTEXTS=(slither forge-fork unit-int audit-signoff lint)

# ----- Preconditions ---------------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is not installed. See https://cli.github.com/." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run 'gh auth login' as a repo admin." >&2
  exit 1
fi

# Resolve owner/repo: explicit $REPO wins, else ask gh about the current repo.
if [[ -n "${REPO:-}" ]]; then
  OWNER_REPO="${REPO}"
else
  if ! OWNER_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"; then
    echo "ERROR: could not detect the repository. Run inside the repo clone or set REPO=owner/name." >&2
    exit 1
  fi
fi

echo "==> Repository : ${OWNER_REPO}"
echo "==> Branch     : ${BRANCH}"
echo "==> Reviews    : ${REVIEWS} approving review(s) required"
echo "==> Checks     : ${CONTEXTS[*]}"
echo

# ----- Build the protection payload (GitHub Branch Protection API) -----------
# Build the required_status_checks.checks array from CONTEXTS.
checks_json="$(printf '%s\n' "${CONTEXTS[@]}" \
  | jq -R '{context: ., app_id: null}' \
  | jq -s '.')"

payload="$(jq -n \
  --argjson checks "${checks_json}" \
  --argjson reviews "${REVIEWS}" '
  {
    required_status_checks: {
      strict: true,                # "require branches to be up to date before merging"
      checks: $checks
    },
    enforce_admins: true,          # the rule binds admins too (no bypass)
    required_pull_request_reviews: {
      required_approving_review_count: $reviews,
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      require_last_push_approval: true
    },
    required_conversation_resolution: true,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    restrictions: null             # null = no extra push restriction list (PRs still required)
  }')"

echo "==> Applying branch protection to ${OWNER_REPO}@${BRANCH} ..."
# PUT is a full replace, which is what makes this idempotent: re-running yields
# the same protection object regardless of prior state.
echo "${payload}" | gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${OWNER_REPO}/branches/${BRANCH}/protection" \
  --input - >/dev/null

echo "==> Branch protection applied."
echo

# ----- Verify & echo the resulting state -------------------------------------
echo "==> Current protection summary:"
gh api "repos/${OWNER_REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  | jq '{
      enforce_admins: .enforce_admins.enabled,
      strict_up_to_date: .required_status_checks.strict,
      required_checks: [.required_status_checks.checks[].context],
      required_approvals: .required_pull_request_reviews.required_approving_review_count,
      dismiss_stale_reviews: .required_pull_request_reviews.dismiss_stale_reviews,
      require_code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
      conversation_resolution: .required_conversation_resolution.enabled,
      linear_history: .required_linear_history.enabled,
      allow_force_pushes: .allow_force_pushes.enabled,
      allow_deletions: .allow_deletions.enabled
    }'

echo
echo "DONE. The Deploy Gate (CLAUDE.md §2) is now BINDING on '${BRANCH}'."
echo "Reminder: also configure the protected 'production' environment"
echo "(required reviewers + scoped deployer secrets) per tools/ci/README.md §B."
