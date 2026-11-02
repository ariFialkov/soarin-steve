/**
 * The world: an infinite procedural city streamed in chunks ahead of the
 * plane, with the cash track painted down the avenue, ambient sky traffic,
 * and the flight plan's event objects.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { FlightPlan } from './flightPlan';
import type { ParticleSystem } from './particles';
import { GeoBatch, PLANE, BOX, CYL, CYL_LO, SPHERE, SPHERE_LO, CONE, makeGlassTexture, makeWindowTexture } from './geobatch';
import { CityPlan, GRID, LAYER, buildChunk, districtGround, type AnimatedObject, type Batches, type District } from './city';
import { DECOY_KINDS, balloonEnvelope, makeEventObject, type EventObject } from './events';

export const CHUNK = GRID.CHUNK;
const AHEAD = 7;

export interface WorldParams {
  seed: string;
  cashPerUnit: number;
  quality: 'low' | 'high';
}

interface Chunk {
  index: number;
  group: THREE.Group;
  disposables: { dispose(): void }[];
  labels: { s: number; mat: THREE.MeshBasicMaterial; color: string; stroke: string }[];
  animated: AnimatedObject[];
  decoys: EventObject[];
}

function fmtCash(v: number): string {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'm';
  if (v >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'k';
  if (v >= 100) return '$' + Math.round(v).toString();
  if (v >= 10) return '$' + v.toFixed(1);
  return '$' + v.toFixed(2);
}

/** Chunky cartoon lettering: heavy rounded face with an outline, both in shades of the surface it is painted on. */
function makeLabel(text: string, fill: string, stroke: string, w = 320, h = 96): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.font = `900 ${Math.floor(h * 0.74)}px "Arial Rounded MT Bold", "Helvetica Rounded", "Nunito", "Varela Round", "Segoe UI Black", "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = h * 0.2;
  g.strokeStyle = stroke;
  g.strokeText(text, w / 2, h / 2 + 3);
  g.fillStyle = fill;
  g.fillText(text, w / 2, h / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

// shared materials (one set for the whole world)
let windowTex: THREE.CanvasTexture | null = null;
let glassTex: THREE.CanvasTexture | null = null;
function materials(): { solid: THREE.Material; facade: THREE.Material; glass: THREE.Material } {
  windowTex ??= makeWindowTexture();
  glassTex ??= makeGlassTexture();
  return {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    facade: new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTex }),
    glass: new THREE.MeshLambertMaterial({ vertexColors: true, map: glassTex }),
  };
}

export class World {
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private params: WorldParams;
  private plan: FlightPlan | null = null;
  private city: CityPlan;
  private eventObjects: EventObject[] = [];
  private particles: ParticleSystem;
  private elapsed = 0;
  private sky: THREE.Group;
  private mats = materials();
  private matCache = new Map<string, THREE.Material>();

  constructor(params: WorldParams, particles: ParticleSystem) {
    this.params = params;
    this.particles = particles;
    this.city = new CityPlan(params.seed);
    this.sky = this.buildSky();
    this.group.add(this.sky);
    // build the whole look-ahead up front so the first seconds of flight never stall
    this.ensure(0, AHEAD, Infinity);
  }

  get events(): EventObject[] { return this.eventObjects; }

  districtAt(z: number): District {
    return this.city.at(Math.max(0, Math.floor(-z / CHUNK))).district;
  }

  /** Shared Lambert material by colour for animated objects. */
  private mkMat = (c: string): THREE.Material => {
    let m = this.matCache.get(c);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); this.matCache.set(c, m); }
    return m;
  };

  setPlan(plan: FlightPlan, cashPerUnit: number): void {
    for (const eo of this.eventObjects) { this.group.remove(eo.group); eo.dispose(); }
    this.eventObjects = [];
    this.plan = plan;
    void this.plan;
    for (const e of plan.events) {
      const h = plan.h[Math.min(plan.h.length - 1, Math.round(e.t / plan.dt))];
      const eo = makeEventObject(e, h, this.particles);
      this.eventObjects.push(eo);
      this.group.add(eo.group);
    }
    this.setCashPerUnit(cashPerUnit);
  }

  setCashPerUnit(cashPerUnit: number): void {
    this.params.cashPerUnit = cashPerUnit;
    for (const [, ch] of this.chunks) {
      for (const l of ch.labels) {
        const old = l.mat.map;
        const { tex } = makeLabel(fmtCash(l.s * cashPerUnit), l.color, l.stroke);
        l.mat.map = tex;
        l.mat.needsUpdate = true;
        old?.dispose();
        ch.disposables.push(tex);
      }
    }
  }

  /** Keep chunks around z; builds at most `budget` new chunks per call (one per frame in play). */
  ensure(z: number, ahead = AHEAD, budget = 1): void {
    const idx = Math.max(0, Math.floor(-z / CHUNK));
    let built = 0;
    for (let i = Math.max(-1, idx - 1); i <= idx + ahead && built < budget; i++) {
      if (!this.chunks.has(i)) { this.buildChunk(i); built++; }
    }
    for (const [i, ch] of this.chunks) {
      if (i < idx - 2) {
        this.group.remove(ch.group);
        for (const d of ch.disposables) d.dispose();
        for (const a of ch.animated) a.dispose();
        for (const d of ch.decoys) d.dispose();
        this.chunks.delete(i);
      }
    }
  }

  // ------------------------------------------------------------------ chunks
  private buildChunk(i: number): void {
    const rng = new Rng(`${this.params.seed}:avenue:${i}`);
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const labels: Chunk['labels'] = [];
    const B: Batches = { solid: new GeoBatch(), facade: new GeoBatch(), glass: new GeoBatch() };
    // chunk -1 (behind the launcher) is built in chunk 0's coordinates with a
    // different seed and then translated backwards, so the grid lines up.
    const ci = Math.max(0, i);
    const district = this.city.at(ci).district;
    const col = districtGround(district);
    const z1 = -ci * CHUNK, z0 = z1 - CHUNK, zc = (z0 + z1) / 2;

    const { animated } = buildChunk(B, this.city, ci, this.params.seed + (i < 0 ? ':behind' : ''), this.params.quality, this.mkMat);

    // ---- avenue + cash track
    if (district !== 'river') {
      B.solid.add(PLANE, col.ave, 0, LAYER.STREET, zc, -Math.PI / 2, 0, 0, GRID.AVE * 2, CHUNK, 1);
    }
    B.solid.add(PLANE, col.track, 0, LAYER.TRACK, zc, -Math.PI / 2, 0, 0, 12, CHUNK, 1);
    // lane markings
    for (let z = z1 - 2; z > z0; z -= 4) {
      B.solid.add(PLANE, col.lane, 0, LAYER.MARK, z, -Math.PI / 2, 0, 0, 0.18, 2, 1);
      B.solid.add(PLANE, col.line, 3.5, LAYER.MARK, z, -Math.PI / 2, 0, 0, 0.16, 2, 1);
      B.solid.add(PLANE, col.line, -3.5, LAYER.MARK, z, -Math.PI / 2, 0, 0, 0.16, 2, 1);
    }
    // cross markers every 10 units with cash labels either side
    for (let s = Math.ceil(-z1 / 10) * 10; s < -z1 + CHUNK && i >= 0; s += 10) {
      if (s <= 0) continue;
      const z = -s;
      B.solid.add(PLANE, col.cross, 0, LAYER.CROSS, z, -Math.PI / 2, 0, 0, 12, 0.36, 1);
      const cash = fmtCash(s * this.params.cashPerUnit);
      const { tex, aspect } = makeLabel(cash, col.label, col.labelStroke);
      disposables.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(mat);
      labels.push({ s, mat, color: col.label, stroke: col.labelStroke });
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(PLANE, mat);
        const hgt = 2.0;
        m.scale.set(hgt * aspect, hgt, 1);
        m.rotation.x = -Math.PI / 2;
        m.position.set(side * 3.5, LAYER.LABEL, z + 1.3);
        group.add(m);
      }
    }

    // ---- ambient sky traffic + filler obstacles that are not on the flight line
    this.addAmbient(group, animated, rng, i, district);
    const decoys: EventObject[] = [];
    if (i >= 0) {
      const n = rng.int(this.params.quality === 'high' ? 2 : 1, this.params.quality === 'high' ? 4 : 2);
      for (let d = 0; d < n; d++) {
        const kind = rng.pick(DECOY_KINDS);
        const grounded = kind === 'crane' || kind === 'billboard' || kind === 'pigeons' || kind === 'thermal' || kind === 'vent';
        const h = kind === 'pigeons' ? rng.range(6, 13) : kind === 'billboard' ? rng.range(10, 26) : grounded ? rng.range(16, 40) : rng.range(14, 75);
        // fliers sit clearly off the centre line; grounded ones hug the kerbs like the real ones
        const x = grounded ? rng.sign() * 0.5 : rng.sign() * rng.range(7, 34);
        // never right beside the launcher
        const ev = { t: Infinity, s: Math.max(i === 0 ? 46 : 0, -(z1 - rng.range(3, CHUNK - 3))), delta: -1, kind, lift: 0, x };
        const eo = makeEventObject(ev, h, this.particles, true);
        if (!grounded) eo.group.position.x = x; // the builders use e.x only as a small nudge; push fliers out to the side
        decoys.push(eo);
        group.add(eo.group);
      }
    }

    // ---- bake
    const solid = B.solid.build(this.mats.solid);
    const facade = B.facade.build(this.mats.facade);
    const glass = B.glass.build(this.mats.glass);
    for (const m of [solid, facade, glass]) if (m) { group.add(m); disposables.push(m.geometry); }
    for (const a of animated) group.add(a.obj);
    if (i < 0) group.position.z = CHUNK; // the mirrored chunk sits behind the launcher

    this.group.add(group);
    this.chunks.set(i, { index: i, group, disposables, labels, animated, decoys });
  }

  private addAmbient(group: THREE.Group, animated: AnimatedObject[], rng: Rng, i: number, district: District): void {
    void group;
    const z1 = -i * CHUNK;
    const mk = this.mkMat;
    // birds
    if (rng.chance(0.6)) {
      const flock = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      const n = rng.int(4, 9);
      for (let b = 0; b < n; b++) {
        const g = new THREE.Group();
        const w1 = new THREE.Mesh(BOX, mk('#2b2f36')); w1.scale.set(1.1, 0.05, 0.3); w1.position.x = -0.55;
        const w2 = w1.clone(); w2.position.x = 0.55;
        g.add(w1, w2);
        g.position.set((b - n / 2) * 1.4, Math.abs(b - n / 2) * 0.5, -Math.abs(b - n / 2) * 1.2);
        flock.add(g); wings.push(w1, w2);
      }
      const side = rng.sign();
      const y = rng.range(18, 60);
      flock.position.set(side * rng.range(20, 120), y, z1 - rng.range(0, CHUNK));
      const speed = rng.range(5, 9);
      animated.push({ obj: flock, update(dt, t) { flock.position.x -= side * speed * dt; wings.forEach((w, k) => { w.rotation.z = (k % 2 ? -1 : 1) * Math.sin(t * 8 + k) * 0.6; }); }, dispose() {} });
    }
    // hot-air balloons off to the side
    if (rng.chance(0.35)) {
      const g = new THREE.Group();
      const cols = [rng.pick(['#f2c14e', '#e5679a', '#5fb8e6', '#7bc96f']), '#ffffff'];
      const env = balloonEnvelope(cols); env.position.y = 7.5; g.add(env);
      const neck = new THREE.Mesh(CONE, mk(cols[0])); neck.scale.set(3.2, 2.2, 3.2); neck.rotation.x = Math.PI; neck.position.y = 3.6; g.add(neck);
      const basket = new THREE.Mesh(BOX, mk('#9a6b3c')); basket.scale.set(1.6, 1.2, 1.6); basket.position.y = 0.6; g.add(basket);
      g.position.set(rng.sign() * rng.range(40, 150), rng.range(20, 70), z1 - rng.range(0, CHUNK));
      const y0 = g.position.y;
      animated.push({ obj: g, update(dt, t) { g.position.y = y0 + Math.sin(t * 0.5 + i) * 1.2; g.position.x += dt * 0.6; }, dispose() {} });
    }
    // blimp high up
    if (rng.chance(0.12)) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(SPHERE, mk('#f4f4f4')); body.scale.set(7, 7, 20); b.add(body);
      const band = new THREE.Mesh(BOX, mk('#3f5f8a')); band.scale.set(7.2, 1.2, 12); b.add(band);
      const gondola = new THREE.Mesh(BOX, mk('#3b3f47')); gondola.scale.set(1.6, 1.4, 4); gondola.position.y = -3.6; b.add(gondola);
      b.position.set(rng.sign() * rng.range(60, 160), rng.range(55, 90), z1 - rng.range(0, CHUNK));
      b.rotation.y = rng.range(0, Math.PI);
      animated.push({ obj: b, update(dt) { b.position.z += dt * 0.8; }, dispose() {} });
    }
    // airliner far away and high
    if (rng.chance(0.1)) {
      const g = new THREE.Group();
      const white = mk('#f4f6f8');
      const fus = new THREE.Mesh(CYL, white); fus.scale.set(2.2, 18, 2.2); fus.rotation.x = Math.PI / 2; g.add(fus);
      const wings = new THREE.Mesh(BOX, white); wings.scale.set(22, 0.25, 3.2); g.add(wings);
      const fin = new THREE.Mesh(BOX, mk('#e2574c')); fin.scale.set(0.25, 3.6, 3); fin.position.set(0, 1.8, 8.5); g.add(fin);
      const side = rng.sign();
      g.position.set(-side * 200, rng.range(90, 130), z1 - rng.range(0, CHUNK));
      g.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      animated.push({ obj: g, update(dt) { g.position.x += side * dt * 25; }, dispose() {} });
    }
    // helicopter over downtown
    if (district === 'downtown' && rng.chance(0.3)) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(SPHERE_LO, mk('#3f5f8a')); body.scale.set(2.4, 2, 4.5); g.add(body);
      const tail = new THREE.Mesh(CYL_LO, mk('#3f5f8a')); tail.scale.set(0.5, 6, 0.5); tail.rotation.x = Math.PI / 2; tail.position.z = 4.5; g.add(tail);
      const rotor = new THREE.Mesh(BOX, mk('#222')); rotor.scale.set(9, 0.1, 0.4); rotor.position.y = 1.5; g.add(rotor);
      g.position.set(rng.sign() * rng.range(25, 90), rng.range(40, 80), z1 - rng.range(0, CHUNK));
      animated.push({ obj: g, update(dt, t) { rotor.rotation.y += dt * 30; g.position.x += Math.sin(t * 0.3) * dt * 4; g.position.z += dt * 2; }, dispose() {} });
    }
  }

  // ------------------------------------------------------------------ sky
  private buildSky(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(1300, 24, 12);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color('#4f9fe0'), mid = new THREE.Color('#9fd0f5'), hor = new THREE.Color('#e8f3fb');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1300;
      if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
      else c.copy(hor).lerp(mid, Math.max(0, y) / 0.25);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.renderOrder = -10;
    g.add(dome);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: '#fff6c8', fog: false, depthWrite: false }));
    sun.position.set(-380, 520, -1050);
    sun.lookAt(0, 0, 0);
    g.add(sun);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(120, 24), new THREE.MeshBasicMaterial({ color: '#fff6c8', fog: false, transparent: true, opacity: 0.25, depthWrite: false }));
    glow.position.copy(sun.position).multiplyScalar(1.001);
    glow.lookAt(0, 0, 0);
    g.add(glow);
    // far mountain silhouettes
    const b = new GeoBatch();
    const rng = new Rng(this.params.seed + ':far');
    for (let i = 0; i < 14; i++) {
      const x = (i - 6.5) * 170 + rng.range(-40, 40);
      const h = rng.range(90, 220);
      b.add(CONE, rng.pick(['#bcd8e8', '#a9cce3', '#c9e0ee']), x, h / 2 - 20, -1000, 0, 0, 0, h * 1.8, h, h);
    }
    const m = b.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    if (m) g.add(m);
    return g;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, planeZ: number, cameraZ: number, cameraY: number, planTime: number): void {
    this.elapsed += dt;
    this.ensure(planeZ);
    this.sky.position.set(0, Math.max(0, cameraY - 60), cameraZ);
    for (const [, ch] of this.chunks) {
      for (const a of ch.animated) a.update(dt, this.elapsed);
      for (const d of ch.decoys) {
        const dz = d.group.position.z - cameraZ;
        d.group.visible = !(dz > -2 && dz < 3.5);
        if (Math.abs(dz) < 450) d.update(dt, this.elapsed);
      }
    }
    for (const eo of this.eventObjects) {
      const dz = eo.group.position.z - cameraZ;
      eo.group.visible = !(dz > -2 && dz < 3.5);
      eo.approach(eo.event.t - planTime);
      if (Math.abs(eo.group.position.z - planeZ) < 450) eo.update(dt, this.elapsed);
    }
  }

  dispose(): void {
    for (const [, ch] of this.chunks) {
      this.group.remove(ch.group);
      for (const d of ch.disposables) d.dispose();
      for (const a of ch.animated) a.dispose();
      for (const d of ch.decoys) d.dispose();
    }
    this.chunks.clear();
    for (const eo of this.eventObjects) eo.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.sky.traverse(o => { const mm = o as THREE.Mesh; if (mm.geometry) mm.geometry.dispose(); if (mm.material) (mm.material as THREE.Material).dispose(); });
    this.mats.solid.dispose(); this.mats.facade.dispose(); this.mats.glass.dispose();
  }
}
