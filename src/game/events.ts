/**
 * Event objects: the boost pads and obstacles the flight plan places along
 * the route. Each one is a self-contained animated group positioned at the
 * plan's (s, h) for that event. They explain the speed profile; they never
 * change it.
 */
import * as THREE from 'three';
import type { PlanEvent } from './flightPlan';
import type { ParticleSystem } from './particles';
import { BOX, CONE, CYL, CYL_LO, DISC, PLANE, SPHERE, SPHERE_LO, TORUS } from './geobatch';

export interface EventObject {
  event: PlanEvent;
  group: THREE.Group;
  triggered: boolean;
  age: number;
  decoy: boolean;
  /** Place the object in the world: route point, ground height, right-hand normal and heading. */
  anchor(x: number, y: number, z: number, nx: number, nz: number, heading: number): void;
  update(dt: number, elapsed: number): void;
  /** Called with the time remaining until the trigger; fliers use it to glide in from the side. */
  approach(timeToTrigger: number): void;
  trigger(): void;
  dispose(): void;
}

/** Kinds that can be scattered as harmless filler along the route. */
export const DECOY_KINDS: PlanEvent['kind'][] = ['gulls', 'hotair', 'drone', 'blimp', 'raincloud', 'kite', 'crane', 'billboard', 'pigeons', 'burner', 'thermal', 'vent'];
/** Street-level filler, placed on side streets away from the avenue. */
export const STREET_DECOY_KINDS: PlanEvent['kind'][] = ['trampoline', 'castle', 'tyres', 'bigfan', 'cones', 'hotdog', 'mattress', 'dumpster'];
/** Fliers that enter from the side before their moment (so they never pop in). */
const FLY_IN = new Set<PlanEvent['kind']>(['gulls', 'drone']);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  return m;
}

const goreMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/** A balloon envelope as a single sphere with vertex-coloured gores (no overlapping shells). */
export function balloonEnvelope(colors: string[], gores = 8, material: THREE.Material = goreMat): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.5, 24, 12);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getX(i), pos.getZ(i)) + Math.PI;
    const k = Math.min(gores - 1, Math.floor((a / (Math.PI * 2)) * gores));
    c.set(colors[k % colors.length]);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, material);
  m.scale.set(5.6, 6.6, 5.6);
  return m;
}

/** A hot-air balloon: envelope, basket, ropes. Returns the group (origin at the basket). */
function balloon(mk: (c: string) => THREE.Material, colors: string[], gore?: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const env = balloonEnvelope(colors, 8, gore);
  env.position.y = 7.5;
  const neck = mesh(CONE, mk(colors[0]), 0, 3.6, 0, 3.2, 2.2, 3.2, Math.PI, 0, 0);
  const basket = mesh(BOX, mk('#9a6b3c'), 0, 0.6, 0, 1.6, 1.2, 1.6);
  const burner = mesh(BOX, mk('#444'), 0, 1.9, 0, 0.5, 0.4, 0.5);
  for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    g.add(mesh(CYL_LO, mk('#555'), dx, 2.2, dz, 0.05, 2.4, 0.05));
  }
  g.add(env, neck, basket, burner);
  return g;
}

function airliner(mk: (c: string) => THREE.Material, color: string): THREE.Group {
  const g = new THREE.Group();
  const white = mk('#f4f6f8');
  g.add(mesh(CYL, white, 0, 0, 0, 2.2, 18, 2.2, Math.PI / 2, 0, 0));          // fuselage along z
  g.add(mesh(CONE, white, 0, 0, -10.2, 2.2, 2.6, 2.2, -Math.PI / 2, 0, 0));   // nose
  g.add(mesh(CONE, mk(color), 0, 0.5, 9.5, 2.2, 3, 2.2, Math.PI / 2, 0, 0));  // tail cone
  g.add(mesh(BOX, white, 0, -0.3, 1, 22, 0.25, 3.2, 0, 0, 0));                 // wings
  g.add(mesh(BOX, mk(color), 0, 1.8, 8.5, 0.25, 3.6, 3, -0.3, 0, 0));         // fin
  g.add(mesh(BOX, white, 0, 0.3, 8.8, 8, 0.2, 1.8));                          // stabiliser
  for (const dx of [-5, 5]) g.add(mesh(CYL, mk('#8e97a3'), dx, -1.1, 0, 1.2, 2.8, 1.2, Math.PI / 2, 0, 0));
  g.add(mesh(BOX, mk('#3b4654'), 0, 0.6, -7.5, 1.4, 0.5, 2.2));              // cockpit
  return g;
}

function gull(mk: (c: string) => THREE.Material): { g: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh } {
  const g = new THREE.Group();
  const body = mesh(SPHERE_LO, mk('#f4f4f4'), 0, 0, 0, 0.5, 0.4, 0.9);
  const wl = mesh(BOX, mk('#e6e6e6'), -0.9, 0, 0, 1.6, 0.06, 0.5);
  const wr = mesh(BOX, mk('#e6e6e6'), 0.9, 0, 0, 1.6, 0.06, 0.5);
  const beak = mesh(CONE, mk('#f2a23a'), 0, 0, -0.55, 0.16, 0.3, 0.16, -Math.PI / 2, 0, 0);
  g.add(body, wl, wr, beak);
  return { g, wl, wr };
}

export function makeEventObject(e: PlanEvent, h: number, particles: ParticleSystem, decoy = false): EventObject {
  const group = new THREE.Group();
  // all builders work in a local frame: -z forward along the route, x to the right, y up from the ground
  const z = 0;
  const flyIn = !decoy && FLY_IN.has(e.kind);
  const base = { x: 0, y: 0, z: 0, nx: 1, nz: 0 };
  /** plan time until this object's moment (+ before, − after); decoys keep their own clock */
  let ttt = 30;
  let fade = 0;
  const mats: THREE.Material[] = [];
  const mk = (c: string, extra: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.Material => {
    const m = new THREE.MeshLambertMaterial({ color: c, ...extra });
    m.userData.wasTransparent = !!extra.transparent;
    m.userData.baseOpacity = extra.opacity ?? 1;
    m.transparent = true; m.opacity = 0;
    mats.push(m);
    return m;
  };
  const goreFor = () => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.userData.baseOpacity = 1; m.transparent = true; m.opacity = 0; mats.push(m); return m; };
  let update: (dt: number, elapsed: number) => void = () => {};
  let onTrigger: () => void = () => {};
  const side = e.x >= 0 ? 1 : -1;
  const self: EventObject = {
    event: e, group, triggered: false, age: -1, decoy,
    anchor(x, y, zz, nx, nz, heading) {
      base.x = x; base.y = y; base.z = zz; base.nx = nx; base.nz = nz;
      group.position.set(x, y, zz);
      group.rotation.set(0, heading, 0);
      if (flyIn) this.approach(99);
    },
    update(dt, elapsed) {
      if (this.triggered) this.age += dt;
      if (decoy) ttt -= dt;
      // fade in rather than popping into existence
      if (fade < 1) {
        fade = Math.min(1, fade + dt / 1.2);
        for (const m of mats) { m.transparent = fade < 1 || (m as THREE.MeshLambertMaterial).userData.wasTransparent; m.opacity = fade * ((m as THREE.MeshLambertMaterial).userData.baseOpacity ?? 1); }
      }
      update(dt, elapsed);
    },
    approach(t) {
      ttt = t;
      if (!flyIn) return;
      // fully off to the side 2.2 s out, in position 0.3 s before the moment
      const k = this.triggered ? 0 : Math.min(1, Math.max(0, (t - 0.3) / 1.9));
      const ease = k * k * (3 - 2 * k);
      const off = side * 70 * ease;
      group.position.set(base.x + base.nx * off, base.y + 12 * ease, base.z + base.nz * off);
    },
    trigger() { if (this.triggered) return; this.triggered = true; this.age = 0; onTrigger(); },
    dispose() { for (const m of mats) m.dispose(); },
  };

  switch (e.kind) {
    // ───────────────────────── boosts ─────────────────────────
    case 'vent': {
      // steam vent in the avenue: manhole + a rising column up to the plane
      group.add(mesh(DISC, mk('#3a3d42'), e.x * 2, 0.06, 0, 2.6, 2.6, 1, -Math.PI / 2));
      group.add(mesh(TORUS, mk('#5a5e66'), e.x * 2, 0.08, 0, 2.6, 2.6, 1, -Math.PI / 2));
      update = (dt) => {
        const strong = self.triggered && self.age < 2.5;
        if (Math.random() < (strong ? 0.95 : dt * 6)) {
          particles.emit({ pos: V(e.x * 2, 0.5, z), vel: V(0, strong ? 10 + h * 0.9 : 4, 0), spread: strong ? 2.2 : 0.8, count: strong ? 5 : 1, life: strong ? 1.6 : 1.1, size: strong ? 1.1 : 0.6, endSize: 2.4, colors: ['#ffffff', '#eef4f8', '#dde8ef'], drag: 0.6 });
        }
      };
      break;
    }
    case 'fountain': {
      // plaza fountain on the avenue median with a water jet that rises to meet the plane
      group.add(mesh(CYL, mk('#cfc7b8'), 0, 0.4, 0, 5.5, 0.6, 5.5));
      group.add(mesh(CYL, mk('#7cc6ea'), 0, 0.65, 0, 4.8, 0.2, 4.8));
      const jet = mesh(CYL_LO, mk('#cfe8f5', { transparent: true, opacity: 0.85 }), 0, 2, 0, 0.5, 4, 0.5);
      group.add(jet);
      update = (dt) => {
        const strong = self.triggered && self.age < 2.2;
        const target = strong ? h + 1 : 4;
        jet.scale.y += (target - jet.scale.y) * Math.min(1, dt * 4);
        jet.position.y = jet.scale.y / 2 + 0.6;
        if (Math.random() < (strong ? 0.95 : dt * 4)) {
          particles.emit({ pos: V(0, strong ? h : 4.5, z), vel: V(0, strong ? 6 : 2, 0), spread: strong ? 2.5 : 1, count: strong ? 6 : 1, life: 1.3, size: 0.5, endSize: 0.1, colors: ['#bfe9ff', '#ffffff', '#7cc6ea'], drag: 0.8, gravity: 9 });
        }
      };
      break;
    }
    case 'burner': {
      // hot-air balloon whose burner blast lifts the plane as it passes
      const b = balloon(mk, ['#f2c14e', '#e2574c', '#ffffff', '#5fb8e6'], goreFor());
      b.position.set(side * 6, h - 8, 0);
      group.add(b);
      const flame = mesh(CONE, mk('#ffb347', { emissive: '#ff8c00', emissiveIntensity: 0.9 }), 0, 2.8, 0, 0.8, 1.4, 0.8);
      b.add(flame);
      update = (dt, t) => {
        b.position.y = h - 8 + Math.sin(t * 0.6) * 0.6;
        const strong = self.triggered && self.age < 2;
        flame.scale.setScalar(strong ? 2.4 : 0.9 + Math.sin(t * 9) * 0.1);
        if (strong && Math.random() < 0.9) {
          particles.emit({ pos: V(side * 6, h - 6 + Math.random() * 4, z), vel: V(-side * 4, 9, -2), spread: 2, count: 3, life: 0.9, size: 0.6, endSize: 0.05, colors: ['#ffd27f', '#ffffff', '#ffb347'], drag: 1 });
        }
        void dt;
      };
      break;
    }
    case 'firework': {
      // a launched shell that bursts beside the plane, blowing it forward
      const tube = mesh(CYL_LO, mk('#c0392b'), side * 7, 0.5, 2, 0.6, 1, 0.6);
      group.add(tube);
      let launched = false;
      update = (dt, t) => {
        void t;
        if (self.triggered && !launched) {
          launched = true;
          particles.emit({ pos: V(side * 7, 1, z + 2), vel: V(0, 2, 0), spread: 1, count: 12, life: 0.4, size: 0.4, endSize: 0.05, colors: ['#ffd27f', '#ffffff'], drag: 2 });
        }
        if (self.triggered && self.age < 0.35 && Math.random() < 0.9) {
          const u = self.age / 0.35;
          particles.emit({ pos: V(side * 7 * (1 - u) + side * 2.5 * u, 1 + (h - 1) * u, z + 2 * (1 - u)), vel: V(0, 1, 0), spread: 0.5, count: 2, life: 0.4, size: 0.3, endSize: 0.02, colors: ['#ffd27f', '#ffffff'], drag: 2 });
        }
        if (self.triggered && self.age >= 0.35 && self.age < 0.35 + dt * 1.01) {
          particles.emit({ pos: V(side * 2.5, h, z + 0.5), vel: V(-side * 6, 2, -10), spread: 14, count: 160, life: 1.6, size: 0.45, endSize: 0.05, colors: ['#ff5a5a', '#ffd166', '#5fb8e6', '#7bc96f', '#ffffff', '#e5679a'], drag: 1.6, gravity: 3 });
        }
      };
      break;
    }
    case 'jetwash': {
      // an airliner on a straight, constant-speed crossing timed to pass just ahead of him; its wake shoves him along
      const jet = airliner(mk, '#2b7bb9');
      const dir = side, spd = 48;
      jet.position.set(-dir * 300, h + 6, -10);
      jet.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(jet);
      let xd = -dir * (60 + Math.abs(e.x) * 200);
      update = (dt) => {
        const x = decoy ? (xd += dir * spd * dt) : THREE.MathUtils.clamp(-dir * spd * ttt, -700, 700);
        jet.position.x = x;
        if (Math.random() < 0.8) {
          particles.emit({ pos: group.localToWorld(V(x - dir * 9, h + 5, -10)), vel: V(0, 0.5, 0), spread: 1.2, count: 2, life: 1.6, size: 0.7, endSize: 1.8, colors: ['#ffffff', '#eef4f8'], drag: 0.4 });
        }
      };
      break;
    }
    case 'thermal': {
      // a shimmering column of warm air rising off a sun-baked patch of fresh tarmac: leaves and dust spiral up
      const roof = mesh(DISC, mk('#4a4d52'), side * 4.5, 0.06, 0, 7, 9, 1, -Math.PI / 2);
      group.add(roof);
      update = (dt) => {
        const strong = self.triggered && self.age < 2.4;
        if (Math.random() < (strong ? 0.95 : dt * 5)) {
          const a = Math.random() * Math.PI * 2;
          particles.emit({ pos: V(side * 4.5 + Math.cos(a) * 3, 1 + Math.random() * (strong ? h : 6), z + Math.sin(a) * 3), vel: V(-Math.sin(a) * 3, strong ? 8 : 3, Math.cos(a) * 3), spread: 0.8, count: strong ? 3 : 1, life: 1.4, size: 0.3, endSize: 0.1, colors: ['#e9b949', '#d98c3f', '#f3d9a4', '#9bbf6a'], drag: 0.5, spin: 8 });
        }
      };
      break;
    }

    // ───────────────────────── obstacles ─────────────────────────
    case 'gulls': {
      const flock: ReturnType<typeof gull>[] = [];
      for (let i = 0; i < 7; i++) {
        const gl = gull(mk);
        gl.g.position.set((i - 3) * 1.6 * side + side * 1.5, h + Math.abs(i - 3) * 0.6 + 0.5, -Math.abs(i - 3) * 1.4);
        group.add(gl.g);
        flock.push(gl);
      }
      update = (dt, t) => {
        flock.forEach((gl, i) => {
          const flap = Math.sin(t * 9 + i) * 0.7;
          gl.wl.rotation.z = flap; gl.wr.rotation.z = -flap;
          gl.g.position.y += Math.sin(t * 2 + i) * dt * 0.3;
          if (self.triggered) {
            gl.g.position.x += (i % 2 ? 1 : -1) * dt * 9;
            gl.g.position.y += dt * (3 + i * 0.4);
            gl.g.rotation.z = (i % 2 ? 1 : -1) * Math.min(0.8, self.age * 2);
          }
        });
        if (self.triggered && self.age < 0.4 && Math.random() < 0.7) {
          particles.emit({ pos: V(0, h, z), vel: V(0, 1, 2), spread: 2.5, count: 3, life: 1.6, size: 0.25, endSize: 0.15, colors: ['#ffffff', '#f2f2f2'], drag: 1, gravity: 1.5, spin: 8 });
        }
      };
      break;
    }
    case 'pigeons': {
      // pigeons perched on a wire strung across the avenue between two kerb-side poles
      for (const sx of [-1, 1]) group.add(mesh(CYL_LO, mk('#4b515b'), sx * 8.7, (h + 0.6) / 2, 0, 0.18, h + 0.6, 0.18));
      group.add(mesh(CYL_LO, mk('#3a3d42'), 0, h + 0.5, 0, 0.035, 17.4, 0.035, 0, 0, Math.PI / 2));
      const birds: THREE.Mesh[] = [];
      for (let i = 0; i < 9; i++) {
        const b = mesh(SPHERE_LO, mk(['#8a8f99', '#6b7079', '#b7bcc4'][i % 3]), -6 + i * 1.5, h + 0.75, 0, 0.35, 0.38, 0.5);
        group.add(b); birds.push(b);
      }
      update = (dt, t) => {
        if (!self.triggered) { birds.forEach((b, i) => { b.position.y = h + 0.75 + Math.sin(t * 3 + i) * 0.03; }); return; }
        birds.forEach((b, i) => {
          b.position.x += (i % 2 ? 1 : -1) * dt * (6 + i);
          b.position.y += dt * (5 + i * 0.5);
          b.position.z += dt * (i % 3 - 1) * 3;
        });
        if (self.age < 0.3 && Math.random() < 0.8) particles.emit({ pos: V(0, h + 0.5, z), vel: V(0, 2, 1), spread: 3, count: 3, life: 1.4, size: 0.2, endSize: 0.1, colors: ['#b7bcc4', '#ffffff'], drag: 1, gravity: 1.5, spin: 10 });
      };
      break;
    }
    case 'hotair': {
      // a drifting hot-air balloon right in the lane
      const b = balloon(mk, ['#e5679a', '#ffffff', '#7bc96f', '#f2c14e'], goreFor());
      b.position.set(e.x, h - 7.5, 0);
      group.add(b);
      update = (_dt, t) => {
        b.position.y = h - 7.5 + Math.sin(t * 0.7) * 0.5;
        b.rotation.z = Math.sin(t * 0.5) * 0.03;
        b.position.x = e.x + Math.sin(t * 0.12) * 0.8;
        if (self.triggered && self.age < 1) {
          const s = 1 + Math.sin(self.age * Math.PI) * 0.12;
          b.scale.set(s, 1 / s, s);
        }
      };
      break;
    }
    case 'propplane': {
      // a little banner-towing plane on a steady crossing, timed to meet him, then flying on
      const p = new THREE.Group();
      const col = mk(side > 0 ? '#e2574c' : '#f2c14e');
      p.add(mesh(CYL, col, 0, 0, 0, 1.3, 5, 1.3, Math.PI / 2, 0, 0));
      p.add(mesh(BOX, col, 0, 0.3, -0.5, 7, 0.18, 1.4));
      p.add(mesh(BOX, col, 0, 0.9, 2.3, 0.15, 1.4, 1.2));
      p.add(mesh(BOX, col, 0, 0.3, 2.3, 2.6, 0.15, 1));
      p.add(mesh(BOX, mk('#bfe9ff'), 0, 0.8, -0.6, 0.9, 0.5, 1.2));
      const prop = mesh(BOX, mk('#333'), 0, 0, -2.7, 2.6, 0.25, 0.1);
      p.add(prop);
      const banner = mesh(PLANE, mk('#ffffff', { side: THREE.DoubleSide }), 0, 0, 9, 1, 2.2, 1, 0, Math.PI / 2, 0);
      banner.scale.set(1, 2.2, 9);
      p.add(mesh(CYL_LO, mk('#444'), 0, 0, 5, 0.05, 6, 0.05, Math.PI / 2, 0, 0));
      p.add(banner);
      p.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(p);
      const spd = 20;
      let xd = -side * (40 + Math.abs(e.x) * 120);
      update = (dt, t) => {
        prop.rotation.z += dt * 40;
        const x = decoy ? (xd += side * spd * dt) : THREE.MathUtils.clamp(-side * spd * ttt, -700, 700);
        p.position.x = x;
        p.position.y = h + Math.sin(t * 1.2) * 0.3;
        banner.rotation.x = Math.sin(t * 6) * 0.06;
        if (self.triggered) p.rotation.z = Math.sin(self.age * 10) * 0.25 * Math.max(0, 1 - self.age);
      };
      break;
    }
    case 'blimp': {
      const b = new THREE.Group();
      const body = mesh(SPHERE, mk('#f4f4f4'), 0, 0, 0, 7, 7, 20);
      b.add(body);
      b.add(mesh(BOX, mk('#e2574c'), 0, 0, 0, 7.2, 1.2, 12));
      b.add(mesh(BOX, mk('#3b3f47'), 0, -3.6, -1, 1.6, 1.4, 4));
      for (const [dx, dy] of [[0, 3.2], [0, -3.2], [3.2, 0], [-3.2, 0]]) b.add(mesh(BOX, mk('#e2574c'), dx, dy, 8.5, dx ? 3 : 0.3, dy ? 3 : 0.3, 3));
      b.position.set(e.x * 1.5, h + 2.5, 0);
      b.rotation.y = side * 0.5;
      group.add(b);
      update = (dt, t) => {
        b.position.y = h + 2.5 + Math.sin(t * 0.5) * 0.6;
        b.position.z += dt * 0.6;
        if (self.triggered && self.age < 1.2) b.rotation.x = Math.sin(self.age * 8) * 0.08 * (1 - self.age / 1.2);
      };
      break;
    }
    case 'crane': {
      // construction crane on the kerb whose jib reaches over the avenue
      const grey = mk('#f2c14e');
      const H = h + 4;
      group.add(mesh(BOX, grey, side * 10.5, H / 2, 0, 1.6, H, 1.6));
      for (let i = 1; i < H / 4; i++) group.add(mesh(BOX, mk('#d9a52c'), side * 10.5, i * 4, 0, 2.2, 0.2, 2.2));
      const jib = new THREE.Group();
      jib.add(mesh(BOX, grey, -side * 12, 0, 0, 28, 1, 1));
      jib.add(mesh(BOX, grey, side * 6, 0.5, 0, 9, 1.2, 1.2));
      jib.add(mesh(BOX, mk('#5b6a7a'), side * 8, 0, 0, 3, 2.2, 2.2)); // counterweight
      jib.add(mesh(BOX, mk('#3b3f47'), 0, -1.4, 0, 1.8, 1.8, 1.8));   // cab
      const hook = mesh(CYL_LO, mk('#555'), -side * 10, -h * 0.25, 0, 0.06, h * 0.5, 0.06);
      jib.add(hook);
      const load = mesh(BOX, mk('#c0392b'), -side * 10, -h * 0.5 + 0.5, 0, 3, 2.2, 1.4);
      jib.add(load);
      jib.position.set(side * 10.5, H, 0);
      group.add(jib);
      update = (dt, t) => {
        jib.rotation.y = Math.sin(t * 0.15) * 0.15;
        if (self.triggered && self.age < 1.5) {
          load.rotation.z = Math.sin(self.age * 12) * 0.4 * (1 - self.age / 1.5);
          jib.rotation.y += dt * 0.5 * (1 - self.age / 1.5);
        }
      };
      break;
    }
    case 'billboard': {
      // tall billboard frame on the sidewalk; the poster sits at plane height
      const px = side * 8.5;
      group.add(mesh(CYL_LO, mk('#4b515b'), px, h / 2 - 1, 0, 0.5, h - 2, 0.5));
      group.add(mesh(BOX, mk('#4b515b'), px, h, 0, 9, 4.4, 0.4, 0, side * 0.25, 0));
      const poster = mesh(BOX, mk(['#e2574c', '#2f8a4b', '#f2c14e', '#3f5f8a', '#e5679a'][Math.abs(Math.round(e.x * 100)) % 5]), px, h, 0.25, 8.2, 3.6, 0.1, 0, side * 0.25, 0);
      group.add(poster);
      group.add(mesh(BOX, mk('#ffffff'), px, h + 0.5, 0.32, 5.5, 1.1, 0.05, 0, side * 0.25, 0));
      update = () => {
        if (self.triggered && self.age < 1.2) {
          const w = Math.sin(self.age * 14) * 0.2 * (1 - self.age / 1.2);
          poster.rotation.x = w;
          if (self.age < 0.3 && Math.random() < 0.6) particles.emit({ pos: V(px * 0.6, h, z), vel: V(-side * 2, 1, 2), spread: 2, count: 2, life: 1.5, size: 0.35, endSize: 0.3, colors: ['#ffffff', '#f2f2f2'], drag: 1, gravity: 2, spin: 6 });
        }
      };
      break;
    }
    case 'bunting': {
      // festival bunting strung across the avenue between two poles
      for (const sx of [-1, 1]) group.add(mesh(CYL_LO, mk('#8a5a3c'), sx * 8.7, h / 2 + 0.4, 0, 0.18, h + 0.8, 0.18));
      const line = mesh(CYL_LO, mk('#444'), 0, h + 0.7, 0, 0.03, 17.4, 0.03, 0, 0, Math.PI / 2);
      group.add(line);
      const flags: THREE.Mesh[] = [];
      const cols = ['#ff6b6b', '#ffd166', '#4dabf7', '#69db7c', '#ff8cc6', '#ffffff'];
      for (let i = 0; i < 11; i++) {
        const f = mesh(CONE, mk(cols[i % cols.length], { side: THREE.DoubleSide }), -7.5 + i * 1.5, h + 0.1, 0, 0.8, 1.2, 0.08, Math.PI, 0, 0);
        group.add(f); flags.push(f);
      }
      update = (_dt, t) => {
        flags.forEach((f, i) => {
          f.rotation.x = Math.PI + Math.sin(t * 2.5 + i) * 0.2 + (self.triggered && self.age < 1.2 ? Math.sin(self.age * 16 + i) * 1.1 * (1 - self.age / 1.2) : 0);
        });
      };
      break;
    }
    case 'kite': {
      const kx = side * 2.6;
      const kite = new THREE.Group();
      const body = mesh(PLANE, mk(side > 0 ? '#f26b6b' : '#5fb8e6', { side: THREE.DoubleSide, emissive: side > 0 ? '#f26b6b' : '#5fb8e6', emissiveIntensity: 0.35 }), 0, 0, 0, 1.2, 1.7, 1, 0, 0.5, Math.PI / 4);
      kite.add(body);
      for (let i = 0; i < 5; i++) kite.add(mesh(BOX, mk(['#ffd166', '#ffffff', '#7bc96f'][i % 3]), 0, -1.1 - i * 0.45, 0.15 * i, 0.3, 0.1, 0.05));
      const sx = kx * 3, sy = 0.2;
      const len = Math.hypot(sx - kx, sy - (h + 0.6), 3);
      const str = mesh(CYL_LO, mk('#b9b2a6'), (kx + sx) / 2, (h + 0.6 + sy) / 2, 1.5, 0.015, len, 0.015);
      str.lookAt(sx, sy, 3); str.rotateX(Math.PI / 2);
      kite.position.set(kx, h + 0.6, 0);
      group.add(kite, str);
      update = (_dt, t) => {
        kite.rotation.z = Math.sin(t * 1.5) * 0.2;
        kite.position.x = kx + Math.sin(t * 0.8) * 0.3;
        if (self.triggered) kite.rotation.z += Math.sin(self.age * 20) * 0.3 * Math.max(0, 1 - self.age);
      };
      break;
    }
    case 'drone': {
      const d = new THREE.Group();
      d.add(mesh(BOX, mk('#3b3f47'), 0, 0, 0, 1.2, 0.4, 1.2));
      const rotors: THREE.Mesh[] = [];
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        d.add(mesh(BOX, mk('#6d7480'), dx * 0.7, 0, dz * 0.7, 1.2, 0.12, 0.12, 0, Math.atan2(dz, dx), 0));
        const r = mesh(BOX, mk('#cfd6dd', { transparent: true, opacity: 0.6 }), dx * 1.1, 0.15, dz * 1.1, 1.4, 0.04, 0.12);
        d.add(r); rotors.push(r);
      }
      d.add(mesh(SPHERE_LO, mk('#ff4040', { emissive: '#ff0000', emissiveIntensity: 0.8 }), 0, -0.3, -0.5, 0.25));
      d.position.set(e.x, h + 0.3, 0);
      group.add(d);
      update = (dt, t) => {
        rotors.forEach(r => { r.rotation.y += dt * 50; });
        d.position.y = h + 0.3 + Math.sin(t * 3) * 0.2;
        d.position.x = e.x + Math.sin(t * 1.2) * 0.4;
        if (self.triggered) {
          d.position.y -= dt * 3;
          d.rotation.z += dt * 2;
          d.position.x += side * dt * 4;
        }
      };
      break;
    }
    // ───────────────────────── ground boosts ─────────────────────────
    case 'trampoline': {
      const px = e.x * 2;
      const frame = mesh(TORUS, mk('#2b5fa8'), px, 1.2, 0, 5.2, 5.2, 1.2, -Math.PI / 2);
      const mat = mesh(DISC, mk('#1e1e24'), px, 1.15, 0, 4.6, 4.6, 1, -Math.PI / 2);
      group.add(frame, mat);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; group.add(mesh(CYL_LO, mk('#4b515b'), px + Math.cos(a) * 2.3, 0.6, Math.sin(a) * 2.3, 0.12, 1.2, 0.12)); }
      update = (_dt) => {
        if (self.triggered && self.age < 0.8) { const q = self.age / 0.8; mat.position.y = 1.15 - Math.sin(Math.PI * q) * 0.6; mat.scale.setScalar(4.6 * (1 + Math.sin(Math.PI * q) * 0.12)); }
        if (self.triggered && self.age < 0.3 && Math.random() < 0.7) particles.emit({ pos: V(px, 1.3, z), vel: V(0, 3, 0), spread: 3, count: 3, life: 0.7, size: 0.35, endSize: 0.8, colors: ['#d9d3c4', '#c8c2b4'], drag: 1.5 });
      };
      break;
    }
    case 'castle': {
      const px = e.x * 2;
      const c = new THREE.Group();
      c.add(mesh(BOX, mk('#f2c14e'), 0, 0.6, 0, 6, 1.2, 6));
      c.add(mesh(BOX, mk('#e2574c'), 0, 2.2, 0, 5.2, 2.2, 5.2));
      c.add(mesh(BOX, mk('#2b7bb9'), 0, 1.2, 2.7, 2, 2.4, 0.3));
      for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
        c.add(mesh(CYL_LO, mk('#5fb8e6'), dx, 2.6, dz, 1.1, 3.2, 1.1));
        c.add(mesh(CONE, mk('#e5679a'), dx, 4.6, dz, 1.3, 1.2, 1.3));
      }
      c.position.set(px, 0.02, 0);
      group.add(c);
      update = () => {
        if (self.triggered && self.age < 0.9) { const q = self.age / 0.9; const sq = 1 - Math.sin(Math.PI * q) * 0.25; c.scale.set(1 / sq, sq, 1 / sq); }
        else c.scale.setScalar(1);
      };
      break;
    }
    case 'tyres': {
      const px = e.x * 2;
      const stack = new THREE.Group();
      for (let i = 0; i < 5; i++) stack.add(mesh(TORUS, mk('#2b2b2b'), (i % 2) * 0.1, 0.3 + i * 0.32, 0, 1.9, 1.9, 1.6, -Math.PI / 2));
      stack.position.set(px, 0.02, 0);
      group.add(stack);
      update = () => {
        if (self.triggered && self.age < 1.2) { stack.rotation.z = Math.sin(self.age * 14) * 0.15 * (1 - self.age / 1.2); stack.scale.y = 1 - Math.sin(Math.PI * Math.min(1, self.age / 0.5)) * 0.2; }
      };
      break;
    }
    case 'bigfan': {
      const px = e.x * 2;
      group.add(mesh(BOX, mk('#8a5a3c'), px, 0.8, 0, 3.6, 1.6, 3.6));
      const ring = mesh(TORUS, mk('#4b515b'), px, 1.75, 0, 3.4, 3.4, 1.2, -Math.PI / 2);
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) { const b = mesh(BOX, mk('#dfe6ee'), 0.7, 0, 0, 1.4, 0.06, 0.4); const p = new THREE.Group(); p.rotation.y = (i / 4) * Math.PI * 2; p.add(b); blades.add(p); }
      blades.position.set(px, 1.75, 0);
      group.add(ring, blades);
      let spin = 4;
      update = (dt) => {
        const target = self.triggered && self.age < 3 ? 30 : 4;
        spin += (target - spin) * Math.min(1, dt * 3);
        blades.rotation.y += spin * dt;
        if (Math.random() < (self.triggered && self.age < 2.5 ? 0.95 : dt * 4)) particles.emit({ pos: V(px + (Math.random() - 0.5) * 2, 2.2, z + (Math.random() - 0.5) * 2), vel: V(0, self.triggered ? 14 : 5, 0), spread: 1, count: 2, life: 0.9, size: 0.2, endSize: 0.03, colors: ['#ffffff', '#e6f3ff'], drag: 0.6 });
      };
      break;
    }
    // ───────────────────────── ground obstacles ─────────────────────────
    case 'cones': {
      const cones: { m: THREE.Mesh; vx: number; vy: number; vz: number; w: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const m = mesh(CONE, mk('#ff7a1a'), -4.5 + i * 1.5, 0.55, 0, 0.7, 1.1, 0.7);
        const band = mesh(CYL_LO, mk('#ffffff'), 0, 0.05, 0, 0.75, 0.14, 0.75); m.add(band);
        const foot = mesh(BOX, mk('#2b2b2b'), -4.5 + i * 1.5, 0.05, 0, 0.9, 0.1, 0.9);
        group.add(m, foot); cones.push({ m, vx: (i - 3) * 2.5, vy: 6 + Math.random() * 4, vz: -6 - Math.random() * 6, w: (Math.random() - 0.5) * 12 });
      }
      update = (dt) => {
        if (!self.triggered) return;
        for (const c of cones) {
          c.vy -= 20 * dt;
          c.m.position.x += c.vx * dt; c.m.position.y += c.vy * dt; c.m.position.z += c.vz * dt;
          c.m.rotation.z += c.w * dt;
          if (c.m.position.y < 0.3) { c.m.position.y = 0.3; c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; c.w *= 0.8; }
        }
      };
      break;
    }
    case 'hotdog': {
      const px = e.x * 1.5;
      const cart = new THREE.Group();
      cart.add(mesh(BOX, mk('#f4f4f4'), 0, 1.0, 0, 2.8, 1.2, 1.6));
      cart.add(mesh(BOX, mk('#d8392b'), 0, 1.65, 0, 2.9, 0.1, 1.7));
      cart.add(mesh(CYL_LO, mk('#4b515b'), 0, 2.9, 0, 0.08, 2.5, 0.08));
      const umb = mesh(CONE, mk('#f2c14e'), 0, 4.2, 0, 3.6, 0.9, 3.6);
      cart.add(umb);
      for (const dx of [-0.9, 0.9]) cart.add(mesh(CYL_LO, mk('#2b2b2b'), dx, 0.4, 0.9, 0.8, 0.2, 0.8, Math.PI / 2, 0, 0));
      cart.add(mesh(BOX, mk('#ffffff'), 0, 1.0, -0.82, 1.8, 0.6, 0.05));
      cart.position.set(px, 0.02, 0);
      group.add(cart);
      let vy = 0;
      update = (dt) => {
        if (!self.triggered) return;
        if (self.age < 0.05) { vy = 9; particles.emit({ pos: V(px, 2, z), vel: V(0, 5, -2), spread: 6, count: 40, life: 1.6, size: 0.3, endSize: 0.25, colors: ['#e8b86d', '#c0392b', '#f2c14e', '#7bc96f'], drag: 1.2, gravity: 9, spin: 10 }); }
        vy -= 18 * dt; umb.position.y += vy * dt; umb.position.x -= dt * 3; umb.rotation.z += dt * 2;
        if (umb.position.y < -1) umb.visible = false;
        cart.rotation.z = Math.sin(self.age * 9) * 0.12 * Math.max(0, 1 - self.age);
      };
      break;
    }
    case 'mattress': {
      const px = e.x * 2;
      const m = mesh(BOX, mk('#f4ede0'), px, 0.45, 0, 3.4, 0.9, 6);
      for (let i = 0; i < 4; i++) group.add(mesh(BOX, mk('#5fb8e6'), px, 0.46, -2.2 + i * 1.5, 3.42, 0.9, 0.3));
      group.add(m);
      update = () => {
        if (self.triggered && self.age < 0.8) { const q = Math.sin(Math.PI * self.age / 0.8); m.scale.set(1 + q * 0.2, 1 - q * 0.45, 1 + q * 0.1); }
        else m.scale.setScalar(1);
      };
      break;
    }
    // ───────────────────────── endings ─────────────────────────
    case 'dumpster': {
      const bin = new THREE.Group();
      bin.add(mesh(BOX, mk('#2e8b57'), 0, 1.1, 0, 3.6, 2.0, 2.4));
      for (const dx of [-1.4, 1.4]) for (const dz of [-0.9, 0.9]) bin.add(mesh(CYL_LO, mk('#2b2b2b'), dx, 0.2, dz, 0.4, 0.2, 0.4, Math.PI / 2, 0, 0));
      bin.add(mesh(BOX, mk('#ffffff'), 0, 1.2, -1.22, 1.6, 0.6, 0.04));
      const lid = new THREE.Group();
      lid.add(mesh(BOX, mk('#246b45'), 0, 0.1, 1.2, 3.7, 0.2, 2.5));
      lid.position.set(0, 2.1, -1.25);
      lid.rotation.x = -1.9; // open, leaning back
      bin.add(lid);
      // a bit of trash poking out
      bin.add(mesh(SPHERE_LO, mk('#2b2b2b'), -0.8, 2.2, 0.2, 0.9, 0.7, 0.9));
      bin.add(mesh(BOX, mk('#e8d5a8'), 0.7, 2.2, -0.2, 0.8, 0.6, 0.5));
      group.add(bin);
      update = (dt) => {
        if (!self.triggered) return;
        if (self.age < 0.08) particles.emit({ pos: V(0, 2.4, z), vel: V(0, 7, 0), spread: 5, count: 60, life: 1.5, size: 0.35, endSize: 0.3, colors: ['#2b2b2b', '#e8d5a8', '#9fd8ff', '#c0392b', '#7bc96f', '#ffffff'], drag: 1.2, gravity: 9, spin: 12 });
        // lid slams shut, then pops back open for the reveal
        const target = self.age < 1.4 ? 0 : -1.9;
        lid.rotation.x += (target - lid.rotation.x) * Math.min(1, dt * (self.age < 1.4 ? 14 : 5));
        if (self.age < 0.6) bin.scale.y = 1 - Math.sin(Math.PI * self.age / 0.6) * 0.12;
      };
      break;
    }
    case 'hay': {
      const truck = new THREE.Group();
      truck.add(mesh(BOX, mk('#8a5a3c'), 0, 0.9, 0, 3.2, 0.3, 7));
      truck.add(mesh(BOX, mk('#d8392b'), 0, 1.6, 4.2, 3, 1.8, 2.2));
      truck.add(mesh(BOX, mk('#bfe9ff'), 0, 1.9, 3.1, 2.6, 0.9, 0.1));
      for (const dz of [-2.4, 2.4]) for (const dx of [-1.5, 1.5]) truck.add(mesh(CYL_LO, mk('#2b2b2b'), dx, 0.5, dz, 1, 0.4, 1, 0, 0, Math.PI / 2));
      const hayMat = mk('#e2c56b');
      for (const [dx, dy, dz, sc] of [[0, 2.2, -0.5, 3.4], [1.1, 1.9, 0.8, 2.6], [-1.1, 1.9, -1.6, 2.6], [0, 2.9, -1.2, 2.4], [0.6, 1.8, -2.4, 2.2]]) truck.add(mesh(SPHERE_LO, hayMat, dx, dy, dz, sc, sc * 0.8, sc));
      truck.position.set(0, 0.02, 1.5);
      group.add(truck);
      update = () => {
        if (!self.triggered) return;
        if (self.age < 0.08) particles.emit({ pos: V(0, 3, z), vel: V(0, 6, 0), spread: 5, count: 70, life: 1.8, size: 0.25, endSize: 0.2, colors: ['#e2c56b', '#d4b45a', '#f0dc8c'], drag: 1.0, gravity: 6, spin: 14 });
      };
      break;
    }
    case 'raincloud': {
      const c = new THREE.Group();
      const grey = mk('#8e9aa8');
      for (const [dx, dy, s] of [[0, 0, 3.2], [2.4, 0.5, 2.5], [-2.5, 0.4, 2.4], [1, 1.3, 2], [-1, 1.2, 1.9]]) {
        c.add(mesh(SPHERE_LO, grey, dx, dy, 0, s * 1.3, s * 0.85, s));
      }
      c.position.set(e.x * 0.5, h + 2.2, 0);
      group.add(c);
      update = (dt, t) => {
        c.position.y = h + 2.2 + Math.sin(t * 0.8) * 0.3;
        if (Math.random() < (self.triggered ? 0.9 : dt * 8)) {
          particles.emit({ pos: V(e.x * 0.5 + (Math.random() - 0.5) * 6, h + 0.5, z + (Math.random() - 0.5) * 4), vel: V(0, -9, 0), spread: 0.4, count: self.triggered ? 4 : 1, life: 0.6, size: 0.12, endSize: 0.1, colors: ['#9fd8ff', '#cfe9ff'], drag: 0 });
        }
        if (self.triggered && self.age < 0.2) c.scale.setScalar(1.05);
      };
      break;
    }
  }
  return self;
}
