/**
 * The 3D engine: scene, launcher, flight playback, camera and the mid-flight
 * boosts. It never decides money. It receives a finished RoundResult from the
 * server module and animates a flight that lands exactly on it.
 */
import * as THREE from 'three';
import { BOOST_CONFIG, TIER_CONFIG, type BoostKind } from '../core/config';
import { server, type RoundResult } from '../core/server';
import { profile, saveProfile } from '../core/store';
import { planeById, type PlaneDef } from '../data/planes';
import { audio } from './audio';
import { buildFlightPlan, sampleAt, type FlightPlan } from './flightPlan';
import { ParticleSystem } from './particles';
import { buildPlaneModel, type PlaneModel } from './planeModel';
import { World } from './world';

export type GameState = 'menu' | 'aiming' | 'betting' | 'flying' | 'landed';

export interface HudInfo {
  distance: number;    // metres
  cash: number;
  speed: number;       // world units / s (display only)
  progress: number;    // 0..1
  fanSeconds: number;
  confetti: number;
  sparklers: number;
  litSparklers: number;
}

export interface EngineEvents {
  onState(state: GameState): void;
  onHud(info: HudInfo): void;
  onResult(result: RoundResult): void;
  onError(msg: string): void;
  onPull(power: number): void;
}

interface Impulse { strength: number; remaining: number; duration: number }

const UP = new THREE.Vector3(0, 1, 0);

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles: ParticleSystem;
  state: GameState = 'menu';
  boostMode: BoostKind | null = null;

  private clock = new THREE.Clock();
  private world: World | null = null;
  private plane: PlaneModel | null = null;
  private planeDef: PlaneDef;
  private launcher = new THREE.Group();
  private bandL!: THREE.Line;
  private bandR!: THREE.Line;
  private blob: THREE.Mesh;
  private fanModel: THREE.Group;
  private fanBlades!: THREE.Group;
  private fanHum: { stop(): void } | null = null;

  // launcher / aiming
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
  private camY = 3;
  private landedAt = -1;
  private resultSent = false;
  private menuTime = 0;

  // boosts inventory for the current round
  private fanSeconds = 0;
  private fanActive = false;
  private fanPos = new THREE.Vector3();
  private confetti = 0;
  private sparklers = 0;
  private sparklerLit: { idx: number; age: number; stop: () => void }[] = [];
  private sparklerNext = 0;

  private hud: HudInfo = { distance: 0, cash: 0, speed: 0, progress: 0, fanSeconds: 0, confetti: 0, sparklers: 0, litSparklers: 0 };
  private events: EngineEvents;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

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
    // soft fill from below so the paper's underside never goes muddy when the plane climbs
    const fill = new THREE.DirectionalLight('#e8f0ff', 0.55);
    fill.position.set(10, -30, 20);
    this.scene.add(hemi, sun, fill);

    this.particles = new ParticleSystem(high ? 1200 : 600);
    this.scene.add(this.particles.mesh);

    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0x1b2a10, transparent: true, opacity: 0.14, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);

    this.buildLauncher();
    this.scene.add(this.launcher);
    this.fanModel = this.buildFan();
    this.fanModel.visible = false;
    this.scene.add(this.fanModel);

    this.planeDef = planeById(profile.selected[profile.tier]);
    this.setPlane(this.planeDef);
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

  private buildLauncher(): void {
    const wood = new THREE.MeshLambertMaterial({ color: '#b07a4a' });
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 1.5, 8);
    for (const x of [-1.4, 1.4]) {
      const p = new THREE.Mesh(postGeo, wood);
      p.position.set(x, 0.75, 0.6);
      p.rotation.z = x > 0 ? -0.12 : 0.12;
      this.launcher.add(p);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.8), wood);
    base.position.set(0, 0.09, 0.6);
    this.launcher.add(base);
    const bandMat = new THREE.LineBasicMaterial({ color: '#d94f4f' });
    const mk = () => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      return new THREE.Line(g, bandMat);
    };
    this.bandL = mk(); this.bandR = mk();
    this.launcher.add(this.bandL, this.bandR);
    // a little stand for the plane to rest on
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.3, 6), wood);
    stand.position.set(0, 0.8, 0.1);
    this.launcher.add(stand);
  }

  private buildFan(): THREE.Group {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8), new THREE.MeshLambertMaterial({ color: '#f26b6b' }));
    handle.position.y = -0.6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 18), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshLambertMaterial({ color: '#333' }));
    this.fanBlades = new THREE.Group();
    const bladeMat = new THREE.MeshLambertMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.34), bladeMat);
      b.position.y = 0.2;
      const p = new THREE.Group(); p.rotation.z = (i / 4) * Math.PI * 2; p.add(b);
      this.fanBlades.add(p);
    }
    g.add(handle, ring, hub, this.fanBlades);
    return g;
  }

  setPlane(def: PlaneDef): void {
    if (this.plane) { this.scene.remove(this.plane.group); this.plane.dispose(); }
    this.planeDef = def;
    this.plane = buildPlaneModel(def);
    this.plane.group.scale.setScalar(2.4);
    this.scene.add(this.plane.group);
    this.placePlaneOnLauncher();
  }

  /** Called by the UI when the tier/plane selection changes. */
  refreshSelection(): void {
    const def = planeById(profile.selected[profile.tier]);
    if (def.id !== this.planeDef.id) this.setPlane(def);
    this.updateSparklerVisibility();
    if (this.world) this.world.setCashPerUnit(this.menuCashPerUnit());
  }

  private menuCashPerUnit(): number {
    const cfg = TIER_CONFIG[profile.tier];
    return cfg.stake / cfg.baseDistance;
  }

  private async newWorld(): Promise<void> {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    // The world seed is the public commitment for the next round: cosmetic, but
    // it lets us build the scenery before the bet without it changing after.
    const seed = await server.nextSeedHash();
    this.world = new World({ seed, cashPerUnit: this.menuCashPerUnit(), quality: profile.quality }, this.particles);
    this.scene.add(this.world.group);
  }

  private placePlaneOnLauncher(): void {
    if (!this.plane) return;
    this.plane.group.position.set(0, 1.6, 0);
    this.plane.group.rotation.set(0, 0, 0);
    this.plane.body.position.set(0, 0, 0);
    this.plane.body.rotation.set(0, 0, 0);
    this.updateBands(0);
  }

  private updateBands(pull: number): void {
    const tail = new THREE.Vector3(0, 1.55, 0.5 + pull * 2.2);
    for (const [band, x] of [[this.bandL, -1.4], [this.bandR, 1.4]] as const) {
      const pos = band.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, x, 1.5, 0.6);
      pos.setXYZ(1, tail.x, tail.y, tail.z);
      pos.needsUpdate = true;
    }
  }

  private updateSparklerVisibility(): void {
    if (!this.plane) return;
    const n = this.state === 'flying' || this.state === 'landed' || this.state === 'betting' ? this.sparklers + this.sparklerLit.length : Math.min(BOOST_CONFIG.sparkler.max, profile.boosts.sparkler);
    const total = this.state === 'flying' || this.state === 'landed' ? this.sparklerNextTotal : n;
    this.plane.sparklers.forEach((s, i) => { s.visible = i < total; });
  }
  private sparklerNextTotal = 0;

  // ---------------------------------------------------------------- state
  private setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.events.onState(s);
  }

  /** Leave the menu and get ready to aim. */
  startPlaying(): void {
    if (this.state !== 'menu') return;
    audio.unlock();
    this.refreshSelection();
    this.placePlaneOnLauncher();
    this.setState('aiming');
  }

  /** Back to the menu (from aiming or after a round). */
  async toMenu(): Promise<void> {
    this.resetRound();
    await this.newWorld();
    this.placePlaneOnLauncher();
    this.setState('menu');
  }

  /** After a round: reset and aim again straight away. */
  async playAgain(): Promise<void> {
    this.resetRound();
    await this.newWorld();
    this.refreshSelection();
    this.placePlaneOnLauncher();
    this.setState('aiming');
  }

  private resetRound(): void {
    this.plan = null; this.result = null; this.tau = 0; this.flightClock = 0;
    this.impulses = []; this.lift = 0; this.liftVel = 0; this.lateral = 0; this.lateralVel = 0;
    this.bonk = 0; this.landedAt = -1; this.resultSent = false;
    this.fanActive = false; this.fanModel.visible = false; this.fanHum?.stop(); this.fanHum = null;
    for (const s of this.sparklerLit) s.stop();
    this.sparklerLit = []; this.sparklerNext = 0; this.sparklerNextTotal = 0;
    this.boostMode = null;
    this.particles.clear();
    this.launcher.visible = true;
    this.pull = 0;
    this.camY = 3;
    // snap the camera back to the launcher instead of lerping across the whole map
    this.camera.position.set(0, 2.9, 6);
    this.camera.lookAt(0, 1.7, -7);
  }

  // ---------------------------------------------------------------- launch
  private async launch(power: number): Promise<void> {
    if (!this.plane || !this.world) return;
    this.setState('betting');
    const boosts = { ...profile.boosts };
    let result: RoundResult;
    try {
      // THE bet. Everything that follows is decided by this one call.
      result = await server.placeBet({ tier: profile.tier, planeId: this.planeDef.id, boosts, clientSeed: profile.clientSeed });
    } catch (e) {
      this.events.onError((e as Error).message);
      this.placePlaneOnLauncher();
      this.setState('aiming');
      return;
    }
    // Boosts are consumed by the round whether or not the player uses them.
    this.fanSeconds = boosts.fan;
    this.confetti = boosts.confetti;
    this.sparklers = boosts.sparkler;
    this.sparklerNextTotal = boosts.sparkler;
    profile.boosts = { fan: 0, confetti: 0, sparkler: 0 };
    profile.rounds++;
    saveProfile();

    this.result = result;
    const plan = buildFlightPlan({ seed: result.worldSeed, distanceMetres: result.distance, power, angle: 0.3 + 0.7 * power, style: this.planeDef.flight });
    this.plan = plan;
    this.cashPerUnit = result.payout / plan.L;
    this.world.setPlan(plan, this.cashPerUnit);
    this.updateSparklerVisibility();
    this.tau = 0;
    this.flightClock = 0;
    audio.whoosh(0.7, 0.8, 1.1);
    this.particles.emit({ pos: new THREE.Vector3(0, 1.6, 0.5), vel: new THREE.Vector3(0, 0.5, 2), spread: 2, count: 14, life: 0.5, size: 0.14, endSize: 0, colors: ['#ffffff', '#fff3c4'], drag: 2 });
    this.setState('flying');
  }

  // ---------------------------------------------------------------- input
  private ndcFromEvent(e: PointerEvent): void {
    this.pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  /** Project the pointer onto a vertical plane just behind the paper plane. */
  private pointerToWorld(e: PointerEvent, out: THREE.Vector3): boolean {
    if (!this.plane) return false;
    this.ndcFromEvent(e);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const pz = this.plane.group.position.z + 1.6;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -pz);
    const hit = this.raycaster.ray.intersectPlane(plane, out);
    return !!hit;
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
      if (this.boostMode === 'fan' && this.fanSeconds > 0) {
        if (this.pointerToWorld(e, this.fanPos)) { this.fanActive = true; this.pointerDown = true; this.fanModel.visible = true; if (!this.fanHum) this.fanHum = audio.hum(); }
      } else if (this.boostMode === 'confetti' && this.confetti > 0) {
        if (this.pointerToWorld(e, this.tmpV)) this.fireConfetti(this.tmpV.clone());
      } else if (this.boostMode === 'sparkler' && this.sparklers > 0) {
        this.lightSparkler();
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.state === 'aiming' && this.pointerDown) {
      const dy = e.clientY - this.pointerStart.y;
      const dx = e.clientX - this.pointerStart.x;
      const along = Math.max(0, dy) + Math.abs(dx) * 0.15;
      this.pull = Math.min(1, along / (window.innerHeight * 0.3));
      this.events.onPull(this.pull);
    } else if (this.state === 'flying' && this.fanActive) {
      this.pointerToWorld(e, this.fanPos);
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (this.state === 'aiming' && this.pointerDown) {
      this.pointerDown = false;
      const p = this.pull;
      this.events.onPull(0);
      if (p < 0.08) { this.pull = 0; return; }
      this.pull = 0;
      void this.launch(p);
      return;
    }
    if (this.fanActive) {
      this.fanActive = false; this.pointerDown = false;
      this.fanModel.visible = false;
      this.fanHum?.stop(); this.fanHum = null;
    }
  }

  // ---------------------------------------------------------------- boosts
  /** How much a push from `from` towards the plane counts, split into forward / lift / lateral. */
  private pushComponents(from: THREE.Vector3): { forward: number; lift: number; lateral: number; falloff: number } {
    const P = this.plane!.group.position;
    const d = this.tmpV2.copy(P).sub(from);
    const dist = d.length();
    if (dist < 1e-3) return { forward: 0, lift: 0, lateral: 0, falloff: 0 };
    d.divideScalar(dist);
    const falloff = Math.max(0, 1 - Math.max(0, dist - 1.2) / 5.5);
    return { forward: Math.max(0, -d.z), lift: Math.max(0, d.y), lateral: d.x, falloff };
  }

  private fireConfetti(at: THREE.Vector3): void {
    if (this.confetti <= 0 || !this.plane) return;
    this.confetti--;
    audio.pop();
    const P = this.plane.group.position;
    const dir = P.clone().sub(at).normalize();
    this.particles.emit({ pos: at, vel: dir.clone().multiplyScalar(9), spread: 4, count: 70, life: 1.6, size: 0.16, endSize: 0.12, colors: ['#f26b6b', '#f2c14e', '#5fb8e6', '#7bc96f', '#e5679a', '#ffffff'], drag: 1.6, gravity: 4, spin: 14 });
    const c = this.pushComponents(at);
    const k = c.falloff * this.speedFactor();
    this.impulses.push({ strength: 1.7 * c.forward * k, remaining: 0.9, duration: 0.9 });
    this.liftVel += 5 * c.lift * k;
    this.lateralVel += 4 * c.lateral * k;
  }

  private lightSparkler(): void {
    if (this.sparklers <= 0 || !this.plane) return;
    this.sparklers--;
    const idx = this.sparklerNext++;
    const stop = audio.fizz(1.4);
    this.sparklerLit.push({ idx, age: 0, stop });
    const k = this.speedFactor();
    this.impulses.push({ strength: 1.0 * k, remaining: 1.4, duration: 1.4 });
    this.liftVel += 0.8 * k;
  }

  /** Boosts only work in proportion to how fast the plane is already going. */
  private speedFactor(): number {
    if (!this.plan) return 0;
    const v = sampleAt(this.plan.v, this.plan.dt, this.tau);
    return Math.min(1.2, v / this.plan.v0);
  }

  setBoostMode(mode: BoostKind | null): void {
    if (this.boostMode === 'fan' && mode !== 'fan' && this.fanActive) this.onPointerUp(new PointerEvent('pointerup'));
    this.boostMode = mode;
  }

  // ---------------------------------------------------------------- frame
  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.menuTime += dt;
    if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'aiming' || this.state === 'betting') this.updateAiming(dt);
    else this.updateFlight(dt);

    const pz = this.plane ? this.plane.group.position.z : 0;
    this.world?.update(dt, pz, this.camera.position.z, this.camera.position.y);
    this.particles.update(dt, this.camera);
    if (this.plane) {
      const p = this.plane.group.position;
      this.blob.position.set(p.x + this.plane.body.position.x * 1.6, 0.03, p.z);
      const s = Math.max(0.5, 1.6 - p.y * 0.02);
      this.blob.scale.set(s * 1.3, s, 1);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.max(0, 1 - p.y / 40);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateMenu(dt: number): void {
    if (!this.plane) return;
    const t = this.menuTime;
    // plane rests on the launcher, bobbing a little in the breeze
    this.plane.body.position.set(0, Math.sin(t * 1.2) * 0.04, 0);
    this.plane.body.rotation.set(Math.sin(t * 0.9) * 0.03, 0, Math.sin(t * 1.1) * 0.05);
    this.updateBands(0);
    // slow orbiting camera
    const a = Math.sin(t * 0.18) * 0.9;
    const target = new THREE.Vector3(Math.sin(a) * 5.5, 2.3 + Math.sin(t * 0.3) * 0.3, Math.cos(a) * 5.5 + 0.8);
    this.camera.position.lerp(target, Math.min(1, dt * 1.5));
    this.camera.lookAt(0, 1.5, -4);
    void dt;
  }

  private updateAiming(dt: number): void {
    if (!this.plane) return;
    const p = this.pull;
    const t = this.menuTime;
    this.plane.group.position.set(0, 1.6, p * 2.2);
    this.plane.group.rotation.set(0.1 + p * 0.45, 0, 0);
    this.plane.body.position.set(0, Math.sin(t * 1.2) * 0.02, 0);
    this.plane.body.rotation.set(0, 0, Math.sin(t * 1.1) * 0.03 + p * Math.sin(t * 25) * 0.015);
    this.updateBands(p);
    const target = new THREE.Vector3(0, 2.9, 5.4 + p * 1.4);
    this.camera.position.lerp(target, Math.min(1, dt * 4));
    this.camera.lookAt(0, 1.7, -7);
  }

  private updateFlight(dt: number): void {
    if (!this.plan || !this.plane || !this.result) return;
    const plan = this.plan;
    this.flightClock += dt;

    // ---- boosts: fan (continuous), impulses (confetti / sparklers)
    let rate = 1;
    if (this.fanActive && this.fanSeconds > 0) {
      this.fanSeconds = Math.max(0, this.fanSeconds - dt);
      const c = this.pushComponents(this.fanPos);
      const k = c.falloff * this.speedFactor();
      rate += 0.85 * c.forward * k;
      this.liftVel += 9 * c.lift * k * dt;
      this.lateralVel += 7 * c.lateral * k * dt;
      this.fanModel.position.copy(this.fanPos);
      this.fanModel.lookAt(this.plane.group.position);
      this.fanBlades.rotation.z += dt * 40;
      if (Math.random() < 0.9) {
        const dir = this.tmpV.copy(this.plane.group.position).sub(this.fanPos).normalize();
        this.particles.emit({ pos: this.fanPos.clone().addScaledVector(dir, 0.5), vel: dir.multiplyScalar(10), spread: 1.2, count: 2, life: 0.45, size: 0.12, endSize: 0.02, colors: ['#ffffff', '#e6f3ff'], drag: 1 });
      }
      if (this.fanSeconds <= 0) { this.onPointerUp(new PointerEvent('pointerup')); }
    }
    for (const im of this.impulses) {
      const env = Math.sin(Math.PI * Math.min(1, 1 - im.remaining / im.duration)) ** 0.5;
      rate += im.strength * env;
      im.remaining -= dt;
    }
    this.impulses = this.impulses.filter(i => i.remaining > 0);
    // after landing nothing can push the plane
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
        if (eo.event.delta > 0) { audio.boing(); }
        else { audio.bonk(); this.bonk = 1; }
      }
    }

    // ---- lift / lateral springs (visual response to boosts)
    this.liftVel += (-this.lift * 6 - this.liftVel * 2.5) * dt;
    this.lift += this.liftVel * dt;
    this.lateralVel += (-this.lateral * 5 - this.lateralVel * 2.2) * dt;
    this.lateral += this.lateralVel * dt;
    this.bonk = Math.max(0, this.bonk - dt * 1.4);

    // ---- sway by flight style (pure whimsy)
    const t = this.tau;
    const st = this.planeDef.flight;
    let sx = 0, sy = 0, roll = 0, yaw = 0, pitch = 0;
    const wind = 0.08 * Math.sin(t * 0.63 + 1.7) + 0.05 * Math.sin(t * 1.31);
    switch (st) {
      case 'steady': sx = 0.16 * Math.sin(t * 0.7); sy = 0.1 * Math.sin(t * 0.9 + 1); roll = 0.1 * Math.sin(t * 0.7 + 1); break;
      case 'swoop': sy = 0.7 * Math.sin(t * 0.55); pitch = 0.35 * Math.cos(t * 0.55); sx = 0.2 * Math.sin(t * 0.4); roll = 0.12 * Math.sin(t * 0.4); break;
      case 'rockabye': roll = 0.5 * Math.sin(t * 1.4); sx = 0.35 * Math.sin(t * 1.4 - 0.6); sy = 0.08 * Math.sin(t * 2.8); break;
      case 'twirl': {
        roll = 0.18 * Math.sin(t * 0.9);
        const period = 5.5, u = (t % period) / period;
        if (u > 0.7) { const q = (u - 0.7) / 0.3; roll += Math.PI * 2 * (q * q * (3 - 2 * q)); }
        sx = 0.25 * Math.sin(t * 0.8); sy = 0.15 * Math.sin(t * 1.1);
        break;
      }
      case 'flutter': sy = 0.12 * Math.sin(t * 5) + 0.1 * Math.sin(t * 3.1); sx = 0.1 * Math.sin(t * 4.2); pitch = 0.08 * Math.sin(t * 5); roll = 0.12 * Math.sin(t * 3.3); break;
      case 'dart': sx = 0.06 * Math.sin(t * 3); yaw = 0.05 * Math.sin(t * 3); roll = 0.04 * Math.sin(t * 2.2); sy = 0.04 * Math.sin(t * 1.7); break;
      case 'drift': sx = 0.9 * Math.sin(t * 0.6) + 0.3 * Math.sin(t * 1.3); yaw = 0.25 * Math.cos(t * 0.6); roll = 0.3 * Math.cos(t * 0.6); sy = 0.15 * Math.sin(t * 0.9); break;
    }
    const speedFrac = Math.min(1, v / plan.v0);
    const grounded = this.tau >= plan.landT;
    const air = grounded ? Math.max(0, 1 - (this.tau - plan.landT) / 0.3) : 1;
    sx = (sx + wind) * air; sy *= air; roll *= air; yaw *= air; pitch *= air;
    if (this.bonk > 0) { roll += Math.sin(this.bonk * 30) * 0.35 * this.bonk; sy -= this.bonk * 0.3; }

    // ---- place the plane
    const g = this.plane.group;
    g.position.set(0, h + this.lift * 0.8, -s);
    const slope = THREE.MathUtils.clamp(Math.atan2(hNext - h, Math.max(0.05, 0.15 * Math.max(0.5, v))), -0.5, 0.5);
    g.rotation.set(slope * 0.8 + pitch, 0, 0);
    const body = this.plane.body;
    body.position.set(sx + this.lateral, sy, 0);
    body.rotation.set(0, yaw - this.lateral * 0.15, roll - (sx + this.lateral) * 0.25);
    if (grounded) {
      // skid along the ground
      body.rotation.z = Math.sin(this.tau * 2) * 0.05 * speedFrac;
      g.rotation.x = 0.03;
    }

    // ---- sparklers (visual jets)
    for (const sp of this.sparklerLit) {
      sp.age += dt;
      const tip = this.plane.sparklerTips[sp.idx];
      if (tip && sp.age < 1.4) {
        tip.getWorldPosition(this.tmpV);
        this.particles.emit({ pos: this.tmpV, vel: new THREE.Vector3(0, 0.4, 6), spread: 2.2, count: 4, life: 0.35, size: 0.08, endSize: 0.01, colors: ['#fff7b0', '#ffd166', '#ffffff', '#ff9a3c'], drag: 2 });
      }
    }
    this.sparklerLit = this.sparklerLit.filter(sp => sp.age < 1.6);

    // ---- camera: fixed on the centre line, smooth in height, trailing behind
    const vNorm = Math.min(1, v / 60);
    const targetY = g.position.y + 2.4 + vNorm * 2.2;
    this.camY += (targetY - this.camY) * Math.min(1, dt * 3);
    const back = 7 + vNorm * 5;
    this.camera.position.set(0, this.camY, g.position.z + back);
    // look a little past the plane, but keep the plane itself in the upper-middle of the frame
    const lookY = (this.camY - 1.6 - vNorm * 1.2) * 0.45 + g.position.y * 0.55;
    this.camera.lookAt(0, lookY, g.position.z - 14);

    // launcher fades out of relevance once we are away
    this.launcher.visible = s < 80;

    // ---- HUD
    const progress = s / plan.L;
    this.hud.distance = progress * this.result.distance;
    this.hud.cash = s * this.cashPerUnit;
    this.hud.speed = v * rate;
    this.hud.progress = progress;
    this.hud.fanSeconds = this.fanSeconds;
    this.hud.confetti = this.confetti;
    this.hud.sparklers = this.sparklers;
    this.hud.litSparklers = this.sparklerLit.length;
    this.events.onHud(this.hud);

    // ---- landing
    if (this.tau >= plan.T) {
      if (this.landedAt < 0) { this.landedAt = this.flightClock; this.setState('landed'); }
      else if (!this.resultSent && this.flightClock - this.landedAt > 0.9) {
        this.resultSent = true;
        this.hud.distance = this.result.distance;
        this.hud.cash = this.result.payout;
        this.events.onHud(this.hud);
        this.events.onResult(this.result);
      }
    }
    void UP;
  }
}
