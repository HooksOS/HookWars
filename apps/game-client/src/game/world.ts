import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Color3, Color4 } from "@babylonjs/core/Maths/math";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Meshes/Builders/linesBuilder";
import { NetClient, type NetPlayer, type ShotEvent } from "../net/client";
import { stepMovement, INTERP_DELAY_MS, type InputFrame } from "../net/protocol";
import { loadCharacters, spawnCharacter, type CharacterView } from "./character";

interface RemoteBuffer {
  view: CharacterView;
  buf: { t: number; x: number; z: number; angle: number }[];
  lastX: number;
  lastZ: number;
  hp: number;
}

export interface WorldHud {
  onFps: (n: number) => void;
  onPlayers: (n: number) => void;
  onStatus: (s: string) => void;
  onVitals: (hp: number, score: number) => void;
}

/**
 * The HookWars game world: Babylon render + Colyseus authoritative netcode +
 * real skinned-GLB characters + server-authoritative combat.
 * - LOCAL player: client-side prediction + server reconciliation.
 * - REMOTE players: entity interpolation (~100 ms behind authoritative state).
 * - Aiming/firing send INTENT; the server resolves all hits, HP, and score.
 */
export function createWorld(canvas: HTMLCanvasElement, hud: WorldHud): () => void {
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

  // ---- input ----
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function sampleInput(): { dx: number; dz: number } {
    let dx = 0;
    let dz = 0;
    if (keys.has("w") || keys.has("arrowup")) dz += 1;
    if (keys.has("s") || keys.has("arrowdown")) dz -= 1;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    return { dx, dz };
  }

  // ---- netcode + entities ----
  const net = new NetClient();
  let localView: CharacterView | null = null;
  let localHp = 100;
  const predicted = { x: 0, z: 0 };
  let aimAngle = 0;
  let seq = 0;
  const pending: InputFrame[] = [];
  const remotes = new Map<string, RemoteBuffer>();
  let disposed = false;

  function reconcile(p: NetPlayer): void {
    predicted.x = p.x;
    predicted.z = p.z;
    while (pending.length && pending[0].seq <= p.lastProcessedInput) pending.shift();
    for (const inp of pending) {
      const next = stepMovement(predicted, inp.dx, inp.dz, inp.dt);
      predicted.x = next.x;
      predicted.z = next.z;
    }
  }

  function headcount(): number {
    return remotes.size + (localView ? 1 : 0);
  }

  // brief tracer line for shot feedback (cosmetic; authority already resolved)
  function spawnTracer(s: ShotEvent): void {
    const ex = s.x + Math.sin(s.angle) * s.dist;
    const ez = s.z + Math.cos(s.angle) * s.dist;
    const line = MeshBuilder.CreateLines(
      "tracer",
      { points: [new Vector3(s.x, 0.9, s.z), new Vector3(ex, 0.9, ez)] },
      scene,
    );
    line.color = s.hit ? new Color3(1, 0.3, 0.25) : new Color3(0.4, 0.85, 1);
    window.setTimeout(() => line.dispose(), 70);
  }

  (async () => {
    let container;
    try {
      container = await loadCharacters(scene);
    } catch (err) {
      console.error("[assets] character load failed:", err);
      hud.onStatus("asset load failed — see console");
      return;
    }
    if (disposed) {
      container.dispose();
      return;
    }

    try {
      await net.connect({
        onAdd: (p) => {
          if (p.id === net.sessionId) {
            localView = spawnCharacter(scene, container, p.faction);
            localView.root.position.set(p.x, 0, p.z);
            predicted.x = p.x;
            predicted.z = p.z;
            localHp = p.hp;
            hud.onVitals(p.hp, p.score);
          } else {
            const view = spawnCharacter(scene, container, p.faction);
            view.root.position.set(p.x, 0, p.z);
            remotes.set(p.id, { view, buf: [{ t: now(), ...vec(p) }], lastX: p.x, lastZ: p.z, hp: p.hp });
          }
          hud.onPlayers(headcount());
        },
        onRemove: (id) => {
          remotes.get(id)?.view.dispose();
          remotes.delete(id);
          hud.onPlayers(headcount());
        },
        onChange: (p) => {
          if (p.id === net.sessionId) {
            reconcile(p);
            localHp = p.hp;
            localView?.setDowned(p.hp <= 0);
            hud.onVitals(p.hp, p.score);
          } else {
            const r = remotes.get(p.id);
            if (r) {
              r.buf.push({ t: now(), ...vec(p) });
              if (r.buf.length > 30) r.buf.shift();
              r.hp = p.hp;
              r.view.setDowned(p.hp <= 0);
            }
          }
        },
        onShot: spawnTracer,
      });
      hud.onStatus("connected · authoritative");
    } catch (err) {
      console.error("[net] connect failed:", err);
      hud.onStatus("offline — start services/realtime (ws://localhost:2567)");
    }
  })();

  // ---- aim + fire (twin-stick: mouse aims, click fires) ----
  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERMOVE) {
      if (!localView) return;
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m === floor);
      if (pick?.hit && pick.pickedPoint) {
        aimAngle = Math.atan2(pick.pickedPoint.x - localView.root.position.x, pick.pickedPoint.z - localView.root.position.z);
      }
    } else if (info.type === PointerEventTypes.POINTERDOWN) {
      if (localView && localHp > 0) net.sendFire(aimAngle);
    }
  });

  let fpsAcc = 0;
  scene.registerBeforeRender(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);

    if (localView) {
      const { dx, dz } = sampleInput();
      const moving = (dx !== 0 || dz !== 0) && localHp > 0;
      if (moving) {
        const frame: InputFrame = { seq: ++seq, dx, dz, angle: aimAngle, dt };
        const next = stepMovement(predicted, dx, dz, dt);
        predicted.x = next.x;
        predicted.z = next.z;
        pending.push(frame);
        net.sendInput(frame);
      }
      localView.root.position.x += (predicted.x - localView.root.position.x) * 0.5;
      localView.root.position.z += (predicted.z - localView.root.position.z) * 0.5;
      localView.root.rotation.y = aimAngle; // face the cursor
      localView.setMoving(moving);
    }

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
      const x = a.x + (c.x - a.x) * f;
      const z = a.z + (c.z - a.z) * f;
      const speed = Math.hypot(x - r.lastX, z - r.lastZ);
      r.lastX = x;
      r.lastZ = z;
      r.view.root.position.x = x;
      r.view.root.position.z = z;
      r.view.root.rotation.y = a.angle;
      r.view.setMoving(r.hp > 0 && speed > 0.001);
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
    disposed = true;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
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
