/** Procedural folded-paper plane meshes, plus the sparkler strap-ons. */
import * as THREE from 'three';
import type { PlaneDef } from '../data/planes';
import { SILHOUETTES, halfSpan } from './silhouettes';
import { BOOST_CONFIG } from '../core/config';

export interface PlaneModel {
  group: THREE.Group;           // positioned/rotated by the flight controller
  body: THREE.Group;            // inner group used for sway/roll animation
  sparklers: THREE.Group[];     // mounted sparklers (tip at local origin of each group)
  sparklerTips: THREE.Mesh[];
  halfSpan: number;
  dispose(): void;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

function paperTexture(p: PlaneDef): THREE.CanvasTexture {
  const key = `${p.paper}|${p.accent}|${p.pattern}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = p.paper;
  g.fillRect(0, 0, 128, 128);
  // paper grain
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(90,70,40,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.fillStyle = p.accent;
  g.strokeStyle = p.accent;
  g.globalAlpha = 0.85;
  if (p.pattern === 'stripe') {
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 9, 128);
  } else if (p.pattern === 'dots') {
    for (let y = 8; y < 128; y += 24) for (let x = 8; x < 128; x += 24) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
  } else if (p.pattern === 'chevron') {
    g.lineWidth = 5;
    for (let y = 0; y < 128 + 32; y += 32) {
      g.beginPath();
      for (let x = 0; x <= 128; x += 32) { g.lineTo(x, y); g.lineTo(x + 16, y - 16); }
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

function halfWingGeometry(outline: [number, number][], side: 1 | -1, dihedral: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  outline.forEach(([x, z], i) => { if (i === 0) shape.moveTo(x * side, z); else shape.lineTo(x * side, z); });
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 1);
  // ShapeGeometry lies in XY; we treat shape.y as z. Rotate so it lies in XZ (y up).
  geo.rotateX(Math.PI / 2); // shape y -> +z
  // dihedral: rotate about z axis (fold line) so the wing tips rise
  geo.rotateZ(dihedral * side);
  // uv: use xz for tiling
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 3;
    uv[i * 2 + 1] = pos.getZ(i) * 3;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function outlineLines(outline: [number, number][], side: 1 | -1, dihedral: number): Float32Array {
  const pts: number[] = [];
  const m = new THREE.Matrix4().makeRotationZ(dihedral * side);
  const v = new THREE.Vector3();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    for (const p of [a, b]) {
      v.set(p[0] * side, 0.002, p[1]).applyMatrix4(m);
      pts.push(v.x, v.y, v.z);
    }
  }
  return new Float32Array(pts);
}

/** A thin strip of accent colour just inside each edge of the outline. */
function borderGeometry(outline: [number, number][], side: 1 | -1, dihedral: number, w: number): THREE.BufferGeometry {
  const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length * side;
  const cz = outline.reduce((a, p) => a + p[1], 0) / outline.length;
  const verts: number[] = [];
  const m = new THREE.Matrix4().makeRotationZ(dihedral * side);
  const v = new THREE.Vector3();
  const push = (x: number, z: number) => { v.set(x, 0.003, z).applyMatrix4(m); verts.push(v.x, v.y, v.z); };
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const ax = a[0] * side, az = a[1], bx = b[0] * side, bz = b[1];
    if (Math.abs(ax) < 1e-6 && Math.abs(bx) < 1e-6) continue; // centre fold, no border
    let nx = -(bz - az), nz = bx - ax;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len; nz /= len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nx * (cx - mx) + nz * (cz - mz) < 0) { nx = -nx; nz = -nz; }
    push(ax, az); push(bx, bz); push(bx + nx * w, bz + nz * w);
    push(ax, az); push(bx + nx * w, bz + nz * w); push(ax + nx * w, az + nz * w);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

export function buildPlaneModel(p: PlaneDef): PlaneModel {
  const def = SILHOUETTES[p.silhouette];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const mat = new THREE.MeshStandardMaterial({
    map: paperTexture(p),
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const edgeMat = new THREE.MeshStandardMaterial({ color: p.accent, side: THREE.DoubleSide, roughness: 0.9 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5b544c, transparent: true, opacity: 0.55 });
  const disposables: { dispose(): void }[] = [mat, edgeMat, lineMat];

  const addWing = (outline: [number, number][], dihedral: number) => {
    for (const side of [1, -1] as const) {
      const g = halfWingGeometry(outline, side, dihedral);
      disposables.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      body.add(mesh);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(outlineLines(outline, side, dihedral), 3));
      disposables.push(lg);
      body.add(new THREE.LineSegments(lg, lineMat));
      if (p.pattern === 'edge') {
        const bg = borderGeometry(outline, side, dihedral, 0.045);
        disposables.push(bg);
        body.add(new THREE.Mesh(bg, edgeMat));
      }
    }
  };
  addWing(def.outline, def.dihedral);
  if (def.canard) addWing(def.canard, def.dihedral * 0.5);

  // keel (the folded fuselage under the centre line)
  const noseZ = def.outline[0][1];
  const tailZ = def.outline[def.outline.length - 1][1];
  const keel = new THREE.Shape();
  keel.moveTo(noseZ, 0);
  keel.lineTo(tailZ, 0);
  keel.lineTo(tailZ, -def.keelDepth);
  keel.lineTo(noseZ + 0.12, -def.keelDepth * 0.9);
  keel.closePath();
  const keelGeo = new THREE.ShapeGeometry(keel);
  keelGeo.rotateY(-Math.PI / 2); // shape x -> +z
  disposables.push(keelGeo);
  const keelMesh = new THREE.Mesh(keelGeo, mat);
  body.add(keelMesh);

  // fins
  const finShape = (h: number, len: number) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(len, 0); s.lineTo(len * 0.8, h); s.lineTo(len * 0.25, h); s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateY(-Math.PI / 2);
    disposables.push(g);
    return g;
  };
  if (def.tipFins) {
    const tip = def.outline.reduce((a, b) => (b[0] > a[0] ? b : a));
    for (const side of [1, -1] as const) {
      const m = new THREE.Mesh(finShape(def.tipFins, 0.22), mat);
      const pos = new THREE.Vector3(tip[0] * side, 0, tip[1] - 0.2).applyMatrix4(new THREE.Matrix4().makeRotationZ(def.dihedral * side));
      m.position.copy(pos);
      body.add(m);
    }
  }
  if (def.tailFin) {
    const m = new THREE.Mesh(finShape(def.tailFin, 0.22), mat);
    m.position.set(0, 0, tailZ - 0.24);
    body.add(m);
  }

  // sparkler mounts
  const sparklers: THREE.Group[] = [];
  const sparklerTips: THREE.Mesh[] = [];
  const hs = halfSpan(p.silhouette);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6, metalness: 0.4 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffd766, roughness: 0.8 });
  disposables.push(stickMat, tipMat, tapeMat);
  const stickGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.26, 6);
  const tipGeo = new THREE.CylinderGeometry(0.012, 0.009, 0.09, 6);
  const tapeGeo = new THREE.BoxGeometry(0.04, 0.012, 0.03);
  disposables.push(stickGeo, tipGeo, tapeGeo);
  const maxSp = BOOST_CONFIG.sparkler.max;
  for (let i = 0; i < maxSp; i++) {
    const g = new THREE.Group();
    const t = maxSp === 1 ? 0 : i / (maxSp - 1);
    const x = (t - 0.5) * Math.min(hs * 1.3, 0.5);
    g.position.set(x, 0.012, tailZ - 0.22);
    g.rotation.x = -Math.PI / 2 + 0.12; // stick pointing backwards (+z), tip slightly up
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.position.y = 0.13;
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = 0.3;
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.y = 0.04;
    g.add(stick, tip, tape);
    g.visible = false;
    body.add(g);
    sparklers.push(g);
    sparklerTips.push(tip);
  }

  return {
    group, body, sparklers, sparklerTips, halfSpan: hs,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
