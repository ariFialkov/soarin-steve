/**
 * Soarin' Steve: a procedurally built, jointed stuntman with a small library
 * of poses and an animator that blends between them. The engine drives the
 * pose and the body orientation; the suit sets the colours.
 */
import * as THREE from 'three';
import type { SuitDef } from '../data/suits';
import { BOOST_CONFIG } from '../core/config';

export type Joint = 'torso' | 'head' | 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lHip' | 'rHip' | 'lKnee' | 'rKnee';
const JOINTS: Joint[] = ['torso', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHip', 'rHip', 'lKnee', 'rKnee'];

/** Joint rotations [rx, ry, rz]. Limbs hang along -y; +rx swings them forward (toward -z). */
export type Pose = Partial<Record<Joint, [number, number, number]>>;

export const POSES: Record<string, Pose> = {
  stand: {},
  // front tuck, hugging the knees
  tuck: { torso: [0.55, 0, 0], head: [0.6, 0, 0], lShoulder: [1.3, 0, -0.25], rShoulder: [1.3, 0, 0.25], lElbow: [1.9, 0, 0], rElbow: [1.9, 0, 0], lHip: [2.1, 0, -0.1], rHip: [2.1, 0, 0.1], lKnee: [-2.4, 0, 0], rKnee: [-2.4, 0, 0] },
  // arms straight ahead, legs together, head up
  superman: { torso: [-0.05, 0, 0], head: [0.45, 0, 0], lShoulder: [2.95, 0, -0.12], rShoulder: [2.95, 0, 0.12], lElbow: [0.05, 0, 0], rElbow: [0.05, 0, 0], lHip: [-0.08, 0, -0.04], rHip: [-0.08, 0, 0.04], lKnee: [-0.08, 0, 0], rKnee: [-0.08, 0, 0] },
  // arms and legs fanned out
  squirrel: { torso: [-0.1, 0, 0], head: [0.5, 0, 0], lShoulder: [0.7, 0, -1.55], rShoulder: [0.7, 0, 1.55], lElbow: [0.25, 0, 0], rElbow: [0.25, 0, 0], lHip: [0.1, 0, -0.55], rHip: [0.1, 0, 0.55], lKnee: [-0.45, 0, 0], rKnee: [-0.45, 0, 0] },
  // rolling along the ground: knees and elbows in, so the body stays a compact ball
  tumble: { torso: [0.5, 0, 0.1], head: [0.4, 0.2, 0], lShoulder: [1.8, 0, -0.6], rShoulder: [1.2, 0, 0.7], lElbow: [1.6, 0, 0], rElbow: [1.9, 0, 0], lHip: [1.7, 0, -0.3], rHip: [1.2, 0, 0.35], lKnee: [-1.9, 0, 0], rKnee: [-1.4, 0, 0] },
  // mid-wipeout flailing
  flail: { torso: [0.3, 0, 0.1], head: [0.3, 0.3, 0], lShoulder: [2.4, 0, -1.0], rShoulder: [1.4, 0, 1.2], lElbow: [0.7, 0, 0], rElbow: [1.4, 0, 0], lHip: [0.9, 0, -0.5], rHip: [-0.4, 0, 0.4], lKnee: [-1.2, 0, 0], rKnee: [-0.5, 0, 0] },
  // flat on his back, star shaped
  sprawl: { torso: [0, 0, 0], head: [-0.15, 0.4, 0], lShoulder: [-0.1, 0, -1.7], rShoulder: [-0.1, 0, 1.5], lElbow: [0.5, 0, 0], rElbow: [0.2, 0, 0], lHip: [0, 0, -0.4], rHip: [0, 0, 0.3], lKnee: [-0.2, 0, 0], rKnee: [-0.5, 0, 0] },
  // sitting up, one hand on the head
  sit: { torso: [0.45, 0, 0], head: [0.1, -0.2, 0], lShoulder: [0.4, 0, -0.15], rShoulder: [2.5, 0, 0.4], lElbow: [0.9, 0, 0], rElbow: [2.4, 0, 0], lHip: [1.5, 0, -0.15], rHip: [1.35, 0, 0.2], lKnee: [-0.5, 0, 0], rKnee: [-0.9, 0, 0] },
  // standing, hand on the lower back, a little hunched
  gingerly: { torso: [0.25, 0, 0], head: [-0.1, 0, 0], lShoulder: [0.2, 0, -0.1], rShoulder: [-0.6, 0, 0.5], lElbow: [0.4, 0, 0], rElbow: [1.7, 0, 0], lHip: [0.1, 0, -0.05], rHip: [0.05, 0, 0.1], lKnee: [-0.35, 0, 0], rKnee: [-0.2, 0, 0] },
  // brushing the left shoulder with the right hand
  brushL: { torso: [0.05, 0.15, 0], head: [0.05, 0.35, 0], lShoulder: [0.15, 0, -0.15], rShoulder: [1.3, 0, 0.7], lElbow: [0.3, 0, 0], rElbow: [2.5, 0, 0], lHip: [0, 0, -0.08], rHip: [0, 0, 0.08], lKnee: [-0.05, 0, 0], rKnee: [-0.05, 0, 0] },
  brushR: { torso: [0.05, -0.15, 0], head: [0.05, -0.35, 0], lShoulder: [1.3, 0, -0.7], rShoulder: [0.15, 0, 0.15], lElbow: [2.5, 0, 0], rElbow: [0.3, 0, 0], lHip: [0, 0, -0.08], rHip: [0, 0, 0.08], lKnee: [-0.05, 0, 0], rKnee: [-0.05, 0, 0] },
  // fists on hips, chest out, chin up
  hero: { torso: [-0.12, 0, 0], head: [0.18, 0, 0], lShoulder: [0.25, 0, -0.75], rShoulder: [0.25, 0, 0.75], lElbow: [1.55, 0.6, 0], rElbow: [1.55, -0.6, 0], lHip: [0, 0, -0.2], rHip: [0, 0, 0.2], lKnee: [0, 0, 0], rKnee: [0, 0, 0] },
  // standing inside something up to the waist, arms raised in triumph
  triumph: { torso: [-0.1, 0, 0], head: [0.25, 0, 0], lShoulder: [2.6, 0, -0.5], rShoulder: [2.6, 0, 0.5], lElbow: [0.3, 0, 0], rElbow: [0.3, 0, 0], lHip: [0, 0, -0.1], rHip: [0, 0, 0.1], lKnee: [0, 0, 0], rKnee: [0, 0, 0] },
};

/** Body proportions and signature features of each stuntman (multipliers on Steve's build). */
export interface Physique {
  leg: number; legT: number;        // leg length / thickness
  arm: number; armT: number;
  torsoLen: number; torsoW: number; torsoD: number;
  shoulderW: number;
  head: number; headLong: number;
  belly: number;                    // 0..1 round belly
  pecs: number;                     // 0..1 heroic chest
  style: 'steve' | 'chris' | 'pete' | 'hank';
  rocketShoes: boolean;
}

export const PHYSIQUES: Record<'easy' | 'medium' | 'hard' | 'expert', Physique> = {
  // Soarin' Steve: the original
  easy:   { leg: 1, legT: 1, arm: 1, armT: 1, torsoLen: 1, torsoW: 1, torsoD: 1, shoulderW: 1, head: 1, headLong: 1, belly: 0, pecs: 0, style: 'steve', rocketShoes: false },
  // Cannonball Chris: short, round, squat
  medium: { leg: 0.7, legT: 1.35, arm: 0.82, armT: 1.3, torsoLen: 0.84, torsoW: 1.4, torsoD: 1.45, shoulderW: 1.2, head: 1.12, headLong: 0.95, belly: 1, pecs: 0, style: 'chris', rocketShoes: false },
  // Projectile Pete: tall, slender, tube-shaped
  hard:   { leg: 1.22, legT: 0.8, arm: 1.15, armT: 0.8, torsoLen: 1.2, torsoW: 0.82, torsoD: 0.85, shoulderW: 0.85, head: 0.95, headLong: 1.15, belly: 0, pecs: 0, style: 'pete', rocketShoes: false },
  // Heatseeker Hank: buff, square-jawed, rocket shoes
  expert: { leg: 1.08, legT: 1.2, arm: 1.06, armT: 1.4, torsoLen: 1.08, torsoW: 1.22, torsoD: 1.1, shoulderW: 1.35, head: 1.0, headLong: 1.04, belly: 0, pecs: 1, style: 'hank', rocketShoes: true },
};

/** Pelvis height above the soles when standing straight. */
export function standHeight(p: Physique): number { return 0.05 + 0.86 * p.leg + 0.06; }

export interface SteveRig {
  group: THREE.Group;      // world placement (flight position)
  body: THREE.Group;       // sway offsets
  root: THREE.Group;       // pose orientation (prone / upright / spin)
  rockets: THREE.Group[];  // bottle rockets on the backpack
  rocketTips: THREE.Mesh[];
  cape: THREE.Mesh | null;
  pack: THREE.Mesh;
  height: number;
  physique: Physique;
  /** pelvis height above the soles when standing */
  stand: number;
  /** how far the head sits from the pelvis in the cannonball tuck (for seating in the barrel) */
  tuckReach: number;
  /** rocket-shoe nozzles (Hank), empty otherwise */
  shoeNozzles: THREE.Object3D[];
  /** Secondary motion input: world velocity of the figure (for the cape and limb lag). */
  velocity: THREE.Vector3;
  /** blend towards a pose; speed in radians per second */
  setPose(name: keyof typeof POSES | Pose, speed?: number): void;
  /** instantly snap to a pose */
  snapPose(name: keyof typeof POSES | Pose): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------- cloth cape
class ClothCape {
  readonly mesh: THREE.Mesh;
  /** Set by the rig: whether the rocket backpack is on (the cape then drapes over it). */
  packOn = false;
  private W = 9; private H = 12;
  private pos: Float32Array; private prev: Float32Array;
  private rest: { a: number; b: number; d: number; k: number }[] = [];
  private pinsLocal: THREE.Vector3[] = [];
  private pinned: boolean[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private back = new THREE.Vector3();
  private side = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private initialised = false;
  private lastOrigin = new THREE.Vector3();
  private origin = new THREE.Vector3();
  private pinIdx: number[] = [];
  /** max allowed distance of each particle from each pin (long-range attachments: the cape cannot stretch) */
  private reach: number[][] = [];

  private depth = 1;
  constructor(private torso: THREE.Object3D, private group: THREE.Object3D, material: THREE.Material, scale: number, ph: Physique) {
    this.depth = ph.torsoD;
    const geo = new THREE.PlaneGeometry(1, 1, this.W - 1, this.H - 1);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    const n = this.W * this.H;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    // rest shape (torso space): tied at the collarbones, widening to the hem, with soft vertical flutes
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const v = j / (this.H - 1);
      const u = i / (this.W - 1) - 0.5;
      const half = (0.24 + 0.32 * v) * ph.shoulderW;
      const flute = Math.cos(u * Math.PI * 6) * 0.035 * v;
      const len = 0.75 * ph.torsoLen + 0.55 * ph.leg;
      this.pinsLocal.push(new THREE.Vector3(u * 2 * half, 0.64 * ph.torsoLen - v * len, 0.26 * ph.torsoD + v * 0.1 + flute));
      this.pinned.push(j === 0 && (i === 0 || i === this.W - 1));
    }
    const idx = (i: number, j: number) => j * this.W + i;
    const link = (a: number, b: number, k: number) => {
      this.rest.push({ a, b, d: this.pinsLocal[a].distanceTo(this.pinsLocal[b]) * scale, k });
    };
    this.pinIdx = this.pinned.map((p, k) => (p ? k : -1)).filter(k => k >= 0);
    for (const pi of this.pinIdx) this.reach.push(this.pinsLocal.map(q => q.distanceTo(this.pinsLocal[pi]) * scale * 1.06));
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      if (i + 1 < this.W) link(idx(i, j), idx(i + 1, j), 1);                 // structural
      if (j + 1 < this.H) link(idx(i, j), idx(i, j + 1), 1);
      if (i + 1 < this.W && j + 1 < this.H) { link(idx(i, j), idx(i + 1, j + 1), 0.6); link(idx(i + 1, j), idx(i, j + 1), 0.6); }  // shear
      if (j + 2 < this.H) link(idx(i, j), idx(i, j + 2), 0.75);               // stiff down the length: holds its shape
      if (i + 2 < this.W) link(idx(i, j), idx(i + 2, j), 0.22);               // soft across: folds lengthwise into flutes
    }
  }

  reset(): void { this.initialised = false; }

  /** Minimum distance behind the spine (torso space) at height y and width x: clears chest, shoulders, pack and seat. */
  private clearance(x: number, y: number): number {
    const D = this.depth;
    let z: number;
    if (y > 0.5) z = 0.24 * D;                    // shoulder blades
    else if (y > -0.12) z = 0.25 * D;             // back
    else z = 0.2 * D;                             // seat and legs
    if (this.packOn && y > 0.1 && y < 0.62) z = 0.36 * D;   // over the rocket backpack
    // let it wrap a little around the sides
    const ax = Math.abs(x);
    if (ax > 0.28 * D) z -= Math.min(z, (ax - 0.28 * D) * 1.6);
    return z;
  }

  update(dt: number, t: number, velocity: THREE.Vector3): void {
    const n = this.W * this.H;
    this.torso.updateWorldMatrix(true, false);
    const m = this.torso.matrixWorld;
    this.origin.setFromMatrixPosition(m);
    if (!this.initialised) {
      for (let k = 0; k < n; k++) {
        this.tmp.copy(this.pinsLocal[k]).applyMatrix4(m);
        this.pos[k * 3] = this.prev[k * 3] = this.tmp.x;
        this.pos[k * 3 + 1] = this.prev[k * 3 + 1] = this.tmp.y;
        this.pos[k * 3 + 2] = this.prev[k * 3 + 2] = this.tmp.z;
      }
      this.lastOrigin.copy(this.origin);
      this.initialised = true;
    }
    dt = Math.min(dt, 1 / 30);
    // carry the cloth with the body's translation: only rotation and airflow should move it relative to him
    const ddx = this.origin.x - this.lastOrigin.x, ddy = this.origin.y - this.lastOrigin.y, ddz = this.origin.z - this.lastOrigin.z;
    this.lastOrigin.copy(this.origin);
    for (let k = 0; k < n; k++) {
      const o = k * 3;
      this.pos[o] += ddx; this.pos[o + 1] += ddy; this.pos[o + 2] += ddz;
      this.prev[o] += ddx; this.prev[o + 1] += ddy; this.prev[o + 2] += ddz;
    }
    // the oncoming air: opposite to his velocity, capped so a fast flight streams it rather than tearing it
    let wx = -velocity.x, wy = -velocity.y, wz = -velocity.z;
    const wl = Math.hypot(wx, wy, wz), wcap = 16;
    if (wl > wcap) { wx *= wcap / wl; wy *= wcap / wl; wz *= wcap / wl; }
    // world directions of the torso's back (+z) and side (+x)
    this.back.set(0, 0, 1).transformDirection(m);
    this.side.set(1, 0, 0).transformDirection(m);
    const speed = velocity.length();
    const flow = Math.min(1, speed / 22);
    const damp = 0.985;
    const grav = -5.4;
    const drag = 2.4;
    for (let k = 0; k < n; k++) {
      if (this.pinned[k]) continue;
      const o = k * 3;
      const j = Math.floor(k / this.W), i = k % this.W;
      const vrow = j / (this.H - 1);
      const idt = 1 / Math.max(1e-4, dt);
      const vx = (this.pos[o] - this.prev[o]) * idt, vy = (this.pos[o + 1] - this.prev[o + 1]) * idt, vz = (this.pos[o + 2] - this.prev[o + 2]) * idt;
      // travelling ripples: waves run down the cape from the shoulders to the hem, stronger with airspeed
      // travelling ripples plus a little lift, so at speed it streams up off his back instead of lying flat
      const wave = (Math.sin(t * 15 - j * 0.85 + Math.sin(i * 0.9) * 0.6) * (2 + 26 * flow) + 9 * flow) * Math.pow(vrow, 1.1);
      const sway = Math.sin(t * 9.5 - j * 0.6 + i * 0.45) * (1 + 7 * flow) * vrow;
      const ax = (wx - vx) * drag + this.back.x * wave + this.side.x * sway;
      const ay = grav + (wy - vy) * drag * 0.6 + this.back.y * wave + this.side.y * sway;
      const az = (wz - vz) * drag + this.back.z * wave + this.side.z * sway;
      const nx = this.pos[o] + (this.pos[o] - this.prev[o]) * damp + ax * dt * dt;
      const ny = this.pos[o + 1] + (this.pos[o + 1] - this.prev[o + 1]) * damp + ay * dt * dt;
      const nz = this.pos[o + 2] + (this.pos[o + 2] - this.prev[o + 2]) * damp + az * dt * dt;
      this.prev[o] = this.pos[o]; this.prev[o + 1] = this.pos[o + 1]; this.prev[o + 2] = this.pos[o + 2];
      this.pos[o] = nx; this.pos[o + 1] = ny; this.pos[o + 2] = nz;
    }
    for (let k = 0; k < n; k++) {
      if (!this.pinned[k]) continue;
      this.tmp.copy(this.pinsLocal[k]).applyMatrix4(m);
      this.pos[k * 3] = this.tmp.x; this.pos[k * 3 + 1] = this.tmp.y; this.pos[k * 3 + 2] = this.tmp.z;
    }
    this.inv.copy(m).invert();
    for (let it = 0; it < 6; it++) {
      for (const r of this.rest) {
        const a = r.a * 3, b = r.b * 3;
        let dx = this.pos[b] - this.pos[a], dy = this.pos[b + 1] - this.pos[a + 1], dz = this.pos[b + 2] - this.pos[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const pa = this.pinned[r.a], pb = this.pinned[r.b];
        const diff = ((d - r.d) / d) * r.k * (pa || pb ? 1 : 0.5);
        dx *= diff; dy *= diff; dz *= diff;
        if (!pa) { this.pos[a] += dx; this.pos[a + 1] += dy; this.pos[a + 2] += dz; }
        if (!pb) { this.pos[b] -= dx; this.pos[b + 1] -= dy; this.pos[b + 2] -= dz; }
      }
      // long-range attachments: never farther from either tie than the cape's own length allows
      for (let pi = 0; pi < this.pinIdx.length; pi++) {
        const p0 = this.pinIdx[pi] * 3, reach = this.reach[pi];
        for (let k = 0; k < n; k++) {
          if (this.pinned[k]) continue;
          const o = k * 3;
          const dx = this.pos[o] - this.pos[p0], dy = this.pos[o + 1] - this.pos[p0 + 1], dz = this.pos[o + 2] - this.pos[p0 + 2];
          const d = Math.hypot(dx, dy, dz);
          if (d > reach[k]) { const f = reach[k] / d; this.pos[o] = this.pos[p0] + dx * f; this.pos[o + 1] = this.pos[p0 + 1] + dy * f; this.pos[o + 2] = this.pos[p0 + 2] + dz * f; }
        }
      }
      // collision with the back (and pack): push any particle that strays inside back out behind it
      for (let k = 0; k < n; k++) {
        if (this.pinned[k]) continue;
        const o = k * 3;
        this.tmp.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]).applyMatrix4(this.inv);
        const zmin = this.clearance(this.tmp.x, this.tmp.y);
        if (this.tmp.z < zmin && Math.abs(this.tmp.x) < 0.5 * this.depth) {
          this.tmp.z = zmin;
          this.tmp2.copy(this.tmp).applyMatrix4(m);
          this.pos[o] = this.tmp2.x; this.pos[o + 1] = this.tmp2.y; this.pos[o + 2] = this.tmp2.z;
        }
      }
    }
    this.group.updateWorldMatrix(true, false);
    this.inv.copy(this.group.matrixWorld).invert();
    const attr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      this.tmp.set(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]).applyMatrix4(this.inv);
      attr.setXYZ(k, this.tmp.x, this.tmp.y, this.tmp.z);
    }
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  return new THREE.Mesh(g, mat);
}

export function buildSteve(suit: SuitDef, scale = 1, ph: Physique = PHYSIQUES.easy): SteveRig {
  const mats = {
    primary: new THREE.MeshLambertMaterial({ color: suit.primary }),
    secondary: new THREE.MeshLambertMaterial({ color: suit.secondary }),
    accent: new THREE.MeshLambertMaterial({ color: suit.accent }),
    skin: new THREE.MeshLambertMaterial({ color: suit.skin }),
    dark: new THREE.MeshLambertMaterial({ color: '#2b2b2b' }),
    glass: new THREE.MeshLambertMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.8 }),
    cape: new THREE.MeshLambertMaterial({ color: capeColour(suit), side: THREE.DoubleSide }),
    rocket: new THREE.MeshLambertMaterial({ color: '#d8392b' }),
    stick: new THREE.MeshLambertMaterial({ color: '#c9a86a' }),
    tip: new THREE.MeshLambertMaterial({ color: '#f2c14e' }),
    cheek: new THREE.MeshLambertMaterial({ color: '#f29a8a' }),
    hair: new THREE.MeshLambertMaterial({ color: '#4a2f1d' }),
    steel: new THREE.MeshLambertMaterial({ color: '#9aa1ab' }),
    flame: new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  };
  const geos: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Mesh>(m: T): T => { geos.push(m.geometry); return m; };

  const group = new THREE.Group();
  group.scale.setScalar(scale);
  const body = new THREE.Group();
  const root = new THREE.Group();
  group.add(body); body.add(root);

  const joints = {} as Record<Joint, THREE.Group>;
  const J = (name: Joint, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); joints[name] = g; return g;
  };

  // pelvis sits at the origin of root; the figure stands with its soles `stand` below it
  const L = ph.torsoLen, Wd = ph.torsoW, Dp = ph.torsoD;
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const trunks = track(capsule(0.2, 0.12, mats.secondary)); trunks.position.y = 0.02; trunks.scale.set(1.15 * Wd, 1, 0.9 * Dp); pelvis.add(trunks);

  const torso = J('torso', pelvis, 0, 0.1 * L, 0);
  const chest = track(capsule(0.22, 0.42 * L, mats.primary)); chest.position.y = 0.33 * L; chest.scale.set(1.2 * Wd, 1, 0.85 * Dp); torso.add(chest);
  if (ph.belly > 0) {
    // Chris: a big round tummy, more cannonball than man
    const tum = track(new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mats.primary));
    tum.position.set(0, 0.2 * L, -0.06 * Dp); tum.scale.set(1.15 * Wd * ph.belly, 1.0, 1.1 * Dp * ph.belly); torso.add(tum);
  }
  if (ph.pecs > 0) {
    // Hank: broad chest and shoulders tapering to the waist
    const pec = track(new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), mats.primary));
    pec.position.set(0, 0.5 * L, -0.02); pec.scale.set(1.45 * Wd, 0.75, 0.95 * Dp); torso.add(pec);
    for (const sx of [-1, 1]) {
      const delt = track(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.secondary));
      delt.position.set(sx * 0.31 * ph.shoulderW, 0.58 * L, 0); delt.scale.set(1.2, 1, 1.1); torso.add(delt);
    }
  }
  const belt = track(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 12), mats.accent)); belt.position.y = 0.04 * L; belt.scale.set(1.15 * Wd * (ph.belly > 0 ? 1.15 : 1), 1, 0.9 * Dp * (ph.belly > 0 ? 1.25 : 1)); torso.add(belt);
  // emblem on the chest (faces -z)
  const emblem = emblemMesh(suit, mats.accent);
  if (emblem) {
    // on Chris the star sits proudly on the front of his tummy
    if (ph.belly > 0) emblem.position.set(0, 0.32 * L, -0.5 * ph.belly);
    else emblem.position.set(0, 0.42 * L, -(0.235 * Dp + (ph.pecs > 0 ? 0.03 : 0)));
    torso.add(emblem); geos.push(emblem.geometry);
  }

  const head = J('head', torso, 0, 0.66 * L, 0);
  const hs = new THREE.Group(); hs.scale.set(ph.head, ph.head * ph.headLong, ph.head); head.add(hs);
  const skull = track(new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), mats.skin)); skull.position.y = 0.17; hs.add(skull);
  const helmet = track(new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.accent)); helmet.position.y = 0.19; hs.add(helmet);
  const nose = track(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mats.skin)); nose.position.set(0, 0.12, -0.19); hs.add(nose);
  if (ph.style === 'hank') {
    // goggles pushed up on the helmet, eyes, brows, a confident grin and a square jaw
    const gog = track(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.06), mats.dark)); gog.position.set(0, 0.32, -0.14); gog.rotation.x = -0.5; hs.add(gog);
    for (const sx of [-1, 1]) {
      const eye = track(new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), mats.dark)); eye.position.set(sx * 0.065, 0.2, -0.18); hs.add(eye);
      const brow = track(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.02), mats.hair)); brow.position.set(sx * 0.065, 0.245, -0.18); brow.rotation.z = sx * -0.15; hs.add(brow);
    }
    const grin = track(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.02), mats.glass)); grin.position.set(0, 0.07, -0.19); hs.add(grin);
    const jaw = track(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.2), mats.skin)); jaw.position.set(0, 0.04, -0.04); hs.add(jaw);
    const quiff = track(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mats.hair)); quiff.position.set(0.05, 0.29, -0.19); quiff.scale.set(1.4, 0.7, 0.8); hs.add(quiff);
  } else {
    const goggles = track(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.08), mats.dark)); goggles.position.set(0, 0.2, -0.16); hs.add(goggles);
    const lens1 = track(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), mats.glass)); lens1.position.set(-0.07, 0.2, -0.2); hs.add(lens1);
    const lens2 = lens1.clone(); lens2.position.x = 0.07; hs.add(lens2);
    const mouth = track(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mats.dark)); mouth.position.set(0, 0.06, -0.185); hs.add(mouth);
    const chin = track(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), mats.skin)); chin.position.y = 0.02; hs.add(chin);
  }
  if (ph.style === 'chris') {
    // rosy cheeks and a handlebar moustache
    for (const sx of [-1, 1]) {
      const ck = track(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mats.cheek)); ck.position.set(sx * 0.12, 0.11, -0.14); hs.add(ck);
      const mo = track(new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 3, 6), mats.hair)); mo.position.set(sx * 0.06, 0.095, -0.19); mo.rotation.z = sx * 1.2; hs.add(mo);
      const curl = track(new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), mats.hair)); curl.position.set(sx * 0.115, 0.115, -0.18); hs.add(curl);
    }
  }
  if (ph.style === 'pete') {
    // a nose-cone helmet: when he flies prone it points straight ahead like a shell
    const cone = track(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 14), mats.accent)); cone.position.y = 0.43; hs.add(cone);
    const band = track(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 6, 16), mats.secondary)); band.position.y = 0.26; band.rotation.x = Math.PI / 2; hs.add(band);
  }

  const arm = (side: 1 | -1) => {
    const sh = J(side < 0 ? 'lShoulder' : 'rShoulder', torso, side * 0.3 * ph.shoulderW, 0.56 * L, 0);
    const upper = track(capsule(0.075 * ph.armT, 0.26 * ph.arm, mats.secondary)); upper.position.y = -0.17 * ph.arm; sh.add(upper);
    const el = J(side < 0 ? 'lElbow' : 'rElbow', sh, 0, -0.36 * ph.arm, 0);
    const fore = track(capsule(0.065 * ph.armT, 0.24 * ph.arm, mats.primary)); fore.position.y = -0.16 * ph.arm; el.add(fore);
    const hand = track(new THREE.Mesh(new THREE.SphereGeometry(0.08 * Math.sqrt(ph.armT), 8, 6), mats.secondary)); hand.position.y = -0.34 * ph.arm; el.add(hand);
  };
  arm(-1); arm(1);
  const shoeNozzles: THREE.Object3D[] = [];
  const leg = (side: 1 | -1) => {
    const hip = J(side < 0 ? 'lHip' : 'rHip', pelvis, side * 0.12 * Wd, -0.05, 0);
    const thigh = track(capsule(0.1 * ph.legT, 0.32 * ph.leg, mats.primary)); thigh.position.y = -0.21 * ph.leg; hip.add(thigh);
    const knee = J(side < 0 ? 'lKnee' : 'rKnee', hip, 0, -0.44 * ph.leg, 0);
    const shin = track(capsule(0.085 * ph.legT, 0.3 * ph.leg, mats.primary)); shin.position.y = -0.2 * ph.leg; knee.add(shin);
    const bw = 0.15 * Math.sqrt(ph.legT);
    const boot = track(new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, 0.3), mats.secondary)); boot.position.set(0, -0.42 * ph.leg, -0.05); knee.add(boot);
    if (ph.rocketShoes) {
      // Hank: a steel thruster on each heel firing out past the sole, along the leg (straight back when he dives)
      const tilt = -0.25;
      const thr = new THREE.Group(); thr.position.set(0, -0.36 * ph.leg, 0.13); thr.rotation.x = tilt; knee.add(thr);
      const can = track(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 10), mats.steel)); thr.add(can);
      const bell = track(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.07, 10, 1, true), mats.dark)); bell.position.y = -0.13; thr.add(bell);
      const fin = track(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.1), mats.rocket)); fin.position.set(0, 0.02, 0.07); thr.add(fin);
      const core = track(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 8), mats.flame)); core.position.y = -0.22; core.rotation.x = Math.PI; thr.add(core);
      // +z of this marker is the exhaust direction (down the leg)
      const nz = new THREE.Object3D(); nz.position.y = -0.17; nz.rotation.x = Math.PI / 2; thr.add(nz);
      shoeNozzles.push(nz);
    }
  };
  leg(-1); leg(1);

  // cape: a small cloth simulation pinned at the shoulders (added to the group, simulated in world space)
  let cape: THREE.Mesh | null = null;
  let cloth: ClothCape | null = null;
  {
    cloth = new ClothCape(torso, group, mats.cape, scale, ph);
    cape = cloth.mesh;
    group.add(cape);
    geos.push(cape.geometry);
  }

  // backpack frame with bottle rockets
  const pack = track(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.08), mats.dark)); pack.position.set(0, 0.36 * L, 0.24 * Dp); torso.add(pack);
  const rockets: THREE.Group[] = [];
  const rocketTips: THREE.Mesh[] = [];
  const maxR = BOOST_CONFIG.rockets.max;
  for (let i = 0; i < maxR; i++) {
    const g = new THREE.Group();
    const t = maxR === 1 ? 0 : i / (maxR - 1);
    g.position.set((t - 0.5) * 0.28, (0.2 + (i % 2) * 0.1) * L, 0.3 * Dp);
    g.rotation.x = -0.35; // nozzles point back and slightly down
    const bodyR = track(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 7), mats.rocket)); bodyR.position.y = 0.1; g.add(bodyR);
    const cone = track(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 7), mats.tip)); cone.position.y = 0.235; g.add(cone);
    const stick = track(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), mats.stick)); stick.position.y = -0.05; g.add(stick);
    const nozzle = track(new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), mats.dark)); nozzle.position.y = -0.01; g.add(nozzle);
    g.visible = false;
    torso.add(g);
    rockets.push(g); rocketTips.push(nozzle);
  }

  // ---- animator: each joint follows its target with an under-damped spring, so limbs
  // overshoot and settle like a rag doll instead of snapping between poses
  const current: Record<Joint, THREE.Vector3> = {} as Record<Joint, THREE.Vector3>;
  const target: Record<Joint, THREE.Vector3> = {} as Record<Joint, THREE.Vector3>;
  const vel: Record<Joint, THREE.Vector3> = {} as Record<Joint, THREE.Vector3>;
  for (const j of JOINTS) { current[j] = new THREE.Vector3(); target[j] = new THREE.Vector3(); vel[j] = new THREE.Vector3(); }
  let speed = 6;
  const velocity = new THREE.Vector3();
  const lastVel = new THREE.Vector3();
  const lag = new THREE.Vector3();   // filtered acceleration, drives limb lag
  const LIMBS: Joint[] = ['lShoulder', 'rShoulder', 'lHip', 'rHip'];
  const resolve = (p: keyof typeof POSES | Pose): Pose => (typeof p === 'string' ? POSES[p] : p);
  const apply = () => { for (const j of JOINTS) joints[j].rotation.set(current[j].x, current[j].y, current[j].z); };

  const rig: SteveRig = {
    group, body, root, rockets, rocketTips, cape, pack, height: 1.9, velocity,
    physique: ph, stand: standHeight(ph), tuckReach: 0.98 * (0.55 * L + 0.4 * ph.head), shoeNozzles,
    setPose(p, s = 6) {
      const pose = resolve(p);
      speed = s;
      for (const j of JOINTS) { const r = pose[j] ?? [0, 0, 0]; target[j].set(r[0], r[1], r[2]); }
    },
    snapPose(p) {
      const pose = resolve(p);
      for (const j of JOINTS) { const r = pose[j] ?? [0, 0, 0]; target[j].set(r[0], r[1], r[2]); current[j].copy(target[j]); vel[j].set(0, 0, 0); }
      apply();
      cloth?.reset();
    },
    update(dt, t) {
      dt = Math.min(dt, 1 / 30);
      // spring: omega from the requested speed, damping ratio ~0.55 for a little overshoot
      const w = speed * 1.6, zeta = 0.55;
      // limb lag from acceleration (filtered): limbs trail when the body is thrown around
      const ax = (velocity.x - lastVel.x) / Math.max(1e-3, dt), ay = (velocity.y - lastVel.y) / Math.max(1e-3, dt), az = (velocity.z - lastVel.z) / Math.max(1e-3, dt);
      lastVel.copy(velocity);
      lag.x += (Math.max(-40, Math.min(40, ax)) - lag.x) * Math.min(1, dt * 6);
      lag.y += (Math.max(-40, Math.min(40, ay)) - lag.y) * Math.min(1, dt * 6);
      lag.z += (Math.max(-40, Math.min(40, az)) - lag.z) * Math.min(1, dt * 6);
      for (const j of JOINTS) {
        const c = current[j], tg = target[j], v = vel[j];
        const extra = LIMBS.includes(j) ? -lag.y * 0.012 : 0;
        const ex = c.x - (tg.x + extra), ey = c.y - tg.y, ez = c.z - tg.z;
        v.x += (-w * w * ex - 2 * zeta * w * v.x) * dt;
        v.y += (-w * w * ey - 2 * zeta * w * v.y) * dt;
        v.z += (-w * w * ez - 2 * zeta * w * v.z) * dt;
        c.x += v.x * dt; c.y += v.y * dt; c.z += v.z * dt;
      }
      apply();
      if (cloth) cloth.packOn = pack.visible && rockets.some(r => r.visible);
      cloth?.update(dt, t, velocity);
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
  rig.snapPose('stand');
  return rig;
}

/** A cape colour that reads against the sky: the suit's main colour unless it is very pale. */
function capeColour(suit: SuitDef): string {
  const lum = (hex: string) => { const c = new THREE.Color(hex); return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; };
  if (lum(suit.primary) < 0.8) return suit.primary;
  if (lum(suit.secondary) < 0.8) return suit.secondary;
  return suit.accent;
}

function emblemMesh(suit: SuitDef, mat: THREE.Material): THREE.Mesh | null {
  let geo: THREE.BufferGeometry | null = null;
  switch (suit.emblem) {
    case 'star': { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.05 : 0.12; const a = i * Math.PI / 5 - Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); geo = new THREE.ShapeGeometry(s); break; }
    case 'bolt': { const s = new THREE.Shape(); s.moveTo(-0.02, 0.14); s.lineTo(0.07, 0.14); s.lineTo(0.0, 0.02); s.lineTo(0.06, 0.02); s.lineTo(-0.05, -0.14); s.lineTo(-0.01, -0.03); s.lineTo(-0.07, -0.03); s.closePath(); geo = new THREE.ShapeGeometry(s); break; }
    case 'stripe': geo = new THREE.PlaneGeometry(0.42, 0.07); break;
    case 'chevron': { const s = new THREE.Shape(); s.moveTo(-0.14, 0.08); s.lineTo(0, -0.04); s.lineTo(0.14, 0.08); s.lineTo(0.14, 0.01); s.lineTo(0, -0.12); s.lineTo(-0.14, 0.01); s.closePath(); geo = new THREE.ShapeGeometry(s); break; }
    case 'dots': geo = new THREE.CircleGeometry(0.08, 12); break;
    default: return null;
  }
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI; // ShapeGeometry faces +z; the chest faces -z
  return m;
}
