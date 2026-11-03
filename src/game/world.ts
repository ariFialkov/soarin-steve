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

type CarPath =
  | { kind: 'avenue'; off: number; dir: 1 | -1 }   // along the winding boulevard; dir +1 = ahead
  | { kind: 'side'; x: number; dir: 1 | -1 }       // a side street parallel to the flight; dir +1 = ahead (−z)
  | { kind: 'cross'; z: number; dir: 1 | -1 };     // a cross street; dir +1 = +x
interface Car { g: THREE.Group; path: CarPath; u: number; active: boolean; rot: number; bus: boolean }
function sameLane(a: CarPath, b: CarPath): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'avenue' && b.kind === 'avenue') return a.off === b.off;
  if (a.kind === 'side' && b.kind === 'side') return a.x === b.x;
  if (a.kind === 'cross' && b.kind === 'cross') return a.z === b.z;
  return false;
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
  labels: { s: number; mat: THREE.MeshBasicMaterial; fill: string }[];
}

function fmtCash(v: number): string {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'm';
  if (v >= 1e4) return '$' + (v / 1e3).toFixed(1) + 'k';
  if (v >= 100) return '$' + Math.round(v).toString();
  if (v >= 10) return '$' + v.toFixed(1);
  return '$' + v.toFixed(2);
}

/**
 * The cash track's lettering: a custom squared typeface (no outline), drawn as thick strokes on a
 * 4×7 grid with a slight forward slant, so it reads like crisp road paint rather than a sticker.
 */
const GLYPHS: Record<string, { w: number; paths: number[][] }> = {
  '0': { w: 4, paths: [[0, 0, 4, 0, 4, 7, 0, 7, 0, 0]] },
  '1': { w: 3, paths: [[0.5, 1.2, 2, 0, 2, 7]] },
  '2': { w: 4, paths: [[0, 0, 4, 0, 4, 3.5, 0, 3.5, 0, 7, 4, 7]] },
  '3': { w: 4, paths: [[0, 0, 4, 0, 4, 7, 0, 7], [1, 3.5, 4, 3.5]] },
  '4': { w: 4, paths: [[0, 0, 0, 4.2, 4, 4.2], [3.2, 0, 3.2, 7]] },
  '5': { w: 4, paths: [[4, 0, 0, 0, 0, 3.5, 4, 3.5, 4, 7, 0, 7]] },
  '6': { w: 4, paths: [[4, 0, 0, 0, 0, 7, 4, 7, 4, 3.5, 0, 3.5]] },
  '7': { w: 4, paths: [[0, 0, 4, 0, 4, 1.5, 2, 7]] },
  '8': { w: 4, paths: [[0, 0, 4, 0, 4, 7, 0, 7, 0, 0], [0, 3.5, 4, 3.5]] },
  '9': { w: 4, paths: [[4, 3.5, 0, 3.5, 0, 0, 4, 0, 4, 7, 0, 7]] },
  '$': { w: 4, paths: [[4, 1, 0, 1, 0, 3.5, 4, 3.5, 4, 6, 0, 6], [2, -0.4, 2, 7.4]] },
  '.': { w: 1.2, paths: [[0.6, 6.4, 0.6, 7]] },
  'k': { w: 3.6, paths: [[0, 0, 0, 7], [3.6, 2.6, 0, 4.6, 3.6, 7]] },
  'm': { w: 4.6, paths: [[0, 7, 0, 2.6, 4.6, 2.6, 4.6, 7], [2.3, 2.6, 2.3, 7]] },
};

function makeLabel(text: string, fill: string, w = 384, h = 96): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const unit = h * 0.1;                        // grid unit in pixels (7 units tall glyphs)
  const gap = 1.6;
  let total = 0;
  for (const ch of text) total += (GLYPHS[ch]?.w ?? 3) + gap;
  total -= gap;
  const scale = Math.min(unit, (w * 0.92) / total);
  const x0 = (w - total * scale) / 2, y0 = (h - 7 * scale) / 2;
  g.save();
  g.translate(x0, y0);
  g.transform(1, 0, -0.16, 1, 7 * scale * 0.16 * 0.5, 0);   // gentle forward slant
  g.strokeStyle = fill;
  g.lineWidth = scale * 1.15;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.miterLimit = 4;
  let x = 0;
  for (const ch of text) {
    const gl = GLYPHS[ch];
    if (gl) {
      for (const path of gl.paths) {
        g.beginPath();
        for (let i = 0; i < path.length; i += 2) {
          const px = (x + path[i]) * scale, py = path[i + 1] * scale;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
    }
    x += (gl?.w ?? 3) + gap;
  }
  g.restore();
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
  asphalt: { base: '#6f7378', kerb: '#8f8a80', track: '#767a80', line: '#5f6369', lane: '#b9a04a', cross: '#d9d3c2', label: '#e6e0cf', stroke: '' },
  cobble:  { base: '#857a6e', kerb: '#a39888', track: '#8c8175', line: '#6f655a', lane: '#c2a874', cross: '#efdcb8', label: '#f2e2c2', stroke: '' },
  pavers:  { base: '#cdb994', kerb: '#b9a37c', track: '#c6b28c', line: '#b39c74', lane: '#a88d62', cross: '#7a5d33', label: '#6b4f2a', stroke: '' },
  bridge:  { base: '#8b8f96', kerb: '#9ea3aa', track: '#92969d', line: '#7a7e85', lane: '#a39f7a', cross: '#f0f2f4', label: '#f7f8fa', stroke: '' },
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
    // build the whole look-ahead up front so the first seconds of flight never stall
    this.stream(0, Infinity);
    this.trafficRng = new Rng(params.seed + ':traffic');
    this.initTraffic();
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
        const { tex } = makeLabel(fmtCash(l.s * cashPerUnit), l.fill);
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
      if (central) {
        this.addAmbient(animated, rng, I, J, res.blocks);
        this.addDecoys(group, decoys, rng, I, J, res.blocks);
      }
    }
    const solid = B.solid.build(this.mats.solid);
    const facade = B.facade.build(this.mats.facade);
    const glass = B.glass.build(this.mats.glass);
    // only the tiles along the flight line can ever have his shadow on them; the rest skip the lookup
    const onLine = !far && (I === -1 || I === 0);
    for (const m of [solid, facade, glass]) if (m) { m.receiveShadow = onLine; group.add(m); disposables.push(m.geometry); }
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
    // the cash lane: one straight lane on the flight line (not the winding road), a faint band,
    // a tick every 10 units and a single number per tick, painted to suit the surface beneath
    for (let i = 0; i < 20; i++) {
      const qa = s0 + i * 2, qb = qa + 2;
      const a = this.route.at(qa, this.sample), b = this.route.at(qb, this.sample2);
      B.addRaw(stripQuad(a.x, a.z, b.x, b.z, a.nx, a.nz, b.nx, b.nz, 1.9, hAt, 0.16), TRACK_STYLE[this.surfaceAt(qa + 1)].track);
    }
    for (let m = 0; m < TRACK_STEP / MARK_STEP; m++) {
      const sm = s0 + m * MARK_STEP;
      if (sm <= 0) continue;
      const r0 = this.route.at(sm, this.sample);
      const st = TRACK_STYLE[this.surfaceAt(sm)];
      const ax = r0.x - r0.tx * 0.09, az = r0.z - r0.tz * 0.09, bx = r0.x + r0.tx * 0.09, bz = r0.z + r0.tz * 0.09;
      B.addRaw(stripQuad(ax, az, bx, bz, r0.nx, r0.nz, r0.nx, r0.nz, 1.9, hAt, 0.18), st.cross);
      const { tex, aspect } = makeLabel(fmtCash(sm * this.params.cashPerUnit), st.label);
      disposables.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(mat);
      labels.push({ s: sm, mat, fill: st.label });
      const hgt = 1.45, w = hgt * aspect;
      // draped over the ground: every vertex sits on the terrain, so the number tilts with the hill
      // instead of cutting into it, while staying square to the forward axis
      const lg = new THREE.PlaneGeometry(w, hgt, 10, 3);
      lg.rotateX(-Math.PI / 2);
      lg.rotateY(r0.heading);
      const px = r0.x - r0.tx * 1.0, pz = r0.z - r0.tz * 1.0;
      lg.translate(px, 0, pz);
      const lp = lg.attributes.position as THREE.BufferAttribute;
      for (let vi = 0; vi < lp.count; vi++) lp.setY(vi, hAt(lp.getX(vi), lp.getZ(vi)) + 0.22);
      lg.computeVertexNormals();
      const lm = new THREE.Mesh(lg, mat); lm.matrixAutoUpdate = false; group.add(lm); disposables.push(lg);
    }
    const mesh = B.build(this.mats.solid);
    if (mesh) { mesh.receiveShadow = true; group.add(mesh); disposables.push(mesh.geometry); }
    this.group.add(group);
    this.track.set(k, { group, disposables, labels });
  }

  // ------------------------------------------------------------------ traffic
  /**
   * One traffic system for the whole city. Cars drive real lanes: the winding boulevard (forward
   * traffic on the right, oncoming on the left) and the side streets; a car that reaches a river
   * turns onto the riverside road. New cars only ever appear deep in the haze ahead, and cars are
   * retired once they are behind the camera, so nothing pops in or out in view. Every lane has a
   * single speed, so cars in a lane never run into each other.
   */
  private cars: Car[] = [];
  private trafficRng!: Rng;

  private makeVehicle(rng: Rng, bus: boolean): THREE.Group {
    const g = new THREE.Group();
    const cb = new GeoBatch();
    if (bus) {
      cb.add(this.carGeo.busBody, rng.pick(['#f2c14e', '#e2574c', '#3f5f8a']), 0, 1.4, 0);
      cb.add(this.carGeo.busGlass, '#bfe9ff', 0, 1.9, 0);
      for (const a of [-3, 3]) for (const bb of [-1.1, 1.1]) cb.add(this.carGeo.wheel, '#2b2b2b', bb, 0.45, a, 0, 0, Math.PI / 2, 1.4, 1, 1.4);
    } else {
      cb.add(this.carGeo.body, rng.pick(['#f26b6b', '#5fb8e6', '#f2c14e', '#7bc96f', '#ffffff', '#3b3f47', '#e5679a', '#9a9ea5']), 0, 0.55, 0);
      cb.add(this.carGeo.cabin, '#bfe9ff', 0, 1.15, 0);
      for (const a of [-1.2, 1.2]) for (const bb of [-0.8, 0.8]) cb.add(this.carGeo.wheel, '#2b2b2b', bb, 0.32, a, 0, 0, Math.PI / 2);
    }
    const m = cb.build(this.mats.solid);
    if (m) { m.matrixAutoUpdate = true; m.receiveShadow = false; g.add(m); }
    this.group.add(g);
    return g;
  }

  private laneSpeed(p: CarPath): number {
    if (p.kind === 'avenue') return Math.abs(p.off) < 3 ? 12 : 9;
    return 8;
  }

  private carPos(c: Car, out: THREE.Vector3): number {
    const p = c.path;
    if (p.kind === 'avenue') {
      const r = this.route.at(c.u, this.sample);
      const o = this.route.roadOffset(c.u) + p.off;
      out.set(r.x + r.nx * o, 0, r.z + r.nz * o);
      const slope = this.route.roadSlope(c.u);
      return p.dir > 0 ? Math.atan2(-slope, 1) : Math.atan2(slope, -1);
    }
    if (p.kind === 'side') { out.set(p.x, 0, -c.u); return p.dir > 0 ? 0 : Math.PI; }
    out.set(c.u, 0, p.z); return p.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  /** Is z (on a side street) inside a river row's water? */
  private inRiver(z: number): boolean {
    const jz = Math.floor(-z / PZ);
    if (!this.city.isRiverRow(jz)) return false;
    const zNear = -jz * PZ, zFar = -(jz + 1) * PZ;
    return z < zNear - 3 && z > zFar + 3;
  }

  /** Place a car on a free lane somewhere between zNear and zFar (negative z is ahead). */
  private spawnCar(c: Car, zNear: number, zFar: number): boolean {
    const rng = this.trafficRng;
    for (let attempt = 0; attempt < 12; attempt++) {
      const z = zNear + (zFar - zNear) * rng.next();
      const roll = rng.next();
      let path: CarPath;
      let u: number;
      if (roll < 0.5) {
        const dir = rng.chance(0.5) ? 1 : -1;
        const off = (rng.chance(0.5) ? 1.75 : 5.25) * dir;   // forward traffic keeps right (+x when facing ahead)
        path = { kind: 'avenue', off, dir }; u = -z;
        if (u < 40) continue;
      } else if (roll < 0.85) {
        const ix = rng.pick([-3, -2, -1, 1, 2, 3]);
        const dir = rng.chance(0.5) ? 1 : -1;
        path = { kind: 'side', x: ix * PX + (dir > 0 ? 2 : -2), dir }; u = -z;
        if (this.inRiver(z)) continue;
      } else {
        const jz = Math.max(1, Math.round(-z / PZ));
        const dir = rng.chance(0.5) ? 1 : -1;
        path = { kind: 'cross', z: -jz * PZ + (dir > 0 ? 2 : -2), dir }; u = rng.sign() * rng.range(30, 300);
        if (Math.abs(u) < 14) continue;
      }
      // keep a gap to anyone already in this lane (same lane, same speed: they will never close it)
      const clash = this.cars.some(o => o !== c && o.active && sameLane(o.path, path) && Math.abs(o.u - u) < 14);
      if (clash) continue;
      c.path = path; c.u = u; c.active = true; c.rot = NaN;
      return true;
    }
    return false;
  }

  private initTraffic(): void {
    const n = this.params.quality === 'high' ? 34 : 16;
    for (let i = 0; i < n; i++) {
      const bus = this.trafficRng.chance(0.15);
      const c: Car = { g: this.makeVehicle(this.trafficRng, bus), path: { kind: 'avenue', off: 5.25, dir: 1 }, u: 0, active: false, rot: NaN, bus };
      this.cars.push(c);
      // the city starts already busy, spread from just ahead of the launch tower into the haze
      if (!this.spawnCar(c, -30, -560)) c.g.visible = false;
    }
  }

  private updateTraffic(dt: number, cam: THREE.Vector3): void {
    const pos = this.trafficTmp;
    for (const c of this.cars) {
      if (!c.active) { if (this.spawnCar(c, cam.z - 480, cam.z - 560)) c.g.visible = true; else continue; }
      const p = c.path;
      const v = this.laneSpeed(p) * dt;
      if (p.kind === 'avenue') {
        c.u += p.dir * v;
      } else if (p.kind === 'side') {
        const before = -c.u;
        c.u += p.dir * v;
        const after = -c.u;
        // reaching a river: turn onto the riverside road instead of driving into the water
        const jzA = p.dir > 0 ? Math.floor(-after / PZ) : Math.floor(-before / PZ);
        if (p.dir > 0 && this.city.isRiverRow(jzA) && after < -jzA * PZ && before >= -jzA * PZ) {
          const turn = this.trafficRng.chance(0.5) ? 1 : -1;
          c.path = { kind: 'cross', z: -jzA * PZ + (turn > 0 ? 2 : -2), dir: turn }; c.u = p.x;
        } else if (p.dir < 0) {
          const jzB = Math.floor(-before / PZ) - 1;
          const bank = -(jzB + 1) * PZ;
          if (this.city.isRiverRow(jzB) && before < bank && after >= bank) {
            const turn = this.trafficRng.chance(0.5) ? 1 : -1;
            c.path = { kind: 'cross', z: bank + (turn > 0 ? 2 : -2), dir: turn }; c.u = p.x;
          }
        }
      } else {
        c.u += p.dir * v;
      }
      const targetRot = this.carPos(c, pos);
      pos.y = this.terrain.at(pos.x, pos.z) + 0.05;
      // retire cars once they are behind the camera, at the launch tower, or far off to the side in the haze
      const offRoute = c.path.kind === 'avenue' && c.u < 10;
      if (pos.z > cam.z + 12 || pos.z < cam.z - 620 || Math.abs(pos.x - cam.x) > 380 || offRoute) {
        c.active = false; c.g.visible = false; continue;
      }
      // turn the body smoothly (corners and the boulevard's bends)
      if (Number.isNaN(c.rot)) c.rot = targetRot;
      let dr = targetRot - c.rot;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      c.rot += dr * Math.min(1, dt * 5);
      c.g.position.copy(pos);
      c.g.rotation.set(0, c.rot, 0);
    }
  }
  private trafficTmp = new THREE.Vector3();

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
      const hdir = rng.sign(), hy = g.position.y;
      g.rotation.y = hdir > 0 ? -Math.PI / 2 : Math.PI / 2;
      animated.push({ obj: g, update(dt, t) { rotor.rotation.y += dt * 30; g.position.x += hdir * dt * 9; g.position.y = hy + Math.sin(t * 0.6) * 0.6; }, dispose() {} });
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
    sun.position.set(-150, 1050, 480);
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
    this.updateTraffic(dt, camera);
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
    for (const c of this.cars) { this.group.remove(c.g); c.g.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.geometry.dispose(); }); }
    this.cars = [];
    for (const m of this.matCache.values()) m.dispose();
    for (const g of Object.values(this.carGeo)) g.dispose();
    this.sky.traverse(o => { const mm = o as THREE.Mesh; if (mm.geometry) mm.geometry.dispose(); if (mm.material) (mm.material as THREE.Material).dispose(); });
    this.mats.solid.dispose(); this.mats.facade.dispose(); this.mats.glass.dispose();
  }
}
