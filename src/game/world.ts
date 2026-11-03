/**
 * The world: a procedural city streamed in macro tiles around the flight
 * route, the cash track painted along the route, moving traffic, ambient sky
 * life, filler obstacles and the flight plan's event objects.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { FlightPlan, Surface } from './flightPlan';
import type { ParticleSystem } from './particles';
import { GeoBatch, BOX, CYL, CYL_LO, SPHERE, SPHERE_LO, CONE, makeGlassTexture, makeWindowTexture, stripQuad } from './geobatch';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MACRO, buildFarMacroTile, buildMacroTile, makeCityCtx, type AnimatedObject, type Batches, type BlockInfo, type CityCtx, type District } from './city';
import { Route, PX, PZ, STREET_HALF, type RouteSample } from './route';
import { Terrain } from './terrain';
import { DECOY_KINDS, STREET_DECOY_KINDS, balloonEnvelope, makeEventObject, type EventObject } from './events';

const MX = MACRO * PX, MZ = MACRO * PZ;
const NEAR_RI = 1, NEAR_RJ = 1;   // macro tiles around each route sample in full detail (across, along)
const FAR_RI = 3, FAR_RJ = 2;     // cheap massing beyond that
const AHEAD = 520;     // route distance covered by the window
const BEHIND = 90;
const TRACK_STEP = 40;    // one baked piece per 40 units
const MARK_STEP = 10;     // a cash marker every 10 units

export interface WorldParams {
  seed: string;
  cashPerUnit: number;
  quality: 'low' | 'high';
}

interface Tile {
  key: string;
  far: boolean;
  group: THREE.Group;
  disposables: { dispose(): void }[];
  animated: AnimatedObject[];
  decoys: EventObject[];
}

interface TrackPiece {
  group: THREE.Group;
  disposables: { dispose(): void }[];
  labels: { s: number; mat: THREE.MeshBasicMaterial; fill: string; stroke: string }[];
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

/** Road ribbon paint per surface: base, kerb and track are shades of the same material. */
const TRACK_STYLE: Record<Surface, { base: string; kerb: string; track: string; line: string; lane: string; cross: string; label: string; stroke: string }> = {
  asphalt: { base: '#6f7378', kerb: '#8f8a80', track: '#777b81', line: '#5f6369', lane: '#b9a04a', cross: '#575b61', label: '#3e4147', stroke: '#9a9ea5' },
  cobble:  { base: '#857a6e', kerb: '#a39888', track: '#8e8376', line: '#6f655a', lane: '#c2a874', cross: '#665c51', label: '#4a4038', stroke: '#b3a796' },
  pavers:  { base: '#cdb994', kerb: '#b9a37c', track: '#d6c4a1', line: '#b39c74', lane: '#a88d62', cross: '#a3895f', label: '#6e5530', stroke: '#eadcbf' },
  bridge:  { base: '#8b8f96', kerb: '#9ea3aa', track: '#969aa1', line: '#7a7e85', lane: '#a39f7a', cross: '#6e7279', label: '#4a4e55', stroke: '#aab0b8' },
};

export class World {
  readonly group = new THREE.Group();
  readonly route: Route;
  readonly terrain: Terrain;
  readonly city: CityCtx;
  private tiles = new Map<string, Tile>();
  private track = new Map<number, TrackPiece>();
  private params: WorldParams;
  private eventObjects: EventObject[] = [];
  private particles: ParticleSystem;
  private elapsed = 0;
  private sky: THREE.Group;
  private mats = materials();
  private matCache = new Map<string, THREE.Material>();
  private carGeo = { body: new THREE.BoxGeometry(1.7, 0.7, 3.8), cabin: new THREE.BoxGeometry(1.5, 0.55, 2.0), wheel: new THREE.CylinderGeometry(0.32, 0.32, 0.3, 8), busBody: new THREE.BoxGeometry(2.3, 2.6, 9), busGlass: new THREE.BoxGeometry(2.36, 0.9, 8.4) };
  private sample: RouteSample = { x: 0, z: 0, tx: 0, tz: -1, nx: 1, nz: 0, heading: 0 };
  private sample2: RouteSample = { x: 0, z: 0, tx: 0, tz: -1, nx: 1, nz: 0, heading: 0 };

  constructor(params: WorldParams, particles: ParticleSystem) {
    this.params = params;
    this.particles = particles;
    this.route = new Route(params.seed);
    this.terrain = new Terrain(params.seed);
    this.city = makeCityCtx(params.seed, this.route, this.terrain);
    this.sky = this.buildSky();
    this.group.add(this.sky);
    this.stream(0, Infinity);
  }

  get events(): EventObject[] { return this.eventObjects; }

  /** Ground height under a route position. */
  groundAt(s: number): number {
    const r = this.route.at(s, this.sample);
    return this.terrain.at(r.x, r.z);
  }

  /** What the road under the flight line is made of at route distance s. */
  surfaceAt(s: number): Surface {
    const r = this.route.at(s, this.sample);
    const jz = Math.floor(-r.z / PZ);
    if (this.city.isRiverRow(jz)) return 'bridge';
    const d = this.city.districtAt(Math.floor((r.x + 1) / PX), jz);
    return d === 'oldtown' ? 'cobble' : d === 'park' ? 'pavers' : 'asphalt';
  }

  districtAt(s: number): District {
    const r = this.route.at(s, this.sample);
    return this.city.districtAt(Math.floor((r.x + r.nx * 2) / PX), Math.floor(-(r.z + r.nz * 2) / PZ));
  }

  private mkMat = (c: string): THREE.Material => {
    let m = this.matCache.get(c);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); this.matCache.set(c, m); }
    return m;
  };

  // ------------------------------------------------------------------ events
  setPlan(plan: FlightPlan, cashPerUnit: number): void {
    for (const eo of this.eventObjects) { this.group.remove(eo.group); eo.dispose(); }
    this.eventObjects = [];
    for (const e of plan.events) {
      const h = plan.h[Math.min(plan.h.length - 1, Math.round(e.t / plan.dt))];
      const eo = makeEventObject(e, h, this.particles);
      const r = this.route.at(e.s);
      eo.anchor(r.x, this.terrain.at(r.x, r.z), r.z, r.nx, r.nz, r.heading);
      this.eventObjects.push(eo);
      this.group.add(eo.group);
    }
    this.setCashPerUnit(cashPerUnit);
  }

  setCashPerUnit(cashPerUnit: number): void {
    this.params.cashPerUnit = cashPerUnit;
    for (const [, p] of this.track) {
      for (const l of p.labels) {
        const old = l.mat.map;
        const { tex } = makeLabel(fmtCash(l.s * cashPerUnit), l.fill, l.stroke);
        l.mat.map = tex;
        l.mat.needsUpdate = true;
        old?.dispose();
        p.disposables.push(tex);
      }
    }
  }

  // ------------------------------------------------------------------ streaming
  /** Keep tiles and track around route position s. `budget` limits full-detail builds per call. */
  stream(s: number, budget = 1): void {
    this.route.ensure(s + AHEAD + 300);
    const near = new Set<string>();
    const far = new Set<string>();
    for (let q = s - BEHIND; q <= s + AHEAD; q += 24) {
      const r = this.route.at(Math.max(0, q), this.sample);
      const I = Math.floor(r.x / MX), J = Math.floor(-r.z / MZ);
      for (let di = -FAR_RI; di <= FAR_RI; di++) for (let dj = -FAR_RJ; dj <= FAR_RJ; dj++) {
        const key = `${I + di}:${J + dj}`;
        if (Math.abs(di) <= NEAR_RI && Math.abs(dj) <= NEAR_RJ) { near.add(key); far.delete(key); }
        else if (!near.has(key)) far.add(key);
      }
    }
    let built = 0;
    for (const key of near) {
      const t = this.tiles.get(key);
      if (t && !t.far) continue;
      if (built >= budget) break;
      if (t) this.disposeTile(t);
      this.buildTile(key, false);
      built++;
    }
    let farBuilt = 0;
    for (const key of far) {
      if (this.tiles.has(key)) continue;
      if (farBuilt >= budget * 2) break;
      this.buildTile(key, true);
      farBuilt++;
    }
    for (const [key, t] of this.tiles) {
      if (!near.has(key) && !far.has(key)) this.disposeTile(t);
    }
    // cash track pieces along the route
    const k0 = Math.max(0, Math.floor((s - BEHIND) / TRACK_STEP)), k1 = Math.floor((s + AHEAD) / TRACK_STEP);
    for (let k = k0; k <= k1; k++) if (!this.track.has(k)) this.buildTrackPiece(k);
    for (const [k, p] of this.track) if (k < k0 - 2 || k > k1 + 2) { this.group.remove(p.group); for (const d of p.disposables) d.dispose(); this.track.delete(k); }
  }

  private disposeTile(t: Tile): void {
    this.group.remove(t.group);
    for (const d of t.disposables) d.dispose();
    for (const a of t.animated) a.dispose();
    for (const d of t.decoys) d.dispose();
    this.tiles.delete(t.key);
  }

  private buildTile(key: string, far: boolean): void {
    const [I, J] = key.split(':').map(Number);
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const B: Batches = { solid: new GeoBatch(), facade: new GeoBatch(), glass: new GeoBatch() };
    const animated: AnimatedObject[] = [];
    const decoys: EventObject[] = [];
    if (far) {
      buildFarMacroTile(B, this.city, I, J);
    } else {
      const res = buildMacroTile(B, this.city, I, J, this.params.quality, this.mkMat);
      animated.push(...res.animated);
      const rng = new Rng(`${this.params.seed}:tile:${key}`);
      // life only where the camera can see it: the two tile columns straddling the flight line
      const central = I === -1 || I === 0;
      this.addTraffic(animated, rng, res.blocks, central ? 1 : 0.4);
      if (central) {
        this.addAmbient(animated, rng, I, J, res.blocks);
        this.addDecoys(group, decoys, rng, I, J, res.blocks);
      }
    }
    const solid = B.solid.build(this.mats.solid);
    const facade = B.facade.build(this.mats.facade);
    const glass = B.glass.build(this.mats.glass);
    for (const m of [solid, facade, glass]) if (m) { group.add(m); disposables.push(m.geometry); }
    for (const a of animated) group.add(a.obj);
    this.group.add(group);
    this.tiles.set(key, { key, far, group, disposables, animated, decoys });
  }

  // ------------------------------------------------------------------ cash track
  private buildTrackPiece(k: number): void {
    const s0 = k * TRACK_STEP;
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const B = new GeoBatch();
    const hAt = (x: number, z: number) => this.terrain.at(x, z);
    const ro = (q: number) => this.route.roadOffset(q);
    const labels: TrackPiece['labels'] = [];
    const sub = 20;  // 2-unit sub-segments so the ribbon follows its bends
    for (let i = 0; i < sub; i++) {
      const qa = s0 + (i / sub) * TRACK_STEP, qb = s0 + ((i + 1) / sub) * TRACK_STEP;
      const surf = this.surfaceAt(qa + 1);
      const onBridge = surf === 'bridge';
      const st = TRACK_STYLE[surf];
      const a = this.route.at(qa, this.sample);
      const b = this.route.at(qb, this.sample2);
      const oa = ro(qa), ob = ro(qb);
      const ax = a.x + a.nx * oa, az = a.z + a.nz * oa, bx = b.x + b.nx * ob, bz = b.z + b.nz * ob;
      if (!onBridge) {
        B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 7.4, hAt, 0.07), st.kerb);       // kerb line
        B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 7, hAt, 0.09), st.base);         // road surface
      }
      B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 6, hAt, 0.12), st.track);
      if (i % 2 === 0) {
        B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 0.09, hAt, 0.15), st.lane);
        B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 0.08, hAt, 0.15, 3.5), st.line);
        B.addRaw(stripQuad(ax, az, bx, bz, a.nx, a.nz, b.nx, b.nz, 0.08, hAt, 0.15, -3.5), st.line);
      }
      // a lamp every 20 units, alternating sides
      if (i % 10 === 5 && !onBridge) {
        const side = ((qa / 20) | 0) % 2 === 0 ? 1 : -1;
        const lx = a.x + a.nx * (oa + side * 8.6), lz = a.z + a.nz * (oa + side * 8.6);
        const ly = hAt(lx, lz);
        B.add(CYL_LO, '#4b515b', lx, ly + 3, lz, 0, 0, 0, 0.16, 6, 0.16);
        B.add(BOX, '#4b515b', lx - a.nx * side * 0.6, ly + 6, lz - a.nz * side * 0.6, 0, a.heading, 0, 1.3, 0.14, 0.14);
        B.add(BOX, '#fff3b0', lx - a.nx * side * 1.1, ly + 5.85, lz - a.nz * side * 1.1, 0, a.heading, 0, 0.6, 0.3, 0.5);
      }
    }
    // markers with a cash label either side, each marker's two labels baked into one mesh
    for (let m = 0; m < TRACK_STEP / MARK_STEP; m++) {
      const sm = s0 + m * MARK_STEP;
      if (sm <= 0) continue;
      const r0 = this.route.at(sm, this.sample);
      const o0 = ro(sm);
      const rx = r0.x + r0.nx * o0, rz = r0.z + r0.nz * o0;
      const st = TRACK_STYLE[this.surfaceAt(sm)];
      const ax = rx - r0.tx * 0.18, az = rz - r0.tz * 0.18, bx = rx + r0.tx * 0.18, bz = rz + r0.tz * 0.18;
      B.addRaw(stripQuad(ax, az, bx, bz, r0.nx, r0.nz, r0.nx, r0.nz, 6, hAt, 0.17), st.cross);
      const { tex, aspect } = makeLabel(fmtCash(sm * this.params.cashPerUnit), st.label, st.stroke);
      disposables.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(mat);
      labels.push({ s: sm, mat, fill: st.label, stroke: st.stroke });
      const hgt = 2.0, w = hgt * aspect;
      const parts: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(w, hgt);
        g.rotateX(-Math.PI / 2);
        g.rotateY(r0.heading);
        const px = rx + r0.nx * side * 3.5 - r0.tx * 1.3, pz = rz + r0.nz * side * 3.5 - r0.tz * 1.3;
        g.translate(px, hAt(px, pz) + 0.2, pz);
        parts.push(g);
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      if (merged) { const lm = new THREE.Mesh(merged, mat); lm.matrixAutoUpdate = false; group.add(lm); disposables.push(merged); }
    }
    const mesh = B.build(this.mats.solid);
    if (mesh) { group.add(mesh); disposables.push(mesh.geometry); }
    this.group.add(group);
    this.track.set(k, { group, disposables, labels });
  }

  // ------------------------------------------------------------------ traffic
  private addTraffic(animated: AnimatedObject[], rng: Rng, blocks: BlockInfo[], density = 1): void {
    const mk = this.mkMat;
    const terrain = this.terrain;
    const n = Math.round((this.params.quality === 'high' ? rng.int(3, 5) : rng.int(1, 3)) * density);
    for (let i = 0; i < n; i++) {
      const b = rng.pick(blocks);
      if (b.district === 'river') continue;
      // drive along the west street (z direction) or the north street (x direction) of this block
      const alongZ = rng.chance(0.55);
      const boulevard = alongZ ? b.wW > STREET_HALF : b.wN > STREET_HALF;
      // no traffic through the launch tower
      if (alongZ && b.ix === 0 && b.jz <= 0) continue;
      const dir = rng.sign();
      const laneOff = (boulevard ? 5.0 : 2.3) * dir;
      const isBus = boulevard && rng.chance(0.25);
      const g = new THREE.Group();
      const col = rng.pick(['#f26b6b', '#5fb8e6', '#f2c14e', '#7bc96f', '#ffffff', '#3b3f47', '#e5679a', '#9a9ea5']);
      // one merged mesh per vehicle keeps the scene graph small
      const cb = new GeoBatch();
      if (isBus) {
        cb.add(this.carGeo.busBody, rng.pick(['#f2c14e', '#e2574c', '#3f5f8a']), 0, 1.4, 0);
        cb.add(this.carGeo.busGlass, '#bfe9ff', 0, 1.9, 0);
        for (const a of [-3, 3]) for (const bb of [-1.1, 1.1]) cb.add(this.carGeo.wheel, '#2b2b2b', bb, 0.45, a, 0, 0, Math.PI / 2, 1.4, 1, 1.4);
      } else {
        cb.add(this.carGeo.body, col, 0, 0.55, 0);
        cb.add(this.carGeo.cabin, '#bfe9ff', 0, 1.15, 0);
        for (const a of [-1.2, 1.2]) for (const bb of [-0.8, 0.8]) cb.add(this.carGeo.wheel, '#2b2b2b', bb, 0.32, a, 0, 0, Math.PI / 2);
      }
      const carMesh = cb.build(this.mats.solid);
      if (carMesh) { carMesh.matrixAutoUpdate = true; g.add(carMesh); }
      void mk;
      const speed = (isBus ? 7 : rng.range(8, 14)) * dir;
      // path: a line segment through the macro tile along the chosen street
      const span = alongZ ? MZ : MX;
      let u = rng.range(0, span);
      const lineX = alongZ ? b.tile.x0 : 0, lineZ = alongZ ? 0 : b.tile.z1;
      const x0 = alongZ ? lineX + laneOff : Math.floor(b.tile.x0 / MX) * MX;
      const z1 = alongZ ? Math.ceil(b.tile.z1 / MZ) * MZ : lineZ - laneOff;
      g.rotation.y = alongZ ? (dir < 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      animated.push({
        obj: g,
        update(dt) {
          u = (u + speed * dt + span * 10) % span;
          const x = alongZ ? x0 : x0 + u;
          const z = alongZ ? z1 - u : z1;
          g.position.set(x, terrain.at(x, z) + 0.05, z);
        },
        dispose() { carMesh?.geometry.dispose(); },
      });
      g.position.set(x0, 0, z1);
    }
  }

  // ------------------------------------------------------------------ decoys
  private addDecoys(group: THREE.Group, decoys: EventObject[], rng: Rng, I: number, J: number, blocks: BlockInfo[]): void {
    const cx = (I + 0.5) * MX, cz = -(J + 0.5) * MZ;
    const n = rng.chance(this.params.quality === 'high' ? 0.6 : 0.3) ? 1 : 0;
    for (let d = 0; d < n; d++) {
      const kind = rng.pick(DECOY_KINDS);
      const grounded = kind === 'crane' || kind === 'billboard' || kind === 'pigeons' || kind === 'thermal' || kind === 'vent';
      const h = kind === 'pigeons' ? rng.range(6, 13) : kind === 'billboard' ? rng.range(10, 26) : grounded ? rng.range(16, 40) : rng.range(14, 75);
      const x = cx + rng.range(-MX * 0.45, MX * 0.45), z = cz + rng.range(-MZ * 0.45, MZ * 0.45);
      if (Math.hypot(x, z) < 70) continue; // not around the cannon
      const ev = { t: Infinity, s: 0, delta: -1, kind, lift: 0, x: grounded ? rng.sign() * 0.5 : rng.sign() * 0.3 };
      const eo = makeEventObject(ev, h, this.particles, true);
      eo.anchor(x, this.terrain.at(x, z), z, 1, 0, rng.range(0, Math.PI * 2));
      decoys.push(eo);
      group.add(eo.group);
    }
    // street-level filler on ordinary streets
    if (rng.chance(0.3)) {
      const b = rng.pick(blocks);
      if (b.district !== 'river' && b.wN === STREET_HALF) {
        const kind = rng.pick(STREET_DECOY_KINDS);
        const x = rng.range(b.tile.x0 + 8, b.tile.x1 - 8), z = b.tile.z1;
        if (Math.hypot(x, z) > 60) {
          const ev = { t: Infinity, s: 0, delta: -1, kind, lift: 0, x: 0 };
          const eo = makeEventObject(ev, 1, this.particles, true);
          eo.anchor(x, this.terrain.at(x, z), z, 1, 0, Math.PI / 2);
          decoys.push(eo);
          group.add(eo.group);
        }
      }
    }
  }

  // ------------------------------------------------------------------ ambient
  private addAmbient(animated: AnimatedObject[], rng: Rng, I: number, J: number, blocks: BlockInfo[]): void {
    const mk = this.mkMat;
    const cx = (I + 0.5) * MX, cz = -(J + 0.5) * MZ;
    const downtown = blocks.some(b => b.district === 'downtown');
    if (rng.chance(0.5)) {
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
      const dir = rng.sign();
      flock.position.set(cx + rng.range(-40, 40), rng.range(18, 60), cz + rng.range(-40, 40));
      const speed = rng.range(5, 9);
      animated.push({ obj: flock, update(dt, t) { flock.position.x -= dir * speed * dt; wings.forEach((w, k) => { w.rotation.z = (k % 2 ? -1 : 1) * Math.sin(t * 8 + k) * 0.6; }); }, dispose() {} });
    }
    if (rng.chance(0.3)) {
      const g = new THREE.Group();
      const cols = [rng.pick(['#f2c14e', '#e5679a', '#5fb8e6', '#7bc96f']), '#ffffff'];
      const env = balloonEnvelope(cols); env.position.y = 7.5; g.add(env);
      const neck = new THREE.Mesh(CONE, mk(cols[0])); neck.scale.set(3.2, 2.2, 3.2); neck.rotation.x = Math.PI; neck.position.y = 3.6; g.add(neck);
      const basket = new THREE.Mesh(BOX, mk('#9a6b3c')); basket.scale.set(1.6, 1.2, 1.6); basket.position.y = 0.6; g.add(basket);
      g.position.set(cx + rng.range(-45, 45), rng.range(22, 70), cz + rng.range(-40, 40));
      const y0 = g.position.y;
      animated.push({ obj: g, update(dt, t) { g.position.y = y0 + Math.sin(t * 0.5 + I) * 1.2; g.position.x += dt * 0.6; }, dispose() {} });
    }
    if (rng.chance(0.1)) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(SPHERE, mk('#f4f4f4')); body.scale.set(7, 7, 20); b.add(body);
      const band = new THREE.Mesh(BOX, mk('#3f5f8a')); band.scale.set(7.2, 1.2, 12); b.add(band);
      const gondola = new THREE.Mesh(BOX, mk('#3b3f47')); gondola.scale.set(1.6, 1.4, 4); gondola.position.y = -3.6; b.add(gondola);
      b.position.set(cx + rng.range(-50, 50), rng.range(55, 90), cz + rng.range(-50, 50));
      b.rotation.y = rng.range(0, Math.PI);
      animated.push({ obj: b, update(dt) { b.position.z += dt * 0.8; }, dispose() {} });
    }
    if (rng.chance(0.08)) {
      const g = new THREE.Group();
      const white = mk('#f4f6f8');
      const fus = new THREE.Mesh(CYL, white); fus.scale.set(2.2, 18, 2.2); fus.rotation.x = Math.PI / 2; g.add(fus);
      const wings = new THREE.Mesh(BOX, white); wings.scale.set(22, 0.25, 3.2); g.add(wings);
      const fin = new THREE.Mesh(BOX, mk('#e2574c')); fin.scale.set(0.25, 3.6, 3); fin.position.set(0, 1.8, 8.5); g.add(fin);
      const dir = rng.sign();
      g.position.set(cx - dir * 200, rng.range(90, 130), cz + rng.range(-40, 40));
      g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      animated.push({ obj: g, update(dt) { g.position.x += dir * dt * 25; }, dispose() {} });
    }
    if (downtown && rng.chance(0.3)) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(SPHERE_LO, mk('#3f5f8a')); body.scale.set(2.4, 2, 4.5); g.add(body);
      const tail = new THREE.Mesh(CYL_LO, mk('#3f5f8a')); tail.scale.set(0.5, 6, 0.5); tail.rotation.x = Math.PI / 2; tail.position.z = 4.5; g.add(tail);
      const rotor = new THREE.Mesh(BOX, mk('#222')); rotor.scale.set(9, 0.1, 0.4); rotor.position.y = 1.5; g.add(rotor);
      g.position.set(cx + rng.range(-40, 40), rng.range(40, 80), cz + rng.range(-40, 40));
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
    // far mountain silhouettes all around
    const b = new GeoBatch();
    const rng = new Rng(this.params.seed + ':far');
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.range(-0.08, 0.08);
      const h = rng.range(90, 230);
      b.add(CONE, rng.pick(['#bcd8e8', '#a9cce3', '#c9e0ee']), Math.cos(a) * 1050, h / 2 - 25, Math.sin(a) * 1050, 0, 0, 0, h * 1.8, h, h);
    }
    const m = b.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    if (m) g.add(m);
    return g;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, s: number, camera: THREE.Vector3, planTime: number, hideNearCamera = true): void {
    this.elapsed += dt;
    this.stream(s);
    this.sky.position.set(camera.x, Math.max(0, camera.y - 60), camera.z);
    for (const [, t] of this.tiles) {
      for (const a of t.animated) a.update(dt, this.elapsed);
      for (const d of t.decoys) {
        const dz = d.group.position.distanceTo(camera);
        d.group.visible = !hideNearCamera || dz > 4;
        if (dz < 450) d.update(dt, this.elapsed);
      }
    }
    for (const eo of this.eventObjects) {
      const dist = eo.group.position.distanceTo(camera);
      eo.group.visible = !hideNearCamera || dist > 4;
      eo.approach(eo.event.t - planTime);
      if (dist < 500) eo.update(dt, this.elapsed);
    }
  }

  dispose(): void {
    for (const [, t] of this.tiles) this.disposeTile(t);
    for (const [, p] of this.track) { this.group.remove(p.group); for (const d of p.disposables) d.dispose(); }
    this.track.clear();
    for (const eo of this.eventObjects) eo.dispose();
    for (const m of this.matCache.values()) m.dispose();
    for (const g of Object.values(this.carGeo)) g.dispose();
    this.sky.traverse(o => { const mm = o as THREE.Mesh; if (mm.geometry) mm.geometry.dispose(); if (mm.material) (mm.material as THREE.Material).dispose(); });
    this.mats.solid.dispose(); this.mats.facade.dispose(); this.mats.glass.dispose();
  }
}
