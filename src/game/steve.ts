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

export interface SteveRig {
  group: THREE.Group;      // world placement (flight position)
  body: THREE.Group;       // sway offsets
  root: THREE.Group;       // pose orientation (prone / upright / spin)
  rockets: THREE.Group[];  // bottle rockets on the backpack
  rocketTips: THREE.Mesh[];
  cape: THREE.Mesh | null;
  pack: THREE.Mesh;
  height: number;
  /** blend towards a pose; speed in radians per second */
  setPose(name: keyof typeof POSES | Pose, speed?: number): void;
  /** instantly snap to a pose */
  snapPose(name: keyof typeof POSES | Pose): void;
  update(dt: number, t: number): void;
  dispose(): void;
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  return new THREE.Mesh(g, mat);
}

export function buildSteve(suit: SuitDef): SteveRig {
  const mats = {
    primary: new THREE.MeshLambertMaterial({ color: suit.primary }),
    secondary: new THREE.MeshLambertMaterial({ color: suit.secondary }),
    accent: new THREE.MeshLambertMaterial({ color: suit.accent }),
    skin: new THREE.MeshLambertMaterial({ color: suit.skin }),
    dark: new THREE.MeshLambertMaterial({ color: '#2b2b2b' }),
    glass: new THREE.MeshLambertMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.8 }),
    cape: new THREE.MeshLambertMaterial({ color: suit.accent, side: THREE.DoubleSide }),
    rocket: new THREE.MeshLambertMaterial({ color: '#d8392b' }),
    stick: new THREE.MeshLambertMaterial({ color: '#c9a86a' }),
    tip: new THREE.MeshLambertMaterial({ color: '#f2c14e' }),
  };
  const geos: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Mesh>(m: T): T => { geos.push(m.geometry); return m; };

  const group = new THREE.Group();
  const body = new THREE.Group();
  const root = new THREE.Group();
  group.add(body); body.add(root);

  const joints = {} as Record<Joint, THREE.Group>;
  const J = (name: Joint, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); joints[name] = g; return g;
  };

  // pelvis sits at the origin of root; the figure stands with feet at y = -0.95
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const trunks = track(capsule(0.2, 0.12, mats.secondary)); trunks.position.y = 0.02; trunks.scale.set(1.15, 1, 0.9); pelvis.add(trunks);

  const torso = J('torso', pelvis, 0, 0.1, 0);
  const chest = track(capsule(0.22, 0.42, mats.primary)); chest.position.y = 0.33; chest.scale.set(1.2, 1, 0.85); torso.add(chest);
  const belt = track(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 12), mats.accent)); belt.position.y = 0.04; belt.scale.set(1.15, 1, 0.9); torso.add(belt);
  // emblem on the chest (faces -z)
  const emblem = emblemMesh(suit, mats.accent); if (emblem) { emblem.position.set(0, 0.42, -0.235); torso.add(emblem); geos.push(emblem.geometry); }

  const head = J('head', torso, 0, 0.66, 0);
  const skull = track(new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), mats.skin)); skull.position.y = 0.17; head.add(skull);
  const helmet = track(new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.accent)); helmet.position.y = 0.19; head.add(helmet);
  const goggles = track(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.08), mats.dark)); goggles.position.set(0, 0.2, -0.16); head.add(goggles);
  const lens1 = track(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.03), mats.glass)); lens1.position.set(-0.07, 0.2, -0.2); head.add(lens1);
  const lens2 = lens1.clone(); lens2.position.x = 0.07; head.add(lens2);
  const nose = track(new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mats.skin)); nose.position.set(0, 0.12, -0.19); head.add(nose);
  const mouth = track(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mats.dark)); mouth.position.set(0, 0.06, -0.185); head.add(mouth);
  const chin = track(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), mats.skin)); chin.position.y = 0.02; head.add(chin);

  const arm = (side: 1 | -1) => {
    const sh = J(side < 0 ? 'lShoulder' : 'rShoulder', torso, side * 0.3, 0.56, 0);
    const upper = track(capsule(0.075, 0.26, mats.secondary)); upper.position.y = -0.17; sh.add(upper);
    const el = J(side < 0 ? 'lElbow' : 'rElbow', sh, 0, -0.36, 0);
    const fore = track(capsule(0.065, 0.24, mats.primary)); fore.position.y = -0.16; el.add(fore);
    const hand = track(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mats.secondary)); hand.position.y = -0.34; el.add(hand);
  };
  arm(-1); arm(1);
  const leg = (side: 1 | -1) => {
    const hip = J(side < 0 ? 'lHip' : 'rHip', pelvis, side * 0.12, -0.05, 0);
    const thigh = track(capsule(0.1, 0.32, mats.primary)); thigh.position.y = -0.21; hip.add(thigh);
    const knee = J(side < 0 ? 'lKnee' : 'rKnee', hip, 0, -0.44, 0);
    const shin = track(capsule(0.085, 0.3, mats.primary)); shin.position.y = -0.2; knee.add(shin);
    const boot = track(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.3), mats.secondary)); boot.position.set(0, -0.42, -0.05); knee.add(boot);
  };
  leg(-1); leg(1);

  // cape hangs from the shoulders down the back
  let cape: THREE.Mesh | null = null;
  if (suit.cape) {
    // a tapered cape: narrow at the shoulders, wide at the hem
    const cg = new THREE.PlaneGeometry(1, 0.9, 1, 5);
    const pos = cg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) - 0.45; // 0 at the top, -0.9 at the hem
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) * (0.4 + (-y) * 0.5));
    }
    cape = new THREE.Mesh(cg, mats.cape);
    cape.position.set(0, 0.62, 0.2);
    cape.rotation.x = 0.35;
    torso.add(cape);
    geos.push(cg);
  }

  // backpack frame with bottle rockets
  const pack = track(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.08), mats.dark)); pack.position.set(0, 0.36, 0.24); torso.add(pack);
  const rockets: THREE.Group[] = [];
  const rocketTips: THREE.Mesh[] = [];
  const maxR = BOOST_CONFIG.rockets.max;
  for (let i = 0; i < maxR; i++) {
    const g = new THREE.Group();
    const t = maxR === 1 ? 0 : i / (maxR - 1);
    g.position.set((t - 0.5) * 0.28, 0.2 + (i % 2) * 0.1, 0.3);
    g.rotation.x = -0.35; // nozzles point back and slightly down
    const bodyR = track(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 7), mats.rocket)); bodyR.position.y = 0.1; g.add(bodyR);
    const cone = track(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 7), mats.tip)); cone.position.y = 0.235; g.add(cone);
    const stick = track(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), mats.stick)); stick.position.y = -0.05; g.add(stick);
    const nozzle = track(new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), mats.dark)); nozzle.position.y = -0.01; g.add(nozzle);
    g.visible = false;
    torso.add(g);
    rockets.push(g); rocketTips.push(nozzle);
  }

  // ---- animator
  const current: Record<Joint, THREE.Vector3> = {} as Record<Joint, THREE.Vector3>;
  const target: Record<Joint, THREE.Vector3> = {} as Record<Joint, THREE.Vector3>;
  for (const j of JOINTS) { current[j] = new THREE.Vector3(); target[j] = new THREE.Vector3(); }
  let speed = 6;
  const resolve = (p: keyof typeof POSES | Pose): Pose => (typeof p === 'string' ? POSES[p] : p);
  const apply = () => { for (const j of JOINTS) joints[j].rotation.set(current[j].x, current[j].y, current[j].z); };

  const rig: SteveRig = {
    group, body, root, rockets, rocketTips, cape, pack, height: 1.9,
    setPose(p, s = 6) {
      const pose = resolve(p);
      speed = s;
      for (const j of JOINTS) { const r = pose[j] ?? [0, 0, 0]; target[j].set(r[0], r[1], r[2]); }
    },
    snapPose(p) {
      const pose = resolve(p);
      for (const j of JOINTS) { const r = pose[j] ?? [0, 0, 0]; target[j].set(r[0], r[1], r[2]); current[j].copy(target[j]); }
      apply();
    },
    update(dt, t) {
      const k = Math.min(1, speed * dt);
      for (const j of JOINTS) current[j].lerp(target[j], k);
      apply();
      if (cape) {
        // cape flutter: bend the lower vertices back and forth
        const pos = cape.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const y = -pos.getY(i); // 0 at top, 0.9 at the hem
          pos.setZ(i, Math.sin(t * 6 + y * 4) * 0.1 * y + y * 0.15);
        }
        pos.needsUpdate = true;
      }
    },
    dispose() { for (const g of geos) g.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
  rig.snapPose('stand');
  return rig;
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
