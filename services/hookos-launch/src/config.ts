/**
 * config.ts — environment loading + validation for @hookwars/hookos-launch.
 *
 * Responsibilities:
 *  - Read every input the launcher needs from `process.env`.
 *  - Fail loudly (throw with a clear message) when something required is missing
 *    or malformed, BEFORE any wallet/network work begins.
 *  - Export a single immutable, fully-typed `config` object.
 *
 * Safety posture (see CLAUDE.md §1 "Never recommend insecure implementations"
 * and docs/go-to-production.md §2 deploy gate):
 *  - `dryRun` defaults to TRUE. The service must explicitly opt out to spend.
 *  - A real Base-mainnet launch additionally requires `CONFIRM_MAINNET_LAUNCH`.
 */

import { type Address, isHex } from "viem";
import { base, baseSepolia } from "viem/chains";

/** Exact string the operator must set in CONFIRM_MAINNET_LAUNCH to arm mainnet. */
export const MAINNET_CONFIRMATION_PHRASE = "I_UNDERSTAND_THIS_SPENDS_REAL_FUNDS";

/** Chain ids we explicitly support. Base mainnet is primary. */
export const SUPPORTED_CHAINS = {
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

export interface LaunchConfig {
  /** JSON-RPC endpoint for the target chain. */
  readonly rpcUrl: string;
  /** Deployer private key, validated to be 0x-prefixed 32-byte hex. */
  readonly deployerPrivateKey: `0x${string}`;
  /** Metadata URI passed straight to the token at creation. */
  readonly tokenMetadataURI: string;
  /** Target chain id (defaults to Base mainnet 8453). */
  readonly chainId: SupportedChainId;
  /** Resolved viem chain object for the selected chain id. */
  readonly chain: (typeof SUPPORTED_CHAINS)[SupportedChainId];
  /** True == print-only, never transact. Defaults true. */
  readonly dryRun: boolean;
  /** Whether the operator armed a real mainnet launch via the confirm phrase. */
  readonly mainnetConfirmed: boolean;
  /** Convenience: is the selected chain Base mainnet? */
  readonly isMainnet: boolean;
}

/** The fixed $BULLET launch parameters (per CLAUDE.md §5 — Token: $BULLET). */
export const BULLET_TOKEN = {
  name: "Bullet",
  symbol: "BULLET",
  /** 1,000,000,000 BULLET, expressed as wei (18 decimals) by the caller. */
  initialSupplyWhole: 1_000_000_000n,
} as const;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `[config] Missing required environment variable ${name}. ` +
        `Copy services/hookos-launch/.env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

/**
 * Parse a boolean-ish env var. Anything other than an explicit falsey value
 * ("false"/"0"/"no"/"off", case-insensitive) is treated as true when present.
 * Absent => returns the provided default. This is used so that DRY_RUN must be
 * *deliberately* turned off; typos default to the safe (true) side.
 */
function parseBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  throw new Error(
    `[config] ${name} must be a boolean-like value (true/false), got "${raw}".`,
  );
}

function parseChainId(): SupportedChainId {
  const raw = process.env.CHAIN_ID;
  if (raw === undefined || raw.trim() === "") return base.id;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed)) {
    throw new Error(`[config] CHAIN_ID must be an integer, got "${raw}".`);
  }
  if (!(parsed in SUPPORTED_CHAINS)) {
    throw new Error(
      `[config] Unsupported CHAIN_ID ${parsed}. Supported: ` +
        `${Object.keys(SUPPORTED_CHAINS).join(", ")} (Base mainnet / Base Sepolia).`,
    );
  }
  return parsed as SupportedChainId;
}

function parsePrivateKey(): `0x${string}` {
  const key = required("DEPLOYER_PRIVATE_KEY");
  // A secp256k1 private key is 32 bytes => "0x" + 64 hex chars = 66 chars.
  if (!isHex(key) || key.length !== 66) {
    throw new Error(
      "[config] DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string " +
        "(66 characters total). Do NOT commit this value.",
    );
  }
  return key as `0x${string}`;
}

/** Build and validate the config from the current process environment. */
export function loadConfig(): LaunchConfig {
  const chainId = parseChainId();
  const chain = SUPPORTED_CHAINS[chainId];
  const isMainnet = chainId === base.id;

  const dryRun = parseBool("DRY_RUN", true);

  const confirmPhrase = (process.env.CONFIRM_MAINNET_LAUNCH ?? "").trim();
  const mainnetConfirmed = confirmPhrase === MAINNET_CONFIRMATION_PHRASE;

  return Object.freeze({
    rpcUrl: required("BASE_RPC_URL"),
    deployerPrivateKey: parsePrivateKey(),
    tokenMetadataURI: required("TOKEN_METADATA_URI"),
    chainId,
    chain,
    dryRun,
    mainnetConfirmed,
    isMainnet,
  });
}

/** Address type re-export for downstream modules. */
export type { Address };
