#!/usr/bin/env node
// @ts-check
/**
 * verify-audit-signoff.mjs — HookWars Deploy Gate (CLAUDE.md §2, item 4)
 *
 * "Never deploy unaudited contracts." / "Never approve deployment until audits pass."
 *
 * This script makes it impossible for the release pipeline's `audit-signoff` gate job
 * to go green unless EVERY changed Solidity contract under `contracts/src` has a
 * matching, PASSED entry in the audit manifest at `audit/signoff.json`.
 *
 * Behaviour:
 *   1. Resolve the repo root (this file lives at <root>/tools/ci/).
 *   2. Read + parse the JSON manifest at <root>/audit/signoff.json.
 *   3. Determine the set of CHANGED contracts under contracts/src/**.sol via, in order:
 *        a. CLI args (each arg = a path)                       -> for local/manual runs
 *        b. $CHANGED_CONTRACTS env (newline/space separated)   -> for custom CI wiring
 *        c. git diff against a base ref                         -> normal PR / push CI
 *        d. fallback: every .sol under contracts/src            -> first commit / no git
 *   4. For each changed contract, require a manifest entry with:
 *        - status === "passed"
 *        - non-empty `auditor`
 *        - non-empty `report`
 *   5. Exit 0 only if all changed contracts pass; otherwise print a clear,
 *      actionable message and exit non-zero. No overrides, no skips.
 *
 * Usage:
 *   node tools/ci/verify-audit-signoff.mjs
 *   node tools/ci/verify-audit-signoff.mjs contracts/src/HookWarsHook.sol
 *   BASE_REF=origin/main node tools/ci/verify-audit-signoff.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep, posix } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// <root>/tools/ci/verify-audit-signoff.mjs -> repo root is two levels up.
const REPO_ROOT = resolve(__dirname, '..', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'audit', 'signoff.json');
const CONTRACTS_SRC_REL = posix.join('contracts', 'src');
const CONTRACTS_SRC_ABS = join(REPO_ROOT, 'contracts', 'src');

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_CONFIG = 2;

/** Normalise any path to a repo-relative POSIX path (so manifest keys are stable across OSes). */
function toRepoRelPosix(p) {
  const abs = resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  return rel.split(sep).join('/');
}

function fail(msg) {
  console.error(`\n❌  AUDIT SIGN-OFF GATE FAILED\n${msg}\n`);
  process.exit(EXIT_FAIL);
}

function configError(msg) {
  console.error(`\n⚠️  AUDIT SIGN-OFF GATE — CONFIGURATION ERROR\n${msg}\n`);
  process.exit(EXIT_CONFIG);
}

/** Recursively collect every *.sol file under a directory, returned as repo-relative POSIX paths. */
function walkSol(absDir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkSol(abs));
    } else if (st.isFile() && name.endsWith('.sol')) {
      out.push(toRepoRelPosix(abs));
    }
  }
  return out;
}

/** Try to discover changed contracts via git diff against a base ref. Returns null if git unavailable. */
function changedViaGit() {
  const candidates = [
    process.env.BASE_REF,
    process.env.BASE_SHA,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
    'origin/main',
    'main',
  ].filter(Boolean);

  for (const base of candidates) {
    try {
      // Use merge-base so we compare against the fork point, not unrelated history.
      let diffBase = base;
      try {
        diffBase = execFileSync('git', ['merge-base', 'HEAD', String(base)], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // No common ancestor (e.g. shallow clone) — fall back to the raw ref.
        diffBase = String(base);
      }

      const out = execFileSync(
        'git',
        ['diff', '--name-only', '--diff-filter=ACMR', diffBase, 'HEAD', '--', CONTRACTS_SRC_REL],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );

      const files = out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('.sol'))
        .map((l) => l.split(sep).join('/'));

      console.log(`   (changed contracts resolved via: git diff ${diffBase}..HEAD)`);
      return files;
    } catch {
      // Try the next candidate base ref.
    }
  }
  return null;
}

/** Resolve the list of changed contracts (repo-relative POSIX paths under contracts/src). */
function resolveChangedContracts() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length > 0) {
    console.log('   (changed contracts resolved via: CLI arguments)');
    return args.map(toRepoRelPosix);
  }

  if (process.env.CHANGED_CONTRACTS && process.env.CHANGED_CONTRACTS.trim()) {
    console.log('   (changed contracts resolved via: $CHANGED_CONTRACTS)');
    return process.env.CHANGED_CONTRACTS.split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(toRepoRelPosix);
  }

  const fromGit = changedViaGit();
  if (fromGit !== null) return fromGit;

  // Last resort: no git history available. Be STRICT — require every contract to be signed off.
  if (existsSync(CONTRACTS_SRC_ABS)) {
    console.log('   (changed contracts resolved via: full scan of contracts/src — git unavailable)');
    return walkSol(CONTRACTS_SRC_ABS);
  }

  return [];
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    configError(
      `Audit manifest not found at:\n    ${MANIFEST_PATH}\n` +
        `Create it (see audit/README.md). Every changed contract under contracts/src must be listed and "passed".`
    );
  }

  let raw;
  try {
    raw = readFileSync(MANIFEST_PATH, 'utf8');
  } catch (err) {
    configError(`Could not read audit manifest at ${MANIFEST_PATH}: ${err.message}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    configError(`audit/signoff.json is not valid JSON: ${err.message}`);
  }

  if (!json || typeof json !== 'object' || typeof json.contracts !== 'object' || json.contracts === null) {
    configError(
      `audit/signoff.json must be an object with a "contracts" map keyed by repo-relative path.\n` +
        `See audit/README.md for the schema.`
    );
  }

  // Normalise the manifest keys to repo-relative POSIX so lookups are OS-independent.
  /** @type {Map<string, any>} */
  const byPath = new Map();
  for (const [key, value] of Object.entries(json.contracts)) {
    byPath.set(toRepoRelPosix(key), value);
  }
  return byPath;
}

/** Validate a single manifest entry. Returns an array of problem strings (empty == ok). */
function validateEntry(entry) {
  const problems = [];
  if (!entry || typeof entry !== 'object') {
    return ['no manifest entry found'];
  }
  if (entry.status !== 'passed') {
    problems.push(`status is "${entry.status ?? '<missing>'}" (must be "passed")`);
  }
  if (typeof entry.auditor !== 'string' || entry.auditor.trim() === '') {
    problems.push('"auditor" is missing or empty');
  }
  if (typeof entry.report !== 'string' || entry.report.trim() === '') {
    problems.push('"report" is missing or empty');
  }
  return problems;
}

function main() {
  console.log('HookWars — Audit Sign-off Gate (CLAUDE.md §2)');
  console.log(`   repo root: ${REPO_ROOT}`);
  console.log(`   manifest:  ${relative(REPO_ROOT, MANIFEST_PATH).split(sep).join('/')}`);

  const changed = resolveChangedContracts();

  if (changed.length === 0) {
    console.log('\n✅  No changed Solidity contracts under contracts/src — audit gate satisfied (nothing to verify).');
    process.exit(EXIT_OK);
  }

  const manifest = loadManifest();

  console.log(`\nChanged contracts to verify (${changed.length}):`);
  for (const c of changed) console.log(`   • ${c}`);

  /** @type {{contract: string, problems: string[]}[]} */
  const failures = [];
  for (const contract of changed) {
    const entry = manifest.get(contract);
    const problems = validateEntry(entry);
    if (problems.length > 0) {
      failures.push({ contract, problems });
    } else {
      console.log(`   ✔ ${contract} — passed (auditor: ${entry.auditor}, report: ${entry.report})`);
    }
  }

  if (failures.length > 0) {
    const lines = failures
      .map((f) => `   • ${f.contract}\n        - ${f.problems.join('\n        - ')}`)
      .join('\n');
    fail(
      `${failures.length} contract(s) lack a valid PASSED audit sign-off in audit/signoff.json:\n${lines}\n\n` +
        `Add/repair each entry in audit/signoff.json (status "passed", non-empty auditor + report)\n` +
        `before this release can deploy contracts. See audit/README.md.`
    );
  }

  console.log(`\n✅  All ${changed.length} changed contract(s) have a valid PASSED audit sign-off. Gate satisfied.`);
  process.exit(EXIT_OK);
}

main();
