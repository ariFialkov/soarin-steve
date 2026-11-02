/**
 * Procedurally generated world: ground chunks, the cash track, scenery and the
 * animated event objects (boost pads and obstacles) placed by the flight plan.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import type { FlightPlan, PlanEvent } from './flightPlan';
import type { ParticleSystem } from './particles';

export const CHUNK = 40;
const GROUND_W = 260;

type Terrain = 'meadow' | 'road' | 'sand' | 'farm' | 'snow';
const TERRAIN_COLORS: Record<Terrain, { base: string; track: string; line: string; label: string }> = {
  meadow: { base: '#8ccf66', track: '#7fc25b', line: '#a5de85', label: '#3f7a2a' },
  road:   { base: '#8d9096', track: '#7f8289', line: '#a9acb3', label: '#2f3238' },
  sand:   { base: '#f0dca3', track: '#e6cf8f', line: '#f8ebbf', label: '#8a6b2c' },
  farm:   { base: '#b8c95f', track: '#a9ba52', line: '#cbd97c', label: '#5a6a1f' },
  snow:   { base: '#f3f6fa', track: '#e4e9f0', line: '#ffffff', label: '#5b6b85' },
};

export interface WorldParams {
  seed: string;
  cashPerUnit: number;   // currency per world unit along the track
  quality: 'low' | 'high';
}

interface Chunk {
  index: number;
  group: THREE.Group;
  disposables: { dispose(): void }[];
  labels: { s: number; mat: THREE.MeshBasicMaterial; color: string }[];
}

export interface EventObject {
  event: PlanEvent;
  group: THREE.Group;
  triggered: boolean;
  age: number;           // seconds since trigger (or -1)
  update(dt: number, elapsed: number): void;
  trigger(): void;
  dispose(): void;
}

/** Accumulates coloured geometry so a whole chunk becomes one mesh. */
class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];
  private tmp = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private euler = new THREE.Euler();

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): void {
    const g = geo.clone();
    this.pos.set(x, y, z);
    this.quat.setFromEuler(this.euler.set(rx, ry, rz));
    this.scl.set(sx, sy, sz);
    this.tmp.compose(this.pos, this.quat, this.scl);
    g.applyMatrix4(this.tmp);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (g.index) { this.parts.push(g.toNonIndexed()); g.dispose(); }
    else this.parts.push(g);
  }

  build(material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    for (const p of this.parts) { p.deleteAttribute('uv'); p.deleteAttribute('uv2'); }
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    return new THREE.Mesh(merged, material);
  }
}

// Shared primitive geometries
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 7, 5),
  cone: new THREE.ConeGeometry(0.5, 1, 7),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  cylTaper: new THREE.CylinderGeometry(0.35, 0.5, 1, 7),
  plane: new THREE.PlaneGeometry(1, 1),
  torus: new THREE.TorusGeometry(0.5, 0.08, 6, 14),
  roof: (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.6, 0); s.lineTo(0.6, 0); s.lineTo(0, 0.5); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g;
  })(),
};

const sceneryMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.55 });
const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });

function fmtCash(v: number): string {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'm';
  if (v >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'k';
  if (v >= 100) return '$' + Math.round(v).toString();
  if (v >= 10) return '$' + v.toFixed(1);
  return '$' + v.toFixed(2);
}

function makeLabel(text: string, color: string, w = 256, h = 72): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.font = `bold ${Math.floor(h * 0.78)}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

export class World {
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private params: WorldParams;
  private terrainFor = new Map<number, Terrain>();
  private eventObjects: EventObject[] = [];
  private particles: ParticleSystem;
  private elapsed = 0;
  private far: THREE.Group;
  private plan: FlightPlan | null = null;

  constructor(params: WorldParams, particles: ParticleSystem) {
    this.params = params;
    this.particles = particles;
    this.far = this.buildFarScenery();
    this.group.add(this.far);
    this.ensure(0, 3);
  }

  get events(): EventObject[] { return this.eventObjects; }

  /** Attach the resolved flight plan: places the boost pads and obstacles. */
  setPlan(plan: FlightPlan, cashPerUnit: number): void {
    for (const eo of this.eventObjects) { this.group.remove(eo.group); eo.dispose(); }
    this.eventObjects = [];
    this.plan = plan;
    for (const e of plan.events) this.eventObjects.push(this.makeEventObject(e));
    for (const eo of this.eventObjects) this.group.add(eo.group);
    this.setCashPerUnit(cashPerUnit);
  }

  /** Re-label the cash track (e.g. when the wager changes). */
  setCashPerUnit(cashPerUnit: number): void {
    this.params.cashPerUnit = cashPerUnit;
    for (const [, ch] of this.chunks) {
      for (const l of ch.labels) {
        const old = l.mat.map;
        const { tex } = makeLabel(fmtCash(l.s * cashPerUnit), l.color);
        l.mat.map = tex;
        l.mat.needsUpdate = true;
        old?.dispose();
        ch.disposables.push(tex);
      }
    }
  }

  private terrain(i: number): Terrain {
    const cached = this.terrainFor.get(i);
    if (cached) return cached;
    const rng = new Rng(`${this.params.seed}:terrain`);
    const kinds: Terrain[] = ['meadow', 'road', 'sand', 'farm', 'snow', 'meadow', 'meadow'];
    let current: Terrain = 'meadow';
    let run = 2;
    for (let c = 0; c <= i; c++) {
      if (run <= 0) {
        let next = rng.pick(kinds);
        if (next === current) next = rng.pick(kinds);
        current = next;
        run = rng.int(2, 4);
      }
      this.terrainFor.set(c, current);
      run--;
    }
    return this.terrainFor.get(i)!;
  }

  /** Make sure chunks around the given z are present. */
  ensure(z: number, ahead = 5): void {
    const idx = Math.max(0, Math.floor(-z / CHUNK));
    for (let i = Math.max(-1, idx - 1); i <= idx + ahead; i++) {
      if (!this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [i, ch] of this.chunks) {
      if (i < idx - 2) {
        this.group.remove(ch.group);
        for (const d of ch.disposables) d.dispose();
        this.chunks.delete(i);
      }
    }
  }

  private buildChunk(i: number): void {
    const rng = new Rng(`${this.params.seed}:chunk:${i}`);
    const terrain = this.terrain(Math.max(0, i));
    const col = TERRAIN_COLORS[terrain];
    const z0 = -i * CHUNK;            // near edge
    const zc = z0 - CHUNK / 2;        // centre
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const labels: Chunk['labels'] = [];

    // ---- ground + track
    const ground = new GeoBatch();
    ground.add(G.plane, col.base, 0, 0, zc, -Math.PI / 2, 0, 0, GROUND_W, CHUNK, 1);
    ground.add(G.plane, col.track, 0, 0.01, zc, -Math.PI / 2, 0, 0, 13, CHUNK, 1);
    // side lines
    ground.add(G.plane, col.line, -6.5, 0.015, zc, -Math.PI / 2, 0, 0, 0.18, CHUNK, 1);
    ground.add(G.plane, col.line, 6.5, 0.015, zc, -Math.PI / 2, 0, 0, 0.18, CHUNK, 1);
    if (terrain === 'road') {
      for (let z = z0 - 2; z > z0 - CHUNK; z -= 6) ground.add(G.plane, '#d9d3b4', 0, 0.012, z, -Math.PI / 2, 0, 0, 0.35, 2.6, 1);
    }
    if (terrain === 'farm') {
      for (let x = -GROUND_W / 2; x < GROUND_W / 2; x += 5) {
        if (Math.abs(x) < 9) continue;
        ground.add(G.plane, '#a6b752', x, 0.008, zc, -Math.PI / 2, 0, 0, 1.6, CHUNK, 1);
      }
    }
    // cross markers every 10 units with cash labels either side
    for (let s = Math.ceil(-z0 / 10) * 10; s < -z0 + CHUNK; s += 10) {
      if (s === 0) continue;
      const z = -s;
      ground.add(G.plane, col.line, 0, 0.016, z, -Math.PI / 2, 0, 0, 13, 0.28, 1);
      const cash = fmtCash(s * this.params.cashPerUnit);
      const { tex, aspect } = makeLabel(cash, col.label);
      disposables.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(mat);
      labels.push({ s, mat, color: col.label });
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(G.plane, mat);
        const h = 1.6;
        m.scale.set(h * aspect, h, 1);
        m.rotation.x = -Math.PI / 2;
        m.position.set(side * (7.5 + h * aspect / 2), 0.02, z + 0.9);
        group.add(m);
      }
    }
    const gm = ground.build(groundMat);
    if (gm) { group.add(gm); disposables.push(gm.geometry); }

    // ---- scenery
    const sc = new GeoBatch();
    const dense = this.params.quality === 'high' ? 1 : 0.55;
    const count = Math.round(rng.range(14, 22) * dense);
    for (let n = 0; n < count; n++) {
      const side = rng.sign();
      const x = side * rng.range(9, 70);
      const z = z0 - rng.range(0, CHUNK);
      const r = rng.next();
      if (terrain === 'snow') {
        if (r < 0.5) this.addPine(sc, rng, x, z, '#dfe9f2');
        else if (r < 0.7) this.addSnowman(sc, x, z);
        else sc.add(G.sphere, '#ffffff', x, 0.3, z, 0, 0, 0, rng.range(1, 2.4), 0.8, rng.range(1, 2.4));
      } else if (terrain === 'sand') {
        if (r < 0.45) this.addPalm(sc, rng, x, z);
        else if (r < 0.7) this.addUmbrella(sc, rng, x, z);
        else sc.add(G.sphere, '#c9b58a', x, 0.2, z, 0, 0, 0, rng.range(0.8, 2), 0.5, rng.range(0.8, 2));
      } else if (terrain === 'road') {
        if (r < 0.4) this.addHouse(sc, rng, x, z);
        else if (r < 0.6) this.addLamp(sc, x, z);
        else if (r < 0.8) this.addTree(sc, rng, x, z);
        else this.addCar(sc, rng, x, z);
      } else if (terrain === 'farm') {
        if (r < 0.3) this.addBarn(sc, rng, x, z);
        else if (r < 0.5) this.addHaybale(sc, x, z);
        else if (r < 0.75) this.addTree(sc, rng, x, z);
        else this.addFence(sc, rng, x, z);
      } else {
        if (r < 0.45) this.addTree(sc, rng, x, z);
        else if (r < 0.65) this.addBush(sc, rng, x, z);
        else if (r < 0.8) this.addFlowers(sc, rng, x, z);
        else if (r < 0.9) this.addHouse(sc, rng, x, z);
        else this.addRock(sc, rng, x, z);
      }
    }
    // clouds (unlit-ish so they stay fluffy white)
    const cl = new GeoBatch();
    const nClouds = Math.round(rng.range(2, 4) * dense);
    for (let n = 0; n < nClouds; n++) this.addCloud(cl, rng, rng.range(-90, 90), rng.range(16, 34), z0 - rng.range(0, CHUNK));
    const cm = cl.build(cloudMat);
    if (cm) { group.add(cm); disposables.push(cm.geometry); }
    // hills in the distance
    if (rng.chance(0.7)) {
      const side = rng.sign();
      sc.add(G.sphere, rng.pick(['#9bd48a', '#86c777', '#a8dc96']), side * rng.range(70, 120), -6, zc, 0, 0, 0, rng.range(60, 110), 30, rng.range(50, 90));
    }
    const sm = sc.build(sceneryMat);
    if (sm) { group.add(sm); disposables.push(sm.geometry); }

    this.group.add(group);
    this.chunks.set(i, { index: i, group, disposables, labels });
  }

  // ---- scenery builders -------------------------------------------------
  private addTree(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const h = rng.range(2.2, 4.5);
    b.add(G.cyl, '#8a5a3c', x, h * 0.25, z, 0, 0, 0, 0.35, h * 0.5, 0.35);
    const greens = ['#5fb458', '#4ea64c', '#73c367', '#3f9a47'];
    const c = rng.pick(greens);
    b.add(G.sphere, c, x, h * 0.6, z, 0, 0, 0, h * 0.55, h * 0.5, h * 0.55);
    b.add(G.sphere, c, x + 0.4, h * 0.85, z - 0.2, 0, 0, 0, h * 0.4, h * 0.38, h * 0.4);
    b.add(G.sphere, c, x - 0.35, h * 0.8, z + 0.25, 0, 0, 0, h * 0.38, h * 0.35, h * 0.38);
  }
  private addPine(b: GeoBatch, rng: Rng, x: number, z: number, snow?: string): void {
    const h = rng.range(2.5, 5);
    b.add(G.cyl, '#7a4b2c', x, h * 0.2, z, 0, 0, 0, 0.3, h * 0.4, 0.3);
    const c = rng.pick(['#2f8a4b', '#3c9c5a', '#2b7a44']);
    for (let i = 0; i < 3; i++) {
      const y = h * (0.35 + i * 0.22);
      const s = h * (0.55 - i * 0.12);
      b.add(G.cone, c, x, y, z, 0, 0, 0, s, h * 0.35, s);
      if (snow) b.add(G.cone, snow, x, y + h * 0.1, z, 0, 0, 0, s * 0.8, h * 0.18, s * 0.8);
    }
  }
  private addPalm(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const h = rng.range(3, 5);
    b.add(G.cylTaper, '#a8784a', x, h / 2, z, 0.15, 0, 0, 0.35, h, 0.35);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.add(G.box, '#4fae5a', x + Math.cos(a) * 1.1, h + 0.1 - Math.sin(i) * 0.1, z + Math.sin(a) * 1.1 - h * 0.15, 0.6 * Math.sin(a), -a, 0.6 * Math.cos(a), 2.2, 0.08, 0.5);
    }
    b.add(G.sphere, '#7a5a35', x + 0.3, h - 0.1, z - h * 0.15, 0, 0, 0, 0.4);
  }
  private addUmbrella(b: GeoBatch, rng: Rng, x: number, z: number): void {
    b.add(G.cyl, '#eee', x, 1, z, 0, 0, 0, 0.06, 2, 0.06);
    b.add(G.cone, rng.pick(['#f26b6b', '#5fb8e6', '#f2c14e', '#e5679a']), x, 2, z, 0, 0, 0, 2.2, 0.5, 2.2);
    b.add(G.box, '#f7e7c8', x + 1.4, 0.15, z, 0, 0.4, 0, 1.8, 0.3, 0.8);
  }
  private addSnowman(b: GeoBatch, x: number, z: number): void {
    b.add(G.sphere, '#ffffff', x, 0.6, z, 0, 0, 0, 1.3);
    b.add(G.sphere, '#ffffff', x, 1.5, z, 0, 0, 0, 1.0);
    b.add(G.sphere, '#ffffff', x, 2.2, z, 0, 0, 0, 0.7);
    b.add(G.cone, '#f28e2b', x, 2.2, z + 0.4, Math.PI / 2, 0, 0, 0.15, 0.4, 0.15);
    b.add(G.cyl, '#2b2b2b', x, 2.7, z, 0, 0, 0, 0.5, 0.35, 0.5);
  }
  private addBush(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const c = rng.pick(['#5fb458', '#4ea64c', '#73c367']);
    b.add(G.sphere, c, x, 0.5, z, 0, 0, 0, 1.4, 1.0, 1.4);
    b.add(G.sphere, c, x + 0.6, 0.4, z + 0.3, 0, 0, 0, 1.0, 0.8, 1.0);
  }
  private addFlowers(b: GeoBatch, rng: Rng, x: number, z: number): void {
    for (let i = 0; i < 6; i++) {
      const fx = x + rng.range(-1.5, 1.5), fz = z + rng.range(-1.5, 1.5);
      b.add(G.cyl, '#4e9a46', fx, 0.25, fz, 0, 0, 0, 0.05, 0.5, 0.05);
      b.add(G.sphere, rng.pick(['#ff7b9c', '#ffd166', '#ffffff', '#c084fc']), fx, 0.55, fz, 0, 0, 0, 0.26);
    }
  }
  private addRock(b: GeoBatch, rng: Rng, x: number, z: number): void {
    b.add(G.sphere, '#a7a39b', x, 0.3, z, 0, rng.range(0, 3), 0, rng.range(0.8, 1.8), 0.7, rng.range(0.8, 1.6));
  }
  private addHouse(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const w = rng.range(2.4, 3.6), d = rng.range(2.4, 3.4), h = rng.range(1.8, 2.6);
    const wall = rng.pick(['#fff1d6', '#ffd9c2', '#d8ecff', '#f5e0f2', '#f2f2f2']);
    const roof = rng.pick(['#e2574c', '#5d7a3c', '#4a6fa5', '#8d5a3b']);
    b.add(G.box, wall, x, h / 2, z, 0, 0, 0, w, h, d);
    b.add(G.roof, roof, x, h, z, 0, 0, 0, w / 1.2 * 1.1, h * 0.55, d * 1.1);
    b.add(G.box, '#8d5a3b', x, 0.6, z + d / 2 + 0.01, 0, 0, 0, 0.7, 1.2, 0.05);
    b.add(G.box, '#9fd8ff', x + w * 0.3, h * 0.6, z + d / 2 + 0.01, 0, 0, 0, 0.6, 0.6, 0.05);
    b.add(G.box, '#9fd8ff', x - w * 0.3, h * 0.6, z + d / 2 + 0.01, 0, 0, 0, 0.6, 0.6, 0.05);
    b.add(G.box, '#c0c0c0', x + w * 0.3, h + 0.6, z - d * 0.2, 0, 0, 0, 0.4, 0.9, 0.4);
  }
  private addBarn(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const w = rng.range(4, 5.5), d = rng.range(5, 7), h = 3;
    b.add(G.box, '#c7453b', x, h / 2, z, 0, 0, 0, w, h, d);
    b.add(G.roof, '#5a3a2a', x, h, z, 0, 0, 0, w / 1.2 * 1.1, h * 0.6, d * 1.1);
    b.add(G.box, '#f5f1e6', x, 1.2, z + d / 2 + 0.02, 0, 0, 0, 1.8, 2.2, 0.05);
  }
  private addHaybale(b: GeoBatch, x: number, z: number): void {
    b.add(G.cyl, '#e2c56b', x, 0.7, z, 0, 0, Math.PI / 2, 1.4, 1.6, 1.4);
  }
  private addFence(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      b.add(G.box, '#c8a775', x, 0.5, z - i * 1.4, 0, 0, 0, 0.14, 1.0, 0.14);
    }
    b.add(G.box, '#c8a775', x, 0.75, z - (n - 1) * 0.7, 0, 0, 0, 0.08, 0.1, (n - 1) * 1.4);
    b.add(G.box, '#c8a775', x, 0.4, z - (n - 1) * 0.7, 0, 0, 0, 0.08, 0.1, (n - 1) * 1.4);
  }
  private addLamp(b: GeoBatch, x: number, z: number): void {
    b.add(G.cyl, '#555b66', x, 2, z, 0, 0, 0, 0.12, 4, 0.12);
    b.add(G.sphere, '#fff3b0', x, 4.1, z, 0, 0, 0, 0.5);
  }
  private addCar(b: GeoBatch, rng: Rng, x: number, z: number): void {
    const c = rng.pick(['#f26b6b', '#5fb8e6', '#f2c14e', '#7bc96f', '#ffffff']);
    b.add(G.box, c, x, 0.5, z, 0, 0, 0, 1.4, 0.6, 2.8);
    b.add(G.box, '#bfe9ff', x, 1.0, z - 0.1, 0, 0, 0, 1.2, 0.5, 1.4);
    for (const dz of [-0.9, 0.9]) for (const dx of [-0.7, 0.7]) b.add(G.cyl, '#2b2b2b', x + dx, 0.3, z + dz, 0, 0, Math.PI / 2, 0.6, 0.2, 0.6);
  }
  private addCloud(b: GeoBatch, rng: Rng, x: number, y: number, z: number): void {
    const s = rng.range(2.5, 5);
    b.add(G.sphere, '#ffffff', x, y, z, 0, 0, 0, s * 1.6, s * 0.9, s);
    b.add(G.sphere, '#ffffff', x + s * 0.9, y + s * 0.15, z, 0, 0, 0, s * 1.1, s * 0.8, s * 0.9);
    b.add(G.sphere, '#ffffff', x - s * 0.9, y - s * 0.05, z, 0, 0, 0, s * 1.0, s * 0.7, s * 0.9);
  }

  private buildFarScenery(): THREE.Group {
    const g = new THREE.Group();
    const b = new GeoBatch();
    const rng = new Rng(this.params.seed + ':far');
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 90 + rng.range(-20, 20);
      const h = rng.range(60, 120);
      b.add(G.cone, rng.pick(['#bcd8e8', '#a9cce3', '#c9e0ee']), x, h / 2 - 10, -420, 0, 0, 0, h * 1.4, h, h);
    }
    const m = b.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    if (m) g.add(m);
    return g;
  }

  // ---- event objects ----------------------------------------------------
  private makeEventObject(e: PlanEvent): EventObject {
    const group = new THREE.Group();
    const z = -e.s;
    const plan = this.plan!;
    const h = plan.h[Math.min(plan.h.length - 1, Math.round(e.t / plan.dt))];
    group.position.set(0, 0, z);
    const parts: THREE.Object3D[] = [];
    const mats: THREE.Material[] = [];
    const mkMat = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) => { const m = new THREE.MeshLambertMaterial({ color: c, ...extra }); mats.push(m); return m; };
    const particles = this.particles;
    let update: (dt: number, elapsed: number) => void = () => {};
    let onTrigger: () => void = () => {};
    const self: EventObject = {
      event: e, group, triggered: false, age: -1,
      update(dt, elapsed) { if (this.triggered) this.age += dt; update(dt, elapsed); },
      trigger() { if (this.triggered) return; this.triggered = true; this.age = 0; onTrigger(); },
      dispose() { for (const m of mats) m.dispose(); },
    };

    switch (e.kind) {
      case 'fan': {
        // a big pedestal fan beside the track, head at plane height, blowing forward
        const x = e.x > 0 ? 3.2 : -3.2;
        const stand = new THREE.Mesh(G.cyl, mkMat('#6d7480'));
        stand.scale.set(0.25, h, 0.25); stand.position.set(x, h / 2, 1.5);
        const base = new THREE.Mesh(G.cyl, mkMat('#6d7480'));
        base.scale.set(1.6, 0.2, 1.6); base.position.set(x, 0.1, 1.5);
        const head = new THREE.Group();
        head.position.set(x, h, 1.5);
        head.rotation.y = x > 0 ? 0.5 : -0.5;
        const ring = new THREE.Mesh(G.torus, mkMat('#4a90d9'));
        ring.scale.set(2.4, 2.4, 2.4);
        const hub = new THREE.Mesh(G.sphere, mkMat('#2d2f36')); hub.scale.setScalar(0.35);
        const blades = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const bl = new THREE.Mesh(G.box, mkMat('#dfe6ee'));
          bl.scale.set(0.35, 1.0, 0.04); bl.position.set(0, 0.55, 0);
          const p = new THREE.Group(); p.rotation.z = (i / 3) * Math.PI * 2; p.add(bl);
          blades.add(p);
        }
        head.add(ring, hub, blades);
        group.add(stand, base, head);
        parts.push(blades);
        let spin = 0;
        update = (dt) => {
          const target = self.triggered && self.age < 3 ? 25 : 2;
          spin += (target - spin) * Math.min(1, dt * 3);
          blades.rotation.z += spin * dt;
          if (self.triggered && self.age < 2.2 && Math.random() < 0.7) {
            particles.emit({ pos: new THREE.Vector3(x * 0.7, h + Math.random() * 0.6 - 0.3, z + 1), vel: new THREE.Vector3(-x * 2, 0.3, -12), spread: 1.5, count: 2, life: 0.6, size: 0.18, endSize: 0.02, colors: ['#ffffff', '#e6f3ff'], drag: 0.5 });
          }
        };
        break;
      }
      case 'geyser': {
        const pool = new THREE.Mesh(G.cyl, mkMat('#5fb8e6'));
        pool.scale.set(3.2, 0.12, 3.2); pool.position.set(e.x, 0.06, 0);
        const rim = new THREE.Mesh(G.torus, mkMat('#b7a37a'));
        rim.scale.setScalar(3.3); rim.rotation.x = Math.PI / 2; rim.position.set(e.x, 0.1, 0);
        group.add(pool, rim);
        update = (dt) => {
          if (self.triggered && self.age < 2.5) {
            particles.emit({ pos: new THREE.Vector3(e.x, 0.3, z), vel: new THREE.Vector3(0, 14 + h * 1.2, 0), spread: 1.4, count: 6, life: 1.4, size: 0.35, endSize: 0.05, colors: ['#9fdcff', '#ffffff', '#5fb8e6'], drag: 0.8, gravity: 9 });
          } else if (Math.random() < dt * 4) {
            particles.emit({ pos: new THREE.Vector3(e.x, 0.3, z), vel: new THREE.Vector3(0, 2, 0), spread: 0.4, count: 1, life: 0.8, size: 0.2, endSize: 0, colors: ['#bfe9ff'], drag: 1 });
          }
        };
        break;
      }
      case 'balloon': {
        const cols = ['#f26b6b', '#f2c14e', '#5fb8e6', '#7bc96f', '#e5679a'];
        const cluster = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const ba = new THREE.Mesh(G.sphere, mkMat(cols[i % cols.length]));
          ba.scale.set(1.2, 1.5, 1.2);
          ba.position.set(Math.cos(i * 1.3) * 1.1, Math.sin(i * 1.7) * 0.6, Math.sin(i * 1.3) * 0.8);
          cluster.add(ba);
          const str = new THREE.Mesh(G.cyl, mkMat('#777'));
          str.scale.set(0.02, h, 0.02); str.position.set(ba.position.x, -h / 2 - 0.4, ba.position.z);
          cluster.add(str);
        }
        cluster.position.set(e.x, h + 0.4, 0);
        group.add(cluster);
        update = (_dt, elapsed) => {
          cluster.position.y = h + 0.4 + Math.sin(elapsed * 1.3) * 0.25;
          if (self.triggered && self.age < 0.6) {
            const s = 1 + Math.sin(self.age / 0.6 * Math.PI) * 0.35;
            cluster.scale.set(s, 1 / s, s);
          } else cluster.scale.setScalar(1);
        };
        break;
      }
      case 'trampoline': {
        // a bouncy cloud at plane height
        const cloud = new THREE.Group();
        for (const [dx, dy, s] of [[0, 0, 2.2], [1.4, 0.3, 1.6], [-1.4, 0.2, 1.5], [0.5, 0.6, 1.3], [-0.6, 0.6, 1.2]]) {
          const m = new THREE.Mesh(G.sphere, mkMat('#fff8f0'));
          m.scale.set(s * 1.3, s * 0.8, s); m.position.set(dx, dy, 0);
          cloud.add(m);
        }
        cloud.position.set(e.x, h - 0.9, 0);
        group.add(cloud);
        update = (_dt, elapsed) => {
          let s = 1;
          if (self.triggered && self.age < 0.8) s = 1 + Math.sin(self.age / 0.8 * Math.PI) * 0.4;
          cloud.scale.set(s, 1 / s, s);
          cloud.position.y = h - 0.9 + Math.sin(elapsed * 0.9) * 0.15;
        };
        break;
      }
      case 'gust': {
        const cloud = new THREE.Group();
        for (const [dx, dy, s] of [[0, 0, 2.4], [1.6, 0.4, 1.8], [-1.7, 0.3, 1.7], [0.6, 0.9, 1.4]]) {
          const m = new THREE.Mesh(G.sphere, mkMat('#e9f1fb'));
          m.scale.set(s * 1.4, s * 0.8, s); m.position.set(dx, dy, 0);
          cloud.add(m);
        }
        const side = e.x > 0 ? 1 : -1;
        cloud.position.set(side * 4.5, h + 0.5, 1.5);
        group.add(cloud);
        update = (dt, elapsed) => {
          cloud.position.y = h + 0.5 + Math.sin(elapsed * 0.8 + 1) * 0.2;
          if (self.triggered && self.age < 2 && Math.random() < 0.8) {
            particles.emit({ pos: new THREE.Vector3(side * 3.2, h + Math.random() * 0.8 - 0.4, z + 1.2), vel: new THREE.Vector3(-side * 3, 0.5, -11), spread: 1.2, count: 2, life: 0.7, size: 0.16, endSize: 0.02, colors: ['#ffffff'], drag: 0.4 });
          }
          void dt;
        };
        break;
      }
      case 'tree': {
        const tx = (e.x >= 0 ? 1 : -1) * 2.1;
        const trunk = new THREE.Mesh(G.cyl, mkMat('#8a5a3c'));
        const th = h + 1.0;
        trunk.scale.set(0.5, th, 0.5); trunk.position.set(tx, th / 2, 0);
        const canopy = new THREE.Group();
        const c = mkMat('#4ea64c');
        for (const [dx, dy, dz, s] of [[0, 0, 0, 2.6], [1.0, 0.6, -0.3, 1.9], [-0.9, 0.5, 0.4, 1.8], [0.2, 1.1, 0.2, 1.5]]) {
          const m = new THREE.Mesh(G.sphere, c); m.scale.setScalar(s); m.position.set(dx, dy, dz); canopy.add(m);
        }
        canopy.position.set(tx, h, 0);
        group.add(trunk, canopy);
        update = () => {
          if (self.triggered && self.age < 1.2) {
            const a = Math.sin(self.age * 18) * 0.12 * (1 - self.age / 1.2);
            canopy.rotation.z = a; canopy.rotation.x = a * 0.6;
            if (self.age < 0.4 && Math.random() < 0.6) particles.emit({ pos: new THREE.Vector3(tx * 0.5, h + 0.5, z), vel: new THREE.Vector3(0, 1, 2), spread: 2.5, count: 3, life: 1.2, size: 0.22, endSize: 0.1, colors: ['#5fb458', '#3f9a47', '#8fd16b'], drag: 1.2, gravity: 3, spin: 6 });
          }
        };
        break;
      }
      case 'bird': {
        const bird = new THREE.Group();
        const body = new THREE.Mesh(G.sphere, mkMat('#f2f2f2')); body.scale.set(0.5, 0.45, 0.8);
        const beak = new THREE.Mesh(G.cone, mkMat('#f2a23a')); beak.scale.set(0.18, 0.35, 0.18); beak.rotation.x = -Math.PI / 2; beak.position.z = -0.5;
        const wl = new THREE.Mesh(G.box, mkMat('#e6e6e6')); wl.scale.set(1.1, 0.06, 0.5); wl.position.x = -0.7;
        const wr = wl.clone(); wr.position.x = 0.7;
        bird.add(body, beak, wl, wr);
        bird.position.set(e.x, h, 0);
        group.add(bird);
        let vx = 0;
        update = (dt, elapsed) => {
          const flap = Math.sin(elapsed * 10) * 0.6;
          wl.rotation.z = flap; wr.rotation.z = -flap;
          bird.position.y = h + Math.sin(elapsed * 2) * 0.3;
          if (self.triggered) {
            vx += dt * 6;
            bird.position.x += (e.x > 0 ? 1 : -1) * vx * dt;
            bird.position.y += dt * 2.5;
            if (self.age < 0.3 && Math.random() < 0.6) particles.emit({ pos: bird.position.clone().add(new THREE.Vector3(0, 0, z)), vel: new THREE.Vector3(0, 1, 1), spread: 2, count: 3, life: 1.5, size: 0.18, endSize: 0.12, colors: ['#ffffff', '#f2f2f2'], drag: 1, gravity: 1.5, spin: 8 });
          }
        };
        break;
      }
      case 'kite': {
        const kx = (e.x >= 0 ? 1 : -1) * 2.4;
        const kite = new THREE.Group();
        const body = new THREE.Mesh(G.plane, mkMat(e.x > 0 ? '#f26b6b' : '#5fb8e6', { side: THREE.DoubleSide, emissive: e.x > 0 ? '#f26b6b' : '#5fb8e6', emissiveIntensity: 0.35 }));
        body.scale.set(1.1, 1.5, 1); body.rotation.z = Math.PI / 4; body.rotation.y = 0.5;
        kite.add(body);
        for (let i = 0; i < 5; i++) {
          const bow = new THREE.Mesh(G.box, mkMat(['#ffd166', '#ffffff', '#7bc96f'][i % 3], { emissive: '#ffffff', emissiveIntensity: 0.2 }));
          bow.scale.set(0.3, 0.1, 0.05); bow.position.set(0, -1.0 - i * 0.4, 0.15 * i);
          kite.add(bow);
        }
        // string runs from the kite down and away from the track
        const str = new THREE.Mesh(G.cyl, mkMat('#b9b2a6'));
        const sx = kx * 2.6, sy = 0.2;
        const len = Math.hypot(sx - kx, sy - (h + 0.6), 3);
        str.scale.set(0.015, len, 0.015);
        str.position.set((kx + sx) / 2, (h + 0.6 + sy) / 2, 1.5);
        str.lookAt(sx, sy, 3); str.rotateX(Math.PI / 2);
        kite.position.set(kx, h + 0.6, 0);
        group.add(kite, str);
        update = (_dt, elapsed) => {
          kite.rotation.z = Math.sin(elapsed * 1.5) * 0.2;
          kite.position.x = kx + Math.sin(elapsed * 0.8) * 0.3;
          if (self.triggered) {
            kite.rotation.z += Math.sin(self.age * 20) * 0.3 * Math.max(0, 1 - self.age);
          }
        };
        break;
      }
      case 'pole': {
        const pole = new THREE.Mesh(G.cyl, mkMat('#555b66'));
        const ph = h + 1.5;
        pole.scale.set(0.18, ph, 0.18); pole.position.set(e.x + 0.9, ph / 2, 0);
        const flag = new THREE.Mesh(G.plane, mkMat('#f2c14e', { side: THREE.DoubleSide }));
        flag.scale.set(2.2, 1.3, 1); flag.position.set(e.x - 0.3, h + 0.2, 0);
        flag.rotation.y = Math.PI / 2;
        group.add(pole, flag);
        update = (_dt, elapsed) => {
          flag.rotation.y = Math.PI / 2 + Math.sin(elapsed * 3) * 0.15;
          if (self.triggered && self.age < 1) flag.rotation.x = Math.sin(self.age * 25) * 0.5 * (1 - self.age);
        };
        break;
      }
      case 'bush': {
        // a laundry line across the track
        const cols = ['#ffffff', '#ffd166', '#9fd8ff', '#ff9ecb', '#c3f0a8'];
        const m1 = new THREE.Mesh(G.cyl, mkMat('#8a5a3c')); m1.scale.set(0.15, h + 0.8, 0.15); m1.position.set(-4, (h + 0.8) / 2, 0);
        const m2 = m1.clone(); m2.position.x = 4;
        const line = new THREE.Mesh(G.cyl, mkMat('#444')); line.scale.set(0.03, 8, 0.03); line.rotation.z = Math.PI / 2; line.position.set(0, h + 0.7, 0);
        group.add(m1, m2, line);
        const sheets: THREE.Mesh[] = [];
        for (let i = 0; i < 5; i++) {
          const s = new THREE.Mesh(G.plane, mkMat(cols[i], { side: THREE.DoubleSide }));
          s.scale.set(1.2, 1.1, 1); s.position.set(-3 + i * 1.5, h + 0.1, 0);
          group.add(s); sheets.push(s);
        }
        update = (_dt, elapsed) => {
          sheets.forEach((s, i) => {
            s.rotation.x = Math.sin(elapsed * 2 + i) * 0.15 + (self.triggered && self.age < 1.2 ? Math.sin(self.age * 15 + i) * 0.9 * (1 - self.age / 1.2) : 0);
          });
        };
        break;
      }
    }
    void parts;
    return self;
  }

  update(dt: number, planeZ: number, cameraZ: number): void {
    this.elapsed += dt;
    this.ensure(planeZ);
    this.far.position.z = planeZ * 0.92;
    for (const eo of this.eventObjects) {
      const dz = eo.group.position.z - cameraZ;
      // never let the trailing camera sit inside an object
      eo.group.visible = !(dz > -1.5 && dz < 3.2);
      if (Math.abs(eo.group.position.z - planeZ) < 160) eo.update(dt, this.elapsed);
    }
  }

  dispose(): void {
    for (const [, ch] of this.chunks) { this.group.remove(ch.group); for (const d of ch.disposables) d.dispose(); }
    this.chunks.clear();
    for (const eo of this.eventObjects) eo.dispose();
    this.far.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  }
}
