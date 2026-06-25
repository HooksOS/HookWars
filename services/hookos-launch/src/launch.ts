/**
 * launch.ts — entrypoint that launches the $BULLET token on Base via HookOS.
 *
 * Flow:
 *   1. Load + validate env (config.ts). Fail fast on anything missing.
 *   2. Build a viem wallet client (account from DEPLOYER_PRIVATE_KEY, http
 *      transport from BASE_RPC_URL, chain from viem/chains).
 *   3. Instantiate `new HookOS({ walletClient })`.
 *   4. Print the launch plan.
 *   5. If DRY_RUN (default): print exactly what WOULD be sent and exit 0 without
 *      transacting.
 *      If not DRY_RUN: enforce the mainnet confirmation guard, then call
 *      `hookos.tokens.create(...)` — the SDK deploys the token itself — and log
 *      the returned tokenAddress / txResult.
 *
 * Safety (CLAUDE.md §1, docs/go-to-production.md §2):
 *   - DRY_RUN defaults true; nothing spends unless explicitly disabled.
 *   - A real Base-mainnet launch additionally requires CONFIRM_MAINNET_LAUNCH.
 *
 * Hooks (register/attach) are intentionally NOT on this happy path — their SDK
 * param shapes are UNVERIFIED (see hooks.ts). tokens.create is the solid path.
 */

import { HookOS } from "@hookos/sdk";
import {
  createWalletClient,
  http,
  parseEther,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  BULLET_TOKEN,
  loadConfig,
  MAINNET_CONFIRMATION_PHRASE,
  type LaunchConfig,
} from "./config.js";

/**
 * Params we pass to `hookos.tokens.create`. These fields ARE part of the
 * verified SDK surface (per the task's verified facts):
 *   tokens.create({ name, symbol, initialSupply: bigint, metadataURI })
 *     -> { tokenAddress, txResult }
 */
interface CreateTokenParams {
  readonly name: string;
  readonly symbol: string;
  readonly initialSupply: bigint;
  readonly metadataURI: string;
}

/** Build the immutable $BULLET creation params from config. */
function buildBulletParams(config: LaunchConfig): CreateTokenParams {
  return {
    name: BULLET_TOKEN.name, // "Bullet"
    symbol: BULLET_TOKEN.symbol, // "BULLET"
    // 1,000,000,000 BULLET in base units (18 decimals).
    initialSupply: parseEther(BULLET_TOKEN.initialSupplyWhole.toString()),
    metadataURI: config.tokenMetadataURI,
  };
}

/** Construct a viem wallet client for the configured chain + deployer key. */
function buildWalletClient(config: LaunchConfig): WalletClient {
  const account = privateKeyToAccount(config.deployerPrivateKey);
  return createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

function logPlan(config: LaunchConfig, params: CreateTokenParams): void {
  const account = privateKeyToAccount(config.deployerPrivateKey);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(" HookOS launch plan — $BULLET");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Network        : ${config.chain.name} (chainId ${config.chainId})`);
  console.log(`  RPC            : ${config.rpcUrl}`);
  console.log(`  Deployer       : ${account.address}`);
  console.log(`  Token name     : ${params.name}`);
  console.log(`  Token symbol   : ${params.symbol}`);
  console.log(
    `  Initial supply : ${BULLET_TOKEN.initialSupplyWhole.toLocaleString("en-US")} ` +
      `${params.symbol} (${params.initialSupply} base units)`,
  );
  console.log(`  Metadata URI   : ${params.metadataURI}`);
  console.log(`  DRY_RUN        : ${config.dryRun}`);
  console.log(
    `  Mainnet armed  : ${config.mainnetConfirmed ? "yes" : "no"}` +
      (config.isMainnet ? " (mainnet target)" : " (non-mainnet target)"),
  );
  console.log("──────────────────────────────────────────────────────────────");
  // Provenance note per docs/go-to-production.md §4: HookOS deploys the ERC-20
  // itself, so $BULLET bytecode is HookOS-provided and lives OUTSIDE the
  // Foundry/Slither audit gate. This is the SDK-driven launch path.
  console.log(
    "  NOTE: tokens.create deploys the ERC-20 via HookOS — $BULLET bytecode is\n" +
      "        HookOS-provided and is outside the Foundry/Slither deploy gate.",
  );
}

/**
 * Enforce the second safety switch for a real mainnet spend. Throws if the
 * operator tried to do a live mainnet launch without the confirmation phrase.
 */
function assertMainnetGuard(config: LaunchConfig): void {
  if (config.isMainnet && !config.mainnetConfirmed) {
    throw new Error(
      "[launch] Refusing to launch on Base MAINNET with DRY_RUN=false unless " +
        `CONFIRM_MAINNET_LAUNCH is set to the exact phrase "${MAINNET_CONFIRMATION_PHRASE}". ` +
        "Set DRY_RUN=true to simulate, or arm the confirmation to proceed.",
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const params = buildBulletParams(config);

  logPlan(config, params);

  if (config.dryRun) {
    console.log("\n[DRY_RUN] No transaction will be sent. Would call:");
    console.log("  hookos.tokens.create({");
    console.log(`    name: ${JSON.stringify(params.name)},`);
    console.log(`    symbol: ${JSON.stringify(params.symbol)},`);
    console.log(`    initialSupply: ${params.initialSupply}n,`);
    console.log(`    metadataURI: ${JSON.stringify(params.metadataURI)},`);
    console.log("  })");
    console.log(
      "\n[DRY_RUN] Set DRY_RUN=false (and CONFIRM_MAINNET_LAUNCH on mainnet) to execute.",
    );
    return;
  }

  // Live path from here on.
  assertMainnetGuard(config);

  const walletClient = buildWalletClient(config);
  const hookos = new HookOS({ walletClient });

  console.log("\n[launch] Sending tokens.create — the SDK deploys $BULLET...");
  const { tokenAddress, txResult } = await hookos.tokens.create(params);

  console.log("\n✅ $BULLET launched via HookOS.");
  console.log(`   tokenAddress : ${tokenAddress}`);
  console.log("   txResult     :", txResult);
  console.log(
    "\n   Next (UNVERIFIED hook path — see src/hooks.ts): register + attach the\n" +
      "   HookWarsHook once its SDK param shape is confirmed against @hookos/sdk.",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ Launch failed: ${message}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
});
