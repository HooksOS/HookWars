import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { NetClient, type NetPlayer } from "../net/client";
import { stepMovement, INTERP_DELAY_MS, type InputFrame } from "../net/protocol";

const FACTION_COLORS = [
  new Color3(0.9, 0.25, 0.3), // Red
  new Color3(0.25, 0.5, 0.95), // Blue
  new Color3(0.3, 0.85, 0.4), // Green
  new Color3(0.5, 0.3, 0.85), // Black/violet
];

interface RemoteBuffer {
  mesh: Mesh;
  faction: number;
  /** timestamped authoritative snapshots for interpolation */
  buf: { t: number; x: number; z: number; angle: number }[];
}

/**
 * The HookWars game world: Babylon render + Colyseus authoritative netcode.
 * - LOCAL player: client-side prediction + server reconciliation.
 * - REMOTE players: entity interpolation (~100 ms behind authoritative state).
 * The client never decides authoritative position; it only predicts/interpolates.
 */
export function createWorld(
  canvas: HTMLCanvasElement,
  hud: { onFps: (n: number) => void; onPlayers: (n: number) => void; onStatus: (s: string) => void },
): () => void {
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);

  const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3.4, 34, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 18;
  camera.upperRadiusLimit = 60;
  camera.upperBetaLimit = Math.PI / 2.2;

  new HemisphericLight("amb", new Vector3(0, 1, 0), scene).intensity = 0.55;
  new DirectionalLight("sun", new Vector3(-0.4, -1, -0.6), scene).intensity = 1.1;

  const floor = MeshBuilder.CreateGround("floor", { width: 30, height: 30 }, scene);
  const floorMat = new StandardMaterial("floorMat", scene);
  floorMat.diffuseColor = new Color3(0.07, 0.09, 0.14);
  floorMat.specularColor = new Color3(0.1, 0.3, 0.4);
  floor.material = floorMat;

  const ring = MeshBuilder.CreateTorus("ring", { diameter: 28, thickness: 0.3, tessellation: 64 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  const ringMat = new StandardMaterial("ringMat", scene);
  ringMat.emissiveColor = new Color3(0.1, 0.7, 1.0);
  ring.material = ringMat;

  // ---- player meshes ----
  const meshTemplate = MeshBuilder.CreateBox("unit", { size: 1.1 }, scene) as Mesh;
  meshTemplate.setEnabled(false);

  function makeUnit(faction: number): Mesh {
    const m = meshTemplate.clone(`unit-${Math.random().toString(36).slice(2)}`);
    m.setEnabled(true);
    m.position.y = 0.7;
    const mat = new StandardMaterial(`m${faction}`, scene);
    const c = FACTION_COLORS[faction % 4];
    mat.emissiveColor = c.scale(0.9);
    mat.diffuseColor = c.scale(0.2);
    m.material = mat;
    return m;
  }

  // ---- input ----
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  function sampleInput(): { dx: number; dz: number } {
    let dx = 0;
    let dz = 0;
    if (keys.has("w") || keys.has("arrowup")) dz += 1;
    if (keys.has("s") || keys.has("arrowdown")) dz -= 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    return { dx, dz };
  }

  // ---- local prediction state ----
  const net = new NetClient();
  let localMesh: Mesh | null = null;
  const predicted = { x: 0, z: 0 };
  let seq = 0;
  const pending: InputFrame[] = []; // inputs not yet acknowledged by the server

  const remotes = new Map<string, RemoteBuffer>();

  net
    .connect({
      onAdd: (p) => {
        if (p.id === net.sessionId) {
          localMesh = makeUnit(p.faction);
          predicted.x = p.x;
          predicted.z = p.z;
        } else {
          remotes.set(p.id, { mesh: makeUnit(p.faction), faction: p.faction, buf: [{ t: now(), ...vec(p) }] });
        }
        hud.onPlayers(remotes.size + (localMesh ? 1 : 0));
      },
      onRemove: (id) => {
        remotes.get(id)?.mesh.dispose();
        remotes.delete(id);
        hud.onPlayers(remotes.size + (localMesh ? 1 : 0));
      },
      onChange: (p) => {
        if (p.id === net.sessionId) reconcile(p);
        else {
          const r = remotes.get(p.id);
          if (r) {
            r.buf.push({ t: now(), ...vec(p) });
            if (r.buf.length > 30) r.buf.shift();
          }
        }
      },
    })
    .then(() => hud.onStatus("connected · authoritative"))
    .catch((err) => {
      console.error("[net] connect failed:", err);
      hud.onStatus("offline — start services/realtime (ws://localhost:2567)");
    });

  /** Server reconciliation: snap to authoritative state, replay un-acked inputs. */
  function reconcile(p: NetPlayer): void {
    predicted.x = p.x;
    predicted.z = p.z;
    // drop inputs the server has already processed
    while (pending.length && pending[0].seq <= p.lastProcessedInput) pending.shift();
    // replay the rest on top of the authoritative position
    for (const inp of pending) {
      const next = stepMovement(predicted, inp.dx, inp.dz, inp.dt);
      predicted.x = next.x;
      predicted.z = next.z;
    }
  }

  let fpsAcc = 0;
  scene.registerBeforeRender(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);

    // local player: predict + send input
    if (localMesh) {
      const { dx, dz } = sampleInput();
      if (dx !== 0 || dz !== 0) {
        const angle = Math.atan2(dx, dz);
        const frame: InputFrame = { seq: ++seq, dx, dz, angle, dt };
        const next = stepMovement(predicted, dx, dz, dt);
        predicted.x = next.x;
        predicted.z = next.z;
        pending.push(frame);
        net.sendInput(frame);
        localMesh.rotation.y = angle;
      }
      localMesh.position.x += (predicted.x - localMesh.position.x) * 0.5;
      localMesh.position.z += (predicted.z - localMesh.position.z) * 0.5;
    }

    // remote players: interpolate ~100ms in the past
    const renderTime = now() - INTERP_DELAY_MS;
    remotes.forEach((r) => {
      const b = r.buf;
      if (b.length === 0) return;
      let a = b[0];
      let c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].t <= renderTime && b[i + 1].t >= renderTime) {
          a = b[i];
          c = b[i + 1];
          break;
        }
      }
      const span = c.t - a.t || 1;
      const f = Math.max(0, Math.min(1, (renderTime - a.t) / span));
      r.mesh.position.x = a.x + (c.x - a.x) * f;
      r.mesh.position.z = a.z + (c.z - a.z) * f;
      r.mesh.rotation.y = a.angle;
    });

    fpsAcc += dt;
    if (fpsAcc > 0.25) {
      fpsAcc = 0;
      hud.onFps(Math.round(engine.getFps()));
    }
  });

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    net.dispose();
    engine.dispose();
  };
}

function now(): number {
  return performance.now();
}
function vec(p: NetPlayer): { x: number; z: number; angle: number } {
  return { x: p.x, z: p.z, angle: p.angle };
}
