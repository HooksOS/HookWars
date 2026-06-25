# HookWars — Master Game-Design Prompt

A copy-paste prompt for Claude to produce the **complete, production-ready game design and asset breakdown**
for HookWars. Tailored to the locked stack (web-only · Babylon.js · Base/HookOS) and the binding rules in
`CLAUDE.md`. Paste everything in the code block below into a fresh Claude session (ideally with `CLAUDE.md`
and `docs/go-to-production.md` attached as context).

```text
ROLE
You are the Game Design Director + Technical Art Director + Economy Designer for HookWars, a
production-grade, web-only (desktop + mobile browser) top-down multiplayer shooter on Base, with a
player-owned economy driven by Uniswap v4 Hooks launched via HookOS. You are producing the definitive
Game Design Bible AND a fully itemized, production-ready asset manifest that a real art/eng team can
execute against without further clarification.

NON-NEGOTIABLE CONSTRAINTS (these override any default assumptions)
- Engine: Babylon.js (WebGL2 with WebGPU fallback). 3D, stylized low-poly. NO Unity, NO native, web only.
- Visual style: Helldivers + Brawl Stars + Vampire Survivors + Cyberpunk + Sci-Fi Military. High readability,
  mobile-friendly, competitive eSports clarity.
- Combat is SERVER-AUTHORITATIVE; the client renders only. Design must never assume client trust.
- Performance budgets (HARD, enforced in CI): low-end mobile <=150 draw calls/frame, characters 2-6k tris
  with LOD, textures KTX2/Basis (ASTC/BC7), meshes Draco-compressed glTF 2.0, first-match download <=25 MB.
- Asset pipeline: ComfyUI/FLUX/Stable Diffusion -> Blender (retopo/rig/LOD/bake) -> glTF 2.0 (GLB) ->
  gltf-transform/meshoptimizer + Draco + KTX2 -> budget-checked in CI.
- Chain: Base (8453). Token: $BULLET (deployed by HookOS). NFTs: ERC-721 (weapons, 1/1) + ERC-1155
  (skins/editioned). No placeholder art specs, no TODOs, no "TBD" — every item fully specified or omitted.
- Economy must prevent death spirals, infinite inflation, and reward exploitation.

SCOPE OF DESIGN (cover ALL of this)
1. Core game pillars, fantasy, and the 30-second-to-30-minute player loop.
2. Game modes: Arena Deathmatch, Team Deathmatch, Faction Wars, Capture Zones, Tournament, Boss Raids,
   Extraction, Territory Control, Ranked Seasons. For each: rules, win condition, player count, match length,
   map needs, economy hooks, and why it retains players.
3. Factions (Red, Blue, Green, Black): identity, color language, economy/territory/governance bonuses,
   seasonal rewards, visual motifs.
4. Combat & systems: movement, weapons, abilities, damage model, TTK targets, progression, BattlePass,
   matchmaking/MMR, anti-cheat surface (what the server validates).
5. Token economy: $BULLET sources/sinks, emissions/deflation/buyback/burn/treasury/creator-rewards/LP
   incentives, and how the Uniswap v4 hook (beforeSwap/afterSwap) feeds tournaments/territory/NFT pools.
   Provide concrete numbers (rates, caps, cooldowns) and an inflation/sink balance table.
6. NFT system: weapons, skins, vehicles, faction, tournament, achievement NFTs; rarity tiers
   (Common/Rare/Epic/Legendary/Mythic) with drop rates and stat/cosmetic deltas.

ASSET BREAKDOWN (the core deliverable — be exhaustive and itemized)
Produce a COMPLETE asset manifest as tables. Every row is a single deliverable asset with:
  | asset_id | name | category | description | qty | format | tri/texel budget | LODs | rarity/faction |
  | animation list | VFX/audio refs | source-tool | target repo path | acceptance criteria |
Cover every category, with counts grounded in the design:
  A. CHARACTERS — 20 player archetypes, 10 enemy classes, 5 faction leaders, boss characters. Per character:
     silhouette/readability note, rig spec (bone count), animation set (idle/run/strafe/fire/reload/ability/
     death/emote), skin slots, poly+texture budget, 3 quality LODs.
  B. WEAPONS — Assault Rifles, Shotguns, SMGs, Snipers, Rocket Launchers, Laser, Plasma, Railguns. Per weapon:
     base model, attachment points, muzzle/impact VFX, fire/reload audio, skin system, stat sheet.
  C. ENVIRONMENTS — Industrial Arena, Reactor Arena, Space Station, Underground Labs, Mining Facility,
     Desert Outpost, Cyber City. Per arena: layout/blockout, modular prop kit (list each prop), lighting mood,
     navmesh/collision needs, draw-call budget, instancing plan, skybox.
  D. VFX — projectiles, impacts, explosions, ability FX, status effects, environmental FX, hit markers.
     Specify particle counts and mobile fallbacks.
  E. UI/UX — HUD, Inventory, Marketplace, NFT Wallet, BattlePass, Leaderboards, Matchmaking, Faction Screens,
     Governance Screens. Desktop + mobile + responsive. Component list, icon set count, font stack, motion specs.
  F. AUDIO — music stems per mode, SFX categories, voice/announcer lines, UI sounds. Format/loudness targets.
  G. NFT/MARKETING ART — weapon cards, skin cards, NFT card frames per rarity, season banners, tournament
     graphics, social/app-store/web assets. Tie each to the ComfyUI/FLUX generation step.
  H. SHARED/TECH ART — shaders/materials (toon/PBR-lite), atlases, decals, impostors, icon atlas.

DELIVERABLE FORMAT
- Start with a 1-page executive design summary and the player-loop diagram (ASCII is fine).
- Then the full design sections (2-6 above) with concrete numbers, not adjectives.
- Then the ASSET MANIFEST as the itemized tables above, grouped A-H, with a TOTAL asset count and a
  per-category rollup (counts, aggregate tri/texture budget, estimated download size vs the 25 MB cap).
- Then a Definition of Done per asset category and an art QA checklist (readability, budget, naming,
  format, LODs, KTX2/Draco, mobile validation).
- Then a phased production order mapped to the roadmap in docs/go-to-production.md (which assets are needed
  for the Phase 2 vertical slice vs later), and a naming convention + directory map under
  apps/game-client/public/assets and assets/art-source.
- Flag every place where a number is an assumption so producers can tune it. Do NOT leave anything as TODO.

OUTPUT QUALITY BAR
Production-ready and investment-ready. A studio should be able to assign every manifest row to an artist or
engineer and a CI pipeline should be able to budget-check every asset. If a section would be too large for one
response, produce it in clearly labeled parts and tell me to say "continue", but never drop categories.
```

---

### How to use it
- **Best results:** attach `CLAUDE.md` + `docs/go-to-production.md` so the constraints are grounded.
- **Want it run in pieces?** Ask Claude to do "Section A: Characters" first, then B, C… — the asset tables are
  large and per-category runs keep each table complete.
- **To wire it into the repo:** point the "target repo path" column at `apps/game-client/public/assets/<category>/`
  for runtime GLBs and `assets/art-source/<category>/` for Blender/PSD sources (Git LFS).
