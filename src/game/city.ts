/**
 * Procedural city: a street grid along an infinite avenue, divided into
 * districts (suburbs, residential, commercial, downtown, parks, river,
 * industrial, old town) with landmarks sprinkled along the way.
 *
 * All placement is grid based so nothing ever stands in a road: the avenue,
 * cross streets and side streets are fixed coordinates, and every building sits
 * inside a lot that is inset from its block's kerb.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { BOX, CONE, CYL, CYL_LO, DISC, HEMI, PLANE, PRISM, PYRAMID, SPHERE_LO, TORUS, WEDGE, GeoBatch, windowBox } from './geobatch';

export type District = 'suburb' | 'residential' | 'commercial' | 'downtown' | 'park' | 'river' | 'industrial' | 'oldtown';
export type Landmark = 'clocktower' | 'cathedral' | 'stadium' | 'ferris' | 'obelisk' | 'arch' | 'dome' | 'mast' | 'watertower';

export const GRID = {
  AVE: 7,          // avenue asphalt half width
  KERB: 9.5,       // where the first block starts (sidewalk from AVE to KERB)
  BLOCK_X: 28,
  STREET_X: 8,
  BLOCKS_X: 5,
  BLOCK_Z: 24,
  STREET_Z: 8,
  CHUNK: 64,       // two blocks + two cross streets
  SIDEWALK: 2,     // inset from the block edge to buildable area
};
export const GRID_END_X = GRID.KERB + GRID.BLOCKS_X * (GRID.BLOCK_X + GRID.STREET_X) - GRID.STREET_X; // 181.5

export interface Rect { x0: number; x1: number; z0: number; z1: number } // z0 < z1 (z0 is further ahead)

export interface Batches {
  solid: GeoBatch;    // vertex-coloured, untextured
  facade: GeoBatch;   // window texture
  glass: GeoBatch;    // glass curtain wall texture
}

export interface AnimatedObject {
  obj: THREE.Object3D;
  update(dt: number, t: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------- palette
export const PAL = {
  asphalt: '#6f7378',
  asphaltTrack: '#7a7e84',
  asphaltLine: '#9a9ea5',
  laneWhite: '#d8d9d3',
  laneYellow: '#e4c45a',
  sidewalk: '#c8c3b8',
  sidewalk2: '#d4cfc4',
  pavers: '#d9c7a8',
  paversTrack: '#e2d2b5',
  grass: '#8ccf66',
  grassDark: '#7cbd59',
  concrete: '#b9b5ad',
  water: '#5fb3e0',
  waterLight: '#7cc6ea',
  trunk: '#8a5a3c',
  greens: ['#5fb458', '#4ea64c', '#73c367', '#3f9a47', '#86cc6a'],
  walls: ['#fff1d6', '#ffd9c2', '#d8ecff', '#f5e0f2', '#f2f2f2', '#f7e7c8', '#e8f0d8', '#fde2e2'],
  brick: ['#b5543f', '#c46b54', '#9e4a3a', '#a6705a'],
  paint: ['#f4e3c1', '#e9d5b8', '#d6e3d3', '#cfdcea', '#f1d7cf', '#e3e3e0', '#d9c8b4', '#eadfcf'],
  pastel: ['#ffd8a8', '#ffc9c9', '#d0ebff', '#d3f9d8', '#fff3bf', '#e5dbff', '#ffe8cc', '#c5f6fa'],
  roofs: ['#c0392b', '#8d5a3b', '#5c6b73', '#7a4b2a', '#3f5f8a', '#a35d3c'],
  tower: ['#d9dde3', '#cfd6dd', '#e6e9ee', '#c9cfd6', '#b8c0c8', '#dcd5c9'],
  glass: ['#bfe0f5', '#a9d3ee', '#cbe6f7'],
  cars: ['#f26b6b', '#5fb8e6', '#f2c14e', '#7bc96f', '#ffffff', '#3b3f47', '#e5679a', '#9a9ea5'],
};

// ---------------------------------------------------------------- city plan
interface ChunkPlan {
  district: District;
  landmark: Landmark | null;
  landmarkSide: 1 | -1;
  landmarkBlock: 0 | 1;      // which of the chunk's two blocks
}

const RUN_LENGTH: Record<District, [number, number]> = {
  suburb: [2, 4], residential: [2, 4], commercial: [2, 3], downtown: [2, 4],
  park: [1, 2], river: [1, 1], industrial: [2, 3], oldtown: [2, 3],
};

const NEXT: Record<District, District[]> = {
  suburb: ['residential', 'residential', 'park', 'commercial', 'industrial', 'oldtown'],
  residential: ['commercial', 'commercial', 'park', 'oldtown', 'downtown', 'river'],
  commercial: ['downtown', 'downtown', 'residential', 'park', 'river', 'oldtown'],
  downtown: ['commercial', 'park', 'river', 'residential', 'industrial'],
  park: ['residential', 'downtown', 'oldtown', 'suburb', 'commercial'],
  river: ['downtown', 'oldtown', 'industrial', 'park', 'commercial', 'residential'],
  industrial: ['suburb', 'residential', 'river', 'commercial'],
  oldtown: ['commercial', 'park', 'residential', 'river', 'downtown'],
};

const LANDMARKS_FOR: Record<District, Landmark[]> = {
  suburb: ['watertower', 'stadium'], residential: ['watertower', 'clocktower', 'stadium'],
  commercial: ['clocktower', 'arch', 'dome'], downtown: ['dome', 'mast', 'arch', 'ferris'],
  park: ['ferris', 'obelisk', 'stadium'], river: [], industrial: ['mast', 'watertower'],
  oldtown: ['cathedral', 'clocktower', 'obelisk'],
};

export class CityPlan {
  private chunks: ChunkPlan[] = [];
  private rng: Rng;
  private current: District = 'suburb';
  private remaining = 2;
  private sinceLandmark = 2;
  private sinceRiver = 10;

  constructor(seed: string) {
    this.rng = new Rng(seed + ':city');
  }

  at(i: number): ChunkPlan {
    i = Math.max(0, i);
    while (this.chunks.length <= i) this.chunks.push(this.next());
    return this.chunks[i];
  }

  private next(): ChunkPlan {
    const rng = this.rng;
    if (this.remaining <= 0) {
      let candidates = NEXT[this.current];
      if (this.sinceRiver < 4) candidates = candidates.filter(d => d !== 'river');
      let d = rng.pick(candidates);
      if (d === this.current) d = rng.pick(candidates);
      this.current = d;
      const [a, b] = RUN_LENGTH[d];
      this.remaining = rng.int(a, b);
    }
    this.remaining--;
    this.sinceRiver = this.current === 'river' ? 0 : this.sinceRiver + 1;
    let landmark: Landmark | null = null;
    const options = LANDMARKS_FOR[this.current];
    this.sinceLandmark++;
    if (options.length && this.sinceLandmark >= 4 && rng.chance(0.3 + (this.sinceLandmark - 4) * 0.12)) {
      landmark = rng.pick(options);
      this.sinceLandmark = 0;
    }
    return { district: this.current, landmark, landmarkSide: rng.sign() as 1 | -1, landmarkBlock: rng.chance(0.5) ? 0 : 1 };
  }
}

// ---------------------------------------------------------------- helpers
function blockRectX(k: number, side: 1 | -1): [number, number] {
  const x0 = GRID.KERB + k * (GRID.BLOCK_X + GRID.STREET_X);
  const x1 = x0 + GRID.BLOCK_X;
  return side > 0 ? [x0, x1] : [-x1, -x0];
}

/** z range (z0 < z1) of block row j (j = 0 is nearest the launcher). */
export function blockRowZ(j: number): [number, number] {
  const z1 = -(20 + 32 * j);
  return [z1 - GRID.BLOCK_Z, z1];
}

/** z centre of the cross street just before block row j. */
export function crossStreetZ(j: number): number {
  return -(16 + 32 * j);
}

function inset(r: Rect, m: number): Rect {
  return { x0: r.x0 + m, x1: r.x1 - m, z0: r.z0 + m, z1: r.z1 - m };
}

// ---------------------------------------------------------------- vegetation
export function tree(B: Batches, rng: Rng, x: number, z: number, scale = 1, y = 0.15): void {
  const h = rng.range(3.2, 5.2) * scale;
  const c = rng.pick(PAL.greens);
  B.solid.add(CYL_LO, PAL.trunk, x, y + h * 0.22, z, 0, 0, 0, 0.32 * scale, h * 0.45, 0.32 * scale);
  B.solid.add(SPHERE_LO, c, x, y + h * 0.62, z, 0, rng.range(0, 3), 0, h * 0.6, h * 0.55, h * 0.6);
  B.solid.add(SPHERE_LO, c, x + 0.5 * scale, y + h * 0.85, z - 0.25 * scale, 0, 0, 0, h * 0.42, h * 0.38, h * 0.42);
  B.solid.add(SPHERE_LO, c, x - 0.45 * scale, y + h * 0.8, z + 0.3 * scale, 0, 0, 0, h * 0.4, h * 0.36, h * 0.4);
}

export function pine(B: Batches, rng: Rng, x: number, z: number, scale = 1, y = 0.15): void {
  const h = rng.range(3.5, 6) * scale;
  B.solid.add(CYL_LO, '#7a4b2c', x, y + h * 0.2, z, 0, 0, 0, 0.28, h * 0.4, 0.28);
  const c = rng.pick(['#2f8a4b', '#3c9c5a', '#2b7a44']);
  for (let i = 0; i < 3; i++) {
    const yy = y + h * (0.35 + i * 0.22);
    const s = h * (0.5 - i * 0.11);
    B.solid.add(CONE, c, x, yy, z, 0, 0, 0, s, h * 0.35, s);
  }
}

function bush(B: Batches, rng: Rng, x: number, z: number, y = 0.15): void {
  const c = rng.pick(PAL.greens);
  B.solid.add(SPHERE_LO, c, x, y + 0.45, z, 0, 0, 0, 1.3, 0.9, 1.3);
  B.solid.add(SPHERE_LO, c, x + 0.6, y + 0.35, z + 0.3, 0, 0, 0, 0.9, 0.7, 0.9);
}

function flowerBed(B: Batches, rng: Rng, x: number, z: number, r: number, y = 0.16): void {
  B.solid.add(DISC, '#6b4a2b', x, y + 0.02, z, -Math.PI / 2, 0, 0, r * 2, r * 2, 1);
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, r * 0.8);
    B.solid.add(SPHERE_LO, rng.pick(['#ff7b9c', '#ffd166', '#ffffff', '#c084fc', '#ff8c42']), x + Math.cos(a) * d, y + 0.35, z + Math.sin(a) * d, 0, 0, 0, 0.5, 0.4, 0.5);
  }
}

// ---------------------------------------------------------------- buildings
type WallStyle = 'windows' | 'glass' | 'plain';

/** A rectangular building body with a window grid on its sides, plus a roof slab. */
function body(B: Batches, color: string, r: Rect, y0: number, h: number, style: WallStyle, win = 3): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  if (style === 'plain') {
    B.solid.box(color, cx, y0 + h / 2, cz, w, h, d);
  } else {
    const g = windowBox(w, h, d, win, win * 1.05);
    (style === 'glass' ? B.glass : B.facade).add(g, color, cx, y0 + h / 2, cz);
    g.dispose();
  }
}

function flatRoof(B: Batches, rng: Rng, r: Rect, y: number, color: string, details = true): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  B.solid.box(color, cx, y + 0.15, cz, w + 0.3, 0.3, d + 0.3);            // slab / cornice
  // parapet
  B.solid.box(color, cx, y + 0.6, r.z0 + 0.15, w + 0.3, 0.6, 0.3);
  B.solid.box(color, cx, y + 0.6, r.z1 - 0.15, w + 0.3, 0.6, 0.3);
  B.solid.box(color, r.x0 + 0.15, y + 0.6, cz, 0.3, 0.6, d);
  B.solid.box(color, r.x1 - 0.15, y + 0.6, cz, 0.3, 0.6, d);
  if (!details) return;
  const t = rng.next();
  if (t < 0.3 && w > 6 && d > 6) {
    // water tank
    B.solid.add(CYL_LO, '#8a7a66', cx + rng.range(-w * 0.25, w * 0.25), y + 1.9, cz + rng.range(-d * 0.25, d * 0.25), 0, 0, 0, 2.2, 2.6, 2.2);
    B.solid.add(CONE, '#6b5a48', cx + 0, y + 3.6, cz, 0, 0, 0, 2.3, 0.8, 2.3);
  } else if (t < 0.6) {
    // AC units
    for (let i = 0; i < 2; i++) B.solid.box('#b7bcc4', cx + rng.range(-w * 0.3, w * 0.3), y + 0.8, cz + rng.range(-d * 0.3, d * 0.3), 1.6, 1.0, 1.2);
  } else if (t < 0.75) {
    B.solid.add(CYL_LO, '#7c8894', cx, y + 2.5, cz, 0, 0, 0, 0.18, 5, 0.18); // antenna
    B.solid.add(SPHERE_LO, '#ff5a5a', cx, y + 5.1, cz, 0, 0, 0, 0.4);
  }
}

function gableRoof(B: Batches, r: Rect, y: number, color: string, alongZ: boolean, pitch = 0.45): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  if (alongZ) {
    // ridge along z: prism width = x extent
    B.solid.add(PRISM, color, cx, y, cz, 0, 0, 0, w + 0.6, w * pitch, d + 0.6);
  } else {
    B.solid.add(PRISM, color, cx, y, cz, 0, Math.PI / 2, 0, d + 0.6, d * pitch, w + 0.6);
  }
}

export function house(B: Batches, rng: Rng, cx: number, cz: number, w: number, d: number, facingZ: number): void {
  const h = rng.range(2.8, 3.6);
  const wall = rng.pick(PAL.walls);
  const roof = rng.pick(PAL.roofs);
  const r: Rect = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
  body(B, wall, r, 0.15, h, 'windows', 2.6);
  B.solid.box(wall, cx, 0.15 + h / 2, cz, w, h, d); // solid core so the roof overhang has no gap underneath
  gableRoof(B, r, 0.15 + h, roof, rng.chance(0.5), 0.5);
  // door + chimney
  B.solid.box('#8d5a3b', cx + w * 0.2, 0.15 + 0.9, cz + facingZ * (d / 2 + 0.03), 0.9, 1.8, 0.1);
  B.solid.box('#b0b0b0', cx - w * 0.25, 0.15 + h + 0.9, cz - d * 0.2, 0.6, 1.8, 0.6);
  if (rng.chance(0.5)) {
    // garage
    const gw = 3.2;
    const gx = cx + (rng.chance(0.5) ? 1 : -1) * (w / 2 + gw / 2 + 0.1);
    B.solid.box(wall, gx, 0.15 + 1.3, cz + 0.3, gw, 2.6, d * 0.7);
    B.solid.box('#eee6d6', gx, 0.15 + 1.1, cz + 0.3 + d * 0.35 + 0.03, 2.4, 2.2, 0.1);
    B.solid.add(PRISM, roof, gx, 0.15 + 2.6, cz + 0.3, 0, 0, 0, gw + 0.4, 1.2, d * 0.7 + 0.4);
  }
}

function warehouse(B: Batches, rng: Rng, r: Rect): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const h = rng.range(6, 9);
  const c = rng.pick(['#c9cdd2', '#b8bec6', '#d7d3c8', '#a9b0b8']);
  B.solid.box(c, cx, 0.15 + h / 2, cz, w, h, d);
  B.solid.box('#5b6a7a', cx, 0.15 + 2.2, r.z1 + 0.02, w * 0.3, 4.4, 0.12); // loading door
  // saw-tooth roof
  const n = Math.max(2, Math.round(w / 5));
  const seg = w / n;
  for (let i = 0; i < n; i++) {
    B.solid.add(WEDGE, '#8f98a3', r.x0 + seg * (i + 0.5), 0.15 + h, cz, 0, 0, 0, seg, 2.2, d);
  }
  // chimneys
  const nc = rng.int(1, 2);
  for (let i = 0; i < nc; i++) {
    const hc = rng.range(16, 26);
    const x = r.x0 + rng.range(2, w - 2), z = r.z0 + rng.range(2, d - 2);
    B.solid.add(CYL_LO, '#b4473a', x, 0.15 + hc / 2, z, 0, 0, 0, 1.4, hc, 1.4);
    B.solid.add(CYL_LO, '#f0f0f0', x, 0.15 + hc * 0.85, z, 0, 0, 0, 1.45, 1.4, 1.45);
    B.solid.add(CYL_LO, '#f0f0f0', x, 0.15 + hc * 0.65, z, 0, 0, 0, 1.45, 1.4, 1.45);
  }
}

function tank(B: Batches, rng: Rng, x: number, z: number): void {
  const r = rng.range(2, 3.2), h = rng.range(4, 7);
  const c = rng.pick(['#e6e6e6', '#cfd6dd', '#d9c9a8']);
  B.solid.add(CYL, c, x, 0.15 + h / 2, z, 0, 0, 0, r * 2, h, r * 2);
  B.solid.add(HEMI, c, x, 0.15 + h, z, 0, 0, 0, r * 2, r * 0.9, r * 2);
  B.solid.add(CYL_LO, '#7c8894', x + r, 0.15 + h / 2, z, 0, 0, 0, 0.3, h, 0.3);
}

function containers(B: Batches, rng: Rng, x: number, z: number): void {
  const cols = ['#d9534f', '#2b7bb9', '#f0ad4e', '#5cb85c', '#8e6c88', '#e07b39'];
  for (let i = 0; i < rng.int(2, 4); i++) {
    const stack = rng.int(1, 2);
    for (let s = 0; s < stack; s++) B.solid.box(rng.pick(cols), x + i * 2.8, 0.15 + 1.3 + s * 2.6, z, 2.4, 2.6, 6);
  }
}

function tower(B: Batches, rng: Rng, r: Rect): void {
  const style: WallStyle = rng.chance(0.45) ? 'glass' : 'windows';
  const color = style === 'glass' ? rng.pick(PAL.glass) : rng.pick(PAL.tower);
  const tiers = rng.int(1, 3);
  let y = 0.15;
  let rect = r;
  const total = rng.range(30, 95);
  for (let t = 0; t < tiers; t++) {
    const h = t === tiers - 1 ? total - (y - 0.15) : total * (t === 0 ? rng.range(0.4, 0.6) : rng.range(0.2, 0.35));
    body(B, color, rect, y, h, style, 3.4);
    y += h;
    const roofColor = style === 'glass' ? '#7f98ad' : '#9aa1ab';
    if (t < tiers - 1) {
      const m = rng.range(1.5, 3);
      B.solid.box(roofColor, (rect.x0 + rect.x1) / 2, y + 0.15, (rect.z0 + rect.z1) / 2, rect.x1 - rect.x0 + 0.2, 0.3, rect.z1 - rect.z0 + 0.2);
      rect = inset(rect, m);
      if (rect.x1 - rect.x0 < 5 || rect.z1 - rect.z0 < 5) break;
    } else {
      flatRoof(B, rng, rect, y, roofColor, false);
      const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
      const top = rng.next();
      if (top < 0.35) {
        B.solid.add(CYL_LO, '#8c949e', cx, y + 6, cz, 0, 0, 0, 0.4, 12, 0.4);
        B.solid.add(SPHERE_LO, '#ff5a5a', cx, y + 12.2, cz, 0, 0, 0, 0.6);
      } else if (top < 0.6) {
        B.solid.add(DISC, '#3a4048', cx, y + 0.32, cz, -Math.PI / 2, 0, 0, 7, 7, 1);
        B.solid.add(TORUS, '#f2f2f2', cx, y + 0.33, cz, -Math.PI / 2, 0, 0, 5, 5, 1);
      } else if (top < 0.8) {
        B.solid.add(PYRAMID, '#6f8fa5', cx, y + 2.5, cz, 0, Math.PI / 4, 0, Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) * 0.8, 5, Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) * 0.8);
      }
    }
  }
}

function church(B: Batches, rng: Rng, r: Rect): void {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const wall = rng.pick(['#f1e8d8', '#e8dcc6', '#d8d2c8']);
  const nave: Rect = { x0: cx - 5, x1: cx + 5, z0: cz - 8, z1: cz + 6 };
  body(B, wall, nave, 0.15, 7, 'windows', 2.6);
  B.solid.box(wall, cx, 0.15 + 3.5, cz - 1, 10, 7, 14);
  gableRoof(B, nave, 7.15, '#5c6b73', true, 0.5);
  // tower at the front
  B.solid.box(wall, cx, 0.15 + 8, cz + 7, 4, 16, 4);
  B.solid.add(PYRAMID, '#4f8f7a', cx, 16.15 + 3, cz + 7, 0, Math.PI / 4, 0, 4.4, 6, 4.4);
  B.solid.add(SPHERE_LO, '#f2c14e', cx, 22.4, cz + 7, 0, 0, 0, 0.6);
  for (const dz of [-5, -1, 3]) {
    B.solid.box(wall, cx - 5.6, 0.15 + 2, cz + dz, 1.2, 4, 1.2);
    B.solid.box(wall, cx + 5.6, 0.15 + 2, cz + dz, 1.2, 4, 1.2);
  }
}

// ---------------------------------------------------------------- block layouts
function ringBlock(B: Batches, rng: Rng, r: Rect, district: District): void {
  const depth = district === 'oldtown' ? rng.range(6, 7.5) : rng.range(7, 9);
  const segRange: [number, number] = district === 'oldtown' ? [3.6, 6] : district === 'commercial' ? [6, 10] : [5.5, 9];
  const heightFor = (): number =>
    district === 'oldtown' ? rng.range(7, 12) : district === 'commercial' ? (rng.chance(0.25) ? rng.range(16, 30) : rng.range(6, 12)) : rng.range(9, 15);
  const colorFor = (): string =>
    district === 'oldtown' ? rng.pick(PAL.pastel) : district === 'commercial' ? rng.pick([...PAL.paint, ...PAL.brick]) : rng.pick([...PAL.paint, ...PAL.brick, ...PAL.walls]);

  const segments = (len: number): number[] => {
    const out: number[] = [];
    let acc = 0;
    while (acc < len - 0.1) {
      let s = rng.range(segRange[0], segRange[1]);
      if (len - acc - s < segRange[0]) s = len - acc;
      out.push(s);
      acc += s;
    }
    return out;
  };

  const place = (rect: Rect, longAlongZ: boolean, outwardFace: 'x0' | 'x1' | 'z0' | 'z1') => {
    const h = heightFor();
    const col = colorFor();
    const tall = h > 15;
    const style: WallStyle = tall && rng.chance(0.5) ? 'glass' : 'windows';
    body(B, col, rect, 0.15, h, style, district === 'oldtown' ? 2.4 : 3);
    if (district === 'oldtown' || (district === 'residential' && rng.chance(0.3))) {
      gableRoof(B, rect, 0.15 + h, rng.pick(PAL.roofs), longAlongZ, district === 'oldtown' ? 0.55 : 0.4);
      if (rng.chance(0.4)) B.solid.box('#b0b0b0', (rect.x0 + rect.x1) / 2 + rng.range(-1, 1), 0.15 + h + 1.2, (rect.z0 + rect.z1) / 2, 0.6, 2, 0.6);
    } else {
      flatRoof(B, rng, rect, 0.15 + h, style === 'glass' ? '#7f98ad' : '#a39b8f', true);
    }
    if (district === 'commercial' && !tall) {
      // awning + sign on the street face
      const ac = rng.pick(['#e2574c', '#2f8a4b', '#f2c14e', '#3f5f8a', '#e5679a']);
      const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
      if (outwardFace === 'x0') { B.solid.box(ac, rect.x0 - 0.6, 3.2, cz, 1.2, 0.15, rect.z1 - rect.z0 - 0.6); B.solid.box('#fff8e6', rect.x0 - 0.08, 4.4, cz, 0.16, 1.2, (rect.z1 - rect.z0) * 0.6); }
      if (outwardFace === 'x1') { B.solid.box(ac, rect.x1 + 0.6, 3.2, cz, 1.2, 0.15, rect.z1 - rect.z0 - 0.6); B.solid.box('#fff8e6', rect.x1 + 0.08, 4.4, cz, 0.16, 1.2, (rect.z1 - rect.z0) * 0.6); }
      if (outwardFace === 'z0') { B.solid.box(ac, cx, 3.2, rect.z0 - 0.6, rect.x1 - rect.x0 - 0.6, 0.15, 1.2); B.solid.box('#fff8e6', cx, 4.4, rect.z0 - 0.08, (rect.x1 - rect.x0) * 0.6, 1.2, 0.16); }
      if (outwardFace === 'z1') { B.solid.box(ac, cx, 3.2, rect.z1 + 0.6, rect.x1 - rect.x0 - 0.6, 0.15, 1.2); B.solid.box('#fff8e6', cx, 4.4, rect.z1 + 0.08, (rect.x1 - rect.x0) * 0.6, 1.2, 0.16); }
    }
    if (district === 'commercial' && rng.chance(0.2)) {
      // rooftop billboard
      const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
      B.solid.box('#555', cx, 0.15 + h + 1.5, cz, 0.3, 3, 0.3);
      B.solid.box(rng.pick(['#e2574c', '#2f8a4b', '#f2c14e', '#3f5f8a']), cx, 0.15 + h + 4, cz, 5.5, 2.6, 0.25);
      B.solid.box('#fff', cx, 0.15 + h + 4, cz + 0.14, 4.6, 1.8, 0.05);
    }
  };

  // x edges: full z length
  for (const z of segments(r.z1 - r.z0)) { void z; }
  let acc = r.z0;
  for (const s of segments(r.z1 - r.z0)) {
    place({ x0: r.x0, x1: r.x0 + depth, z0: acc, z1: acc + s - 0.25 }, true, 'x0');
    acc += s;
  }
  acc = r.z0;
  for (const s of segments(r.z1 - r.z0)) {
    place({ x0: r.x1 - depth, x1: r.x1, z0: acc, z1: acc + s - 0.25 }, true, 'x1');
    acc += s;
  }
  // z edges: between the corner buildings
  const innerLen = r.x1 - r.x0 - 2 * depth - 0.5;
  if (innerLen > segRange[0]) {
    acc = r.x0 + depth + 0.25;
    for (const s of segments(innerLen)) {
      place({ x0: acc, x1: acc + s - 0.25, z0: r.z0, z1: r.z0 + depth }, false, 'z0');
      acc += s;
    }
    acc = r.x0 + depth + 0.25;
    for (const s of segments(innerLen)) {
      place({ x0: acc, x1: acc + s - 0.25, z0: r.z1 - depth, z1: r.z1 }, false, 'z1');
      acc += s;
    }
  }
  // courtyard
  const cy = inset(r, depth + 1);
  if (cy.x1 - cy.x0 > 3 && cy.z1 - cy.z0 > 3) {
    B.solid.add(PLANE, PAL.grassDark, (cy.x0 + cy.x1) / 2, 0.17, (cy.z0 + cy.z1) / 2, -Math.PI / 2, 0, 0, cy.x1 - cy.x0, cy.z1 - cy.z0, 1);
    for (let i = 0; i < rng.int(1, 3); i++) tree(B, rng, rng.range(cy.x0 + 1, cy.x1 - 1), rng.range(cy.z0 + 1, cy.z1 - 1), 0.8);
  }
}

function suburbBlock(B: Batches, rng: Rng, r: Rect): void {
  // lawn
  B.solid.add(PLANE, PAL.grass, (r.x0 + r.x1) / 2, 0.16, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  const cols = 2, rows = 2;
  const lw = (r.x1 - r.x0) / cols, ld = (r.z1 - r.z0) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lx0 = r.x0 + i * lw, lz0 = r.z0 + j * ld;
    const facingZ = j === 0 ? -1 : 1; // faces the nearest cross street
    const w = rng.range(5.5, 7.5), d = rng.range(4.5, 5.8);
    const cx = lx0 + lw / 2 + rng.range(-1.5, 1.5);
    const cz = facingZ < 0 ? lz0 + d / 2 + 1.5 : lz0 + ld - d / 2 - 1.5;
    house(B, rng, cx, cz, w, d, facingZ);
    // driveway
    B.solid.add(PLANE, '#b9b5ad', cx + w * 0.35, 0.165, facingZ < 0 ? (lz0 + (cz - d / 2)) / 2 : (lz0 + ld + (cz + d / 2)) / 2, -Math.PI / 2, 0, 0, 2.4, Math.abs(facingZ < 0 ? cz - d / 2 - lz0 : lz0 + ld - cz - d / 2) + 0.1, 1);
    // back yard
    const byz = facingZ < 0 ? [cz + d / 2 + 1, lz0 + ld - 0.8] : [lz0 + 0.8, cz - d / 2 - 1];
    if (byz[1] - byz[0] > 2) {
      tree(B, rng, rng.range(lx0 + 1, lx0 + lw - 1), rng.range(byz[0], byz[1]), 0.85);
      if (rng.chance(0.2)) B.solid.add(DISC, '#6fd0f0', lx0 + lw / 2, 0.17, (byz[0] + byz[1]) / 2, -Math.PI / 2, 0, 0, 4, 2.6, 1);
      else if (rng.chance(0.4)) bush(B, rng, rng.range(lx0 + 1, lx0 + lw - 1), rng.range(byz[0], byz[1]));
    }
  }
}

function downtownBlock(B: Batches, rng: Rng, r: Rect): void {
  B.solid.add(PLANE, '#cfcac0', (r.x0 + r.x1) / 2, 0.16, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  const two = rng.chance(0.4);
  if (two) {
    const mid = (r.x0 + r.x1) / 2;
    tower(B, rng, inset({ x0: r.x0, x1: mid - 1, z0: r.z0, z1: r.z1 }, rng.range(1, 2.2)));
    tower(B, rng, inset({ x0: mid + 1, x1: r.x1, z0: r.z0, z1: r.z1 }, rng.range(1, 2.2)));
  } else {
    const w = rng.range(14, 20), d = rng.range(12, 17);
    const cx = rng.range(r.x0 + w / 2 + 1, r.x1 - w / 2 - 1), cz = rng.range(r.z0 + d / 2 + 1, r.z1 - d / 2 - 1);
    tower(B, rng, { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
    // plaza planters at the corners
    for (const [px, pz] of [[r.x0 + 1.5, r.z0 + 1.5], [r.x1 - 1.5, r.z0 + 1.5], [r.x0 + 1.5, r.z1 - 1.5], [r.x1 - 1.5, r.z1 - 1.5]]) {
      if (Math.abs(px - cx) < w / 2 + 2 && Math.abs(pz - cz) < d / 2 + 2) continue;
      B.solid.box('#9a948a', px, 0.5, pz, 2.4, 0.7, 2.4);
      tree(B, rng, px, pz, 0.6, 0.8);
    }
  }
}

function industrialBlock(B: Batches, rng: Rng, r: Rect): void {
  B.solid.add(PLANE, '#b3aea4', (r.x0 + r.x1) / 2, 0.16, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  const w = rng.range(14, 20), d = rng.range(10, 13);
  const left = rng.chance(0.5);
  const wr: Rect = left ? { x0: r.x0 + 0.5, x1: r.x0 + 0.5 + w, z0: r.z1 - 0.5 - d, z1: r.z1 - 0.5 } : { x0: r.x1 - 0.5 - w, x1: r.x1 - 0.5, z0: r.z1 - 0.5 - d, z1: r.z1 - 0.5 };
  warehouse(B, rng, wr);
  // yard in the remaining strip
  const yz = r.z0 + (r.z1 - 0.5 - d - r.z0) / 2;
  if (rng.chance(0.7)) tank(B, rng, left ? r.x1 - 4 : r.x0 + 4, r.z1 - 5);
  if (rng.chance(0.6)) tank(B, rng, left ? r.x1 - 4 : r.x0 + 4, r.z1 - 12);
  containers(B, rng, r.x0 + 2, yz);
  if (rng.chance(0.5)) containers(B, rng, r.x0 + 13, yz + rng.range(-2, 2));
}

function parkBlock(B: Batches, rng: Rng, r: Rect, nearAvenue: boolean): void {
  B.solid.add(PLANE, PAL.grass, (r.x0 + r.x1) / 2, 0.16, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  // paths
  B.solid.add(PLANE, PAL.pavers, cx, 0.17, cz, -Math.PI / 2, 0, 0, 2.2, r.z1 - r.z0, 1);
  B.solid.add(PLANE, PAL.pavers, cx, 0.17, cz, -Math.PI / 2, 0, 0, r.x1 - r.x0, 2.2, 1);
  const centre = rng.next();
  if (centre < 0.3) {
    // pond
    B.solid.add(DISC, PAL.water, cx + 5, 0.17, cz - 4, -Math.PI / 2, 0, 0, 9, 6, 1);
  } else if (centre < 0.55) {
    // fountain
    B.solid.add(CYL, '#cfc7b8', cx, 0.4, cz, 0, 0, 0, 5, 0.5, 5);
    B.solid.add(CYL, PAL.waterLight, cx, 0.6, cz, 0, 0, 0, 4.4, 0.2, 4.4);
    B.solid.add(CYL_LO, '#cfc7b8', cx, 1.4, cz, 0, 0, 0, 0.8, 1.6, 0.8);
    B.solid.add(CYL_LO, '#cfe8f5', cx, 3.0, cz, 0, 0, 0, 0.35, 3, 0.35);
    B.solid.add(SPHERE_LO, '#e6f4fb', cx, 4.4, cz, 0, 0, 0, 1.2, 0.8, 1.2);
  } else if (centre < 0.75) {
    // bandstand
    B.solid.add(CYL, '#e8e1d2', cx, 0.45, cz, 0, 0, 0, 7, 0.6, 7);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B.solid.add(CYL_LO, '#f4f4f4', cx + Math.cos(a) * 2.8, 2.2, cz + Math.sin(a) * 2.8, 0, 0, 0, 0.2, 3.2, 0.2); }
    B.solid.add(CONE, '#3f5f8a', cx, 4.6, cz, 0, 0, 0, 7.6, 2.2, 7.6);
  } else {
    flowerBed(B, rng, cx, cz, 2.2);
  }
  // trees, avoiding the paths
  const n = rng.int(7, 12);
  for (let i = 0; i < n; i++) {
    const x = rng.range(r.x0 + 1, r.x1 - 1), z = rng.range(r.z0 + 1, r.z1 - 1);
    if (Math.abs(x - cx) < 2 || Math.abs(z - cz) < 2) continue;
    if (Math.hypot(x - cx, z - cz) < 5) continue;
    if (rng.chance(0.25)) pine(B, rng, x, z, 0.9); else tree(B, rng, x, z, rng.range(0.8, 1.1));
  }
  for (let i = 0; i < 3; i++) flowerBed(B, rng, rng.range(r.x0 + 2, r.x1 - 2), rng.chance(0.5) ? cz + 2.2 : cz - 2.2, 1);
  // benches along the paths
  for (let i = 0; i < 4; i++) B.solid.box('#8a5a3c', cx + (i % 2 ? 1.6 : -1.6), 0.5, r.z0 + 3 + i * 4.5, 0.5, 0.5, 1.6);
  void nearAvenue;
}

// ---------------------------------------------------------------- landmarks
function landmark(B: Batches, rng: Rng, kind: Landmark, r: Rect, side: 1 | -1, animated: AnimatedObject[], mkMat: (c: string) => THREE.Material): void {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  B.solid.add(PLANE, PAL.pavers, cx, 0.16, cz, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  switch (kind) {
    case 'clocktower': {
      const stone = '#e3d7c3';
      B.solid.box(stone, cx, 0.15 + 5, cz, 11, 10, 11);
      B.solid.box(stone, cx, 0.15 + 10 + 15, cz, 6.5, 30, 6.5);
      for (const [dx, dz, ry] of [[3.3, 0, Math.PI / 2], [-3.3, 0, -Math.PI / 2], [0, 3.3, 0], [0, -3.3, Math.PI]]) {
        B.solid.add(DISC, '#fffaf0', cx + dx, 0.15 + 36, cz + dz, 0, ry, 0, 4.2, 4.2, 1);
        B.solid.add(TORUS, '#3b3530', cx + dx, 0.15 + 36, cz + dz, 0, ry, 0, 4.2, 4.2, 1);
      }
      B.solid.add(PYRAMID, '#4f8f7a', cx, 0.15 + 40 + 4, cz, 0, Math.PI / 4, 0, 7.5, 8, 7.5);
      B.solid.add(SPHERE_LO, '#f2c14e', cx, 0.15 + 48.5, cz, 0, 0, 0, 0.9);
      for (let i = 0; i < 6; i++) tree(B, rng, r.x0 + 1.5 + i * ((r.x1 - r.x0 - 3) / 5), r.z0 + 1.2, 0.7);
      break;
    }
    case 'cathedral': {
      const stone = '#e9e1d1';
      const nave: Rect = { x0: cx - 7, x1: cx + 7, z0: cz - 9, z1: cz + 5 };
      body(B, stone, nave, 0.15, 14, 'windows', 3.5);
      B.solid.box(stone, cx, 0.15 + 7, cz - 2, 14, 14, 14);
      gableRoof(B, nave, 14.15, '#5c6b73', true, 0.45);
      for (const dx of [-5, 5]) {
        B.solid.box(stone, cx + dx, 0.15 + 13, cz + 7, 4.2, 26, 4.2);
        B.solid.add(PYRAMID, '#4f8f7a', cx + dx, 0.15 + 26 + 4, cz + 7, 0, Math.PI / 4, 0, 4.6, 8, 4.6);
      }
      B.solid.add(DISC, '#c84b6e', cx, 0.15 + 9, cz + 9.03, 0, 0, 0, 4.5, 4.5, 1);
      B.solid.add(TORUS, '#3b3530', cx, 0.15 + 9, cz + 9.05, 0, 0, 0, 4.5, 4.5, 1);
      B.solid.box('#5b3a2a', cx, 0.15 + 2.5, cz + 9.03, 2.4, 5, 0.2);
      for (const dz of [-7, -3, 1]) {
        B.solid.box(stone, cx - 7.8, 0.15 + 4, cz + dz, 1.4, 8, 1.4);
        B.solid.box(stone, cx + 7.8, 0.15 + 4, cz + dz, 1.4, 8, 1.4);
      }
      break;
    }
    case 'stadium': {
      B.solid.add(DISC, '#6fbf5a', cx, 0.17, cz, -Math.PI / 2, 0, 0, 18, 14, 1);
      B.solid.add(TORUS, '#ffffff', cx, 0.18, cz, -Math.PI / 2, 0, 0, 14, 10, 1);
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = cx + Math.cos(a) * 11.5, pz = cz + Math.sin(a) * 9;
        B.solid.add(BOX, i % 2 ? '#dfe3e8' : '#c9ced6', px, 0.15 + 4.5, pz, 0, -a, 0, 2.2, 9, 2.8);
        B.solid.add(BOX, '#3f5f8a', px * 0.94 + cx * 0.06, 0.15 + 2.5, pz * 0.94 + cz * 0.06, 0, -a, 0, 1.4, 5, 2.6);
      }
      for (const [dx, dz] of [[-11, -8], [11, -8], [-11, 8], [11, 8]]) {
        B.solid.add(CYL_LO, '#7c8894', cx + dx, 0.15 + 11, cz + dz, 0, 0, 0, 0.5, 22, 0.5);
        B.solid.box('#fff7c2', cx + dx, 0.15 + 22.5, cz + dz, 3, 1.4, 0.6);
      }
      break;
    }
    case 'ferris': {
      // animated wheel
      const g = new THREE.Group();
      const R = 11;
      const wheel = new THREE.Group();
      const rim = new THREE.Mesh(TORUS, mkMat('#e2574c'));
      rim.scale.set(R * 2, R * 2, 2);
      wheel.add(rim);
      const spokeMat = mkMat('#f4f4f4');
      const cabinMats = ['#f2c14e', '#5fb8e6', '#7bc96f', '#e5679a', '#ffffff'].map(mkMat);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const sp = new THREE.Mesh(CYL_LO, spokeMat);
        sp.scale.set(0.25, R, 0.25);
        sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
        sp.rotation.z = a - Math.PI / 2;
        wheel.add(sp);
        const cab = new THREE.Mesh(BOX, cabinMats[i % cabinMats.length]);
        cab.scale.set(1.6, 1.4, 1.6);
        cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        wheel.add(cab);
      }
      wheel.position.set(0, R + 2.5, 0);
      g.add(wheel);
      // A-frame supports
      for (const dz of [-1.6, 1.6]) for (const dx of [-1, 1]) {
        const leg = new THREE.Mesh(CYL_LO, mkMat('#6d7480'));
        leg.scale.set(0.5, R + 3.5, 0.5);
        leg.position.set(dx * 3.5, (R + 2.5) / 2, dz);
        leg.rotation.z = -dx * 0.28;
        g.add(leg);
      }
      g.position.set(cx, 0.15, cz);
      g.rotation.y = Math.PI / 2; // wheel plane along the avenue direction
      animated.push({ obj: g, update(dt) { wheel.rotation.z += dt * 0.25; }, dispose() { /* shared mats */ } });
      // ticket booth + trees
      B.solid.box('#f2c14e', cx + 8, 0.15 + 1.3, cz + 7, 3, 2.6, 3);
      B.solid.add(PRISM, '#e2574c', cx + 8, 0.15 + 2.6, cz + 7, 0, 0, 0, 3.6, 1, 3.6);
      for (let i = 0; i < 4; i++) tree(B, rng, r.x0 + 2 + i * 6, r.z0 + 1.5, 0.7);
      break;
    }
    case 'obelisk': {
      B.solid.box('#d9d0c0', cx, 0.15 + 0.6, cz, 8, 1.2, 8);
      B.solid.box('#d9d0c0', cx, 0.15 + 1.8, cz, 5, 1.2, 5);
      B.solid.add(PYRAMID, '#e7dfd0', cx, 0.15 + 2.4 + 12, cz, 0, Math.PI / 4, 0, 3.2, 24, 3.2);
      B.solid.add(PYRAMID, '#f2c14e', cx, 0.15 + 26.6, cz, 0, Math.PI / 4, 0, 0.9, 1.4, 0.9);
      for (const [dx, dz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) {
        B.solid.box('#9a948a', cx + dx, 0.5, cz + dz, 2.4, 0.7, 2.4);
        tree(B, rng, cx + dx, cz + dz, 0.6, 0.8);
      }
      B.solid.add(DISC, PAL.waterLight, cx, 0.18, cz + 8.5, -Math.PI / 2, 0, 0, 12, 4, 1);
      break;
    }
    case 'arch': {
      // triumphal arch straddling the avenue (sits on both sidewalks)
      const stone = '#e6dcc8';
      const az = cz;
      for (const sx of [-1, 1]) {
        B.solid.box(stone, sx * 8.3, 0.15 + 8, az, 2.4, 16, 6);
        B.solid.box(stone, sx * 8.3, 0.15 + 0.6, az, 3, 1.2, 7);
      }
      B.solid.box(stone, 0, 0.15 + 18.5, az, 19.4, 5, 6.4);
      B.solid.box('#d6c9b0', 0, 0.15 + 21.6, az, 19.4, 1.2, 7);
      B.solid.add(SPHERE_LO, '#f2c14e', 0, 0.15 + 23.5, az, 0, 0, 0, 2.2, 2.2, 2.2);
      // the block itself becomes a small plaza with trees
      for (let i = 0; i < 5; i++) tree(B, rng, rng.range(r.x0 + 2, r.x1 - 2), rng.range(r.z0 + 2, r.z1 - 2), 0.9);
      break;
    }
    case 'dome': {
      const stone = '#efe8da';
      const base: Rect = { x0: cx - 11, x1: cx + 11, z0: cz - 8, z1: cz + 8 };
      body(B, stone, base, 0.15, 10, 'windows', 3.2);
      B.solid.box(stone, cx, 0.15 + 5, cz, 22, 10, 16);
      B.solid.box(stone, cx, 0.15 + 10.3, cz, 22.6, 0.6, 16.6);
      B.solid.add(CYL, stone, cx, 0.15 + 13, cz, 0, 0, 0, 11, 6, 11);
      B.solid.add(HEMI, '#7fa8a0', cx, 0.15 + 16, cz, 0, 0, 0, 12, 7, 12);
      B.solid.add(CYL_LO, stone, cx, 0.15 + 24, cz, 0, 0, 0, 2.2, 2.4, 2.2);
      B.solid.add(SPHERE_LO, '#f2c14e', cx, 0.15 + 25.8, cz, 0, 0, 0, 1);
      for (let i = 0; i < 6; i++) B.solid.add(CYL_LO, stone, cx - 7.5 + i * 3, 0.15 + 5, cz + 9, 0, 0, 0, 1, 10, 1);
      B.solid.add(PRISM, stone, cx, 0.15 + 10, cz + 9, 0, Math.PI / 2, 0, 3, 2.4, 18);
      break;
    }
    case 'mast': {
      B.solid.box('#cfd6dd', cx, 0.15 + 2, cz + 6, 8, 4, 5);
      const H = rng.range(55, 75);
      B.solid.box('#c9ced6', cx, 0.15 + H / 2, cz, 1.2, H, 1.2);
      for (let i = 1; i < 6; i++) B.solid.box('#9aa1ab', cx, 0.15 + i * (H / 6), cz, 2.6, 0.25, 2.6);
      B.solid.add(SPHERE_LO, '#ff4040', cx, 0.15 + H + 0.6, cz, 0, 0, 0, 1);
      for (const [dx, dz] of [[-9, -7], [9, -7], [0, 9]]) {
        const len = Math.hypot(dx, dz, H * 0.8);
        const ry = Math.atan2(dx, dz);
        const rx = Math.atan2(Math.hypot(dx, dz), H * 0.8);
        B.solid.add(CYL_LO, '#8a9099', cx + dx / 2, 0.15 + H * 0.4, cz + dz / 2, rx, ry, 0, 0.1, len, 0.1);
      }
      break;
    }
    case 'watertower': {
      const col = rng.pick(['#d9534f', '#e8e1d2', '#5fb8e6']);
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        B.solid.add(CYL_LO, '#6d7480', cx + dx * 0.9, 0.15 + 8, cz + dz * 0.9, dz * 0.07, 0, -dx * 0.07, 0.4, 16, 0.4);
      }
      B.solid.add(CYL, col, cx, 0.15 + 18, cz, 0, 0, 0, 9, 6, 9);
      B.solid.add(CONE, '#5c6b73', cx, 0.15 + 22.5, cz, 0, 0, 0, 9.6, 3, 9.6);
      B.solid.add(CYL_LO, '#6d7480', cx, 0.15 + 7, cz, 0, 0, 0, 0.6, 14, 0.6);
      for (let i = 0; i < 5; i++) tree(B, rng, rng.range(r.x0 + 1.5, r.x1 - 1.5), rng.range(r.z0 + 1.5, r.z1 - 1.5), 0.8);
      break;
    }
  }
  void side;
}

// ---------------------------------------------------------------- street furniture
function lamp(B: Batches, x: number, z: number): void {
  B.solid.add(CYL_LO, '#4b515b', x, 0.15 + 3, z, 0, 0, 0, 0.16, 6, 0.16);
  B.solid.box('#4b515b', x + (x > 0 ? -0.6 : 0.6), 0.15 + 6, z, 1.3, 0.14, 0.14);
  B.solid.box('#fff3b0', x + (x > 0 ? -1.1 : 1.1), 0.15 + 5.85, z, 0.6, 0.3, 0.5);
}

function trafficLight(B: Batches, x: number, z: number, side: number): void {
  B.solid.add(CYL_LO, '#4b515b', x, 0.15 + 2.5, z, 0, 0, 0, 0.14, 5, 0.14);
  B.solid.box('#4b515b', x + side * 1.5, 0.15 + 5, z, 3, 0.12, 0.12);
  B.solid.box('#2b2f36', x + side * 2.6, 0.15 + 4.4, z, 0.5, 1.4, 0.5);
  B.solid.add(SPHERE_LO, '#ff5a5a', x + side * 2.6, 0.15 + 4.85, z + 0.25, 0, 0, 0, 0.3);
  B.solid.add(SPHERE_LO, '#7bc96f', x + side * 2.6, 0.15 + 4.0, z + 0.25, 0, 0, 0, 0.3);
}

export function car(B: Batches, rng: Rng, x: number, z: number, alongZ: boolean, y = 0): void {
  const c = rng.pick(PAL.cars);
  const ry = alongZ ? 0 : Math.PI / 2;
  B.solid.add(BOX, c, x, y + 0.55, z, 0, ry, 0, 1.7, 0.7, 3.8);
  B.solid.add(BOX, '#bfe9ff', x, y + 1.15, z, 0, ry, 0, 1.5, 0.55, 2.0);
  for (const a of [-1.2, 1.2]) for (const b of [-0.8, 0.8]) {
    const wx = alongZ ? x + b : x + a, wz = alongZ ? z + a : z + b;
    B.solid.add(CYL_LO, '#2b2b2b', wx, y + 0.32, wz, 0, 0, alongZ ? Math.PI / 2 : 0, 0.64, 0.3, 0.64);
    if (!alongZ) B.solid.add(CYL_LO, '#2b2b2b', wx, y + 0.32, wz, Math.PI / 2, 0, 0, 0.64, 0.3, 0.64);
  }
}

function bus(B: Batches, rng: Rng, x: number, z: number): void {
  const c = rng.pick(['#f2c14e', '#e2574c', '#3f5f8a']);
  B.solid.box(c, x, 1.4, z, 2.3, 2.6, 9);
  B.solid.box('#bfe9ff', x, 1.9, z, 2.36, 0.9, 8.4);
  for (const a of [-3, 3]) for (const b of [-1.1, 1.1]) B.solid.add(CYL_LO, '#2b2b2b', x + b, 0.45, z + a, 0, 0, Math.PI / 2, 0.9, 0.3, 0.9);
}

// ---------------------------------------------------------------- chunk assembly
export interface ChunkBuildResult {
  animated: AnimatedObject[];
}

/**
 * Build one chunk's worth of streets, blocks and buildings into the batches.
 * The avenue (cash track) is drawn by the caller because it depends on the
 * stake; this function draws everything else.
 */
export function buildChunk(B: Batches, plan: CityPlan, i: number, seed: string, quality: 'low' | 'high', mkMat: (c: string) => THREE.Material): ChunkBuildResult {
  const rng = new Rng(`${seed}:chunk:${i}`);
  const cp = plan.at(i);
  const district = cp.district;
  const z1 = -i * GRID.CHUNK, z0 = z1 - GRID.CHUNK, zc = (z0 + z1) / 2;
  const animated: AnimatedObject[] = [];
  const W = 620;

  if (district === 'river') {
    buildRiver(B, rng, i);
    return { animated };
  }

  // ---- base ground + streets
  const base = district === 'suburb' || district === 'park' ? PAL.grass : district === 'industrial' ? '#b3aea4' : district === 'oldtown' ? PAL.pavers : PAL.sidewalk;
  B.solid.add(PLANE, base, 0, 0, zc, -Math.PI / 2, 0, 0, W * 2, GRID.CHUNK, 1);
  // cross streets
  for (const j of [2 * i, 2 * i + 1]) {
    const zs = crossStreetZ(j);
    B.solid.add(PLANE, PAL.asphalt, 0, 0.02, zs, -Math.PI / 2, 0, 0, GRID_END_X * 2 + 20, GRID.STREET_Z, 1);
    // crosswalk across the avenue
    for (const edge of [zs - 3.2, zs + 3.2]) for (let x = -6; x <= 6; x += 1.5) B.solid.add(PLANE, PAL.laneWhite, x, 0.04, edge, -Math.PI / 2, 0, 0, 0.8, 1.2, 1);
    // traffic lights at the avenue corners
    trafficLight(B, 10.2, zs + 4.6, -1);
    trafficLight(B, -10.2, zs - 4.6, 1);
  }
  // side streets (parallel to the avenue)
  for (let k = 0; k < GRID.BLOCKS_X; k++) {
    const [, bx1] = blockRectX(k, 1);
    const sx = bx1 + GRID.STREET_X / 2;
    if (k < GRID.BLOCKS_X - 1) {
      B.solid.add(PLANE, PAL.asphalt, sx, 0.02, zc, -Math.PI / 2, 0, 0, GRID.STREET_X, GRID.CHUNK, 1);
      B.solid.add(PLANE, PAL.asphalt, -sx, 0.02, zc, -Math.PI / 2, 0, 0, GRID.STREET_X, GRID.CHUNK, 1);
      for (let z = z1 - 2; z > z0; z -= 5) {
        B.solid.add(PLANE, PAL.laneWhite, sx, 0.035, z, -Math.PI / 2, 0, 0, 0.18, 2.4, 1);
        B.solid.add(PLANE, PAL.laneWhite, -sx, 0.035, z, -Math.PI / 2, 0, 0, 0.18, 2.4, 1);
      }
    }
  }

  // ---- blocks
  const dense = quality === 'high' ? GRID.BLOCKS_X : 3;
  for (const j of [2 * i, 2 * i + 1]) {
    const [bz0, bz1] = blockRowZ(j);
    for (let k = 0; k < dense; k++) {
      for (const side of [1, -1] as const) {
        const [bx0, bx1] = blockRectX(k, side);
        const rect: Rect = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
        // kerb slab
        B.solid.box(PAL.sidewalk, (bx0 + bx1) / 2, 0.075, (bz0 + bz1) / 2, GRID.BLOCK_X, 0.15, GRID.BLOCK_Z);
        const lot = inset(rect, GRID.SIDEWALK);
        const isLandmark = cp.landmark && k === 0 && side === cp.landmarkSide && (j - 2 * i) === cp.landmarkBlock;
        if (isLandmark) {
          landmark(B, rng, cp.landmark!, lot, side, animated, mkMat);
          continue;
        }
        switch (district) {
          case 'suburb': suburbBlock(B, rng, lot); break;
          case 'residential': if (rng.chance(0.3)) suburbBlock(B, rng, lot); else ringBlock(B, rng, lot, 'residential'); break;
          case 'commercial': ringBlock(B, rng, lot, 'commercial'); break;
          case 'downtown': if (k >= 3 && rng.chance(0.5)) ringBlock(B, rng, lot, 'commercial'); else downtownBlock(B, rng, lot); break;
          case 'park': if (k === 0 || rng.chance(0.35)) parkBlock(B, rng, lot, k === 0); else ringBlock(B, rng, lot, 'residential'); break;
          case 'industrial': industrialBlock(B, rng, lot); break;
          case 'oldtown': if (rng.chance(0.12)) church(B, rng, lot); else ringBlock(B, rng, lot, 'oldtown'); break;
          default: break;
        }
      }
    }
    // cars parked along the cross street
    const zs = crossStreetZ(j);
    for (let n = 0; n < rng.int(3, 7); n++) {
      const side = rng.sign();
      car(B, rng, side * rng.range(12, GRID_END_X - 6), zs + rng.sign() * 2.6, false, 0.02);
    }
  }

  // ---- avenue sidewalks + furniture
  for (const j of [2 * i, 2 * i + 1]) {
    const [bz0, bz1] = blockRowZ(j);
    for (const side of [1, -1] as const) {
      B.solid.box(PAL.sidewalk2, side * (GRID.AVE + (GRID.KERB - GRID.AVE) / 2), 0.075, (bz0 + bz1) / 2, GRID.KERB - GRID.AVE, 0.15, GRID.BLOCK_Z);
      lamp(B, side * 8.7, bz1 - 4);
      lamp(B, side * 8.7, bz0 + 4);
      if (district === 'suburb' || district === 'residential' || district === 'park' || district === 'oldtown') {
        B.solid.box('#9a948a', side * 8.4, 0.45, (bz0 + bz1) / 2, 1.6, 0.6, 1.6);
        tree(B, rng, side * 8.4, (bz0 + bz1) / 2, 0.7, 0.75);
      } else if (rng.chance(0.4)) {
        // bus shelter / kiosk
        B.solid.box('#8fb8d8', side * 8.5, 0.15 + 2.4, (bz0 + bz1) / 2, 1.8, 0.12, 4);
        B.solid.box('#6d7480', side * 9.2, 0.15 + 1.2, (bz0 + bz1) / 2 - 1.8, 0.12, 2.4, 0.12);
        B.solid.box('#6d7480', side * 9.2, 0.15 + 1.2, (bz0 + bz1) / 2 + 1.8, 0.12, 2.4, 0.12);
      }
    }
  }
  // traffic on the avenue's outer lanes
  for (let n = 0; n < rng.int(2, 5); n++) {
    const side = rng.sign();
    const z = z1 - rng.range(2, GRID.CHUNK - 2);
    if (rng.chance(0.2)) bus(B, rng, side * 5.3, z); else car(B, rng, side * 5.3, z, true, 0.02);
  }

  // ---- beyond the grid: low-detail outskirts and hills
  for (const side of [1, -1] as const) {
    const n = quality === 'high' ? 14 : 7;
    for (let m = 0; m < n; m++) {
      const x = side * rng.range(GRID_END_X + 20, GRID_END_X + 140);
      const z = z1 - rng.range(0, GRID.CHUNK);
      const tall = district === 'downtown' || district === 'commercial';
      if (district === 'suburb' || district === 'park') {
        if (rng.chance(0.5)) tree(B, rng, x, z, 1.2); else B.solid.box(rng.pick(PAL.walls), x, 1.8, z, 6, 3.6, 5);
      } else {
        const h = tall ? rng.range(10, 50) : rng.range(5, 16);
        const pal = tall ? [...PAL.tower, ...PAL.glass] : district === 'industrial' ? ['#c9cdd2', '#b8bec6', '#d7d3c8'] : [...PAL.paint, ...PAL.brick, ...PAL.pastel];
        B.solid.box(rng.pick(pal), x, h / 2, z, rng.range(6, 12), h, rng.range(6, 12));
        if (!tall && rng.chance(0.5)) B.solid.add(PRISM, rng.pick(PAL.roofs), x, h, z, 0, 0, 0, 9, 3.5, 9);
      }
    }
    if (rng.chance(0.5)) {
      B.solid.add(SPHERE_LO, rng.pick(['#9bd48a', '#86c777', '#a8dc96']), side * rng.range(GRID_END_X + 200, GRID_END_X + 330), -8, zc, 0, 0, 0, rng.range(90, 160), rng.range(26, 46), rng.range(80, 130));
    }
  }

  return { animated };
}

function buildRiver(B: Batches, rng: Rng, i: number): void {
  const z1 = -i * GRID.CHUNK, z0 = z1 - GRID.CHUNK, zc = (z0 + z1) / 2;
  const W = 620;
  // water
  B.solid.add(PLANE, PAL.water, 0, -0.8, zc, -Math.PI / 2, 0, 0, W * 2, GRID.CHUNK, 1);
  for (let n = 0; n < 40; n++) B.solid.add(PLANE, PAL.waterLight, rng.range(-W, W), -0.78, z1 - rng.range(2, GRID.CHUNK - 2), -Math.PI / 2, 0, 0, rng.range(4, 14), 0.5, 1);
  // banks (walls along both chunk edges) + riverside promenade
  for (const zb of [z1, z0]) {
    B.solid.box('#a9a398', 0, -0.4, zb, W * 2, 0.9, 1.2);
    B.solid.box('#cfcac0', 0, 0.075, zb + (zb === z1 ? 2 : -2), W * 2, 0.15, 4);
    for (let x = -GRID_END_X; x <= GRID_END_X; x += 12) {
      if (Math.abs(x) < 11) continue;
      B.solid.add(CYL_LO, '#4b515b', x, 0.15 + 1.5, zb + (zb === z1 ? 1.2 : -1.2), 0, 0, 0, 0.12, 3, 0.12);
      B.solid.add(SPHERE_LO, '#fff3b0', x, 0.15 + 3.1, zb + (zb === z1 ? 1.2 : -1.2), 0, 0, 0, 0.5);
    }
  }
  // bridge carrying the avenue: deck, railings, pylons and arches
  B.solid.box('#8b8f96', 0, -0.4, zc, 2 * GRID.KERB + 1, 0.8, GRID.CHUNK + 2);
  B.solid.box(PAL.sidewalk2, -(GRID.AVE + 1.25), 0.075, zc, 2.5, 0.15, GRID.CHUNK);
  B.solid.box(PAL.sidewalk2, GRID.AVE + 1.25, 0.075, zc, 2.5, 0.15, GRID.CHUNK);
  for (const side of [1, -1]) {
    B.solid.box('#dfe3e8', side * (GRID.KERB - 0.2), 0.15 + 0.6, zc, 0.25, 1.2, GRID.CHUNK);
    for (let z = z1 - 4; z > z0; z -= 4) B.solid.box('#dfe3e8', side * (GRID.KERB - 0.2), 0.15 + 0.5, z, 0.35, 1.0, 0.35);
    for (let z = z1 - 8; z > z0; z -= 16) lamp(B, side * 8.7, z);
  }
  for (let z = z1 - 8; z > z0; z -= 16) {
    for (const side of [1, -1]) B.solid.box('#9ea3aa', side * 6, -4, z, 2.4, 8, 3);
    B.solid.add(TORUS, '#9ea3aa', 0, -0.8, z + 8, 0, 0, 0, 18, 7, 2.5);
  }
  // boats
  for (let n = 0; n < 6; n++) {
    const x = rng.range(-W * 0.8, W * 0.8);
    if (Math.abs(x) < 14) continue;
    const z = z1 - rng.range(6, GRID.CHUNK - 6);
    const c = rng.pick(['#ffffff', '#f2c14e', '#e2574c', '#5fb8e6']);
    B.solid.add(BOX, c, x, -0.4, z, 0, rng.range(0, Math.PI), 0, 2.2, 0.8, 6);
    B.solid.add(BOX, '#3b3f47', x, 0.4, z, 0, 0, 0, 1.4, 0.8, 2);
  }
  // distant hills across the water
  for (const side of [1, -1]) {
    B.solid.add(SPHERE_LO, '#9bd48a', side * rng.range(GRID_END_X + 150, GRID_END_X + 300), -8, zc, 0, 0, 0, rng.range(90, 160), rng.range(26, 46), rng.range(80, 130));
  }
}

export function districtGround(d: District): { ave: string; track: string; line: string; label: string } {
  if (d === 'park' || d === 'oldtown') return { ave: PAL.pavers, track: PAL.paversTrack, line: '#f0e2c6', label: '#7a5a2a' };
  if (d === 'river') return { ave: '#8b8f96', track: '#969aa1', line: '#b4b8bf', label: '#2f3238' };
  if (d === 'industrial') return { ave: '#9a9690', track: '#a5a19b', line: '#bdb9b2', label: '#3a3733' };
  return { ave: PAL.asphalt, track: PAL.asphaltTrack, line: PAL.asphaltLine, label: '#e8e4d8' };
}
