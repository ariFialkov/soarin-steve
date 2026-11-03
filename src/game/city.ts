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
import { LAUNCH_H } from './constants';
import { Route, PX, PZ, BOULEVARD_HALF, BOULEVARD_KERB, STREET_HALF } from './route';
import type { Terrain } from './terrain';
export { LAUNCH_H };
import { BOX, CONE, CYL, CYL_LO, DISC, HEMI, PLANE, PRISM, PYRAMID, SPHERE_LO, TORUS, WEDGE, GeoBatch, windowBox, terrainQuad } from './geobatch';

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
/** Vertical layering so coplanar surfaces never fight: streets sit above the base, paint above streets, lot ground above kerbs. */
export const LAYER = { STREET: 0.03, TRACK: 0.06, MARK: 0.09, CROSS: 0.11, LABEL: 0.14, KERB: 0.15, LOT: 0.2, DETAIL: 0.24, DETAIL2: 0.27 };

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

// ---------------------------------------------------------------- helpers
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

function flowerBed(B: Batches, rng: Rng, x: number, z: number, r: number, y = LAYER.LOT): void {
  B.solid.add(DISC, '#6b4a2b', x, y + 0.07, z, -Math.PI / 2, 0, 0, r * 2, r * 2, 1);
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
      if (outwardFace === 'x0') { B.solid.box(ac, rect.x0 - 0.6, 3.2, cz, 1.2, 0.15, rect.z1 - rect.z0 - 0.6); B.solid.box('#fff8e6', rect.x0 - 0.08, 4.4, cz, LAYER.LOT, 1.2, (rect.z1 - rect.z0) * 0.6); }
      if (outwardFace === 'x1') { B.solid.box(ac, rect.x1 + 0.6, 3.2, cz, 1.2, 0.15, rect.z1 - rect.z0 - 0.6); B.solid.box('#fff8e6', rect.x1 + 0.08, 4.4, cz, LAYER.LOT, 1.2, (rect.z1 - rect.z0) * 0.6); }
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
    B.solid.add(PLANE, PAL.grassDark, (cy.x0 + cy.x1) / 2, LAYER.DETAIL, (cy.z0 + cy.z1) / 2, -Math.PI / 2, 0, 0, cy.x1 - cy.x0, cy.z1 - cy.z0, 1);
    for (let i = 0; i < rng.int(1, 3); i++) tree(B, rng, rng.range(cy.x0 + 1, cy.x1 - 1), rng.range(cy.z0 + 1, cy.z1 - 1), 0.8);
  }
}

function suburbBlock(B: Batches, rng: Rng, r: Rect): void {
  // lawn
  B.solid.add(PLANE, PAL.grass, (r.x0 + r.x1) / 2, LAYER.LOT, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
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
    B.solid.add(PLANE, '#b9b5ad', cx + w * 0.35, LAYER.DETAIL, facingZ < 0 ? (lz0 + (cz - d / 2)) / 2 : (lz0 + ld + (cz + d / 2)) / 2, -Math.PI / 2, 0, 0, 2.4, Math.abs(facingZ < 0 ? cz - d / 2 - lz0 : lz0 + ld - cz - d / 2) + 0.1, 1);
    // back yard
    const byz = facingZ < 0 ? [cz + d / 2 + 1, lz0 + ld - 0.8] : [lz0 + 0.8, cz - d / 2 - 1];
    if (byz[1] - byz[0] > 2) {
      tree(B, rng, rng.range(lx0 + 1, lx0 + lw - 1), rng.range(byz[0], byz[1]), 0.85);
      if (rng.chance(0.2)) B.solid.add(DISC, '#6fd0f0', lx0 + lw / 2, LAYER.DETAIL, (byz[0] + byz[1]) / 2, -Math.PI / 2, 0, 0, 4, 2.6, 1);
      else if (rng.chance(0.4)) bush(B, rng, rng.range(lx0 + 1, lx0 + lw - 1), rng.range(byz[0], byz[1]));
    }
  }
}

function downtownBlock(B: Batches, rng: Rng, r: Rect): void {
  B.solid.add(PLANE, '#cfcac0', (r.x0 + r.x1) / 2, LAYER.LOT, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
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
  B.solid.add(PLANE, '#b3aea4', (r.x0 + r.x1) / 2, LAYER.LOT, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
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
  B.solid.add(PLANE, PAL.grass, (r.x0 + r.x1) / 2, LAYER.LOT, (r.z0 + r.z1) / 2, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  // paths
  B.solid.add(PLANE, PAL.pavers, cx, LAYER.DETAIL, cz, -Math.PI / 2, 0, 0, 2.2, r.z1 - r.z0, 1);
  B.solid.add(PLANE, PAL.pavers, cx, LAYER.DETAIL, cz, -Math.PI / 2, 0, 0, r.x1 - r.x0, 2.2, 1);
  const centre = rng.next();
  if (centre < 0.3) {
    // pond
    B.solid.add(DISC, PAL.water, cx + 5, LAYER.DETAIL, cz - 4, -Math.PI / 2, 0, 0, 9, 6, 1);
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
  B.solid.add(PLANE, PAL.pavers, cx, LAYER.LOT, cz, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
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
      B.solid.add(DISC, '#6fbf5a', cx, LAYER.DETAIL, cz, -Math.PI / 2, 0, 0, 18, 14, 1);
      B.solid.add(TORUS, '#ffffff', cx, LAYER.DETAIL2, cz, -Math.PI / 2, 0, 0, 14, 10, 1);
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
      B.solid.add(DISC, PAL.waterLight, cx, LAYER.DETAIL, cz + 8.5, -Math.PI / 2, 0, 0, 12, 4, 1);
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
function lamp(B: Batches, x: number, z: number, side = 0, alongX = false): void {
  B.solid.add(CYL_LO, '#4b515b', x, 0.15 + 3, z, 0, 0, 0, 0.16, 6, 0.16);
  if (alongX) {
    B.solid.box('#4b515b', x, 0.15 + 6, z, 0.14, 0.14, 1.3);
    B.solid.box('#fff3b0', x, 0.15 + 5.85, z, 0.5, 0.3, 0.6);
  } else {
    const dir = side !== 0 ? -side : (x > 0 ? -1 : 1);
    B.solid.box('#4b515b', x + dir * 0.6, 0.15 + 6, z, 1.3, 0.14, 0.14);
    B.solid.box('#fff3b0', x + dir * 1.1, 0.15 + 5.85, z, 0.6, 0.3, 0.5);
  }
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

export function bus(B: Batches, rng: Rng, x: number, z: number): void {
  const c = rng.pick(['#f2c14e', '#e2574c', '#3f5f8a']);
  B.solid.box(c, x, 1.4, z, 2.3, 2.6, 9);
  B.solid.box('#bfe9ff', x, 1.9, z, 2.36, 0.9, 8.4);
  for (const a of [-3, 3]) for (const b of [-1.1, 1.1]) B.solid.add(CYL_LO, '#2b2b2b', x + b, 0.45, z + a, 0, 0, Math.PI / 2, 0.9, 0.3, 0.9);
}

// ---------------------------------------------------------------- city context
export const MACRO = 3; // blocks per macro tile side

export interface CityCtx {
  seed: string;
  route: Route;
  terrain: Terrain;
  isRiverRow(jz: number): boolean;
  districtAt(ix: number, jz: number): District;
  landmarkAt(ix: number, jz: number): Landmark | null;
}

function hash2(ix: number, jz: number, salt: number): number {
  let h = (ix * 374761393 + jz * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise on the block grid. */
export function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, salt), b = hash2(x0 + 1, y0, salt), c = hash2(x0, y0 + 1, salt), d = hash2(x0 + 1, y0 + 1, salt);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export function makeCityCtx(seed: string, route: Route, terrain: Terrain): CityCtx {
  const rng = new Rng(seed + ':rivers');
  const riverRows = new Set<number>();
  let jz = 9 + rng.int(0, 5);
  while (jz < 600) { riverRows.add(jz); jz += rng.int(11, 19); }
  const salt = new Rng(seed + ':districts').int(1, 1e6);
  const districtAt = (ix: number, jz: number): District => {
    if (riverRows.has(jz)) return 'river';
    if (jz < 3 && Math.abs(ix) < 4) return jz < 1 || Math.abs(ix) > 1 ? 'suburb' : 'residential';
    const density = valueNoise(ix / 5.5 + 100, jz / 5.5 + 100, salt);
    const special = valueNoise(ix / 4 + 300, jz / 4 + 300, salt + 1);
    if (special > 0.8) return 'park';
    if (special < 0.13) return 'industrial';
    if (special > 0.62 && special < 0.7) return 'oldtown';
    if (density < 0.3) return 'suburb';
    if (density < 0.55) return 'residential';
    if (density < 0.78) return 'commercial';
    return 'downtown';
  };
  const landmarkAt = (ix: number, jz: number): Landmark | null => {
    if (riverRows.has(jz) || (jz <= 1 && Math.abs(ix) <= 1)) return null;
    if (hash2(ix, jz, salt + 7) > 1 / 14) return null;
    const d = districtAt(ix, jz);
    const options = LANDMARKS_FOR[d];
    if (!options.length) return null;
    return options[Math.floor(hash2(ix, jz, salt + 8) * options.length)];
  };
  return { seed, route, terrain, isRiverRow: j => riverRows.has(j), districtAt, landmarkAt };
}

const LANDMARKS_FOR: Record<District, Landmark[]> = {
  suburb: ['watertower', 'stadium'], residential: ['watertower', 'clocktower', 'stadium'],
  commercial: ['clocktower', 'arch', 'dome'], downtown: ['dome', 'mast', 'arch', 'ferris'],
  park: ['ferris', 'obelisk', 'stadium'], river: [], industrial: ['mast', 'watertower'],
  oldtown: ['cathedral', 'clocktower', 'obelisk'],
};

// ---------------------------------------------------------------- block geometry
export interface BlockInfo {
  ix: number; jz: number;
  tile: Rect;        // the full tile including its share of the streets
  rect: Rect;        // buildable block (inside the kerbs)
  wW: number; wE: number; wN: number; wS: number;   // half widths of the bounding streets
  e: number;         // block elevation
  district: District;
}

export function blockInfo(ctx: CityCtx, ix: number, jz: number): BlockInfo {
  const r = ctx.route;
  const half = (b: boolean) => (b ? BOULEVARD_KERB : STREET_HALF);
  const wW = half(r.isBoulevardV(ix, jz)), wE = half(r.isBoulevardV(ix + 1, jz));
  const wN = half(r.isBoulevardH(jz, ix)), wS = half(r.isBoulevardH(jz + 1, ix));
  const tile: Rect = { x0: ix * PX, x1: (ix + 1) * PX, z0: -(jz + 1) * PZ, z1: -jz * PZ };
  const rect: Rect = { x0: tile.x0 + wW, x1: tile.x1 - wE, z0: tile.z0 + wS, z1: tile.z1 - wN };
  const e = ctx.terrain.at((rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
  return { ix, jz, tile, rect, wW, wE, wN, wS, e, district: ctx.districtAt(ix, jz) };
}

// ---------------------------------------------------------------- tile assembly
export interface TileBuildResult { animated: AnimatedObject[]; blocks: BlockInfo[] }

function setOffset(B: Batches, y: number): void {
  B.solid.offset.set(0, y, 0); B.facade.offset.set(0, y, 0); B.glass.offset.set(0, y, 0);
}

/** Build one macro tile (MACRO × MACRO blocks) in full detail. */
export function buildMacroTile(B: Batches, ctx: CityCtx, I: number, J: number, quality: 'low' | 'high', mkMat: (c: string) => THREE.Material): TileBuildResult {
  void quality;
  const animated: AnimatedObject[] = [];
  const blocks: BlockInfo[] = [];
  const hAt = (x: number, z: number) => ctx.terrain.at(x, z);
  for (let ix = I * MACRO; ix < (I + 1) * MACRO; ix++) {
    for (let jz = J * MACRO; jz < (J + 1) * MACRO; jz++) {
      const b = blockInfo(ctx, ix, jz);
      blocks.push(b);
      const rng = new Rng(`${ctx.seed}:b:${ix}:${jz}`);
      setOffset(B, 0);
      if (b.district === 'river') { buildRiverTile(B, ctx, b, rng); continue; }

      // ---- base ground under the whole tile, then the streets on its west and north sides
      const base = b.district === 'suburb' || b.district === 'park' ? PAL.grass : b.district === 'industrial' ? '#b3aea4' : b.district === 'oldtown' ? PAL.pavers : PAL.sidewalk;
      B.solid.addRaw(terrainQuad(b.tile.x0, b.tile.x1, b.tile.z0, b.tile.z1, hAt, -0.02, 3, 3), base);
      // west street: an ordinary street is asphalt; the boulevard corridor is pavement, its winding asphalt ribbon is drawn by the world
      B.solid.addRaw(terrainQuad(b.tile.x0 - b.wW, b.tile.x0 + b.wW, b.tile.z0, b.tile.z1, hAt, b.wW === BOULEVARD_KERB ? -0.04 : LAYER.STREET, b.wW === BOULEVARD_KERB ? 4 : 1, 6), b.wW === BOULEVARD_KERB ? PAL.sidewalk2 : PAL.asphalt);
      B.solid.addRaw(terrainQuad(b.tile.x0, b.tile.x1, b.tile.z1 - b.wN, b.tile.z1 + b.wN, hAt, LAYER.STREET, 6, 1), PAL.asphalt);
      // lane dashes on ordinary streets
      if (b.wW === STREET_HALF) for (let z = b.tile.z1 - 2; z > b.tile.z0; z -= 5) B.solid.add(PLANE, PAL.laneWhite, b.tile.x0, hAt(b.tile.x0, z) + LAYER.MARK, z, -Math.PI / 2, 0, 0, 0.18, 2.4, 1);
      if (b.wN === STREET_HALF) for (let x = b.tile.x0 + 2; x < b.tile.x1; x += 5) B.solid.add(PLANE, PAL.laneWhite, x, hAt(x, b.tile.z1) + LAYER.MARK, b.tile.z1, -Math.PI / 2, 0, 0, 2.4, 0.18, 1);

      // ---- kerb slab (deep, to hide the slope beneath) + boulevard sidewalks
      const r = b.rect;
      B.solid.box(PAL.sidewalk, (r.x0 + r.x1) / 2, b.e - 4, (r.z0 + r.z1) / 2, r.x1 - r.x0, 8.3, r.z1 - r.z0);
      const walks: Rect[] = [];

      // ---- the block itself, lifted onto its elevation
      setOffset(B, b.e);
      const lot = inset(r, GRID.SIDEWALK);
      const landmark = ctx.landmarkAt(ix, jz);
      const besideBoulevard = b.wW === BOULEVARD_KERB || b.wE === BOULEVARD_KERB;
      if (besideBoulevard && jz > 4 && hash2(ix, jz, 99) < 0.1) plazaBlock(B, rng, lot);
      else if (landmark) landmarkAt(B, rng, landmark, lot, animated, mkMat);
      else {
        switch (b.district) {
          case 'suburb': suburbBlock(B, rng, lot); break;
          case 'residential': if (rng.chance(0.3)) suburbBlock(B, rng, lot); else ringBlock(B, rng, lot, 'residential'); break;
          case 'commercial': ringBlock(B, rng, lot, 'commercial'); break;
          case 'downtown': downtownBlock(B, rng, lot); break;
          case 'park': parkBlock(B, rng, lot, true); break;
          case 'industrial': industrialBlock(B, rng, lot); break;
          case 'oldtown': if (rng.chance(0.12)) church(B, rng, lot); else ringBlock(B, rng, lot, 'oldtown'); break;
          default: break;
        }
      }
      // ---- furniture on boulevard sidewalks
      const leafy = b.district === 'suburb' || b.district === 'residential' || b.district === 'park' || b.district === 'oldtown';
      for (const w of walks) {
        const alongZ = w.x1 - w.x0 < w.z1 - w.z0;
        const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
        if (alongZ) {
          lamp(B, cx, w.z1 - 3, cx > (r.x0 + r.x1) / 2 ? 1 : -1); lamp(B, cx, w.z0 + 3, cx > (r.x0 + r.x1) / 2 ? 1 : -1);
          if (leafy) { B.solid.box('#9a948a', cx, 0.45, cz, 1.6, 0.6, 1.6); tree(B, rng, cx, cz, 0.7, 0.75); }
        } else {
          lamp(B, w.x1 - 3, cz, 0, true); lamp(B, w.x0 + 3, cz, 0, true);
          if (leafy) { B.solid.box('#9a948a', cx, 0.45, cz, 1.6, 0.6, 1.6); tree(B, rng, cx, cz, 0.7, 0.75); }
        }
      }
      if (b.wW === BOULEVARD_KERB && b.wN === BOULEVARD_KERB) trafficLight(B, r.x0 + 0.8, r.z1 - 0.8, -1);
      setOffset(B, 0);
      // parked cars on the ordinary street to the north
      if (b.wN === STREET_HALF && rng.chance(0.7)) {
        for (let n = 0; n < rng.int(1, 3); n++) {
          const x = rng.range(b.tile.x0 + 6, b.tile.x1 - 6), zz = b.tile.z1 + rng.sign() * 2.6;
          car(B, rng, x, zz, false, hAt(x, zz) + LAYER.STREET);
        }
      }
      // the launch tower straddles the avenue just behind the cannon
      if (ix === 0 && jz === -1) buildLaunchBuilding(B, rng);
    }
  }
  setOffset(B, 0);
  return { animated, blocks };
}

/** A cheap stand-in for distant macro tiles: ground plus simple massing. */
export function buildFarMacroTile(B: Batches, ctx: CityCtx, I: number, J: number): void {
  const hAt = (x: number, z: number) => ctx.terrain.at(x, z);
  for (let ix = I * MACRO; ix < (I + 1) * MACRO; ix++) {
    for (let jz = J * MACRO; jz < (J + 1) * MACRO; jz++) {
      const b = blockInfo(ctx, ix, jz);
      const rng = new Rng(`${ctx.seed}:far:${ix}:${jz}`);
      if (b.district === 'river') { B.solid.addRaw(terrainQuad(b.tile.x0, b.tile.x1, b.tile.z0, b.tile.z1, hAt, -0.8, 2, 2), PAL.water); continue; }
      const base = b.district === 'suburb' || b.district === 'park' ? PAL.grass : b.district === 'industrial' ? '#b3aea4' : PAL.sidewalk;
      B.solid.addRaw(terrainQuad(b.tile.x0, b.tile.x1, b.tile.z0, b.tile.z1, hAt, -0.02, 2, 2), base);
      const r = b.rect;
      setOffset(B, b.e);
      if (b.district === 'park') { for (let i = 0; i < 4; i++) tree(B, rng, rng.range(r.x0 + 2, r.x1 - 2), rng.range(r.z0 + 2, r.z1 - 2), 1.1); setOffset(B, 0); continue; }
      const tall = b.district === 'downtown' || b.district === 'commercial';
      const n = b.district === 'suburb' ? 4 : tall ? 1 + rng.int(0, 1) : 2 + rng.int(0, 2);
      for (let i = 0; i < n; i++) {
        const w = rng.range(6, 12), d = rng.range(6, 10);
        const x = rng.range(r.x0 + w / 2, r.x1 - w / 2), z = rng.range(r.z0 + d / 2, r.z1 - d / 2);
        const h = b.district === 'suburb' ? 3.5 : b.district === 'downtown' ? rng.range(25, 70) : b.district === 'commercial' ? rng.range(8, 28) : b.district === 'industrial' ? rng.range(6, 10) : rng.range(8, 14);
        const pal = tall ? [...PAL.tower, ...PAL.glass] : b.district === 'industrial' ? ['#c9cdd2', '#b8bec6'] : b.district === 'suburb' ? PAL.walls : [...PAL.paint, ...PAL.brick, ...PAL.pastel];
        B.solid.box(rng.pick(pal), x, h / 2, z, w, h, d);
        if (h < 15 && rng.chance(0.6)) B.solid.add(PRISM, rng.pick(PAL.roofs), x, h, z, 0, 0, 0, w + 0.4, Math.min(3.5, w * 0.35), d + 0.4);
      }
      setOffset(B, 0);
    }
  }
}

function buildRiverTile(B: Batches, ctx: CityCtx, b: BlockInfo, rng: Rng): void {
  const hAt = (x: number, z: number) => ctx.terrain.at(x, z);
  const t = b.tile;
  B.solid.addRaw(terrainQuad(t.x0, t.x1, t.z0, t.z1, hAt, -0.8, 3, 3), PAL.water);
  for (let n = 0; n < 6; n++) { const x = rng.range(t.x0 + 2, t.x1 - 2), z = rng.range(t.z0 + 3, t.z1 - 3); B.solid.add(PLANE, PAL.waterLight, x, hAt(x, z) - 0.74, z, -Math.PI / 2, 0, 0, rng.range(4, 10), 0.5, 1); }
  // banks: the north street is a riverside road; a wall drops to the water on both edges
  B.solid.addRaw(terrainQuad(t.x0, t.x1, t.z1 - b.wN, t.z1 + b.wN, hAt, LAYER.STREET, 6, 1), PAL.asphalt);
  for (const zb of [t.z1 - b.wN, t.z0 + b.wS]) {
    const y = hAt((t.x0 + t.x1) / 2, zb);
    B.solid.box('#a9a398', (t.x0 + t.x1) / 2, y - 0.6, zb, t.x1 - t.x0, 1.4, 1.0);
    for (let x = t.x0 + 6; x < t.x1; x += 12) { B.solid.add(CYL_LO, '#4b515b', x, y + 1.5, zb, 0, 0, 0, 0.12, 3, 0.12); B.solid.add(SPHERE_LO, '#fff3b0', x, y + 3.1, zb, 0, 0, 0, 0.5); }
  }
  // the west street crosses as a bridge if the route uses it, otherwise it just ends at the bank
  if (b.wW === BOULEVARD_KERB) {
    const x = t.x0;
    for (let z = t.z1; z > t.z0; z -= 8) {
      const y0 = hAt(x, z), y1 = hAt(x, z - 8);
      B.solid.addRaw(terrainQuad(x - BOULEVARD_KERB - 0.5, x + BOULEVARD_KERB + 0.5, z - 8, z, hAt, -0.4, 1, 1), '#8b8f96');
      B.solid.addRaw(terrainQuad(x - BOULEVARD_HALF, x + BOULEVARD_HALF, z - 8, z, hAt, LAYER.STREET, 1, 1), '#8b8f96');
      for (const side of [1, -1]) {
        B.solid.box(PAL.sidewalk2, x + side * (BOULEVARD_HALF + 1.25), (y0 + y1) / 2 + 0.075, z - 4, 2.5, 0.15, 8);
        B.solid.box('#dfe3e8', x + side * (BOULEVARD_KERB - 0.2), (y0 + y1) / 2 + 0.75, z - 4, 0.25, 1.2, 8);
        B.solid.box('#9ea3aa', x + side * 6, (y0 + y1) / 2 - 4.5, z - 4, 2.4, 8, 3);
      }
      B.solid.add(TORUS, '#9ea3aa', x, (y0 + y1) / 2 - 1.0, z - 4, 0, 0, 0, 18, 7, 2.5);
    }
  }
  // boats
  for (let n = 0; n < 2; n++) {
    const x = rng.range(t.x0 + 4, t.x1 - 4), z = rng.range(t.z0 + 6, t.z1 - 6);
    if (b.wW === BOULEVARD_KERB && Math.abs(x - t.x0) < 14) continue;
    const c = rng.pick(['#ffffff', '#f2c14e', '#e2574c', '#5fb8e6']);
    B.solid.add(BOX, c, x, hAt(x, z) - 0.4, z, 0, rng.range(0, Math.PI), 0, 2.2, 0.8, 6);
    B.solid.add(BOX, '#3b3f47', x, hAt(x, z) + 0.4, z, 0, 0, 0, 1.4, 0.8, 2);
  }
}

function buildLaunchBuilding(B: Batches, rng: Rng): void {
  const H = LAUNCH_H;
  const r: Rect = { x0: -GRID.KERB, x1: GRID.KERB, z0: -6, z1: 30 };
  const cx = 0, cz = (r.z0 + r.z1) / 2;
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  // body: warm stone base, windowed floors, a glass band near the top
  B.solid.box('#d9cfbd', cx, 2, cz, w + 1, 4, d + 1);
  body(B, '#f1eadc', { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 }, 4, H - 7, 'windows', 3.2);
  body(B, '#bfe0f5', { x0: r.x0 + 0.2, x1: r.x1 - 0.2, z0: r.z0 + 0.2, z1: r.z1 - 0.2 }, H - 3, 2.4, 'glass', 3);
  // roof deck + parapet
  B.solid.box('#e6dccb', cx, H - 0.3, cz, w + 1.2, 0.6, d + 1.2);
  B.solid.add(PLANE, PAL.pavers, cx, H + 0.02, cz, -Math.PI / 2, 0, 0, w, d, 1);
  for (const [x, zz, bw, bd] of [[0, r.z0 - 0.35, w + 1.2, 0.5], [0, r.z1 + 0.35, w + 1.2, 0.5], [r.x0 - 0.35, cz, 0.5, d + 1.2], [r.x1 + 0.35, cz, 0.5, d + 1.2]]) {
    B.solid.box('#e6dccb', x, H + 0.5, zz, bw, 1.0, bd);
  }
  // launch pad markings: a lighter runway strip pointing down the avenue
  B.solid.add(PLANE, '#efe6d2', 0, H + 0.04, 8, -Math.PI / 2, 0, 0, 6, 26, 1);
  for (let z = 24; z > -4; z -= 4) B.solid.add(PLANE, '#d8c9a8', 0, H + 0.05, z, -Math.PI / 2, 0, 0, 0.3, 2, 1);
  // corner planters with trees, a couple of benches, rooftop gear at the back
  for (const [x, zz] of [[-7.5, 27], [7.5, 27], [-7.5, -3.5], [7.5, -3.5]]) {
    B.solid.box('#9a948a', x, H + 0.4, zz, 2.2, 0.8, 2.2);
    tree(B, rng, x, zz, 0.55, H + 0.7);
  }
  B.solid.box('#8a5a3c', -6, H + 0.5, 12, 0.5, 0.5, 2.4);
  B.solid.box('#8a5a3c', 6, H + 0.5, 12, 0.5, 0.5, 2.4);
  B.solid.box('#b7bcc4', -5.5, H + 0.9, 24, 2.2, 1.6, 1.6);
  B.solid.box('#b7bcc4', 5.5, H + 0.9, 24, 2.2, 1.6, 1.6);
  // flagpole with a little paper-plane pennant
  B.solid.add(CYL_LO, '#dfe3e8', 8.2, H + 4, 20, 0, 0, 0, 0.12, 8, 0.12);
  B.solid.add(PRISM, '#e2574c', 7.0, H + 7.3, 20, 0, 0, -Math.PI / 2, 1.2, 2.2, 0.08);
  // entrance canopy on the street side
  B.solid.box('#e2574c', 0, 4.2, r.z0 - 1.6, 8, 0.3, 3.2);
  B.solid.box('#8d5a3b', 0, 2, r.z0 - 0.05, 3, 4, 0.2);
}

/** A town square on the inside of a route corner. */
function plazaBlock(B: Batches, rng: Rng, r: Rect): void {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  B.solid.add(PLANE, PAL.pavers, cx, LAYER.LOT, cz, -Math.PI / 2, 0, 0, r.x1 - r.x0, r.z1 - r.z0, 1);
  B.solid.add(PLANE, '#cdb78f', cx, LAYER.DETAIL, cz, -Math.PI / 2, 0, 0, (r.x1 - r.x0) * 0.6, (r.z1 - r.z0) * 0.6, 1);
  const kind = rng.next();
  if (kind < 0.4) {
    B.solid.add(CYL, '#cfc7b8', cx, 0.4, cz, 0, 0, 0, 7, 0.6, 7);
    B.solid.add(CYL, PAL.waterLight, cx, 0.62, cz, 0, 0, 0, 6.2, 0.2, 6.2);
    B.solid.add(CYL_LO, '#cfc7b8', cx, 1.6, cz, 0, 0, 0, 1.2, 2, 1.2);
    B.solid.add(CYL, '#cfc7b8', cx, 2.6, cz, 0, 0, 0, 3.2, 0.3, 3.2);
    B.solid.add(CYL_LO, '#cfe8f5', cx, 4, cz, 0, 0, 0, 0.35, 3, 0.35);
  } else if (kind < 0.7) {
    B.solid.box('#d9d0c0', cx, 0.75, cz, 5, 1.5, 5);
    B.solid.add(PYRAMID, '#e7dfd0', cx, 1.5 + 7, cz, 0, Math.PI / 4, 0, 2.4, 14, 2.4);
    B.solid.add(PYRAMID, '#f2c14e', cx, 15.6, cz, 0, Math.PI / 4, 0, 0.7, 1.1, 0.7);
  } else {
    // statue of a certain daredevil
    B.solid.box('#9a948a', cx, 1, cz, 3, 2, 3);
    B.solid.add(CYL_LO, '#b8a34a', cx, 3.5, cz, 0, 0, 0, 1.0, 3, 1.0);
    B.solid.add(SPHERE_LO, '#b8a34a', cx, 5.4, cz, 0, 0, 0, 0.9);
    B.solid.add(BOX, '#b8a34a', cx, 4.6, cz, 0, 0, 0.5, 3.2, 0.4, 0.4);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = cx + dx * (r.x1 - r.x0) * 0.36, pz = cz + dz * (r.z1 - r.z0) * 0.36;
    B.solid.box('#9a948a', px, 0.5, pz, 2.2, 0.7, 2.2);
    tree(B, rng, px, pz, 0.7, 0.8);
    B.solid.box('#8a5a3c', px + dx * 3, 0.5, pz, 0.5, 0.5, 1.8);
  }
  for (let i = 0; i < 3; i++) flowerBed(B, rng, cx + (i - 1) * 6, r.z0 + 2.5, 1);
}

function landmarkAt(B: Batches, rng: Rng, kind: Landmark, r: Rect, animated: AnimatedObject[], mkMat: (c: string) => THREE.Material): void {
  landmark(B, rng, kind, r, 1, animated, mkMat);
}

export interface GroundStyle { ave: string; track: string; line: string; lane: string; cross: string; label: string; labelStroke: string }

/** Avenue surface per district. Markings are darker/lighter shades of the same surface so the track blends in. */
export function districtGround(d: District): GroundStyle {
  if (d === 'park' || d === 'oldtown') return { ave: PAL.pavers, track: PAL.paversTrack, line: '#c9b48c', lane: '#cdb78f', cross: '#b89d72', label: '#7d5f36', labelStroke: '#ead9b8' };
  if (d === 'river') return { ave: '#8b8f96', track: '#969aa1', line: '#7a7e85', lane: '#a39f7a', cross: '#6e7279', label: '#4a4e55', labelStroke: '#aab0b8' };
  if (d === 'industrial') return { ave: '#9a9690', track: '#a5a19b', line: '#87837d', lane: '#aaa07e', cross: '#7b7771', label: '#56524c', labelStroke: '#bdb9b2' };
  return { ave: PAL.asphalt, track: PAL.asphaltTrack, line: '#5f6369', lane: '#b9a04a', cross: '#575b61', label: '#3e4147', labelStroke: '#9a9ea5' };
}
