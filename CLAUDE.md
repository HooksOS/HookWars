# CLAUDE.md — HookWars Engineering Constitution

> **Status: BINDING. Mandatory to follow indefinitely.**
> This file governs every action taken in this repository by Claude (or any agent/contributor).
> It is derived from `README.md` (the production spec) and is non-negotiable. If a request conflicts
> with a rule here, surface the conflict and refuse the unsafe path — do not silently violate it.
> When `README.md` and this file disagree, the stricter rule wins.

---

## 0. What we are building

**HookWars** — a production-grade, commercial Web3 game: a top-down multiplayer shooter on **Base**,
with a player-owned economy driven by **Uniswap v4 Hooks**, launched via **HookOS** (https://docs.hookos.fun/).
Target scale: **100,000+ concurrent players**. Every deliverable must be **production-grade and investment-ready**.

We are **not** building a prototype. No prototypes, no stubs, no demos passed off as the product.

**Delivery target (decided 2026-06-25): WEB-ONLY** (desktop + mobile browser), **all open-source** stack.
This supersedes the README's Unity 6 / Steam / Epic / native-mobile / console mandate. The client engine is
**Babylon.js** (Apache-2.0). Blockchain side (Base, HookOS, Uniswap v4) is unchanged. See `docs/go-to-production.md`.

---

## 1. Absolute prohibitions (verbatim from README — never violate)

- **Never skip planning.**
- **Never generate placeholder code.**
- **Never leave TODO comments.**
- **Never deploy unaudited contracts.**
- **Never recommend insecure implementations.**
- **Never trust the client.**
- **Never approve deployment until audits pass.**
- **Do not provide summaries** in place of real, built work. Build it.

If you cannot do something properly, say so explicitly. Do not paper over it with a placeholder, a
`TODO`, a mock that ships to prod, or a "left as an exercise" comment.

---

## 2. The Deploy Gate (structurally enforced, no exceptions)

> "making it structurally impossible to deploy without Slither + fork tests passing — mandatory"

Deployment of smart contracts MUST be physically blocked unless ALL of the following pass in CI:

1. **Slither** static analysis — clean (no unsuppressed high/medium findings).
2. **Foundry fork tests** (`forge test --fork-url <base>`) — all green.
3. **Full unit/integration test suite** — all green.
4. **Audit sign-off** for any new/changed contract — "Never approve deployment until audits pass."

These are enforced as **required status checks** in `.github/workflows/` and helper logic in `tools/ci/`.
No `--no-verify`, no skipping hooks, no manual override of the gate. If the gate is red, **nothing deploys** —
and per §3 that means the *entire* release is blocked, not just contracts.

---

## 3. Unified, always-on, in-sync deployment

> "when commit push rebuild deploy start all keep all platform, bots, docs etc in sync and all must start at the same time indefinitely."

Operational meaning — these are requirements, not aspirations:

- **One unified CI/CD pipeline** triggered on commit/push that rebuilds → redeploys → (re)starts the
  whole fleet together. No component is deployed or versioned in isolation.
- **Everything stays version-synchronized**: game client, backend, contracts, subgraphs, Discord bot,
  Telegram bot, AI marketing agents, website, mobile, and **docs** — one coherent release, zero drift.
- **All services start together and run indefinitely** — always-on, auto-restart, self-healing
  (Kubernetes, auto-scaling, monitoring, backups, disaster recovery).
- **Atomic / all-or-nothing releases**: if any required gate fails (§2), the entire release is blocked.
- Release orchestration lives in `tools/scripts/` + `.github/workflows/`. Keep it lockstep.

---

## 4. Security is mandatory

Security is not a phase; it is a gate on every change. For any contract or economy change you MUST cover:

- Smart contract audit · Economic attack analysis · Sybil attack analysis · Reentrancy review
- Flash loan review · MEV review · Anti-cheat review · Wallet abuse review

And maintain: **threat models, risk matrices, mitigation plans** in `docs/security/`.

Game/server security:
- **All combat calculations are server-authoritative.** Dedicated authoritative servers only.
- **Never trust the client.** Validate everything server-side.

Token economy must **prevent death spirals, infinite inflation, and reward exploitation**. Model
emissions/deflation/buyback/burn/treasury/creator-rewards/LP-incentives before shipping economy changes.

---

## 5. Mandated tech stack (do not substitute without explicit approval)

| Layer | Technology |
|---|---|
> **Web-only OSS override (2026-06-25):** game ships in the browser on an all-open-source stack; the rows
> below replace the README's Unity/Netcode-for-GameObjects mandate. Full stack + licenses: `docs/go-to-production.md`.

| Client engine | **Babylon.js** (Apache-2.0), 3D stylized low-poly, WebGL2/WebGPU; **React** DOM HUD; **Vite** build |
| Real-time netcode | **Colyseus** (authoritative rooms) + **Nakama** (social/matchmaking) + **geckos.io** (WebRTC/UDP); dedicated game-server fleet via **Agones**; client carries no authority |
| Client physics | **Rapier** (Apache-2.0) — deterministic client/server (preferred over Havok) |
| Chain | **Base** (chain ID 8453) |
| DeFi / launch | **Uniswap v4 Hooks**, launched via **HookOS** (`@hookos/sdk`, MIT — verified) |
| Contract tooling | **Foundry** + **Slither** (deploy gate) + **Medusa/Echidna** fuzzing |
| Backend | **Node.js, PostgreSQL, Valkey** (Redis fork, BSD-3), **Nakama, BullMQ, WebSockets** |
| Infra / DevOps | **Docker, Kubernetes, GitHub Actions, Turborepo**; **ArgoCD** GitOps; **OpenBao** secrets (not Vault) |
| Analytics | **PostHog** + **GlitchTip** (errors; OSI, not Sentry) |
| On-chain stats | **Ponder** (MIT) indexer — primary; The Graph subgraph optional for public/decentralized hosting |
| Graphics gen | **ComfyUI, FLUX, Stable Diffusion** |
| Marketing | **X API** + autonomous AI marketing agents |
| Bots | **Discord** bot, **Telegram** bot |
| Token | **$BULLET** |

**Mandated contracts:** `BulletToken`, `WeaponNFT`, `SkinNFT`, `BattlePass`, `TournamentVault`,
`Treasury`, `FactionRegistry`, `TerritoryManager`, `RewardDistributor`, `Governance`, `HookWarsHook`,
`Marketplace`, `Staking`, `ReferralSystem`, `CreatorRewards`.

**Mandated v4 hook callbacks:** `beforeSwap`, `afterSwap`, `beforeAddLiquidity`, `afterAddLiquidity` —
powering dynamic fees, buybacks, treasury routing, tournament funding, NFT reward pools, seasonal
rewards, territory bonuses, anti-bot protection.

---

## 6. HookOS integration notes (verify before coding)

HookOS is the launch platform (https://docs.hookos.fun/). Key facts to work from:

**VERIFIED** against the real SDK repo `github.com/HooksOS/sdk` (MIT, TypeScript, viem-based):
- Install `@hookos/sdk viem`; `import { HookOS } from "@hookos/sdk"; const hookos = new HookOS({ walletClient })`.
- `hookos.tokens.create({ name, symbol, initialSupply /*bigint*/, metadataURI })` → `{ tokenAddress, txResult }`.
  **The SDK deploys the token itself** ⇒ `$BULLET` bytecode is HookOS-provided and **sits OUTSIDE our Slither/fork gate** — document this risk; do not assume `BulletToken.sol` is our code.
- Hooks: `hookos.hooks.register()/attach()/detach()` — **param shapes still UNDOCUMENTED**; keep behind the "unverified" boundary in `services/hookos-launch` until confirmed.
- Networks: **Base (8453) primary**, MegaETH/HyperEVM/BSC/Ethereum also supported.

⚠️ **Still unverified — confirm before mainnet:** HookOS↔Uniswap-v4 permission-flag (address-bit) mapping &
whether HookOS mines/deploys the hook address or expects a pre-deployed `HookWarsHook`; the hooks param shapes.
Pin & verify on-chain addresses before integrating.

> **Uniswap v4 licensing: ACCEPTED (2026-06-25, user decision).** v4-core BUSL-1.1 / v4-periphery `BaseHook`
> GPL-2.0 are **not a blocker** — use them freely. No longer a verification item.

---

## 7. Canonical monorepo structure

Keep the repo organized as below. Place new work in the correct home; do not scatter pipeline logic into apps.

```
hookwars/
├── apps/             # User-facing clients: web-marketing, web-dashboard, web-marketplace,
│                     #   web-governance, game-client (Unity 6/URP), mobile (iOS/Android)
├── services/         # Node backends: game-backend, matchmaking, realtime, workers (BullMQ),
│                     #   bot-discord, bot-telegram, ai-marketing, graphics-pipeline, analytics
├── contracts/        # Foundry workspace (Base + v4 hooks): src/ test/ script/ slither.config.json
├── subgraphs/        # The Graph subgraphs for on-chain stats/charts
├── packages/         # Shared libs: types, sdk, contracts-abi, ui, config, game-economy
├── infra/            # docker/ k8s/ terraform/ monitoring/ (IaC, autoscaling, DR)
├── tools/            # scripts/ (commit→deploy lockstep orchestration), generators/, ci/ (gates)
├── docs/             # architecture/ api/ security/ game-design/ art-bible/ playbooks/
├── assets/           # Large art (Git LFS): art-source/, generated/
└── .github/workflows/  # CI/CD + mandatory deploy gates (required status checks)
```

Monorepo orchestration: pnpm workspaces + Turborepo for JS; Unity, Foundry, and subgraphs wired into CI
as their own stages. Contracts stay top-level (own toolchain + hard CI gate); ABIs flow out via
`packages/contracts-abi` so nothing else imports Solidity directly.

---

## 8. How to work here (process)

1. **Plan first.** Never skip planning. State the approach before large changes.
2. **Build phase-by-phase**, real and complete — no placeholders, no TODOs, no summaries-instead-of-work.
3. **Keep everything in sync** (§3): a change to one surface updates its docs, types, subgraph, and bot
   wiring in the same release.
4. **Respect the gate** (§2): contracts ship only behind Slither + fork tests + audit. Never bypass.
5. **Security-review every economy/contract/server change** (§4) and update `docs/security/`.
6. **Verify, don't assume** HookOS/v4 specifics (§6) against official docs/ABIs.
7. Every decision prioritizes, in order of weight: **Scalability, Security, Performance, Player Retention,
   Revenue, Creator-Economy Growth, Long-Term Sustainability.**

---

## 9. Required deliverables (track to completion)

Monorepo structure · technical architecture · database schema · smart-contract architecture · Unity
project architecture · Figma-ready UI system · art production pipeline · AI marketing platform · DevOps
deployment architecture · security audit checklist · production roadmap · launch strategy. Plus the full
docs set (architecture, API, contracts, DB, DevOps, security, GDD, art bible, brand, marketing, launch),
charts/statistics subgraphs, gamification, graphics, animations, and UI.

---

*This constitution is permanent. Re-read it at the start of each session and before every deploy.*
