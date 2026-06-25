import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Minimal HookWars top-down arena. Stylized low-poly, server-authoritative-ready:
 * this is purely the render view. Combatants here are placeholder thin-instanced
 * boxes orbiting the arena to prove the render loop, instancing, and HUD bridge.
 */
export function createArena(
  canvas: HTMLCanvasElement,
  onFps: (fps: number) => void,
): () => void {
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);

  // Top-down-ish angled camera (locked — no user authority over sim).
  const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3.4, 34, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 18;
  camera.upperRadiusLimit = 60;
  camera.upperBetaLimit = Math.PI / 2.2;

  new HemisphericLight("amb", new Vector3(0, 1, 0), scene).intensity = 0.55;
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.6), scene);
  sun.intensity = 1.1;

  // Arena floor
  const floor = MeshBuilder.CreateGround("floor", { width: 30, height: 30 }, scene);
  const floorMat = new StandardMaterial("floorMat", scene);
  floorMat.diffuseColor = new Color3(0.07, 0.09, 0.14);
  floorMat.specularColor = new Color3(0.1, 0.3, 0.4);
  floor.material = floorMat;

  // Glowing grid border
  const ring = MeshBuilder.CreateTorus("ring", { diameter: 28, thickness: 0.3, tessellation: 64 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  const ringMat = new StandardMaterial("ringMat", scene);
  ringMat.emissiveColor = new Color3(0.1, 0.7, 1.0);
  ringMat.diffuseColor = new Color3(0, 0, 0);
  ring.material = ringMat;

  // Faction-colored combatants via thin instances (one draw call).
  const unit = MeshBuilder.CreateBox("unit", { size: 1.1 }, scene) as Mesh;
  const unitMat = new StandardMaterial("unitMat", scene);
  unitMat.emissiveColor = new Color3(0.9, 0.25, 0.3);
  unitMat.diffuseColor = new Color3(0.2, 0.05, 0.06);
  unit.material = unitMat;

  const COUNT = 8;
  const matrices = new Float32Array(16 * COUNT);
  unit.thinInstanceSetBuffer("matrix", matrices, 16, false);

  let t = 0;
  let acc = 0;
  scene.registerBeforeRender(() => {
    const dt = engine.getDeltaTime() / 1000;
    t += dt;
    for (let i = 0; i < COUNT; i++) {
      const a = t * 0.6 + (i / COUNT) * Math.PI * 2;
      const r = 9 + Math.sin(t + i) * 1.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const off = i * 16;
      // identity + translation matrix (column-major)
      matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0.7, z, 1], off);
    }
    unit.thinInstanceBufferUpdated("matrix");

    acc += dt;
    if (acc > 0.25) {
      acc = 0;
      onFps(Math.round(engine.getFps()));
    }
  });

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    engine.dispose();
  };
}
