/**
 * Flight plan: a deterministic, pre-computed trajectory that ends exactly at
 * the resolved distance. The visible "physics" (boost pads, obstacles, gusts)
 * are placed to explain the speed profile, never to decide it.
 *
 * Playback happens in plan time (tau). Player boosts only change the rate at
 * which tau advances, so the end point is untouchable.
 */
import { Rng } from '../core/rng';
import type { FlightStyle } from '../data/planes';

export type EventKind =
  | 'vent' | 'fountain' | 'burner' | 'firework' | 'jetwash' | 'thermal'                       // boosts
  | 'gulls' | 'pigeons' | 'hotair' | 'propplane' | 'blimp' | 'crane' | 'billboard' | 'bunting'  // obstacles
  | 'kite' | 'drone' | 'raincloud';

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
}

/** Boost / obstacle kinds, with the altitude band each one makes sense at. */
const BOOSTS: { kind: EventKind; minH: number; maxH: number }[] = [
  { kind: 'vent', minH: 0, maxH: 18 },
  { kind: 'fountain', minH: 0, maxH: 26 },
  { kind: 'thermal', minH: 0, maxH: 40 },
  { kind: 'burner', minH: 12, maxH: 999 },
  { kind: 'firework', minH: 8, maxH: 999 },
  { kind: 'jetwash', minH: 20, maxH: 999 },
];
const OBSTACLES: { kind: EventKind; minH: number; maxH: number }[] = [
  { kind: 'bunting', minH: 0, maxH: 11 },
  { kind: 'pigeons', minH: 3, maxH: 16 },
  { kind: 'kite', minH: 4, maxH: 40 },
  { kind: 'billboard', minH: 6, maxH: 30 },
  { kind: 'crane', minH: 8, maxH: 45 },
  { kind: 'drone', minH: 4, maxH: 999 },
  { kind: 'gulls', minH: 6, maxH: 999 },
  { kind: 'hotair', minH: 14, maxH: 999 },
  { kind: 'propplane', minH: 14, maxH: 999 },
  { kind: 'raincloud', minH: 18, maxH: 999 },
  { kind: 'blimp', minH: 24, maxH: 999 },
];

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

  // Launch speed from the pull (visual flavour). Duration follows from it so
  // that a plain linear decay would stop exactly at L.
  const vMax = 75;
  let v0 = (0.45 + 0.55 * opts.power) * vMax;
  let T = (2 * L) / v0;
  const tMin = 4, tMax = 58;
  if (T < tMin) { T = tMin; v0 = (2 * L) / T; }
  if (T > tMax) { T = tMax; v0 = (2 * L) / T; }
  // Nudge the launch speed so the plan is never the degenerate straight decay.
  v0 *= 1 + rng.range(-0.22, 0.3);

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

    // With drag k = (v0 + Σδ)/T (so v(T) = 0), the distance constraint reduces to
    //   L = v0·T/2 + Σ δi·(T/2 − ti)
    let acc = 0;
    for (let i = 0; i < n; i++) if (i !== solveIdx) acc += deltas[i] * (T / 2 - times[i]);
    deltas[solveIdx] = (L - (v0 * T) / 2 - acc) / (T / 2 - times[solveIdx]);
    const sum = deltas.reduce((a, b) => a + b, 0);
    const kk = (v0 + sum) / T;
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
    const vEnd = v - kk * (T - prevT);
    if (Math.abs(vEnd) > 1e-6 * v0 + 1e-9) continue;

    k = kk;
    events = times.map((t, i) => {
      const d = deltas[i];
      const lift = d > 0 ? rng.range(2, 6) : rng.range(-3, -1);
      return { t, s: 0, delta: d, kind: 'gulls' as EventKind, lift, x: rng.range(-0.6, 0.6) };
    });
    ok = true;
  }

  if (!ok) {
    // Fallback: no events, pure linear decay. Still ends exactly at L.
    events = [];
    k = (2 * v0) / T;
    v0 = (2 * L) / T;
    k = v0 / T;
  }

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
    v = Math.max(0, v - k * dt);
    s += v * dt;
    if (s > L) s = L;
  }
  while (ei < events.length) { events[ei].s = L; ei++; }
  sArr[N - 1] = L; vArr[N - 1] = 0;

  // Height profile: a smooth arc plus bumps at events, touching down just before the end.
  const h0 = 1.8;
  const peak = 4 + (8 + 16 * opts.angle) * Math.min(1, L / 150) + Math.min(48, L / 28);
  const landT = Math.max(T * 0.86, T - 1.8);
  const styleLift = opts.style === 'swoop' ? 1.25 : opts.style === 'flutter' ? 0.8 : 1;
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    const u = Math.min(1, t / T);
    let h = h0 + peak * Math.sin(Math.PI * Math.min(1, u * 1.08)) * styleLift;
    for (const e of events) {
      const dtE = t - e.t;
      if (dtE > 0 && dtE < 3) {
        const w = Math.sin(Math.PI * dtE / 3);
        h += e.lift * w;
      }
    }
    if (t > landT) {
      const q = Math.min(1, (t - landT) / Math.max(0.01, T - landT));
      const ease = 1 - Math.pow(1 - q, 2);
      const groundH = 0.3;
      h = h * (1 - ease) + groundH * ease;
    }
    hArr[i] = Math.max(0.3, h);
  }
  // make sure the glide into the landing is smooth: blend last airborne second downward
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    if (t > landT - 2 && t <= landT) {
      const q = (t - (landT - 2)) / 2;
      const target = hArr[Math.min(N - 1, Math.round(landT / dt))];
      hArr[i] = hArr[i] * (1 - q * q * 0.5) + target * q * q * 0.5;
    }
  }

  // Now that the height profile exists, pick an object that makes sense at each event's altitude.
  let lastKind: EventKind | null = null;
  for (const e of events) {
    const h = hArr[Math.min(N - 1, Math.round(e.t / dt))];
    const table = e.delta > 0 ? BOOSTS : OBSTACLES;
    let options = table.filter(o => h >= o.minH && h <= o.maxH && o.kind !== lastKind);
    if (!options.length) options = table.filter(o => h >= o.minH && h <= o.maxH);
    if (!options.length) options = table;
    e.kind = rng.pick(options).kind;
    lastKind = e.kind;
  }

  return { L, T, v0, events, dt, s: sArr, v: vArr, h: hArr, landT, unitsPerMetre };
}

export function sampleAt(arr: Float32Array, dt: number, t: number): number {
  const i = t / dt;
  const i0 = Math.floor(i);
  if (i0 >= arr.length - 1) return arr[arr.length - 1];
  if (i0 < 0) return arr[0];
  const f = i - i0;
  return arr[i0] * (1 - f) + arr[i0 + 1] * f;
}
