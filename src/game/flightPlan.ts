/**
 * Flight plan: a deterministic, pre-computed trajectory that ends exactly at
 * the resolved distance. The visible "physics" (boost pads, obstacles, gusts)
 * are placed to explain the speed profile, never to decide it.
 *
 * Playback happens in plan time (tau). Player boosts only change the rate at
 * which tau advances, so the end point is untouchable.
 */
import { Rng } from '../core/rng';
import type { FlightStyle } from '../data/suits';
import { LAUNCH_H } from './constants';

export type EventKind =
  | 'vent' | 'fountain' | 'burner' | 'firework' | 'jetwash' | 'thermal'                       // aerial boosts
  | 'trampoline' | 'castle' | 'tyres' | 'bigfan'                                             // ground boosts (bounce / lift)
  | 'gulls' | 'pigeons' | 'hotair' | 'propplane' | 'blimp' | 'crane' | 'billboard' | 'bunting'  // aerial obstacles
  | 'kite' | 'drone' | 'raincloud'
  | 'cones' | 'hotdog' | 'mattress'                                                          // ground obstacles
  | 'dumpster' | 'hay';                                                                      // endings

export type Ending = 'sprawl' | 'dumpster' | 'hay';

export type FumbleKind = 'fizzle' | 'rim' | 'gust' | 'spinout';

/** What the road is made of where Steve lands: sets how far he slides and how he bounces. */
export type Surface = 'asphalt' | 'cobble' | 'pavers' | 'bridge';
export const SURFACES: Record<Surface, { decel: number; restitution: number; dust: string[] }> = {
  asphalt: { decel: 15, restitution: 0.22, dust: ['#b9b5ad', '#d4cfc4'] },
  cobble:  { decel: 19, restitution: 0.3,  dust: ['#a89c8c', '#c8bca9'] },   // rough: shorter slide, bumpier hops
  pavers:  { decel: 13, restitution: 0.18, dust: ['#d9c7a8', '#e8dcc2'] },
  bridge:  { decel: 11, restitution: 0.14, dust: ['#c9cdd2', '#e0e3e6'] },   // smooth deck: longest slide
};
/** Gravity used for the little hops while tumbling on the ground. */
const HOP_G = 12;

export interface PlanEvent {
  t: number;          // plan time
  s: number;          // distance along track (world units) where it happens
  delta: number;      // velocity change (world units / s)
  kind: EventKind;
  lift: number;       // extra visual height bump
  x: number;          // lateral placement of the object
}

export interface FlightPlan {
  L: number;          // total world length
  T: number;          // plan duration (seconds)
  v0: number;
  events: PlanEvent[];
  /** samples every `dt` seconds: s(t), v(t), h(t) */
  dt: number;
  s: Float32Array;
  v: Float32Array;
  h: Float32Array;
  /** vertical velocity at each sample (world units / s) */
  vy: Float32Array;
  /** gravity used for the whole flight (world units / s²) */
  g: number;
  /** surface at the touchdown point */
  surface: Surface;
  landT: number;      // time the plane touches down
  unitsPerMetre: number;
  /** Set for very short results: a misfire instead of a flight. */
  fumble: FumbleKind | null;
  /** How the flight ends: a tumbling skid, or stopped dead by something at the end. */
  ending: Ending;
  tuckTime: number;   // seconds in the cannonball tuck before unfurling
}

/** Boost / obstacle kinds, with the altitude band each one makes sense at. */
interface KindDef { kind: EventKind; minH: number; maxH: number; ground?: { padH: number; rebound: [number, number] } }
const BOOSTS: KindDef[] = [
  { kind: 'vent', minH: 0, maxH: 18 },
  { kind: 'fountain', minH: 0, maxH: 26 },
  { kind: 'thermal', minH: 0, maxH: 40 },
  { kind: 'burner', minH: 12, maxH: 999 },
  { kind: 'firework', minH: 3, maxH: 999 },
  { kind: 'jetwash', minH: 20, maxH: 999 },
  { kind: 'trampoline', minH: 0, maxH: 999, ground: { padH: 1.3, rebound: [9, 16] } },
  { kind: 'castle', minH: 0, maxH: 999, ground: { padH: 3.6, rebound: [7, 13] } },
  { kind: 'tyres', minH: 0, maxH: 999, ground: { padH: 1.6, rebound: [6, 11] } },
  { kind: 'bigfan', minH: 0, maxH: 999, ground: { padH: 2.4, rebound: [10, 18] } },
];
const OBSTACLES: KindDef[] = [
  { kind: 'bunting', minH: 0, maxH: 11 },
  { kind: 'pigeons', minH: 3, maxH: 16 },
  { kind: 'kite', minH: 4, maxH: 40 },
  { kind: 'billboard', minH: 6, maxH: 30 },
  { kind: 'crane', minH: 8, maxH: 45 },
  { kind: 'drone', minH: 4, maxH: 999 },
  { kind: 'gulls', minH: 3, maxH: 999 },
  { kind: 'hotair', minH: 14, maxH: 999 },
  { kind: 'propplane', minH: 14, maxH: 999 },
  { kind: 'raincloud', minH: 18, maxH: 999 },
  { kind: 'blimp', minH: 24, maxH: 999 },
  { kind: 'cones', minH: 0, maxH: 999, ground: { padH: 0.9, rebound: [1.5, 3] } },
  { kind: 'hotdog', minH: 0, maxH: 999, ground: { padH: 1.8, rebound: [2, 4] } },
  { kind: 'mattress', minH: 0, maxH: 999, ground: { padH: 0.9, rebound: [1, 2.5] } },
];
const GROUND_KINDS = new Map<EventKind, { padH: number; rebound: [number, number] }>();
for (const k of [...BOOSTS, ...OBSTACLES]) if (k.ground) GROUND_KINDS.set(k.kind, k.ground);
export function isGroundKind(k: EventKind): boolean { return GROUND_KINDS.has(k); }

/** Kinds that can appear close to the launcher: they fly in or launch from the ground, so they never pop into view. */
const NEAR_OK = new Set<EventKind>(['gulls', 'drone', 'propplane', 'jetwash', 'firework']);
/** Static structures must sit deep in the haze at launch time (world units from the launcher). */
const STATIC_MIN_S = 230;
/** Results shorter than this become a "bad release" fumble with no obstacles at all. */
export const FUMBLE_L = 110;

/** Compress very long distances so the world stays a sensible size. */
export function worldLength(distanceMetres: number): number {
  const D = distanceMetres;
  if (D <= 1400) return D;
  return 1400 + 420 * Math.log(D / 1400);
}

export function buildFlightPlan(opts: {
  seed: string;
  distanceMetres: number;
  power: number;       // 0..1 from the slingshot pull
  angle: number;       // 0..1 launch elevation
  style: FlightStyle;
  /** Surface under the flight line at route distance s (the world is deterministic, so this is too). */
  surfaceAt?: (s: number) => Surface;
}): FlightPlan {
  const surfaceAt = opts.surfaceAt ?? (() => 'asphalt' as Surface);
  const rng = new Rng(opts.seed + ':plan');
  const L = Math.max(1.5, worldLength(opts.distanceMetres));
  const unitsPerMetre = L / opts.distanceMetres;

  if (L < FUMBLE_L) return buildFumblePlan(rng, L, opts.power, unitsPerMetre);

  // How the flight ends. He always arrives with real speed: a sprawl ending then tumbles along
  // the ground, decelerating hard, for exactly the distance that speed carries; a dumpster or
  // hay truck stops him dead.
  const endRoll = rng.next();
  const ending: Ending = endRoll < 0.68 ? 'sprawl' : endRoll < 0.86 ? 'dumpster' : 'hay';
  const vEndFrac0 = ending === 'sprawl' ? rng.range(0.3, 0.48) : rng.range(0.22, 0.4);

  // Launch speed from the pull (visual flavour), nudged so the plan is never the degenerate
  // straight decay. He arrives at a fraction of it; for a sprawl, the ground tumble then carries
  // him exactly vLand²/(2·decel) further, where decel belongs to the surface he lands on.
  const vMax = 75;
  let v0 = (0.45 + 0.55 * opts.power) * vMax * (1 + rng.range(-0.22, 0.3));
  let vEndFrac = vEndFrac0;
  let decel = SURFACES.asphalt.decel;
  let surface: Surface = 'asphalt';
  let vLand = 0, dSkid = 0, L_air = L, T = 1;
  const tMin = 4, tMax = 46;
  const settle = () => {
    const at = (d: number) => {
      let vl = ending === 'sprawl' ? vEndFrac * v0 : 0;
      // never let the slide eat more than a third of the trip: arrive slower instead (still proportional)
      const vCap = Math.sqrt(2 * d * 0.33 * L);
      if (vl > vCap) vl = vCap;
      const ds = ending === 'sprawl' ? (vl * vl) / (2 * d) : 0;
      return { vl, ds, la: L - ds };
    };
    // the touchdown surface and the friction that decides where touchdown is must agree:
    // take the first surface whose own slide length lands him on it
    let chosen: Surface = surfaceAt(L - at(decel).ds);
    for (const c of [chosen, ...(Object.keys(SURFACES) as Surface[])]) {
      const r = at(SURFACES[c].decel);
      if (surfaceAt(r.la) === c) { chosen = c; break; }
    }
    surface = chosen;
    decel = SURFACES[surface].decel;
    const r = at(decel);
    vLand = r.vl; dSkid = r.ds; L_air = r.la; void dSkid;
    if (ending === 'sprawl' && v0 > 0) vEndFrac = vLand / v0;
    T = (2 * L_air) / (v0 * (1 + vEndFrac));
  };
  settle();
  if (T < tMin || T > tMax) {
    const Tc = Math.max(tMin, Math.min(tMax, T));
    v0 = (2 * L_air) / (Tc * (1 + vEndFrac));
    settle();
  }
  // a little mismatch between duration and mean speed is what the events exist to explain
  T = Math.max(tMin, Math.min(tMax, T * (1 + rng.range(-0.1, 0.14))));
  const tSkid = vLand / decel;

  // How many events? roughly one per 4 seconds, 1..9.
  const n = Math.max(1, Math.min(9, Math.round(T / 4.5 + rng.range(-0.5, 0.8))));
  const minGap = Math.min(1.4, T * 0.09);

  let events: PlanEvent[] = [];
  let k = (2 * v0) / T; // drag (world units / s^2); solved per attempt below
  let ok = false;
  for (let attempt = 0; attempt < 600 && !ok; attempt++) {
    // stratified placement inside the window so events are spread along the flight
    const times: number[] = [];
    const w0 = 0.2 * T, w1 = 0.86 * T, slot = (w1 - w0) / n;
    for (let i = 0; i < n; i++) times.push(w0 + slot * (i + rng.range(0.1, 0.9)));
    let spaced = true;
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] < minGap) spaced = false;
    if (!spaced) continue;
    // identify which index is the one we solve for: choose the one furthest from T/2
    let solveIdx = 0;
    for (let i = 1; i < n; i++) if (Math.abs(times[i] - T / 2) > Math.abs(times[solveIdx] - T / 2)) solveIdx = i;
    if (Math.abs(T / 2 - times[solveIdx]) < 0.08 * T) continue;

    const amp = 0.4 / Math.sqrt(Math.max(1, n / 3));
    const deltas: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) if (i !== solveIdx) deltas[i] = rng.range(-amp, amp) * v0 * (rng.chance(0.5) ? 1 : 0.6);

    // With drag k = (v0 + Σδ − vEnd)/T (so v(T) = vEnd), the distance constraint reduces to
    //   L = (v0 + vEnd)·T/2 + Σ δi·(T/2 − ti)
    const vEnd = vEndFrac * v0;
    let acc = 0;
    for (let i = 0; i < n; i++) if (i !== solveIdx) acc += deltas[i] * (T / 2 - times[i]);
    deltas[solveIdx] = (L_air - ((v0 + vEnd) * T) / 2 - acc) / (T / 2 - times[solveIdx]);
    const sum = deltas.reduce((a, b) => a + b, 0);
    const kk = (v0 + sum - vEnd) / T;
    if (kk <= 0) continue;

    // validate: v stays comfortably positive until T, deltas are readable but not absurd
    let v = v0, valid = true, prevT = 0;
    for (let i = 0; i < n; i++) {
      const vBefore = v - kk * (times[i] - prevT);
      if (vBefore <= 0.08 * v0) { valid = false; break; }
      v = vBefore + deltas[i];
      if (v <= 0.1 * v0 || v > 2.4 * v0) { valid = false; break; }
      if (Math.abs(deltas[i]) > 1.4 * v0 || Math.abs(deltas[i]) < 0.04 * v0) { valid = false; break; }
      prevT = times[i];
    }
    if (!valid) continue;
    const vAtEnd = v - kk * (T - prevT);
    if (Math.abs(vAtEnd - vEnd) > 1e-6 * v0 + 1e-9) continue;

    k = kk;
    events = times.map((t, i) => {
      const d = deltas[i];
      const lift = d > 0 ? rng.range(2, 6) : rng.range(-3, -1);
      return { t, s: 0, delta: d, kind: 'gulls' as EventKind, lift, x: rng.range(-0.6, 0.6) };
    });
    ok = true;
  }

  let vEndFinal = vEndFrac * v0;
  let skidT = ending === 'sprawl' ? tSkid : 0;
  if (!ok) {
    // Fallback: no events, linear decay to the touchdown speed, then the slide. Still ends exactly at L.
    events = [];
    v0 = (2 * L_air) / T - vEndFinal;
    if (v0 < 5) { v0 = (2 * L) / T; vEndFinal = 0; skidT = 0; vLand = 0; L_air = L; }
    k = (v0 - vEndFinal) / T;
  }
  const endingFinal: Ending = skidT > 0 || ending !== 'sprawl' ? ending : 'sprawl';
  const T_air = T;
  T += skidT;

  // ── horizontal: exact closed form, so the arrival point is exact
  //   air:    s(t) = v0·t − ½k·t² + Σ δj·(t − tj)⁺          v(t) = v0 − k·t + Σ δj
  //   ground: s = L_air + vLand·τ − ½·decel·τ²               v = vLand − decel·τ
  const dt = 1 / 60;
  const N = Math.ceil(T / dt) + 2;
  const sArr = new Float32Array(N);
  const vArr = new Float32Array(N);
  const hArr = new Float32Array(N);
  const vyArr = new Float32Array(N);
  const sAir = (t: number) => { let x = v0 * t - 0.5 * k * t * t; for (const e of events) if (t > e.t) x += e.delta * (t - e.t); return x; };
  const vAir = (t: number) => { let x = v0 - k * t; for (const e of events) if (t >= e.t) x += e.delta; return x; };
  for (let i = 0; i < N; i++) {
    const t = Math.min(i * dt, T);
    if (t <= T_air) { sArr[i] = sAir(t); vArr[i] = vAir(t); }
    else { const tau = Math.min(t - T_air, skidT); sArr[i] = L_air + vLand * tau - 0.5 * decel * tau * tau; vArr[i] = Math.max(0, vLand - decel * tau); }
  }
  for (const e of events) e.s = sAir(e.t);
  for (let i = 1; i < N; i++) sArr[i] = Math.min(L, Math.max(sArr[i - 1], sArr[i]));
  sArr[N - 1] = L; vArr[N - 1] = 0;

  // ── vertical: ONE gravity for the whole flight. The body follows true ballistic arcs between
  // contact points (the muzzle, any bounce pad, the touchdown). Aerial boosts and hits are instant
  // vertical kicks under that same gravity, and each arc is solved so it meets its next contact.
  const h0 = LAUNCH_H + 4.0;
  const peak = 2 + (8 + 16 * opts.angle) * Math.min(1, L / 150) + Math.min(40, L / 32);
  const landT = endingFinal === 'sprawl' ? T_air : T;
  const groundH = endingFinal === 'dumpster' ? 1.6 : endingFinal === 'hay' ? 2.6 : 0.05;
  const styleLift = opts.style === 'swoop' ? 1.2 : opts.style === 'flutter' ? 0.85 : 1;
  const pk = peak * styleLift;
  // the single-arc gravity for this flight, held inside a believable band; on long flights the
  // boosts make up the difference by kicking him back up (a hop-hop-hop across the sky)
  const qq = (Math.sqrt(pk) + Math.sqrt(pk + h0 - groundH)) / landT;
  const gBase = 2 * qq * qq;
  const G_LO = 1.6, G_HI = 5.5;
  const baseH = (t: number) => h0 + 2 * qq * Math.sqrt(pk) * t - qq * qq * t * t;

  // pick an object that suits the altitude of the plain arc at each event
  const groundOkFor = (idx: number, e: PlanEvent) => {
    const gapBefore = idx === 0 ? e.t : e.t - events[idx - 1].t;
    const gapAfter = idx === events.length - 1 ? landT - e.t : events[idx + 1].t - e.t;
    return gapBefore > 1.6 && gapAfter > 2.2 && e.t < landT - 2.5 && e.s >= STATIC_MIN_S;
  };
  // ground obstacles barely bounce him, so they only make sense as the last thing before touchdown
  const groundObstacleOk = (idx: number, e: PlanEvent) => idx === events.length - 1 && landT - e.t > 1.0 && landT - e.t < 3.2 && e.s >= STATIC_MIN_S;
  const pickKind = (idx: number, e: PlanEvent, h: number, avoid: EventKind | null, allowGround: boolean): EventKind => {
    const table = e.delta > 0 ? BOOSTS : OBSTACLES;
    const gOk = allowGround && (e.delta > 0 ? groundOkFor(idx, e) : groundObstacleOk(idx, e));
    const allowed = table.filter(o => (e.s >= STATIC_MIN_S || NEAR_OK.has(o.kind)) && (!o.ground || gOk));
    let options = allowed.filter(o => h >= o.minH && h <= o.maxH && o.kind !== avoid);
    if (!options.length) options = allowed.filter(o => h >= o.minH && h <= o.maxH);
    if (!options.length) options = allowed.filter(o => !o.ground && NEAR_OK.has(o.kind));
    if (!options.length) options = table.filter(o => !o.ground);
    const groundOpts = options.filter(o => o.ground);
    return (groundOpts.length && rng.chance(0.6) ? rng.pick(groundOpts) : rng.pick(options)).kind;
  };
  {
    let last: EventKind | null = null;
    events.forEach((e, idx) => { e.kind = pickKind(idx, e, baseH(e.t), last, true); last = e.kind; });
  }

  // kicks in units of g·seconds so they read the same at any gravity; boosts up, hits down
  const kickSeed = events.map(e => (e.delta > 0 ? rng.range(1.2, 2.2) : -rng.range(0.15, 0.4)));
  const reboundSeed = events.map(e => { const gk = GROUND_KINDS.get(e.kind); return gk ? rng.range(gk.rebound[0], gk.rebound[1]) : 0; });
  type Seg = { ta: number; ha: number; tb: number; hb: number; vy: number; kicks: { t: number; dv: number }[] };
  let g = gBase;
  const solve = (gg: number, kickScale: number): Seg[] | null => {
    const keys: { t: number; h: number; idx: number }[] = [{ t: 0, h: h0, idx: -1 }];
    events.forEach((e, j) => { const gk = GROUND_KINDS.get(e.kind); if (gk) keys.push({ t: e.t, h: gk.padH, idx: j }); });
    keys.push({ t: landT, h: groundH, idx: -2 });
    const segs: Seg[] = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1], D = b.t - a.t;
      const pos: { t: number; dv: number }[] = [], neg: { t: number; dv: number }[] = [];
      events.forEach((e, j) => {
        if (GROUND_KINDS.has(e.kind) || e.t <= a.t + 1e-6 || e.t >= b.t - 1e-6) return;
        const dv = kickSeed[j] * gg * kickScale;
        (dv > 0 ? pos : neg).push({ t: e.t, dv });
      });
      // the take-off speed we would like: the launch for the first arc, the pad's bounce afterwards
      const riseWanted = a.idx === -1 ? Math.min(pk, 45) : Math.max(2, reboundSeed[a.idx]);
      const vyWanted = Math.sqrt(2 * gg * riseWanted);
      let accPos = 0, accNeg = 0;
      for (const kk of pos) accPos += kk.dv * (b.t - kk.t);
      for (const kk of neg) accNeg += kk.dv * (b.t - kk.t);
      const need = b.h - a.h + 0.5 * gg * D * D - accNeg;          // = vy·D + λ·accPos
      let lambda = 1;
      let vy = (need - accPos) / D;
      if (vy > vyWanted && accPos > 1e-6) {
        // not enough lift from the boosts at this gravity: make them stronger rather than launching higher
        lambda = (need - vyWanted * D) / accPos;
        if (lambda * Math.max(...pos.map(kk => kk.dv / gg)) > 11) return null;
        vy = vyWanted;
      }
      segs.push({ ta: a.t, ha: a.h, tb: b.t, hb: b.h, vy, kicks: [...pos.map(kk => ({ t: kk.t, dv: kk.dv * lambda })), ...neg].sort((x, y) => x.t - y.t) });
    }
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      if (i === 0 && sg.vy < 2) return null;
      if (i > 0 && sg.vy < 1) return null;
      let vyEnd = sg.vy - gg * (sg.tb - sg.ta);
      for (const kk of sg.kicks) vyEnd += kk.dv;
      if (i < segs.length - 1 && vyEnd > -0.5) return null;
      for (let t = sg.ta + 0.3; t < sg.tb - 0.6; t += 0.1) {
        let h = sg.ha + sg.vy * (t - sg.ta) - 0.5 * gg * (t - sg.ta) * (t - sg.ta);
        for (const kk of sg.kicks) if (t > kk.t) h += kk.dv * (t - kk.t);
        if (h < 3 || h > 150) return null;
      }
    }
    return segs;
  };
  // try gravities inside the band first, drifting toward the single-arc value only if we must
  const gStart = Math.min(G_HI, Math.max(G_LO, gBase));
  const gCandidates: number[] = [];
  for (let i = 0; i <= 6; i++) gCandidates.push(gStart * Math.pow(gBase / gStart, i / 6));
  let segs: Seg[] | null = null;
  for (let pass = 0; pass < 3 && !segs; pass++) {
    for (const gg of gCandidates) {
      for (const ks of [1, 0.65, 0.4]) { segs = solve(gg, ks); if (segs) { g = gg; break; } }
      if (segs) break;
    }
    if (!segs) {
      // a bounce pad that cannot be reached cleanly becomes an aerial object instead
      const gi = events.findIndex(e => GROUND_KINDS.has(e.kind));
      if (gi < 0) break;
      events[gi].kind = pickKind(gi, events[gi], baseH(events[gi].t), null, false);
    }
  }
  if (!segs) {
    for (const e of events) if (GROUND_KINDS.has(e.kind)) e.kind = e.delta > 0 ? 'firework' : 'gulls';
    for (let j = 0; j < kickSeed.length; j++) kickSeed[j] = 0;
    g = gBase;
    segs = solve(gBase, 0)!;
  }
  const kickOf = new Map<number, number>();
  for (const sg of segs) for (const kk of sg.kicks) kickOf.set(kk.t, kk.dv);

  const hAirAt = (t: number): [number, number] => {
    const sg = segs!.find(x => t <= x.tb) ?? segs![segs!.length - 1];
    const u = Math.max(0, t - sg.ta);
    let h = sg.ha + sg.vy * u - 0.5 * g * u * u, vy = sg.vy - g * u;
    for (const kk of sg.kicks) if (t > kk.t) { h += kk.dv * (t - kk.t); vy += kk.dv; }
    return [h, vy];
  };
  // ground phase (sprawl): decaying hops whose first rebound comes from the impact speed and the surface
  const rest = SURFACES[surface].restitution;
  const [, vyTouch] = hAirAt(landT);
  const hops: { t0: number; vy: number }[] = [];
  if (endingFinal === 'sprawl' && skidT > 0) {
    let vyUp = Math.min(Math.sqrt(2 * HOP_G * 1.2), rest * Math.abs(vyTouch) * 0.6 + rest * vLand * 0.25);
    let t0 = landT;
    while (vyUp > 0.6 && t0 < T) { hops.push({ t0, vy: vyUp }); t0 += (2 * vyUp) / HOP_G; vyUp *= rest * 2.2; }
  }
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    if (t <= landT) { const [h, vy] = hAirAt(t); hArr[i] = Math.max(groundH, h); vyArr[i] = vy; }
    else {
      let h = groundH, vy = 0;
      for (const hp of hops) { const u = t - hp.t0, d = (2 * hp.vy) / HOP_G; if (u >= 0 && u < d) { h = groundH + hp.vy * u - 0.5 * HOP_G * u * u; vy = hp.vy - HOP_G * u; } }
      hArr[i] = h; vyArr[i] = vy;
    }
  }
  // record each event's actual altitude and kick, and re-pick any aerial object that no longer suits it
  events.forEach((e, idx) => {
    const gk = GROUND_KINDS.get(e.kind);
    if (gk) { e.lift = hAirAt(e.t + 0.01)[1]; return; }
    const h = hAirAt(e.t)[0];
    const band = [...BOOSTS, ...OBSTACLES].find(o => o.kind === e.kind)!;
    if (h < band.minH || h > band.maxH) e.kind = pickKind(idx, e, h, null, false);
    e.lift = kickOf.get(e.t) ?? 0;
  });

  // The ending object sits exactly at the finish line.
  if (endingFinal !== 'sprawl') events.push({ t: T, s: L, delta: 0, kind: endingFinal, lift: 0, x: 0 });

  const tuckTime = 0.55 + 0.35 * opts.power;
  return { L, T, v0, events, dt, s: sArr, v: vArr, h: hArr, vy: vyArr, g, surface, landT, unitsPerMetre, fumble: null, ending: endingFinal, tuckTime };
}

/**
 * A fumbled launch: the plane leaves the band at full speed, catches an edge
 * (or folds, or meets a gust) within the first second, tumbles and drops. No
 * obstacles are needed, so nothing has to be spawned in front of the player.
 */
function buildFumblePlan(rng: Rng, L: number, power: number, unitsPerMetre: number): FlightPlan {
  const kind = rng.pick<FumbleKind>(['fizzle', 'rim', 'gust', 'spinout']);
  const v0 = (0.45 + 0.55 * power) * 75;
  // speed: brief full-speed burst, then a hard brake while tumbling, then a skid to exactly L
  const T = Math.max(2.6, Math.min(4.5, 1.2 + L / 18));
  const dt = 1 / 60;
  const N = Math.ceil(T / dt) + 2;
  const sArr = new Float32Array(N), vArr = new Float32Array(N), hArr = new Float32Array(N);
  const tBurst = Math.min(0.35, T * 0.12);
  const landT = Math.min(T * 0.66, 2.0);
  // shape v(t): v0 during the burst, exponential-ish decay to the touchdown, then linear skid to zero at T.
  // Scale the whole curve so the integral is exactly L.
  const raw = new Float32Array(N);
  let integral = 0;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    let v: number;
    if (t < tBurst) v = v0;
    else if (t < landT) v = v0 * Math.exp(-(t - tBurst) * 3.2);
    else v = v0 * Math.exp(-(landT - tBurst) * 3.2) * Math.max(0, 1 - (t - landT) / (T - landT));
    raw[i] = v;
    if (i > 0) integral += (raw[i - 1] + raw[i]) / 2 * dt;
  }
  const k = L / Math.max(1e-6, integral);
  let s = 0;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    vArr[i] = t >= T ? 0 : raw[i] * k;
    sArr[i] = Math.min(L, s);
    if (i < N - 1) s += (raw[i] + raw[i + 1]) / 2 * dt * k;
  }
  sArr[N - 1] = L; vArr[N - 1] = 0;
  // height: a short hop up, then a tumble to the ground
  const peak = kind === 'fizzle' ? 1.2 : 3.5 + power * 2;
  const h0 = LAUNCH_H + 4.0;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    let h: number;
    if (t < landT) {
      const u = t / landT;
      // brief hop, then it tumbles off the roof and drops to the street
      h = h0 * (1 - u) * (1 - u) + peak * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u);
    } else h = 0.05;
    hArr[i] = Math.max(0.05, h);
  }
  const vyArr = new Float32Array(N);
  for (let i = 1; i < N; i++) vyArr[i] = (hArr[i] - hArr[i - 1]) / dt;
  vyArr[0] = vyArr[1];
  return { L, T, v0: v0 * k, events: [], dt, s: sArr, v: vArr, h: hArr, vy: vyArr, g: 9, surface: 'asphalt', landT, unitsPerMetre, fumble: kind, ending: 'sprawl', tuckTime: 0.4 };
}

export function sampleAt(arr: Float32Array, dt: number, t: number): number {
  const i = t / dt;
  const i0 = Math.floor(i);
  if (i0 >= arr.length - 1) return arr[arr.length - 1];
  if (i0 < 0) return arr[0];
  const f = i - i0;
  return arr[i0] * (1 - f) + arr[i0 + 1] * f;
}
