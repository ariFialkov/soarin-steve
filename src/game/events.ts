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
  update(dt: number, elapsed: number): void;
  /** Called with the time remaining until the trigger; fliers use it to glide in from the side. */
  approach(timeToTrigger: number): void;
  trigger(): void;
  dispose(): void;
}

/** Kinds that can be scattered as harmless filler along the route. */
export const DECOY_KINDS: PlanEvent['kind'][] = ['gulls', 'hotair', 'drone', 'blimp', 'raincloud', 'kite', 'crane', 'billboard', 'pigeons', 'burner', 'thermal', 'vent'];
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

/** A hot-air balloon: envelope, basket, ropes. Returns the group (origin at the basket). */
function balloon(mk: (c: string) => THREE.Material, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  const env = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(SPHERE, mk(colors[i % colors.length]));
    seg.scale.set(5.6, 6.6, 5.6);
    seg.rotation.y = (i / 8) * Math.PI * 2;
    env.add(seg);
  }
  // simple vertical stripes via thin wedges
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(BOX, mk(colors[(i + 1) % colors.length]));
    s.scale.set(0.5, 6.2, 0.4);
    s.position.set(Math.cos(a) * 2.75, 0, Math.sin(a) * 2.75);
    s.rotation.y = -a;
    env.add(s);
  }
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
  const z = -e.s;
  group.position.set(0, 0, z);
  const flyIn = !decoy && FLY_IN.has(e.kind);
  const mats: THREE.Material[] = [];
  const mk = (c: string, extra: Partial<THREE.MeshLambertMaterialParameters> = {}): THREE.Material => {
    const m = new THREE.MeshLambertMaterial({ color: c, ...extra });
    mats.push(m);
    return m;
  };
  let update: (dt: number, elapsed: number) => void = () => {};
  let onTrigger: () => void = () => {};
  const side = e.x >= 0 ? 1 : -1;
  const self: EventObject = {
    event: e, group, triggered: false, age: -1, decoy,
    update(dt, elapsed) { if (this.triggered) this.age += dt; update(dt, elapsed); },
    approach(ttt) {
      if (!flyIn || this.triggered) { if (flyIn) group.position.x = 0; return; }
      // fully off to the side 2.2 s out, in position 0.3 s before the moment
      const k = Math.min(1, Math.max(0, (ttt - 0.3) / 1.9));
      const ease = k * k * (3 - 2 * k);
      group.position.x = side * 70 * ease;
      group.position.y = 12 * ease;
    },
    trigger() { if (this.triggered) return; this.triggered = true; this.age = 0; onTrigger(); },
    dispose() { for (const m of mats) m.dispose(); },
  };
  if (flyIn) { group.position.x = side * 70; group.position.y = 12; }

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
      const b = balloon(mk, ['#f2c14e', '#e2574c', '#ffffff', '#5fb8e6']);
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
      // an airliner crossing just ahead; its slipstream shoves the plane along
      const jet = airliner(mk, '#2b7bb9');
      const dir = side;
      jet.position.set(-dir * 160, h + 6, -40);
      jet.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(jet);
      let x = -dir * 160;
      update = (dt) => {
        const ahead = self.triggered ? 1 : 0;
        // the airliner cruises across so that it is just past the centre line when the plane arrives
        x += dir * dt * (self.triggered ? 60 : 36);
        if (!self.triggered && dir * x > -20) x = -dir * 20;
        jet.position.x = x;
        jet.position.z = -40 + 40 * (self.triggered ? Math.min(1, self.age * 3) : 0);
        if (Math.random() < 0.8) {
          particles.emit({ pos: V(x - dir * 9, h + 5, jet.position.z + z), vel: V(-dir * 10, 0.5, 2), spread: 1.5, count: 2, life: 1.4, size: 0.7, endSize: 1.6, colors: ['#ffffff', '#eef4f8'], drag: 0.4 });
        }
        void ahead;
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
      // a lamp post full of pigeons that explode into the air
      group.add(mesh(CYL_LO, mk('#4b515b'), 0, h / 2 - 0.5, 0, 0.18, h - 1, 0.18));
      group.add(mesh(BOX, mk('#4b515b'), 0, h - 1, 0, 3, 0.15, 0.15));
      const birds: THREE.Mesh[] = [];
      for (let i = 0; i < 8; i++) {
        const b = mesh(SPHERE_LO, mk(['#8a8f99', '#6b7079', '#b7bcc4'][i % 3]), -1.4 + i * 0.4, h - 0.7, 0, 0.35, 0.35, 0.5);
        group.add(b); birds.push(b);
      }
      update = (dt) => {
        if (self.triggered) {
          birds.forEach((b, i) => {
            b.position.x += (i % 2 ? 1 : -1) * dt * (6 + i);
            b.position.y += dt * (5 + i * 0.5);
            b.position.z += dt * (i % 3 - 1) * 3;
          });
          if (self.age < 0.3 && Math.random() < 0.8) particles.emit({ pos: V(0, h - 0.5, z), vel: V(0, 2, 1), spread: 3, count: 3, life: 1.4, size: 0.2, endSize: 0.1, colors: ['#b7bcc4', '#ffffff'], drag: 1, gravity: 1.5, spin: 10 });
        }
      };
      break;
    }
    case 'hotair': {
      // a drifting hot-air balloon right in the lane
      const b = balloon(mk, ['#e5679a', '#ffffff', '#7bc96f', '#f2c14e']);
      b.position.set(e.x, h - 7.5, 0);
      group.add(b);
      update = (dt, t) => {
        b.position.y = h - 7.5 + Math.sin(t * 0.7) * 0.5;
        b.rotation.z = Math.sin(t * 0.5) * 0.03;
        if (self.triggered && self.age < 1) {
          const s = 1 + Math.sin(self.age * Math.PI) * 0.12;
          b.scale.set(s, 1 / s, s);
          b.position.x += side * dt * 2;
        }
      };
      break;
    }
    case 'propplane': {
      // a little banner-towing plane crossing the avenue
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
      p.position.set(-side * 70, h, 0);
      p.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(p);
      let x = -side * 70;
      update = (dt, t) => {
        prop.rotation.z += dt * 40;
        x += side * dt * (self.triggered ? 28 : 14);
        if (!self.triggered && side * x > -4) x = -side * 4;
        p.position.x = x;
        p.position.y = h + Math.sin(t * 1.5) * 0.4;
        if (self.triggered) p.rotation.z = Math.sin(self.age * 10) * 0.3 * Math.max(0, 1 - self.age);
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
