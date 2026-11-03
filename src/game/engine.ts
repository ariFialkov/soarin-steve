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
import { buildSteve, type SteveRig } from './steve';
import { buildCannon, type Cannon } from './cannon';
import { World } from './world';
import { LAUNCH_H } from './constants';
import { isGroundKind } from './flightPlan';
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
  private bonk = 0;
  private cashPerUnit = 0;
  private camY = LAUNCH_H + 3;
  private landedAt = -1;
  private resultSent = false;
  private menuTime = 0;
  private preroll: { t: number; v0: number; z0: number; dir: THREE.Vector3; from: THREE.Vector3 } | null = null;
  private fumbleShown = false;
  private spin = 0;            // tumbling rotation (rad) about the body's x axis
  private spinRate = 0;
  private bounceSpinUntil = -1;

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
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, events: EngineEvents) {
    this.events = events;
    const high = profile.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color('#d6ebfa');
    this.scene.fog = new THREE.Fog('#d6ebfa', 150, 520);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.2, 2600);

    const hemi = new THREE.HemisphereLight('#e8f6ff', '#9a9a8a', 1.05);
    const sun = new THREE.DirectionalLight('#fff4d6', 1.7);
    sun.position.set(-30, 50, -25);
    const fill = new THREE.DirectionalLight('#e8f0ff', 0.55);
    fill.position.set(10, -30, 20);
    this.scene.add(hemi, sun, fill);

    this.particles = new ParticleSystem(high ? 1400 : 700);
    this.scene.add(this.particles.mesh);

    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0x1b2a10, transparent: true, opacity: 0.14, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);

    this.cannon = buildCannon();
    this.cannon.group.position.y = LAUNCH_H;
    this.cannon.group.scale.setScalar(1.4);
    this.scene.add(this.cannon.group);
    // open on a high shot of the roof and sweep down to the cannon (never from street level)
    this.camera.position.set(9, LAUNCH_H + 14, 16);
    this.camera.lookAt(0, LAUNCH_H + 1.5, -2);
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
    this.steve = buildSteve(def);
    this.steve.group.scale.setScalar(1.45);
    this.scene.add(this.steve.group);
    this.placeOnRoof();
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
    s.group.position.set(2.6, LAUNCH_H, -0.6);
    s.group.rotation.set(0, 0.5, 0);
    s.body.position.set(0, 0, 0);
    s.body.rotation.set(0, 0, 0);
    s.root.rotation.set(0, 0, 0);
    s.root.position.set(0, 0.95, 0);
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
    s.group.position.copy(this.tmpV).addScaledVector(dir, -1.35);
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
    this.bonk = 0; this.landedAt = -1; this.resultSent = false; this.preroll = null; this.fumbleShown = false;
    this.spin = 0; this.spinRate = 0; this.bounceSpinUntil = -1; this.sNow = 0; this.shake = 0;
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
    this.spin = -(Math.atan2(this.tmpV2.y, -this.tmpV2.z) - Math.PI / 2); this.spinRate = 11 + power * 5;
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
    const plan = buildFlightPlan({ seed: result.worldSeed, distanceMetres: result.distance, power, angle: 0.3 + 0.7 * power, style: this.suit.flight });
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
    const point = this.steve.group.position.clone().addScaledVector(normal, 1.6);
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
    const falloff = Math.max(0, 1 - Math.max(0, dist - 1.2) / 5.5);
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
      const rel = p.y - ground;
      const sc = Math.max(0.5, 1.4 - rel * 0.02);
      this.blob.scale.set(sc * 1.1, sc, 1);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.max(0, 1 - rel / 40);
    }
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number): void {
    if (!this.steve) return;
    const t = this.menuTime;
    // a little idle sway and a wave now and then
    this.steve.body.rotation.set(0, Math.sin(t * 0.7) * 0.06, Math.sin(t * 1.1) * 0.02);
    const a = Math.sin(t * 0.18) * 0.9;
    const target = new THREE.Vector3(Math.sin(a) * 6.5, LAUNCH_H + 2.6 + Math.sin(t * 0.3) * 0.3, Math.cos(a) * 6.5 + 1.5);
    this.camera.position.lerp(target, Math.min(1, dt * 1.5));
    this.camera.lookAt(0.8, LAUNCH_H + 1.6, -1.5);
  }

  private updateAiming(dt: number): void {
    if (!this.steve) return;
    const p = this.pull;
    this.placeInCannon();
    const target = new THREE.Vector3(2.4, LAUNCH_H + 6.5, 11 + p * 1.5);
    this.camera.position.lerp(target, Math.min(1, dt * 4));
    this.camera.lookAt(0, LAUNCH_H + 3.6, -10);
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
    const targetY = g.position.y + 2.0 + vNorm * 1.6;
    this.camY += (targetY - this.camY) * Math.min(1, dt * 3);
    this.camera.position.set(0, this.camY, g.position.z + 7 + vNorm * 5);
    this.camera.lookAt(0, g.position.y - 0.9, g.position.z - 16);
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
    const hNext = sampleAt(plan.h, plan.dt, this.tau + 0.15);

    // ---- events
    for (const eo of this.world!.events) {
      if (!eo.triggered && this.tau >= eo.event.t) {
        eo.trigger();
        const kind = eo.event.kind;
        const mag = Math.min(1.5, Math.abs(eo.event.delta) / plan.v0 * 3);   // how big a deal this hit is
        if (kind === 'dumpster' || kind === 'hay') { audio.bonk(); audio.whoosh(0.5, 0.7, 0.8); this.shake = 0.8; }
        else if (eo.event.delta > 0) {
          audio.boing();
          if (isGroundKind(kind)) { this.bounceSpinUntil = this.tau + 0.5 + mag * 0.5; this.spinRate = 6 + mag * 5; }
          this.particles.emit({ pos: steve.group.position.clone(), vel: new THREE.Vector3(0, 1, 0), spread: 2.5, count: 10 + Math.round(mag * 20), life: 0.6, size: 0.25, endSize: 0.02, colors: ['#ffffff', '#fff3c4'], drag: 1.5 });
        } else {
          audio.bonk();
          this.bonk = 0.5 + mag;
          this.shake = mag * 0.6;
          if (isGroundKind(kind)) { this.bounceSpinUntil = this.tau + 0.4 + mag * 0.5; this.spinRate = 5 + mag * 4; }
          else { this.bounceSpinUntil = this.tau + mag * 0.5; this.spinRate = 4 + mag * 6; }
          // impact stars
          this.particles.emit({ pos: steve.group.position.clone(), vel: new THREE.Vector3(0, 2, 0), spread: 3, count: 6 + Math.round(mag * 10), life: 0.9, size: 0.35, endSize: 0.1, colors: ['#ffd166', '#ffffff', '#ff9a3c'], drag: 1.2, spin: 8 });
        }
      }
    }

    // ---- lift / lateral springs (visual response to boosts)
    this.liftVel += (-this.lift * 6 - this.liftVel * 2.5) * dt;
    this.lift += this.liftVel * dt;
    this.lateralVel += (-this.lateral * 5 - this.lateralVel * 2.2) * dt;
    this.lateral += this.lateralVel * dt;
    this.bonk = Math.max(0, this.bonk - dt * 1.4);

    // ---- sway by suit personality (pure whimsy)
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
      case 'dart': sx = 0.1 * Math.sin(t * 1.8); yaw = 0.06 * Math.sin(t * 1.8); roll = 0.05 * Math.sin(t * 1.4); sy = 0.05 * Math.sin(t * 1.2); break;
      case 'drift': sx = 0.8 * Math.sin(t * 0.45) + 0.3 * Math.sin(t * 1.0); yaw = 0.2 * Math.cos(t * 0.45); roll = 0.25 * Math.cos(t * 0.45); sy = 0.12 * Math.sin(t * 0.7); break;
    }
    // Disney-style gusts: slow, smooth wandering around the centre of the frame on top of the suit's own habit
    const windX = 0.45 * Math.sin(t * 0.37 + 1.7) + 0.25 * Math.sin(t * 0.83 + 0.4);
    const windY = 0.3 * Math.sin(t * 0.52 + 2.6) + 0.14 * Math.sin(t * 1.21);
    sx += windX; sy += windY; roll += windX * 0.18; yaw += windX * 0.08; pitch += windY * 0.15;
    const grounded = this.tau >= plan.landT;
    const air = grounded ? Math.max(0, 1 - (this.tau - plan.landT) / 0.3) : 1;
    sx *= air; sy *= air; roll *= air; yaw *= air; pitch *= air;
    if (this.bonk > 0) { roll += Math.sin(this.bonk * 30) * 0.35 * this.bonk; sy -= this.bonk * 0.3; }

    // ---- pose state machine
    const descending = hNext < h - 0.05 && this.tau > plan.T * 0.4;
    const tumbling = this.tau < plan.tuckTime || this.tau < this.bounceSpinUntil || !!plan.fumble;
    if (plan.fumble) {
      if (!this.fumbleShown && t > 0.2) { this.fumbleShown = true; audio.bonk(); }
      if (plan.fumble === 'fizzle') { this.spinRate += (3 - this.spinRate) * Math.min(1, dt * 2); steve.setPose('flail', 5); }
      else if (plan.fumble === 'spinout') { this.spinRate = 16; steve.setPose('tuck', 8); }
      else { this.spinRate += (7 - this.spinRate) * Math.min(1, dt * 2); steve.setPose('flail', 6); }
    } else if (grounded) {
      // the wipeout: tumbling along the pavement at the speed he arrived with, slowing as he skids
      steve.setPose('flail', 10);
      this.spinRate = Math.max(1.5, v / 1.1);
    } else if (tumbling) {
      steve.setPose('tuck', 10);
    } else if (descending) {
      steve.setPose('squirrel', 3.5);
      this.spinRate += (0 - this.spinRate) * Math.min(1, dt * 4);
    } else {
      steve.setPose('superman', 4);
      this.spinRate += (0 - this.spinRate) * Math.min(1, dt * 4);
    }
    if (tumbling || grounded) this.spin += this.spinRate * dt;
    else {
      // settle the spin to a whole turn so he unfurls facing the right way
      const whole = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin += (whole - this.spin) * Math.min(1, dt * 5);
    }

    // ---- place Steve along the route
    const g = steve.group;
    this.sNow = s;
    const r = this.world!.route.at(s, this.rs);
    const ground = this.world!.terrain.at(r.x, r.z);
    g.position.set(r.x, ground + h + this.lift * 0.8, r.z);
    const slope = THREE.MathUtils.clamp(Math.atan2(hNext - h, Math.max(0.05, 0.15 * Math.max(0.5, v))), -0.5, 0.5);
    g.rotation.set(0, r.heading, 0);
    const body = steve.body;
    body.position.set(sx + this.lateral, sy, 0);
    body.rotation.set(0, yaw - this.lateral * 0.15, roll - (sx + this.lateral) * 0.25);
    // orientation: prone for flight, spun by the tumble, pitched with the flight path
    const proneBlend = tumbling ? 0 : 1;
    const targetRx = PRONE * proneBlend + slope * 0.8 + pitch * (descending ? 0.5 : 0.2) - this.spin;
    steve.root.rotation.set(targetRx, 0, tumbling ? 0 : -(roll * 0.3));
    steve.root.position.set(0, tumbling ? 0 : 0.15, 0);
    if (grounded && plan.ending === 'sprawl') {
      // hops along the ground while tumbling, smaller as he slows
      const vf = Math.min(1, v / 25);
      body.position.y = Math.abs(Math.sin(this.tau * (6 + vf * 6))) * 0.9 * vf;
      body.rotation.set(0, 0, 0);
      steve.root.position.set(0, 0.5, 0);
    }

    // ---- bottle rockets (visual jets)
    for (const r of this.rocketsLit) {
      r.age += dt;
      const tip = steve.rocketTips[r.idx];
      if (tip && r.age < 1.4) {
        tip.getWorldPosition(this.tmpV);
        this.particles.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.4, 6), spread: 2.2, count: 4, life: 0.35, size: 0.08, endSize: 0.01, colors: ['#fff7b0', '#ffd166', '#ffffff', '#ff9a3c'], drag: 2 });
      }
    }
    this.rocketsLit = this.rocketsLit.filter(r => r.age < 1.6);

    // ---- camera: on the route centre line behind Steve, smooth in height
    const vNorm = Math.min(1, v / 60);
    const targetY = g.position.y + 2.2 + vNorm * 1.4;
    // follow quickly, faster still on the way down, and never fall more than a few units behind
    const falling = hNext < h;
    this.camY += (targetY - this.camY) * Math.min(1, dt * (falling ? 7 : 4));
    this.camY = THREE.MathUtils.clamp(this.camY, targetY - 2.5, targetY + 3.5);
    const back = 6 + vNorm * 3.5;
    const cb = this.world!.route.at(Math.max(0, s - back), this.rs2);
    // never let the camera sink to road level
    this.camY = Math.max(this.camY, this.world!.terrain.at(cb.x, cb.z) + 1.6);
    this.camera.position.set(cb.x, this.camY, cb.z);
    const la = this.world!.route.at(s + 16, this.rs2);
    // keep Steve a little above the centre of the frame
    this.camera.lookAt(la.x, g.position.y - 0.9 + (this.camY - targetY) * 0.5, la.z);

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
        const flat = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
        this.spin += (flat - this.spin) * Math.min(1, dt * 8);
        steve.root.rotation.set(Math.PI / 2 - this.spin, 0, 0);
        steve.root.position.set(0, 0.2, 0);
        if (Math.random() < dt * 6) {
          // little stars circling the head
          const a = Math.random() * Math.PI * 2;
          this.particles.emit({ pos: this.tmpV.set(Math.cos(a) * 0.6, 1.0, g.position.z + 0.9 + Math.sin(a) * 0.4), vel: new THREE.Vector3(-Math.sin(a) * 1.5, 0.2, Math.cos(a) * 1.5), spread: 0.1, count: 1, life: 1.2, size: 0.22, endSize: 0.05, colors: ['#ffd166', '#ffffff'], drag: 0.2, spin: 6 });
        }
      } else if (T < 2.1) {
        steve.setPose('sit', 5);
        const k = Math.min(1, (T - 1.1) / 0.8);
        steve.root.rotation.set((Math.PI / 2) * (1 - k) * 0.3, 0, 0);
        steve.root.position.set(0, 0.2 + 0.35 * k, 0);
        this.spin = 0;
      } else if (T < 2.9) {
        steve.setPose('gingerly', 4);
        const k = Math.min(1, (T - 2.1) / 0.8);
        steve.root.rotation.set(0, 0, 0);
        steve.root.position.set(0, 0.55 + 0.4 * (k * k * (3 - 2 * k)), 0);
      } else if (T < 3.5) { steve.setPose('brushL', 7); steve.root.position.set(0, 0.95, 0); }
      else if (T < 4.1) { steve.setPose('brushR', 7); }
      else if (T < 4.5) { steve.setPose('gingerly', 8); steve.root.rotation.set(0, Math.sin((T - 4.1) * 25) * 0.25, 0); }
      else { steve.setPose('hero', 6); steve.root.rotation.set(0, 0, 0); }
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
        steve.root.position.set(0, 0.95, 0);
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
        steve.root.position.set(0, 0.95, 0);
        g.position.y = 2.6 + 1.2 * k;
        this.spin = 0;
      }
      done = 3.8;
    }

    // stay on the chase camera, settled behind him on the route, trained on Steve
    const cb = this.world!.route.at(Math.max(0, this.sNow - 7), this.rs2);
    const camFloor = this.world!.terrain.at(cb.x, cb.z) + 1.6;
    this.camera.position.lerp(this.tmpV3.set(cb.x, Math.max(camFloor, g.position.y + 3.0), cb.z), Math.min(1, dt * 2.5));
    this.camera.lookAt(g.position.x, g.position.y + 0.4, g.position.z);

    if (!this.resultSent && T > done) {
      this.resultSent = true;
      this.events.onResult(this.result);
    }
  }
}
