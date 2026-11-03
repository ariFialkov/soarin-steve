/**
 * GeoBatch accumulates coloured primitive instances and merges them into a
 * single mesh, so a whole city chunk is one or two draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

const nonIndexedCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function nonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.index) return geo;
  let n = nonIndexedCache.get(geo);
  if (!n) { n = geo.toNonIndexed(); nonIndexedCache.set(geo, n); }
  return n;
}

export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];
  /** Added to every part's position (used to lift whole blocks onto the terrain). */
  readonly offset = new THREE.Vector3();

  /** Add a transformed, coloured copy of `geo`. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x: number, y: number, z: number,
      rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): void {
    const g = nonIndexed(geo).clone();
    tmpP.set(x + this.offset.x, y + this.offset.y, z + this.offset.z);
    tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
    tmpS.set(sx, sy, sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    tmpC.set(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    g.deleteAttribute('uv1');
    g.deleteAttribute('uv2');
    this.parts.push(g);
  }

  /** Axis-aligned box helper: centre (x,y,z), size (w,h,d). */
  box(color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): void {
    this.add(BOX, color, x, y, z, 0, ry, 0, w, h, d);
  }

  /** Add an already-built, world-space geometry (e.g. a terrain-following strip). Takes ownership. */
  addRaw(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    tmpC.set(color);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.deleteAttribute('uv1'); g.deleteAttribute('uv2');
    this.parts.push(g);
  }

  get size(): number { return this.parts.length; }

  build(material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/**
 * A horizontal quad (x0..x1 × z0..z1) subdivided so its vertices can follow a
 * height function. `lift` is added to every height.
 */
export function terrainQuad(x0: number, x1: number, z0: number, z1: number, heightAt: (x: number, z: number) => number, lift: number, segX = 2, segZ = 2): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, segZ);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    pos.setXYZ(i, x, heightAt(x, z) + lift, z);
  }
  g.computeVertexNormals();
  return g;
}

/** A quad between two route samples (a strip segment), following the terrain. */
export function stripQuad(ax: number, az: number, bx: number, bz: number, nxA: number, nzA: number, nxB: number, nzB: number, halfW: number, heightAt: (x: number, z: number) => number, lift: number, offsetN = 0): THREE.BufferGeometry {
  const p = (x: number, z: number) => [x, heightAt(x, z) + lift, z];
  const a0 = p(ax + nxA * (offsetN - halfW), az + nzA * (offsetN - halfW));
  const a1 = p(ax + nxA * (offsetN + halfW), az + nzA * (offsetN + halfW));
  const b0 = p(bx + nxB * (offsetN - halfW), bz + nzB * (offsetN - halfW));
  const b1 = p(bx + nxB * (offsetN + halfW), bz + nzB * (offsetN + halfW));
  // wind the triangles so the face points up whichever way the strip runs
  const ux = b0[0] - a0[0], uz = b0[2] - a0[2], vx = b1[0] - a0[0], vz = b1[2] - a0[2];
  const up = (uz * vx - ux * vz) > 0;
  const verts = up
    ? new Float32Array([...a0, ...b0, ...b1, ...a0, ...b1, ...a1])
    : new Float32Array([...a0, ...b1, ...b0, ...a0, ...a1, ...b1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

// ---- shared primitives ----------------------------------------------------
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const SPHERE = new THREE.SphereGeometry(0.5, 8, 6);
export const SPHERE_LO = new THREE.SphereGeometry(0.5, 6, 4);
export const CONE = new THREE.ConeGeometry(0.5, 1, 8);
export const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
export const CYL_LO = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
export const PLANE = new THREE.PlaneGeometry(1, 1);
export const TORUS = new THREE.TorusGeometry(0.5, 0.08, 6, 16);
export const PRISM = (() => {
  // triangular prism along z, apex up: used for gabled roofs. Width 1, height 1, depth 1.
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();
export const WEDGE = (() => {
  // right-angle wedge (saw-tooth roof segment) along z
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(-0.5, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();
export const DISC = new THREE.CircleGeometry(0.5, 20);
export const HEMI = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
export const PYRAMID = new THREE.ConeGeometry(0.5, 1, 4);

/**
 * A box whose side faces tile a window texture: one tile per (winW × winH)
 * units of facade. Top and bottom faces get a blank uv so they stay plain.
 */
export function windowBox(w: number, h: number, d: number, winW = 3, winH = 3.2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry vertex order: +x(0-3) -x(4-7) +y(8-11) -y(12-15) +z(16-19) -z(20-23)
  const faceU = [d, d, 0, 0, w, w];
  for (let i = 0; i < 24; i++) {
    const f = Math.floor(i / 4);
    const u = uv.getX(i), v = uv.getY(i);
    if (f === 2 || f === 3) uv.setXY(i, 0.02, 0.02);
    else uv.setXY(i, u * Math.max(1, Math.round(faceU[f] / winW)), v * Math.max(1, Math.round(h / winH)));
  }
  return g;
}

/** Window-grid tile: wall area white (tinted by vertex colour), glass bluish, frame dark. */
export function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  // tiny corner blank for roofs
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 4, 4);
  // window
  g.fillStyle = '#2c3340';
  g.fillRect(18, 14, 30, 36);
  g.fillStyle = '#8fc3e8';
  g.fillRect(20, 16, 26, 32);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(20, 16, 11, 14);
  g.fillStyle = '#2c3340';
  g.fillRect(32, 16, 2, 32);
  g.fillRect(20, 31, 26, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Glass-curtain-wall tile: horizontal bands of glass with thin mullions. */
export function makeGlassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fd2f2';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 4, 4);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, 64, 20);
  g.fillStyle = '#5b7f9a';
  g.fillRect(0, 44, 64, 6);
  g.fillRect(30, 0, 3, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
