# Character assets — credits & how to add

## Bringing in a character (turnkey)
1. Export/obtain a rigged **glTF 2.0 / GLB** humanoid (Y-up). Stylized low-poly, **2–6k tris**, with at
   least a `walk` (and ideally `idle`) animation. Run it through the asset pipeline (Draco + KTX2) per
   `docs/go-to-production.md`.
2. Drop the `.glb` in this folder.
3. Add an entry to `manifest.json` (`id`, `name`, `role`, `file`, `animations`, `license`, `source`,
   `attribution`, `shipping`). Set `shipping: true` only when the license is commercial-safe.
4. The client loads it via `src/game/character.ts` — no code change needed to swap the default model.

## License rule (non-negotiable — CLAUDE.md)
Shipping assets must be **CC0**, a **royalty-free game license** (e.g. Synty), or a **paid-commercial AI tier**
(Meshy/Tripo). Never ship CC-BY-NC or "personal use only". CC-BY is allowed **only** with attribution recorded here.

## Where to source production characters
- **CC0:** Kenney.nl, Quaternius — free, commercial, no attribution.
- **Royalty-free game packs:** Synty POLYGON (Sci-Fi / Military / Cyberpunk) — best style match.
- **Rig + animate (free):** Adobe Mixamo (auto-rig + idle/run/fire/reload/death).
- **Ownable IP (our pipeline):** ComfyUI/FLUX/SD → Meshy/Tripo image-to-3D → Blender retopo → GLB.

## Current assets
| File | Role | License | Attribution |
|---|---|---|---|
| `cesium-man.glb` | placeholder sample (`scout`) | CC-BY-4.0 | **CesiumMan** by Cesium (https://cesium.com), CC-BY 4.0 |

> `cesium-man.glb` is a **development placeholder** to prove the GLB → Babylon → netcode path. Replace with a
> HookWars soldier archetype before launch; the roster spec is in `docs/prompts/game-design-master-prompt.md`.
