/**
 * The 3D engine: scene, cannon, Steve's flight and landing performance,
 * camera and the mid-flight boosts. It never decides money. It receives a
 * finished RoundResult from the server module and performs a flight that
 * lands exactly on it.
 */
import * as THREE from 'three';
import { BOOST_CONFIG, TIER_CONFIG, type BoostKind } from '../core/config';
import { server, type RoundResult } from '../core/server';
import { profile, saveProfile } from '../core/store';
import { suitById, type SuitDef } from '../data/suits';
import { audio } from './audio';
import { buildFlightPlan, sampleAt, type FlightPlan, type FumbleKind } from './flightPlan';
import { ParticleSystem } from './particles';
import { buildSteve, PHYSIQUES, type SteveRig } from './steve';
import { buildCannon, type Cannon } from './cannon';
import { World } from './world';
import { LAUNCH_H } from './constants';
import { isGroundKind, SURFACES } from './flightPlan';
import type { RouteSample } from './route';

export type GameState = 'menu' | 'aiming' | 'betting' | 'flying' | 'landed';

export interface HudInfo {
  distance: number;    // metres
  cash: number;
  speed: number;
  progress: number;
  blowerSeconds: number;
  confetti: number;
  rockets: number;
  litRockets: number;
}

export interface EngineEvents {
  onState(state: GameState): void;
  onHud(info: HudInfo): void;
  onResult(result: RoundResult): void;
  onError(msg: string): void;
  onPull(power: number): void;
  onFumble(kind: FumbleKind): void;
}

interface Impulse { strength: number; remaining: number; duration: number }

const PRONE = -Math.PI / 2;
/** Steve is about 1.65 units tall (a car is 3.8 long); the cannon is sized to fit him. */
const STEVE_SCALE = 0.8;
const SUN_DIR = new THREE.Vector3(-0.12, 0.88, 0.4).normalize();
const CANNON_SCALE = 0.95;
const UPDATE_MARK = 0;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles: ParticleSystem;
  state: GameState = 'menu';
  boostMode: BoostKind | null = null;

  private clock = new THREE.Clock();
  private world: World | null = null;
  private steve: SteveRig | null = null;
  private suit: SuitDef;
  private cannon: Cannon;
  private blob: THREE.Mesh;
  private blower: THREE.Group;
  private blowerFan!: THREE.Group;
  private blowerHum: { stop(): void } | null = null;

  // aiming
  private pointerDown = false;
  private pointerStart = new THREE.Vector2();
  private pull = 0;
  private pointerNdc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  // flight playback
  private plan: FlightPlan | null = null;
  private result: RoundResult | null = null;
  private tau = 0;
  private flightClock = 0;
  private impulses: Impulse[] = [];
  private lift = 0; private liftVel = 0;
  private lateral = 0; private lateralVel = 0;
  private cashPerUnit = 0;
  private camY = LAUNCH_H + 3;
  private landedAt = -1;
  private resultSent = false;
  private menuTime = 0;
  private preroll: { t: number; v0: number; z0: number; dir: THREE.Vector3; from: THREE.Vector3 } | null = null;
  private fumbleShown = false;
  private spin = 0;            // tumbling rotation (rad) about the body's x axis
  private spinRate = 0;

  // boosts inventory for the current round
  private blowerSeconds = 0;
  private blowerActive = false;
  private blowerPos = new THREE.Vector3();
  private confetti = 0;
  private rockets = 0;
  private rocketsLit: { idx: number; age: number; stop: () => void }[] = [];
  private rocketNext = 0;
  private rocketTotal = 0;

  private hud: HudInfo = { distance: 0, cash: 0, speed: 0, progress: 0, blowerSeconds: 0, confetti: 0, rockets: 0, litRockets: 0 };
  private events: EngineEvents;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private rs: RouteSample = { x: 0, z: 0, tx: 0, tz: -1, nx: 1, nz: 0, heading: 0 };
  private rs2: RouteSample = { x: 0, z: 0, tx: 0, tz: -1, nx: 1, nz: 0, heading: 0 };
  private lastPos = new THREE.Vector3();
  private sNow = 0;
  // continuous orientation state (no snapping): forward somersault angle and its target,
  // how prone he is (0 tucked/upright, 1 superman), smoothed flight-path angle, roll wobble
  private flipTarget = 0;
  private spinVel = 0;
  private prone = 0;
  private fpa = 0;
  private rollWob = 0; private rollWobVel = 0;
  private camVel = 0;
  private lastCamTarget = NaN;
  private rootRx = 0;
  private rootY = 0;
  private wasOnGround = false;

  constructor(canvas: HTMLCanvasElement, events: EngineEvents) {
    this.events = events;
    const high = profile.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance', logarithmicDepthBuffer: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color('#d6ebfa');
    this.scene.fog = new THREE.Fog('#d6ebfa', 150, 520);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.2, 2600);

    const hemi = new THREE.HemisphereLight('#e8f6ff', '#9a9a8a', 1.05);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.7);
    // the sun sits high behind the camera, so the stuntman's shadow falls ahead of him on the city
    sun.position.copy(SUN_DIR).multiplyScalar(60);

    const fill = new THREE.DirectionalLight('#e8f0ff', 0.55);
    fill.position.set(10, -30, 20);
    this.scene.add(hemi, sun, fill);

    this.particles = new ParticleSystem(high ? 1400 : 700);
    this.scene.add(this.particles.mesh);

    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0x1b2a10, transparent: true, opacity: 0.14, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);
    this.blob.visible = false;

    this.cannon = buildCannon();
    this.cannon.group.position.y = LAUNCH_H;
    this.cannon.group.scale.setScalar(CANNON_SCALE);
    this.scene.add(this.cannon.group);
    // open on a high shot of the roof and sweep down to the cannon (never from street level)
    this.camera.position.set(7, LAUNCH_H + 11, 12);
    this.camera.lookAt(0, LAUNCH_H + 1.1, -1.5);
    this.blower = this.buildBlower();
    this.blower.visible = false;
    this.scene.add(this.blower);

    this.suit = suitById(profile.selected[profile.tier]);
    this.setSuit(this.suit);
    this.newWorld();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    window.addEventListener('pointermove', e => this.onPointerMove(e));
    window.addEventListener('pointerup', e => this.onPointerUp(e));
    window.addEventListener('pointercancel', e => this.onPointerUp(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- setup
  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 58;
    this.camera.updateProjectionMatrix();
  }

  private buildBlower(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.5, 10), new THREE.MeshLambertMaterial({ color: '#ff7a1a' }));
    body.rotation.x = Math.PI / 2; body.position.z = 0.1;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.0, 10), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
    tube.rotation.x = Math.PI / 2; tube.position.z = -0.6;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.14), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
    handle.position.set(0, 0.42, 0.15);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
    grip.position.set(0, 0.6, 0.05);
    this.blowerFan = new THREE.Group();
    const bladeMat = new THREE.MeshLambertMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.26), bladeMat);
      b.position.y = 0.14;
      const p = new THREE.Group(); p.rotation.z = (i / 4) * Math.PI * 2; p.add(b);
      this.blowerFan.add(p);
    }
    this.blowerFan.position.z = 0.4;
    g.add(body, tube, handle, grip, this.blowerFan);
    return g;
  }

  setSuit(def: SuitDef): void {
    if (this.steve) { this.scene.remove(this.steve.group); this.steve.dispose(); }
    this.suit = def;
    this.steve = buildSteve(def, STEVE_SCALE, PHYSIQUES[def.tier]);
    this.buildShadowProxy();
    this.scene.add(this.steve.group);
    this.placeOnRoof();
  }

  // ---------------------------------------------------------------- planar shadow
  /**
   * The stuntman's shadow: a flattened copy of every part of him projected onto the ground along the
   * sun's direction. A stencil makes overlapping limbs darken only once. It costs a few dozen tiny
   * draws and leaves the city's shaders untouched, so the frame rate does not move.
   */
  private shadowParts: { src: THREE.Mesh; offset: number; count: number }[] = [];
  private shadowGroup = new THREE.Group();
  private shadowMesh: THREE.Mesh | null = null;
  private shadowMat = new THREE.MeshBasicMaterial({
    color: 0x10180c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.IncrementStencilOp,
  });
  private shadowMatrix = new THREE.Matrix4();
  private shadowTmp = new THREE.Matrix4();
  private shadowV = new THREE.Vector3();

  /** One merged mesh holding every part of him; its vertices are re-projected each frame (a single draw). */
  private buildShadowProxy(): void {
    if (this.shadowMesh) { this.shadowGroup.remove(this.shadowMesh); this.shadowMesh.geometry.dispose(); }
    if (!this.shadowGroup.parent) this.scene.add(this.shadowGroup);
    this.shadowParts = [];
    const index: number[] = [];
    let total = 0;
    this.steve!.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      const idx = m.geometry.index;
      if (idx) for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + total);
      else for (let i = 0; i < pos.count; i++) index.push(i + total);
      this.shadowParts.push({ src: m, offset: total, count: pos.count });
      total += pos.count;
    });
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    geo.setIndex(index);
    this.shadowMesh = new THREE.Mesh(geo, this.shadowMat);
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.matrixAutoUpdate = false;
    this.shadowMesh.renderOrder = 5;
    this.shadowGroup.add(this.shadowMesh);
  }

  private updateShadow(p: THREE.Vector3): void {
    if (!this.steve || !this.world || !this.shadowMesh) return;
    // where his centre lands along the sun ray, and the ground height there
    const L = SUN_DIR;
    let gy = this.world.terrain.at(p.x, p.z);
    const onRoof = Math.hypot(p.x, p.z) < 32 && p.z > -6;
    for (let i = 0; i < 2; i++) {
      const k = (p.y - gy) / L.y;
      gy = onRoof ? LAUNCH_H : this.world.terrain.at(p.x - L.x * k, p.z - L.z * k);
    }
    const planeY = gy + 0.24;
    // projection onto y = planeY along L, normalised so w stays 1 (the log depth buffer needs a true w)
    const d = -planeY, ix = L.x / L.y, iz = L.z / L.y;
    this.shadowMatrix.set(
      1, -ix, 0, -ix * d,
      0, 0, 0, -d,
      0, -iz, 1, -iz * d,
      0, 0, 0, 1,
    );
    const alt = Math.max(0, p.y - gy);
    this.shadowMat.opacity = 0.3 * Math.max(0.25, 1 - alt / 140);
    this.steve.group.updateMatrixWorld(true);
    const out = this.shadowMesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = out.array as Float32Array;
    const v = this.shadowV;
    for (const part of this.shadowParts) {
      let vis = part.src.visible && this.steve.group.visible;
      for (let a = part.src.parent; vis && a; a = a.parent) vis = a.visible;
      const src = part.src.geometry.attributes.position;
      if (!vis) { arr.fill(0, part.offset * 3, (part.offset + part.count) * 3); continue; }   // collapsed: draws nothing
      this.shadowTmp.multiplyMatrices(this.shadowMatrix, part.src.matrixWorld);
      const e = this.shadowTmp.elements;
      for (let i = 0; i < part.count; i++) {
        v.fromBufferAttribute(src, i);
        const o = (part.offset + i) * 3;
        arr[o] = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
        arr[o + 1] = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        arr[o + 2] = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
      }
    }
    out.needsUpdate = true;
  }

  /** Called by the UI when the tier/suit selection changes. */
  refreshSelection(): void {
    const def = suitById(profile.selected[profile.tier]);
    if (def.id !== this.suit.id) this.setSuit(def);
    this.updateRocketVisibility();
    if (this.world) this.world.setCashPerUnit(this.menuCashPerUnit());
  }

  private menuCashPerUnit(): number {
    const cfg = TIER_CONFIG[profile.tier];
    return cfg.stake / cfg.baseDistance;
  }

  private async newWorld(): Promise<void> {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    const seed = await server.nextSeedHash();
    this.world = new World({ seed, cashPerUnit: this.menuCashPerUnit(), quality: profile.quality }, this.particles);
    this.scene.add(this.world.group);
  }

  /** Steve standing proudly beside the cannon (menu) */
  private placeOnRoof(): void {
    if (!this.steve) return;
    const s = this.steve;
    s.group.position.set(1.9, LAUNCH_H, -0.3);
    s.group.rotation.set(0, 0.5, 0);
    s.body.position.set(0, 0, 0);
    s.body.rotation.set(0, 0, 0);
    s.root.rotation.set(0, 0, 0);
    s.root.position.set(0, s.stand, 0);
    s.snapPose('hero');
    this.spin = 0; this.spinRate = 0;
  }

  /** Steve tucked in the barrel, only his helmet showing at the muzzle (aiming) */
  private placeInCannon(): void {
    if (!this.steve) return;
    const s = this.steve;
    this.cannon.muzzle(this.tmpV, this.tmpV2);
    const dir = this.tmpV2;
    // the tuck is centred on the pelvis; the head sits about 1.2 units up the body axis
    s.group.position.copy(this.tmpV).addScaledVector(dir, -s.tuckReach * STEVE_SCALE);
    s.group.rotation.set(0, 0, 0);
    s.body.position.set(0, 0, 0);
    s.body.rotation.set(0, 0, 0);
    s.root.position.set(0, 0, 0);
    // body +y (head) along the barrel axis: rotate about x by (elevation - 90°)
    const elev = Math.atan2(dir.y, -dir.z);
    s.root.rotation.set(elev - Math.PI / 2, 0, 0);
    s.snapPose('tuck');
  }

  private updateRocketVisibility(): void {
    if (!this.steve) return;
    const inRound = this.state === 'flying' || this.state === 'landed' || this.state === 'betting';
    const total = inRound ? this.rocketTotal : Math.min(BOOST_CONFIG.rockets.max, profile.boosts.rockets);
    this.steve.rockets.forEach((r, i) => { r.visible = i < total; });
    this.steve.pack.visible = total > 0;
  }

  // ---------------------------------------------------------------- state
  private setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.events.onState(s);
  }

  startPlaying(): void {
    if (this.state !== 'menu') return;
    audio.unlock();
    this.refreshSelection();
    this.placeInCannon();
    this.setState('aiming');
  }

  async toMenu(): Promise<void> {
    this.resetRound();
    await this.newWorld();
    this.placeOnRoof();
    this.setState('menu');
  }

  async playAgain(): Promise<void> {
    this.resetRound();
    await this.newWorld();
    this.refreshSelection();
    this.placeInCannon();
    this.setState('aiming');
  }

  private resetRound(): void {
    this.plan = null; this.result = null; this.tau = 0; this.flightClock = 0;
    this.impulses = []; this.lift = 0; this.liftVel = 0; this.lateral = 0; this.lateralVel = 0;
    this.landedAt = -1; this.resultSent = false; this.preroll = null; this.fumbleShown = false;
    this.spin = 0; this.spinRate = 0; this.sNow = 0;
    this.flipTarget = 0; this.spinVel = 0; this.prone = 0; this.fpa = 0; this.rollWob = 0; this.rollWobVel = 0; this.camVel = 0; this.lastCamTarget = NaN; this.rootRx = 0; this.rootY = 0; this.wasOnGround = false;
    this.blowerActive = false; this.blower.visible = false; this.blowerHum?.stop(); this.blowerHum = null;
    for (const r of this.rocketsLit) r.stop();
    this.rocketsLit = []; this.rocketNext = 0; this.rocketTotal = 0;
    this.boostMode = null;
    this.particles.clear();
    this.cannon.group.visible = true;
    this.cannon.setCharge(0);
    this.pull = 0;
    this.camY = LAUNCH_H + 3;
    this.camera.position.set(0, LAUNCH_H + 2.9, 6);
    this.camera.lookAt(0, LAUNCH_H + 1.7, -7);
  }

  // ---------------------------------------------------------------- launch
  private async launch(power: number): Promise<void> {
    if (!this.steve || !this.world) return;
    this.setState('betting');
    this.cannon.muzzle(this.tmpV, this.tmpV2);
    this.preroll = { t: 0, v0: (0.45 + 0.55 * power) * 75, z0: this.tmpV.z, dir: this.tmpV2.clone(), from: this.tmpV.clone() };
    this.cannon.setCharge(0);
    this.cannon.fire();
    audio.boom();
    this.particles.emit({ pos: this.tmpV.clone(), vel: this.tmpV2.clone().multiplyScalar(9), spread: 3, count: 50, life: 1.4, size: 1.0, endSize: 2.6, colors: ['#ffffff', '#e9e4da', '#cfc9bf'], drag: 1.6 });
    this.particles.emit({ pos: this.tmpV.clone(), vel: this.tmpV2.clone().multiplyScalar(14), spread: 4, count: 24, life: 0.5, size: 0.35, endSize: 0.05, colors: ['#ffd27f', '#fff1a8', '#ff9a3c'], drag: 2 });
    this.spin = -(Math.atan2(this.tmpV2.y, -this.tmpV2.z) - Math.PI / 2); this.spinRate = 10 + power * 4;
    this.spinVel = this.spinRate; this.flipTarget = this.spin; this.prone = 0;
    this.steve.setPose('tuck', 12);
    this.steve.root.position.set(0, 0, 0);

    const boosts = { ...profile.boosts };
    let result: RoundResult;
    try {
      // THE bet. Everything that follows is decided by this one call.
      result = await server.placeBet({ tier: profile.tier, suitId: this.suit.id, boosts, clientSeed: profile.clientSeed });
    } catch (e) {
      this.events.onError((e as Error).message);
      this.preroll = null;
      this.placeInCannon();
      this.setState('aiming');
      return;
    }
    this.blowerSeconds = boosts.blower;
    this.confetti = boosts.confetti;
    this.rockets = boosts.rockets;
    this.rocketTotal = boosts.rockets;
    profile.boosts = { blower: 0, confetti: 0, rockets: 0 };
    profile.rounds++;
    saveProfile();

    this.result = result;
    const world = this.world;
    const plan = buildFlightPlan({ seed: result.worldSeed, distanceMetres: result.distance, power, angle: 0.3 + 0.7 * power, style: this.suit.flight, surfaceAt: q => world.surfaceAt(q) });
    this.plan = plan;
    this.cashPerUnit = result.payout / plan.L;
    this.world.setPlan(plan, this.cashPerUnit);
    this.updateRocketVisibility();
    // pick up the plan at the distance the pre-roll has already covered, so there is no jump
    const g = this.steve.group;
    const covered = this.preroll ? Math.max(0, this.preroll.z0 - g.position.z) : 0;
    this.sNow = covered;
    this.preroll = null;
    let tau = 0;
    while (tau < plan.T && sampleAt(plan.s, plan.dt, tau) < covered) tau += plan.dt;
    this.tau = Math.min(tau, plan.T);
    // absorb any height difference between the pre-roll and the plan with the lift spring
    this.lift = (g.position.y - sampleAt(plan.h, plan.dt, this.tau)) / 0.8;
    this.flightClock = 0;
    this.fumbleShown = false;
    this.setState('flying');
    if (plan.fumble) this.events.onFumble(plan.fumble);
  }

  // ---------------------------------------------------------------- input
  private ndcFromEvent(e: PointerEvent): void {
    this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  private pointerToWorld(e: PointerEvent, out: THREE.Vector3): boolean {
    if (!this.steve) return false;
    this.ndcFromEvent(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    // a vertical plane just behind Steve, facing back along the route
    const r = this.world ? this.world.route.at(this.sNow, this.rs) : this.rs;
    const normal = new THREE.Vector3(-r.tx, 0, -r.tz);
    const point = this.steve.group.position.clone().addScaledVector(normal, 1.1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    return !!this.raycaster.ray.intersectPlane(plane, out);
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.state === 'menu') { this.startPlaying(); return; }
    if (this.state === 'aiming') {
      this.pointerDown = true;
      this.pointerStart.set(e.clientX, e.clientY);
      this.pull = 0;
      audio.unlock();
      return;
    }
    if (this.state === 'flying') {
      if (this.boostMode === 'blower' && this.blowerSeconds > 0) {
        if (this.pointerToWorld(e, this.blowerPos)) { this.blowerActive = true; this.pointerDown = true; this.blower.visible = true; if (!this.blowerHum) this.blowerHum = audio.hum(); }
      } else if (this.boostMode === 'confetti' && this.confetti > 0) {
        if (this.pointerToWorld(e, this.tmpV)) this.fireConfetti(this.tmpV.clone());
      } else if (this.boostMode === 'rockets' && this.rockets > 0) {
        this.lightRocket();
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.state === 'aiming' && this.pointerDown) {
      const dy = e.clientY - this.pointerStart.y;
      const dx = e.clientX - this.pointerStart.x;
      const along = Math.max(0, dy) + Math.abs(dx) * 0.15;
      this.pull = Math.min(1, along / (window.innerHeight * 0.3));
      this.cannon.setCharge(this.pull);
      this.events.onPull(this.pull);
    } else if (this.state === 'flying' && this.blowerActive) {
      this.pointerToWorld(e, this.blowerPos);
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (this.state === 'aiming' && this.pointerDown) {
      this.pointerDown = false;
      const p = this.pull;
      this.events.onPull(0);
      if (p < 0.08) { this.pull = 0; this.cannon.setCharge(0); return; }
      this.pull = 0;
      void this.launch(p);
      return;
    }
    if (this.blowerActive) {
      this.blowerActive = false; this.pointerDown = false;
      this.blower.visible = false;
      this.blowerHum?.stop(); this.blowerHum = null;
    }
  }

  // ---------------------------------------------------------------- boosts
  private pushComponents(from: THREE.Vector3): { forward: number; lift: number; lateral: number; falloff: number } {
    const P = this.steve!.group.position;
    const d = this.tmpV2.copy(P).sub(from);
    const dist = d.length();
    if (dist < 1e-3) return { forward: 0, lift: 0, lateral: 0, falloff: 0 };
    d.divideScalar(dist);
    const r = this.world ? this.world.route.at(this.sNow, this.rs) : this.rs;
    const falloff = Math.max(0, 1 - Math.max(0, dist - 0.8) / 4.0);
    const forward = Math.max(0, d.x * r.tx + d.z * r.tz);
    const lateral = d.x * r.nx + d.z * r.nz;
    return { forward, lift: Math.max(0, d.y), lateral, falloff };
  }

  private fireConfetti(at: THREE.Vector3): void {
    if (this.confetti <= 0 || !this.steve) return;
    this.confetti--;
    audio.pop();
    const P = this.steve.group.position;
    const dir = P.clone().sub(at).normalize();
    this.particles.emit({ pos: at, vel: dir.clone().multiplyScalar(9), spread: 4, count: 70, life: 1.6, size: 0.16, endSize: 0.12, colors: ['#f26b6b', '#f2c14e', '#5fb8e6', '#7bc96f', '#e5679a', '#ffffff'], drag: 1.6, gravity: 4, spin: 14 });
    const c = this.pushComponents(at);
    const k = c.falloff * this.speedFactor();
    this.impulses.push({ strength: 1.7 * c.forward * k, remaining: 0.9, duration: 0.9 });
    this.liftVel += 5 * c.lift * k;
    this.lateralVel += 4 * c.lateral * k;
  }

  private lightRocket(): void {
    if (this.rockets <= 0 || !this.steve) return;
    this.rockets--;
    const idx = this.rocketNext++;
    const stop = audio.fizz(1.4);
    this.rocketsLit.push({ idx, age: 0, stop });
    const k = this.speedFactor();
    this.impulses.push({ strength: 1.0 * k, remaining: 1.4, duration: 1.4 });
    this.liftVel += 0.8 * k;
  }

  /** Boosts only work in proportion to how fast Steve is already going. */
  private speedFactor(): number {
    if (!this.plan) return 0;
    const v = sampleAt(this.plan.v, this.plan.dt, this.tau);
    return Math.min(1.2, v / this.plan.v0);
  }

  setBoostMode(mode: BoostKind | null): void {
    if (this.boostMode === 'blower' && mode !== 'blower' && this.blowerActive) this.onPointerUp(new PointerEvent('pointerup'));
    this.boostMode = mode;
  }

  // ---------------------------------------------------------------- frame
  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.menuTime += dt;
    this.cannon.update(dt, this.menuTime);
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'aiming') this.updateAiming(dt);
    else if (this.state === 'betting') this.updatePreroll(dt);
    else if (this.state === 'flying') this.updateFlight(dt);
    else this.updateLanded(dt);

    this.world?.update(dt, this.sNow, this.camera.position, this.tau, this.state === 'flying' || this.state === 'betting');
    this.particles.update(dt, this.camera);
    if (this.steve) {
      // feed the rig its world velocity for the cape and the rag-doll lag
      const p = this.steve.group.position;
      if (dt > 0) this.steve.velocity.copy(p).sub(this.lastPos).divideScalar(dt);
      this.lastPos.copy(p);
      this.steve.update(dt, this.menuTime);
      const onRoof = Math.hypot(p.x, p.z) < 32 && p.z > -6;
      const ground = onRoof ? LAUNCH_H : (this.world ? this.world.terrain.at(p.x, p.z) : 0);
      this.blob.position.set(p.x, ground + 0.08, p.z);
      this.updateShadow(p);
      const rel = p.y - ground;
      const sc = Math.max(0.5, 1.4 - rel * 0.02);
      this.blob.scale.set(sc * 1.1, sc, 1);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.max(0, 1 - rel / 40);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number): void {
    if (!this.steve) return;
    const t = this.menuTime;
    // a little idle sway and a wave now and then
    this.steve.body.rotation.set(0, Math.sin(t * 0.7) * 0.06, Math.sin(t * 1.1) * 0.02);
    const a = Math.sin(t * 0.18) * 0.9;
    // portrait screens see a narrower slice, so step back and frame the stuntman beside the cannon
    const portrait = Math.min(1, this.camera.aspect * 1.5);
    const rad = 4.6 / Math.max(0.55, portrait);
    const target = new THREE.Vector3(Math.sin(a) * rad, LAUNCH_H + 1.9 + (rad - 4.6) * 0.35 + Math.sin(t * 0.3) * 0.2, Math.cos(a) * rad + 1.2);
    this.camera.position.lerp(target, Math.min(1, dt * 1.5));
    this.camera.lookAt(0.6 + (1 - portrait) * 3.6, LAUNCH_H + 1.1, -1.0);
  }

  private updateAiming(dt: number): void {
    if (!this.steve) return;
    const p = this.pull;
    this.placeInCannon();
    const target = new THREE.Vector3(1.6, LAUNCH_H + 4.4, 7.6 + p * 1.0);
    this.camera.position.lerp(target, Math.min(1, dt * 4));
    this.camera.lookAt(0, LAUNCH_H + 2.4, -7);
  }

  /** While the bet resolves Steve is already out of the barrel and climbing. */
  private updatePreroll(dt: number): void {
    if (!this.steve || !this.preroll) return;
    const p = this.preroll;
    p.t += dt;
    const g = this.steve.group;
    g.position.copy(p.from).addScaledVector(p.dir, p.v0 * p.t);
    g.rotation.set(0, 0, 0);
    this.spin += this.spinRate * dt;
    this.steve.root.rotation.set(-this.spin, 0, 0);
    this.steve.body.position.set(0, 0, 0);
    this.steve.body.rotation.set(0, 0, 0);
    const vNorm = Math.min(1, p.v0 / 60);
    const targetY = g.position.y + 1.35 + vNorm * 0.85;
    this.camY += (targetY - this.camY) * Math.min(1, dt * 3);
    this.camera.position.set(0, this.camY, g.position.z + 3.6 + vNorm * 2.4);
    this.camera.lookAt(0, g.position.y - 0.5, g.position.z - 14);
  }

  private updateFlight(dt: number): void {
    if (!this.plan || !this.steve || !this.result) return;
    const plan = this.plan;
    const steve = this.steve;
    this.flightClock += dt;

    // ---- boosts: blower (continuous), impulses (confetti / rockets)
    let rate = 1;
    if (this.blowerActive && this.blowerSeconds > 0) {
      this.blowerSeconds = Math.max(0, this.blowerSeconds - dt);
      const c = this.pushComponents(this.blowerPos);
      const k = c.falloff * this.speedFactor();
      rate += 0.85 * c.forward * k;
      this.liftVel += 9 * c.lift * k * dt;
      this.lateralVel += 7 * c.lateral * k * dt;
      this.blower.position.copy(this.blowerPos);
      this.blower.lookAt(steve.group.position);
      this.blowerFan.rotation.z += dt * 45;
      if (Math.random() < 0.9) {
        const dir = this.tmpV.copy(steve.group.position).sub(this.blowerPos).normalize();
        this.particles.emit({ pos: this.blowerPos.clone().addScaledVector(dir, 1.1), vel: dir.multiplyScalar(11), spread: 1.2, count: 2, life: 0.45, size: 0.12, endSize: 0.02, colors: ['#ffffff', '#e6f3ff', '#c9d86a'], drag: 1 });
      }
      if (this.blowerSeconds <= 0) { this.onPointerUp(new PointerEvent('pointerup')); }
    }
    for (const im of this.impulses) {
      const env = Math.sin(Math.PI * Math.min(1, 1 - im.remaining / im.duration)) ** 0.5;
      rate += im.strength * env;
      im.remaining -= dt;
    }
    this.impulses = this.impulses.filter(i => i.remaining > 0);
    if (this.tau >= plan.T) rate = 1;

    // ---- advance plan time (only the rate is affected by boosts; the end point is fixed)
    this.tau = Math.min(plan.T + 0.001, this.tau + dt * rate);
    const s = sampleAt(plan.s, plan.dt, this.tau);
    const v = sampleAt(plan.v, plan.dt, this.tau);
    const h = sampleAt(plan.h, plan.dt, this.tau);

    // ---- events: every reaction is a smooth, physical response (a somersault, a wobble), never a snap
    const vyNow = sampleAt(plan.vy, plan.dt, this.tau);
    for (const eo of this.world!.events) {
      if (!eo.triggered && this.tau >= eo.event.t) {
        eo.trigger();
        const kind = eo.event.kind;
        const mag = Math.min(1.5, Math.abs(eo.event.delta) / plan.v0 * 3);   // how big a deal this hit is
        if (kind === 'dumpster' || kind === 'hay') { audio.bonk(); audio.whoosh(0.5, 0.7, 0.8); }
        else if (eo.event.delta > 0) {
          audio.boing();
          // a bounce pad or a strong boost throws him into a forward somersault
          if (isGroundKind(kind) || mag > 0.6) this.flipTarget = Math.ceil((this.spin + 0.01) / (Math.PI * 2)) * Math.PI * 2 + (mag > 1.1 ? Math.PI * 2 : 0);
          this.particles.emit({ pos: steve.group.position.clone(), vel: new THREE.Vector3(0, 1, 0), spread: 2, count: 10 + Math.round(mag * 16), life: 0.6, size: 0.18, endSize: 0.02, colors: ['#ffffff', '#fff3c4'], drag: 1.5 });
        } else {
          audio.bonk();
          if (isGroundKind(kind) || mag > 0.7) this.flipTarget = Math.ceil((this.spin + 0.01) / (Math.PI * 2)) * Math.PI * 2;
          // a knock to the side: a damped roll wobble, scaled by the hit
          this.rollWobVel += (Math.random() < 0.5 ? -1 : 1) * (3 + mag * 5);
          this.particles.emit({ pos: steve.group.position.clone(), vel: new THREE.Vector3(0, 1.5, 0), spread: 2.2, count: 6 + Math.round(mag * 10), life: 0.9, size: 0.26, endSize: 0.08, colors: ['#ffd166', '#ffffff', '#ff9a3c'], drag: 1.2, spin: 8 });
        }
      }
    }

    // ---- lift / lateral springs (visual response to the player's boosts)
    this.liftVel += (-this.lift * 6 - this.liftVel * 2.5) * dt;
    this.lift += this.liftVel * dt;
    this.lateralVel += (-this.lateral * 5 - this.lateralVel * 2.2) * dt;
    this.lateral += this.lateralVel * dt;
    this.rollWobVel += (-this.rollWob * 28 - this.rollWobVel * 4.5) * dt;
    this.rollWob += this.rollWobVel * dt;

    // ---- in-frame sway by suit personality plus slow Disney-style gusts (body offsets only; he always faces forward)
    const t = this.tau;
    const st = this.suit.flight;
    let sx = 0, sy = 0, roll = 0, yaw = 0, pitch = 0;
    switch (st) {
      case 'steady': sx = 0.22 * Math.sin(t * 0.55); sy = 0.12 * Math.sin(t * 0.75 + 1); roll = 0.1 * Math.sin(t * 0.55 + 1); break;
      case 'swoop': sy = 0.45 * Math.sin(t * 0.5); pitch = 0.18 * Math.cos(t * 0.5); sx = 0.25 * Math.sin(t * 0.35); roll = 0.12 * Math.sin(t * 0.35); break;
      case 'rockabye': roll = 0.4 * Math.sin(t * 1.0); sx = 0.4 * Math.sin(t * 1.0 - 0.6); sy = 0.08 * Math.sin(t * 2.0); break;
      case 'twirl': {
        roll = 0.15 * Math.sin(t * 0.7);
        const period = 6.5, u = (t % period) / period;
        if (u > 0.75) { const q = (u - 0.75) / 0.25; roll += Math.PI * 2 * (q * q * (3 - 2 * q)); }
        sx = 0.28 * Math.sin(t * 0.6); sy = 0.12 * Math.sin(t * 0.8);
        break;
      }
      case 'flutter': sy = 0.1 * Math.sin(t * 2.6) + 0.08 * Math.sin(t * 1.7); sx = 0.16 * Math.sin(t * 2.2); pitch = 0.06 * Math.sin(t * 2.6); roll = 0.12 * Math.sin(t * 1.9); break;
      case 'dart': sx = 0.1 * Math.sin(t * 1.8); roll = 0.05 * Math.sin(t * 1.4); sy = 0.05 * Math.sin(t * 1.2); break;
      case 'drift': sx = 0.8 * Math.sin(t * 0.45) + 0.3 * Math.sin(t * 1.0); roll = 0.25 * Math.cos(t * 0.45); sy = 0.12 * Math.sin(t * 0.7); break;
    }
    const windX = 0.45 * Math.sin(t * 0.37 + 1.7) + 0.25 * Math.sin(t * 0.83 + 0.4);
    const windY = 0.3 * Math.sin(t * 0.52 + 2.6) + 0.14 * Math.sin(t * 1.21);
    sx += windX; sy += windY; roll += windX * 0.18; pitch += windY * 0.15;
    yaw = THREE.MathUtils.clamp(windX * 0.04, -0.05, 0.05);   // he always faces down the line
    const grounded = this.tau >= plan.landT;
    const air = grounded ? Math.max(0, 1 - (this.tau - plan.landT) / 0.3) : 1;
    sx *= air; sy *= air; roll *= air; yaw *= air; pitch *= air;

    // ---- somersault state: launch tumble, then a spring that settles on whole turns
    const launching = this.tau < plan.tuckTime;
    if (plan.fumble) {
      const target = plan.fumble === 'spinout' ? 16 : plan.fumble === 'fizzle' ? 3 : 7;
      this.spinVel += (target - this.spinVel) * Math.min(1, dt * 2);
      this.spin += this.spinVel * dt;
      this.flipTarget = this.spin;
      if (!this.fumbleShown && t > 0.2) { this.fumbleShown = true; audio.bonk(); }
    } else if (grounded) {
      // tumbling along the ground: rotation rate follows ground speed, so a fast landing tumbles longer and faster
      this.spinVel = Math.min(13, v / 1.0);
      this.spin += this.spinVel * dt;
      this.flipTarget = this.spin;
    } else if (launching) {
      this.spinVel += (this.spinRate * 0.85 - this.spinVel) * Math.min(1, dt * 2);
      this.spin += this.spinVel * dt;
      this.flipTarget = Math.ceil(this.spin / (Math.PI * 2)) * Math.PI * 2;
    } else {
      // critically damped spring toward the target turn
      const w = 7;
      this.spinVel += (w * w * (this.flipTarget - this.spin) - 2 * w * this.spinVel) * dt;
      this.spin += this.spinVel * dt;
    }
    const flipping = !grounded && !launching && Math.abs(this.flipTarget - this.spin) > 0.7;
    // prone (superman) blends in after the launch tuck and stays; no instant attitude changes
    const proneTarget = launching || plan.fumble ? 0 : 1;
    this.prone += (proneTarget - this.prone) * Math.min(1, dt * 4);
    // flight-path angle straight from the plan's velocity, smoothed through contacts
    const fpaTarget = THREE.MathUtils.clamp(Math.atan2(vyNow, Math.max(2, v)), -1.1, 1.1);
    this.fpa += (fpaTarget - this.fpa) * Math.min(1, dt * 6);

    // ---- pose follows the physics
    if (plan.fumble) steve.setPose(plan.fumble === 'spinout' ? 'tuck' : 'flail', 6);
    else if (grounded) steve.setPose('tumble', 10);
    else if (launching || flipping) steve.setPose('tuck', 10);
    else if (vyNow < -0.5) steve.setPose('squirrel', 3.5);
    else steve.setPose('superman', 4);

    // ---- place Steve on the flight line (straight down the route; he never turns)
    const g = steve.group;
    this.sNow = s;
    const r = this.world!.route.at(s, this.rs);
    const ground = this.world!.terrain.at(r.x, r.z);
    g.position.set(r.x, ground + h + this.lift * 0.8, r.z);
    g.rotation.set(0, r.heading, 0);
    const body = steve.body;
    body.position.set(sx + this.lateral, sy, 0);
    body.rotation.set(0, yaw, roll + this.rollWob * 0.35 - (sx + this.lateral) * 0.2);
    // one continuous attitude: prone + flight path + sway pitch − somersault
    this.rootRx = PRONE * this.prone + this.fpa * 0.9 * this.prone + pitch * 0.2 - this.spin;
    // on the ground the tumbling body rides on its own radius so it never sinks into the road
    const rootYTarget = grounded ? 0.62 : plan.fumble ? 0.3 : 0;
    this.rootY += (rootYTarget - this.rootY) * Math.min(1, dt * 10);
    steve.root.rotation.set(this.rootRx, 0, 0);
    steve.root.position.set(0, this.rootY, 0);
    if ((grounded && plan.ending === 'sprawl') || plan.fumble) this.groundClamp(ground);

    // ---- ground contact dust, sized by speed and surface
    if (grounded && plan.ending === 'sprawl') {
      const onGround = h < 0.12;
      const surf = SURFACES[plan.surface];
      if (onGround && !this.wasOnGround) {
        const strength = Math.min(1.5, (Math.abs(vyNow) + v * 0.2) / 10);
        this.particles.emit({ pos: g.position.clone(), vel: new THREE.Vector3(0, 1.0, -v * 0.15), spread: 1.4, count: 10 + Math.round(strength * 22), life: 0.8, size: 0.14, endSize: 0.42, colors: surf.dust, drag: 2.4 });
        if (!this.wasOnGround && this.tau - plan.landT < 0.05) audio.bonk();
      } else if (onGround && v > 3 && Math.random() < dt * 14) {
        this.particles.emit({ pos: g.position.clone(), vel: new THREE.Vector3(0, 0.5, -v * 0.1), spread: 0.6, count: 1, life: 0.55, size: 0.1, endSize: 0.32, colors: surf.dust, drag: 2.6 });
      }
      this.wasOnGround = onGround;
    }

    // ---- bottle rockets (visual jets)
    for (const rk of this.rocketsLit) {
      rk.age += dt;
      const tip = steve.rocketTips[rk.idx];
      if (tip && rk.age < 1.4) {
        tip.getWorldPosition(this.tmpV);
        this.particles.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.4, 6), spread: 2.2, count: 4, life: 0.35, size: 0.06, endSize: 0.01, colors: ['#fff7b0', '#ffd166', '#ffffff', '#ff9a3c'], drag: 2 });
      }
    }
    this.rocketsLit = this.rocketsLit.filter(rk => rk.age < 1.6);
    // Heatseeker Hank's rocket shoes: a steady exhaust while he is airborne and not tumbling
    if (steve.shoeNozzles.length && !grounded && !plan.fumble && !launching) {
      for (const nz of steve.shoeNozzles) {
        nz.getWorldPosition(this.tmpV);
        nz.getWorldDirection(this.tmpV2).multiplyScalar(4);
        this.particles.emit({ pos: this.tmpV, vel: this.tmpV2, spread: 0.5, count: 2, life: 0.32, size: 0.07, endSize: 0.01, colors: ['#ffb347', '#ffd27f', '#ff7a1a', '#ffffff'], drag: 3 });
      }
    }

    // ---- camera: on the line behind Steve, looking straight down it; height on a smooth spring
    const vNorm = Math.min(1, v / 60);
    const targetY = g.position.y + 1.35 + vNorm * 0.85;
    // critically damped spring that also matches the target's own vertical speed, so a steady
    // fall is tracked with no lag; only sudden kicks are softened
    const targetVel = Number.isNaN(this.lastCamTarget) || dt <= 0 ? 0 : (targetY - this.lastCamTarget) / dt;
    this.lastCamTarget = targetY;
    const cw = 6;
    this.camVel += (cw * cw * (targetY - this.camY) + 2 * cw * (targetVel - this.camVel)) * dt;
    this.camY += this.camVel * dt;
    const back = 3.6 + vNorm * 2.4;
    const cb = this.world!.route.at(Math.max(0, s - back), this.rs2);
    const floor = this.world!.terrain.at(cb.x, cb.z) + 1.2;
    if (this.camY < floor) { this.camY = floor; this.camVel = Math.max(0, this.camVel); }
    this.camera.position.set(cb.x, this.camY, cb.z);
    const la = this.world!.route.at(s + 14, this.rs2);
    // look a little along the trajectory: further down while diving, so he stays in frame
    const lookDrop = THREE.MathUtils.clamp(vyNow * 0.35, -6, 2);
    this.camera.lookAt(la.x, g.position.y - 0.5 + lookDrop, la.z);

    this.cannon.group.visible = s < 80;
    void UPDATE_MARK;

    // ---- HUD
    const progress = s / plan.L;
    this.hud.distance = progress * this.result.distance;
    this.hud.cash = s * this.cashPerUnit;
    this.hud.speed = v * rate;
    this.hud.progress = progress;
    this.hud.blowerSeconds = this.blowerSeconds;
    this.hud.confetti = this.confetti;
    this.hud.rockets = this.rockets;
    this.hud.litRockets = this.rocketsLit.length;
    this.events.onHud(this.hud);

    // ---- touchdown: hand over to the landing performance
    if (this.tau >= plan.T) {
      this.landedAt = 0;
      this.hud.distance = this.result.distance;
      this.hud.cash = this.result.payout;
      this.events.onHud(this.hud);
      this.setState('landed');
    }
  }

  /**
   * After the plan ends: the comedy. Sprawl, come round, get up gingerly,
   * brush off, strike the pose. Or climb out of whatever he landed in.
   */
  /**
   * Keep every part of Steve above the road: measure his lowest point and lift the body if any
   * limb would dip below. Used while tumbling on the ground and lying/sitting/standing after.
   */
  private groundClamp(groundY: number): void {
    const steve = this.steve!;
    steve.group.updateMatrixWorld(true);
    let minY = Infinity;
    const box = this.clampBox;
    steve.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible || m === steve.cape) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      if (box.min.y < minY) minY = box.min.y;
    });
    const gap = minY - (groundY + 0.01);
    if (gap < 0) {
      steve.root.position.y -= gap / steve.group.scale.y;
      steve.group.updateMatrixWorld(true);
    }
  }
  private clampBox = new THREE.Box3();

  private updateLanded(dt: number): void {
    if (!this.plan || !this.steve || !this.result) return;
    const plan = this.plan;
    const steve = this.steve;
    this.landedAt += dt;
    const T = this.landedAt;
    const g = steve.group;
    const body = steve.body;
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    const ending = plan.fumble ? 'sprawl' : plan.ending;
    let done = 5.0;

    if (ending === 'sprawl') {
      // whole turns so he lands flat, then the recovery routine
      if (T < 1.1) {
        steve.setPose('sprawl', 8);
        // roll on (never back) to the nearest "flat on his back" attitude, and settle onto the road
        const back = Math.PI / 2 + Math.floor((this.rootRx - Math.PI / 2) / (Math.PI * 2)) * Math.PI * 2;
        this.rootRx += (back - this.rootRx) * Math.min(1, dt * 7);
        this.rootY += (0.12 - this.rootY) * Math.min(1, dt * 8);
        steve.root.rotation.set(this.rootRx, 0, 0);
        steve.root.position.set(0, this.rootY, 0);
        if (Math.random() < dt * 6) {
          // little stars circling the head
          const a = Math.random() * Math.PI * 2;
          this.particles.emit({ pos: this.tmpV.set(g.position.x + Math.cos(a) * 0.4, g.position.y + 0.6, g.position.z + 0.7 + Math.sin(a) * 0.3), vel: new THREE.Vector3(-Math.sin(a) * 1.0, 0.15, Math.cos(a) * 1.0), spread: 0.1, count: 1, life: 1.2, size: 0.15, endSize: 0.04, colors: ['#ffd166', '#ffffff'], drag: 0.2, spin: 6 });
        }
      } else if (T < 2.1) {
        steve.setPose('sit', 5);
        const k = Math.min(1, (T - 1.1) / 0.8);
        steve.root.rotation.set((Math.PI / 2) * (1 - k) * 0.3, 0, 0);
        steve.root.position.set(0, 0.18 + 0.37 * k, 0);
        this.spin = 0;
      } else if (T < 2.9) {
        steve.setPose('gingerly', 4);
        const k = Math.min(1, (T - 2.1) / 0.8);
        steve.root.rotation.set(0, 0, 0);
        steve.root.position.set(0, 0.55 + (steve.stand - 0.55) * (k * k * (3 - 2 * k)), 0);
      } else if (T < 3.5) { steve.setPose('brushL', 7); steve.root.position.set(0, steve.stand, 0); }
      else if (T < 4.1) { steve.setPose('brushR', 7); }
      else if (T < 4.5) { steve.setPose('gingerly', 8); steve.root.rotation.set(0, Math.sin((T - 4.1) * 25) * 0.25, 0); }
      else { steve.setPose('hero', 6); steve.root.rotation.set(0, 0, 0); }
      // the routine sets a nominal height; the clamp lifts him wherever a limb would go through the road
      this.groundClamp(this.world!.terrain.at(g.position.x, g.position.z));
      done = 5.4;
    } else if (ending === 'dumpster') {
      // hidden under the lid, then pops up in triumph
      if (T < 1.4) { g.visible = false; }
      else {
        g.visible = true;
        steve.setPose('triumph', 7);
        steve.root.rotation.set(0, 0, 0);
        const k = Math.min(1, (T - 1.4) / 0.4);
        g.position.y = 0.3 + 0.9 * k;            // waist at the rim
        steve.root.position.set(0, steve.stand, 0);
        this.spin = 0;
        if (T > 2.4) steve.setPose('hero', 6);
      }
      done = 3.6;
    } else {
      // hay: legs kicking out of the pile, then up on top of it
      if (T < 1.5) {
        steve.setPose('flail', 8);
        steve.root.rotation.set(Math.PI + Math.sin(T * 6) * 0.2, 0, 0);
        steve.root.position.set(0, -0.6, 0);
        g.position.y = 2.6;
      } else {
        steve.setPose(T < 2.4 ? 'triumph' : 'hero', 6);
        steve.root.rotation.set(0, 0, 0);
        const k = Math.min(1, (T - 1.5) / 0.4);
        steve.root.position.set(0, steve.stand, 0);
        g.position.y = 2.6 + 1.2 * k;
        this.spin = 0;
      }
      done = 3.8;
    }

    // stay on the chase camera, settled behind him on the route, trained on Steve
    const cb = this.world!.route.at(Math.max(0, this.sNow - 4.5), this.rs2);
    const camFloor = this.world!.terrain.at(cb.x, cb.z) + 1.2;
    this.camera.position.lerp(this.tmpV3.set(cb.x, Math.max(camFloor, g.position.y + 1.9), cb.z), Math.min(1, dt * 2.5));
    this.camera.lookAt(g.position.x, g.position.y + 0.3, g.position.z);

    if (!this.resultSent && T > done) {
      this.resultSent = true;
      this.events.onResult(this.result);
    }
  }
}
