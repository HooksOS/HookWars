import "@babylonjs/loaders/glTF/2.0";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

const CHARACTER_ROOT = "/assets/characters/";
const CHARACTER_FILE = "cesium-man.glb"; // manifest "default" — swap for a HookWars archetype
const TARGET_HEIGHT = 1.8; // normalize any GLB to ~1.8 world units tall

const FACTION_COLORS = [
  new Color3(0.9, 0.25, 0.3), // Red
  new Color3(0.25, 0.5, 0.95), // Blue
  new Color3(0.3, 0.85, 0.4), // Green
  new Color3(0.6, 0.35, 0.95), // Black/violet
];

/** Load the character GLB once; instantiate cheaply per player from this container. */
export function loadCharacters(scene: Scene): Promise<AssetContainer> {
  return SceneLoader.LoadAssetContainerAsync(CHARACTER_ROOT, CHARACTER_FILE, scene);
}

/**
 * A networked player's visual: a position/rotation holder (driven by netcode),
 * a faction ring at its feet, and a skinned GLB instance whose walk animation
 * plays only while the SERVER reports the player moving.
 */
export interface CharacterView {
  root: TransformNode; // netcode sets .position and .rotation.y
  setMoving: (moving: boolean) => void;
  setDowned: (downed: boolean) => void;
  dispose: () => void;
}

export function spawnCharacter(scene: Scene, container: AssetContainer, faction: number): CharacterView {
  const holder = new TransformNode("player", scene);

  // faction identity ring at the feet (keeps team color despite a shared model)
  const ring = MeshBuilder.CreateTorus("fring", { diameter: 1.6, thickness: 0.12, tessellation: 24 }, scene);
  ring.parent = holder;
  ring.rotation.x = Math.PI / 2;
  const ringMat = new StandardMaterial("fringMat", scene);
  ringMat.emissiveColor = FACTION_COLORS[faction % 4];
  ringMat.disableLighting = true;
  ring.material = ringMat;

  // instantiate the GLB (clones meshes + skeleton + animation groups)
  const inst = container.instantiateModelsToScene(undefined, false);
  const modelRoot = inst.rootNodes[0] as TransformNode;
  modelRoot.parent = holder;

  // normalize height + drop feet to the holder origin
  modelRoot.computeWorldMatrix(true);
  let bounds = modelRoot.getHierarchyBoundingVectors(true);
  const height = bounds.max.y - bounds.min.y || 1;
  modelRoot.scaling.scaleInPlace(TARGET_HEIGHT / height);
  modelRoot.computeWorldMatrix(true);
  bounds = modelRoot.getHierarchyBoundingVectors(true);
  modelRoot.position.y -= bounds.min.y;

  // control the walk cycle ourselves
  const groups = inst.animationGroups;
  groups.forEach((g) => g.stop());
  const walk = groups.find((g) => /walk|run|move/i.test(g.name)) ?? groups[0];

  let moving = false;
  let downed = false;
  return {
    root: holder,
    setMoving(next: boolean) {
      if (downed || next === moving || !walk) return;
      moving = next;
      if (next) walk.start(true, 1, walk.from, walk.to);
      else walk.goToFrame(walk.from), walk.pause();
    },
    setDowned(next: boolean) {
      if (next === downed) return;
      downed = next;
      // collapse the model and dim the faction ring while downed
      modelRoot.setEnabled(!next);
      ringMat.emissiveColor = next ? FACTION_COLORS[faction % 4].scale(0.2) : FACTION_COLORS[faction % 4];
      if (next && walk) {
        walk.pause();
        moving = false;
      }
    },
    dispose() {
      inst.dispose();
      ring.dispose();
      holder.dispose();
    },
  };
}
