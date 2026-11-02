/**
 * Pure outcome maths. Given a tier and a uniform random number this
 * produces the round multiplier. The bucket table defines the *shape* of
 * the distribution; the whole table is then scaled so that the expected
 * multiplier is exactly the configured RTP. Nothing on screen can change it.
 */
import { TIER_CONFIG, type Tier } from './config';

export interface Outcome {
  multiplier: number;  // payout / total wager
  distance: number;    // metres, what the plane will visibly travel
}

/** Expected multiplier of the raw (unscaled) bucket table. */
export function rawExpectation(tier: Tier): number {
  const cfg = TIER_CONFIG[tier];
  let ev = 0;
  let mass = 0;
  for (const b of cfg.buckets) {
    ev += b.p * (b.lo + b.hi) / 2;
    mass += b.p;
  }
  return ev / mass;
}

/** Map a uniform u in [0,1) to a raw multiplier using the bucket table. */
export function rawMultiplier(tier: Tier, u: number): number {
  const cfg = TIER_CONFIG[tier];
  const total = cfg.buckets.reduce((a, b) => a + b.p, 0);
  let acc = 0;
  for (const b of cfg.buckets) {
    const p = b.p / total;
    if (u < acc + p) {
      const t = (u - acc) / p;
      return b.lo + (b.hi - b.lo) * t;
    }
    acc += p;
  }
  const last = cfg.buckets[cfg.buckets.length - 1];
  return last.hi;
}

/** Final multiplier, scaled so E[multiplier] === rtp. Rounded to cents at payout time. */
export function multiplierFor(tier: Tier, u: number, rtp: number): number {
  const scale = rtp / rawExpectation(tier);
  return rawMultiplier(tier, u) * scale;
}

export function resolveOutcome(tier: Tier, u: number, rtp: number): Outcome {
  const cfg = TIER_CONFIG[tier];
  const multiplier = multiplierFor(tier, u, rtp);
  const distance = multiplier * cfg.baseDistance;
  return { multiplier, distance };
}
