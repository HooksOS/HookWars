# HookWars — Go-to-Production Plan (Web-Only, Open Source)

> **Scope decision (2026-06-25):** HookWars ships **web-only** (desktop + mobile browser) on an
> **all open-source** stack. This supersedes the README's Unity 6 / Steam / Epic / native-mobile / console
> mandate. Blockchain side (Base, HookOS, Uniswap v4) is unchanged. Engine: **Babylon.js** (Apache-2.0).
> All deploy gates from `CLAUDE.md §2` and the in-sync release rule from `§3` remain binding.

---

## 1. Open-Source Stack (web-only)

Every component below is OSS. **License nuances are called out** because the project mandate is "open source" —
the AGPL/BUSL/FSL items are fine to *self-host* but matter if anything is *redistributed*.

### Client (browser)
| Concern | Choice | License |
|---|---|---|
| 3D engine | **Babylon.js 7+** (`@babylonjs/core`) | Apache-2.0 |
| Physics | **Havok** plugin (web) → or **Rapier** (`@dimforge/rapier3d`) for shared client/server determinism | MIT / Apache-2.0 |
| UI / HUD | **React 19** (DOM HUD over canvas) + **Zustand** (game↔UI bridge) | MIT |
| Build | **Vite 6** (SPA; TanStack Router) | MIT |
| ECS (sim mirror) | **bitECS** or **Miniplex** | MPL-2.0 / MIT |
| Wallet | **wagmi v2 + viem v2 + RainbowKit**, **@coinbase/onchainkit** | MIT |
| Data | **TanStack Query v5** | MIT |
| Charts | **uPlot** (realtime) + **visx** (dashboards) | MIT |
| Assets | **@babylonjs/loaders** glTF + **Draco** + **KTX2/Basis** | Apache-2.0 |
| Wire format | native **WebSocket** + **MessagePack** | MIT |

### Real-time multiplayer (server-authoritative)
| Concern | Choice | License |
|---|---|---|
| Authoritative match rooms | **Colyseus** (binary delta state sync) | MIT |
| Social/meta (auth, matchmaking, parties, clans, leaderboards, tournaments) | **Nakama** | Apache-2.0 |
| Low-latency transport (ranked arenas) | **geckos.io** (WebRTC DataChannel / UDP) | MIT |
| WS transport driver | **uWebSockets.js** | Apache-2.0 |
| NAT traversal | **coturn** (STUN/TURN) | BSD-3 |
| Game-server fleet | **Agones** (k8s dedicated-server lifecycle/allocation) | Apache-2.0 |
| Coordination | **Redis** / **Valkey** (presence, pub/sub, queues) | BSD-3 / AGPL note → prefer Valkey |
| Jobs | **BullMQ** | MIT |

**Netcode model:** 20–30 Hz authoritative tick · client prediction + server reconciliation · entity
interpolation (~100 ms) · lag compensation with **clamped** rewind · baseline+delta snapshots · area-of-interest
culling. **Client carries zero authority** — sends inputs only. Anti-cheat lives in the server tick.

### Blockchain / contracts (Base 8453)
| Concern | Choice | License |
|---|---|---|
| Contract toolchain | **Foundry** (forge/anvil/cast) | MIT/Apache-2.0 |
| Base contracts | **OpenZeppelin v5** + **Solady** (gas) | MIT |
| Uniswap v4 | **v4-core** ⚠️ **BUSL-1.1** (→MIT 2027-06-15), **v4-periphery `BaseHook`** ⚠️ **GPL-2.0** | see §4 |
| Static analysis (gate) | **Slither** | AGPL-3.0 |
| Fuzzing | **Medusa** (primary) + **Echidna** | AGPL-3.0 |
| Lint | **solhint** | MIT |
| Launch | **HookOS** `@hookos/sdk` (`network: "base"`) | ⚠️ unverified — see §4 |
| Indexing (stats subgraphs) | **Ponder** (primary) / **The Graph** (public subgraph) | MIT / Apache-2.0 |
| Account abstraction | **permissionless.js** (ERC-4337), EIP-5792 batched calls via viem/wagmi | MIT |

### Web platform (apps)
**Next.js + React + Tailwind + shadcn/ui + wagmi/viem + RainbowKit** (all MIT) for marketplace, dashboard,
governance portal (OZ Governor), leaderboards. **Seaport** (MIT) optional behind `Marketplace.sol`.
Charts via Recharts/visx/Lightweight-Charts fed by Ponder GraphQL.

### DevOps / infra
**Docker · Kubernetes · GitHub Actions** (self-hosted runners via **ARC**) · **Turborepo** monorepo ·
**Helm umbrella chart** · **ArgoCD** GitOps (atomic fleet sync) · **Agones + KEDA + Cluster Autoscaler/Karpenter**
scaling · **CloudNativePG** + **Valkey** data HA · **k6** load test (100k VUs) · **cosign/Sigstore** image signing ·
**Sealed Secrets / OpenBao** secrets · **Velero + pgBackRest** DR.

### Observability & analytics
**OpenTelemetry → Prometheus + Loki + Tempo + Grafana** · **Sentry** (self-host; or GlitchTip MIT) ·
**PostHog** (self-host). AI art: **ComfyUI / FLUX / Stable Diffusion**. Bots: **discord.js**, **grammY/Telegraf**.

---

## 2. The Deploy Gate (structural, per CLAUDE.md §2)

Contract deploy is made **impossible** on a red gate via three independent layers:
1. **Branch protection** — `slither`, `forge-fork`, `unit-int`, `audit-signoff` are **required status checks** (no admin bypass).
2. **`needs:` DAG** — `deploy-contracts` `needs:` all four gate jobs; GitHub won't schedule it if any fail/skip.
3. **Protected `production` environment** — holds the Base deployer key + required reviewers; the key exists nowhere else.

→ Slither clean **AND** `forge test --fork-url $BASE_RPC` green **AND** full suite green **AND** audit sign-off, or nothing ships.
Workflow skeleton lives at `.github/workflows/release.yml`; helper logic in `tools/ci/`.

## 3. In-Sync Release (per CLAUDE.md §3)

The pipeline **never `kubectl apply`s directly.** One Turborepo build → one versioned image set (game-server,
backend, matchmaking, realtime, workers, bots, web-\*, docs) → **cosign-signed** → one Git commit to `infra-gitops`
→ **ArgoCD** applies the **Helm umbrella chart** in a single atomic sync wave. Result: the whole fleet rolls to the
**same version together**, and k8s liveness/readiness + ArgoCD self-heal keep it running **indefinitely**.
All-or-nothing: if the gate is red, the entire release is blocked — not just contracts.

---

## 4. Open Verification Items (resolve before building integration code)

These are **flagged unverified** by research and must be confirmed against real sources, not assumed:

1. **`@hookos/sdk` reality** — the SDK/`HookManager` could not be confirmed against a public package as of 2026-06.
   Confirm the package, source, and license before writing launch code. (Docs-reported API: `hookos.tokens.create`,
   `hooks.register`/`attach`, `network: "base"`, 0.005 ETH launch fee — treat as provisional.)
2. **HookOS ↔ Uniswap v4 permission-flag mapping** — v4 encodes hook permissions in the hook **address bits**
   (mined via `HookMiner`/CREATE2). Confirm whether HookOS mines/deploys the permission-correct address for you or
   expects a pre-deployed `HookWarsHook`. Do **not** assume HookOS's flag enum is 1:1 with `Hooks.Permissions`.
3. **$BULLET provenance** — does HookOS deploy its **own** ERC-20 (bytecode *outside* your Slither/fork gate), or can
   it adopt your audited `BulletToken.sol`? **Prefer the latter.** If forced into the former, document that $BULLET's
   bytecode is HookOS-provided and out of your audit gate.
4. **Uniswap v4 licensing** — `v4-core` BUSL-1.1 commercial-use grant must be confirmed for production before the
   2027-06-15 MIT conversion; `v4-periphery` `BaseHook` is GPL-2.0 copyleft (acceptable for an OSS repo; note the obligation).
5. **Havok web license** — confirm current terms; fall back to **Rapier** (Apache-2.0) if any doubt.

---

## 5. Phased Roadmap

Each phase is shippable and gated. Contract-touching phases pass the §2 gate before any deploy.

- **Phase 0 — Foundations.** Monorepo (Turborepo), `contracts/` Foundry workspace + `slither.config.json`,
  `.github/workflows/release.yml` deploy gate, k8s skeleton + ArgoCD, observability baseline. **Resolve §4 verification items.**
- **Phase 1 — Contracts & economy (testnet).** `BulletToken`, `HookWarsHook` (v4 callbacks), Treasury, Staking,
  RewardDistributor + tokenomics model (no death spirals / infinite inflation / reward exploits). Slither + fork tests +
  fuzzing green. Launch $BULLET on **Base Sepolia** via HookOS.
- **Phase 2 — Gameplay vertical slice.** Babylon client + Colyseus authoritative server: 1 mode (Arena Deathmatch),
  1 arena, server-authoritative combat, prediction/interpolation, mobile-web perf budget (≤150 draw calls low-end).
- **Phase 3 — Backend & meta.** Nakama auth (wallet-linked), matchmaking, inventory, NFT ownership, parties/clans;
  Postgres/Valkey/BullMQ; WeaponNFT/SkinNFT (ERC-721/1155 + ERC-2981 royalties).
- **Phase 4 — Web platform & indexing.** Marketplace, dashboard, governance portal, leaderboards; Ponder indexer +
  stats charts/subgraphs; account abstraction onboarding (passkey smart wallet, EIP-5792 batched actions).
- **Phase 5 — Economy live + security.** Full NFT/economy on testnet; **mandatory security program** (audit,
  economic/Sybil/reentrancy/flash-loan/MEV/anti-cheat/wallet-abuse reviews; threat models + risk matrices + mitigations).
- **Phase 6 — Growth surfaces.** Discord + Telegram bots, AI marketing agents, PostHog analytics, ComfyUI/FLUX art pipeline.
- **Phase 7 — Hardening.** k6 load test to **100k** concurrent; chaos/DR drills (Velero/pgBackRest restore); p99/error-budget gates; **audit must pass**.
- **Phase 8 — Mainnet launch.** Deploy contracts to **Base mainnet** via HookOS through the §2 gate; atomic fleet go-live; live-ops + monitoring.

---

*Detailed per-domain research (client, netcode, contracts/web, devops) is summarized above; expand each into
`docs/architecture/`, `docs/security/`, and `docs/playbooks/` as the phases execute.*
