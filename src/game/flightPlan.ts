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
  { kind: 'trampoline', minH: 0, maxH: 42, ground: { padH: 1.3, rebound: [9, 16] } },
  { kind: 'castle', minH: 0, maxH: 42, ground: { padH: 3.6, rebound: [7, 13] } },
  { kind: 'tyres', minH: 0, maxH: 36, ground: { padH: 1.6, rebound: [6, 11] } },
  { kind: 'bigfan', minH: 0, maxH: 44, ground: { padH: 2.4, rebound: [10, 18] } },
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
  { kind: 'cones', minH: 0, maxH: 34, ground: { padH: 0.9, rebound: [1.5, 3] } },
  { kind: 'hotdog', minH: 0, maxH: 36, ground: { padH: 1.8, rebound: [2, 4] } },
  { kind: 'mattress', minH: 0, maxH: 38, ground: { padH: 0.9, rebound: [1, 2.5] } },
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
}): FlightPlan {
  const rng = new Rng(opts.seed + ':plan');
  const L = Math.max(1.5, worldLength(opts.distanceMetres));
  const unitsPerMetre = L / opts.distanceMetres;

  if (L < FUMBLE_L) return buildFumblePlan(rng, L, opts.power, unitsPerMetre);

  // How the flight ends. He always arrives with real speed: a sprawl ending then tumbles along
  // the ground, decelerating hard, for exactly the distance that speed carries; a dumpster or
  // hay truck stops him dead.
  const endRoll = rng.next();
  const ending: Ending = endRoll < 0.68 ? 'sprawl' : endRoll < 0.86 ? 'dumpster' : 'hay';
  const vEndFrac = ending === 'sprawl' ? rng.range(0.3, 0.48) : rng.range(0.22, 0.4);
  const GROUND_DECEL = 15;   // world units / s² while tumbling on the pavement

  // Launch speed from the pull (visual flavour), nudged so the plan is never the degenerate
  // straight decay. The end speed is a fraction of it; the ground tumble distance follows.
  const vMax = 75;
  let v0 = (0.45 + 0.55 * opts.power) * vMax * (1 + rng.range(-0.22, 0.3));
  let vLand = ending === 'sprawl' ? vEndFrac * v0 : 0;
  let dSkid = ending === 'sprawl' ? Math.min(L * 0.45, (vLand * vLand) / (2 * GROUND_DECEL)) : 0;
  let L_air = L - dSkid;
  // the air phase decays linearly from v0 to the end speed, so its duration is set by the mean speed
  const vEnd0 = vEndFrac * v0;
  let T = (2 * L_air) / (v0 + vEnd0);
  const tMin = 4, tMax = 58;
  if (T < tMin || T > tMax) {
    T = Math.max(tMin, Math.min(tMax, T));
    // keep the end-speed ratio and solve the launch speed for the clamped duration
    v0 = (2 * L) / (T * (1 + vEndFrac));
    vLand = ending === 'sprawl' ? vEndFrac * v0 : 0;
    dSkid = ending === 'sprawl' ? Math.min(L * 0.45, (vLand * vLand) / (2 * GROUND_DECEL)) : 0;
    L_air = L - dSkid;
    T = (2 * L_air) / (v0 + vEndFrac * v0);
  }
  // a little mismatch between duration and mean speed is what the events exist to explain
  T = Math.max(tMin, Math.min(tMax, T * (1 + rng.range(-0.1, 0.14))));
  const tSkid = vLand / GROUND_DECEL;

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
  let skidT = ending === 'sprawl' ? tSkid : 0, skidD = ending === 'sprawl' ? dSkid : 0;
  if (!ok) {
    // Fallback: no events, linear decay to the touchdown speed, then the skid. Still ends exactly at L.
    events = [];
    v0 = (2 * L_air) / T - vEndFinal;
    if (v0 < 5) { v0 = (2 * L) / T; vEndFinal = 0; skidT = 0; skidD = 0; }
    k = (v0 - vEndFinal) / T;
  }
  const endingFinal: Ending = ok ? ending : (skidT > 0 ? 'sprawl' : 'sprawl');
  const T_air = T;
  const L_airFinal = L - skidD;
  T += skidT;

  // Sample s(t), v(t)
  const dt = 1 / 60;
  const N = Math.ceil(T / dt) + 2;
  const sArr = new Float32Array(N);
  const vArr = new Float32Array(N);
  const hArr = new Float32Array(N);
  let s = 0, v = v0, ei = 0;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    while (ei < events.length && events[ei].t <= t) { v += events[ei].delta; events[ei].s = s; ei++; }
    if (t >= T) { v = 0; s = L; }
    sArr[i] = s; vArr[i] = v;
    if (t < T_air) {
      v = Math.max(vEndFinal, v - k * dt);
      s += v * dt;
      if (s > L_airFinal) s = L_airFinal;
    } else {
      // on the ground: hard deceleration, the skid distance was budgeted into L
      v = Math.max(0, v - GROUND_DECEL * dt);
      s += v * dt;
      if (s > L) s = L;
    }
  }
  while (ei < events.length) { events[ei].s = L; ei++; }
  // tidy the tail so the tumble ends exactly on the line
  if (skidD > 0) {
    const iAir = Math.min(N - 1, Math.round(T_air / dt));
    const sAir = sArr[iAir];
    for (let i = iAir; i < N; i++) {
      const q = Math.min(1, (i * dt - T_air) / Math.max(1e-6, T - T_air));
      sArr[i] = sAir + (L - sAir) * (1 - (1 - q) * (1 - q));
    }
  }
  for (let i = 1; i < N; i++) sArr[i] = Math.min(L, Math.max(sArr[i - 1], sArr[i]));
  sArr[N - 1] = L; vArr[N - 1] = 0;

  // Height profile: one clean ballistic parabola from the muzzle over the apex to the touchdown.
  // Aerial events add parabolic bumps (a vertical kick that gravity brings back), ground events
  // dive to the pad and bounce. Everything is relative to the ground under the route.
  const h0 = LAUNCH_H + 3.6;
  const peak = 2 + (8 + 16 * opts.angle) * Math.min(1, L / 150) + Math.min(40, L / 32);
  const landT = endingFinal === 'sprawl' ? T_air : T;
  const groundH = endingFinal === 'dumpster' ? 1.6 : endingFinal === 'hay' ? 2.6 : 0.3;
  const styleLift = opts.style === 'swoop' ? 1.2 : opts.style === 'flutter' ? 0.85 : 1;
  // parabola h(t) = h0 + b t - q² t² with apex h0 + peak·styleLift and h(landT) = groundH
  const pk = peak * styleLift;
  const q = (Math.sqrt(pk) + Math.sqrt(pk + h0 - groundH)) / landT;
  const bq = 2 * q * Math.sqrt(pk);
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    let h: number;
    if (t <= landT) h = h0 + bq * t - q * q * t * t;
    else h = groundH;
    hArr[i] = Math.max(groundH, h);
  }
  if (endingFinal === 'sprawl') for (let i = 0; i < N; i++) if (i * dt > landT) hArr[i] = 0.3;

  // Now that the height profile exists, pick an object that makes sense at each event's altitude.
  let lastKind: EventKind | null = null;
  events.forEach((e, idx) => {
    const h = hArr[Math.min(N - 1, Math.round(e.t / dt))];
    const gapBefore = idx === 0 ? e.t : e.t - events[idx - 1].t;
    const gapAfter = idx === events.length - 1 ? landT - e.t : events[idx + 1].t - e.t;
    const groundOk = gapBefore > 1.6 && gapAfter > 2.2 && e.t < landT - 2.5 && e.s >= STATIC_MIN_S;
    const table = e.delta > 0 ? BOOSTS : OBSTACLES;
    const allowed = table.filter(o => (e.s >= STATIC_MIN_S || NEAR_OK.has(o.kind)) && (!o.ground || groundOk));
    let options = allowed.filter(o => h >= o.minH && h <= o.maxH && o.kind !== lastKind);
    if (!options.length) options = allowed.filter(o => h >= o.minH && h <= o.maxH);
    if (!options.length) options = allowed.filter(o => NEAR_OK.has(o.kind));
    // ground kinds get a bias so they show up reasonably often when the altitude allows
    const groundOpts = options.filter(o => o.ground);
    e.kind = (groundOpts.length && rng.chance(0.7) ? rng.pick(groundOpts) : rng.pick(options)).kind;
    lastKind = e.kind;
  });

  // Aerial events: a vertical kick that gravity brings back (a small parabolic bump, up or down).
  const base = Float32Array.from(hArr);
  events.forEach(e => {
    if (GROUND_KINDS.has(e.kind)) return;
    const dur = e.delta > 0 ? 3.2 : 2.4;
    const amp = e.delta > 0 ? rng.range(2.5, 5.5) : -rng.range(1.2, 2.6);
    e.lift = amp;
    const i0 = Math.max(0, Math.floor(e.t / dt)), i1 = Math.min(N - 1, Math.ceil((e.t + dur) / dt));
    for (let i = i0; i <= i1; i++) {
      const q2 = (i * dt - e.t) / dur;           // 0..1
      const bump = 4 * q2 * (1 - q2);             // parabola, 0 at both ends, 1 in the middle
      hArr[i] = Math.max(groundH, hArr[i] + amp * bump);
    }
  });

  // Ground events: dive to the pad and bounce back up (boosts high, obstacles barely).
  events.forEach((e, idx) => {
    const g = GROUND_KINDS.get(e.kind);
    if (!g) return;
    const gapBefore = idx === 0 ? e.t : e.t - events[idx - 1].t;
    const gapAfter = idx === events.length - 1 ? landT - e.t : events[idx + 1].t - e.t;
    const hAt = base[Math.min(N - 1, Math.round(e.t / dt))];
    const wb = Math.min(0.45 * gapBefore, Math.max(0.8, Math.min(2.2, 0.7 + hAt / 18)));
    const wa = Math.min(0.45 * gapAfter, 1.4);
    const rebound = rng.range(g.rebound[0], g.rebound[1]);
    e.lift = rebound;
    const i0 = Math.max(0, Math.floor((e.t - wb) / dt)), i1 = Math.min(N - 1, Math.ceil((e.t + wa) / dt));
    const hStart = hArr[i0], hEnd = hArr[i1];
    for (let i = i0; i <= i1; i++) {
      const t = i * dt;
      if (t <= e.t) {
        // dive: a parabola from hStart (level) down to the pad
        const q2 = Math.min(1, Math.max(0, (t - (e.t - wb)) / wb));
        hArr[i] = hStart + (g.padH - hStart) * q2 * q2;
      } else {
        // bounce: launched up off the pad, gravity brings it back to the base line
        const q2 = Math.min(1, (t - e.t) / wa);
        hArr[i] = g.padH + (hEnd - g.padH) * q2 + rebound * 4 * q2 * (1 - q2);
      }
    }
  });

  // The ending object sits exactly at the finish line.
  if (endingFinal !== 'sprawl') events.push({ t: T, s: L, delta: 0, kind: endingFinal, lift: 0, x: 0 });

  const tuckTime = 0.55 + 0.35 * opts.power;
  return { L, T, v0, events, dt, s: sArr, v: vArr, h: hArr, landT, unitsPerMetre, fumble: null, ending: endingFinal, tuckTime };
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
  const h0 = LAUNCH_H + 3.6;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    let h: number;
    if (t < landT) {
      const u = t / landT;
      // brief hop, then it tumbles off the roof and drops to the street
      h = h0 * (1 - u) * (1 - u) + peak * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u);
    } else h = 0.3;
    hArr[i] = Math.max(0.3, h);
  }
  return { L, T, v0: v0 * k, events: [], dt, s: sArr, v: vArr, h: hArr, landT, unitsPerMetre, fumble: kind, ending: 'sprawl', tuckTime: 0.4 };
}

export function sampleAt(arr: Float32Array, dt: number, t: number): number {
  const i = t / dt;
  const i0 = Math.floor(i);
  if (i0 >= arr.length - 1) return arr[arr.length - 1];
  if (i0 < 0) return arr[0];
  const f = i - i0;
  return arr[i0] * (1 - f) + arr[i0 + 1] * f;
}
