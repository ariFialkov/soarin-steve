/**
 * Game configuration. Everything that an operator would want to tune lives here.
 *
 * RTP (return to player) is the long-run expected payout per unit wagered.
 * It can be overridden at runtime through `setRtp()` (persisted in localStorage)
 * or with a `?rtp=0.95` query parameter, which is handy for testing.
 */
export type Tier = 'easy' | 'medium' | 'hard' | 'expert';

export const TIERS: Tier[] = ['easy', 'medium', 'hard', 'expert'];

export interface TierConfig {
  label: string;
  stake: number;           // fixed stake for this tier (currency units)
  baseDistance: number;    // distance in metres that corresponds to a 1.00x result
  maxMultiplier: number;   // the largest multiplier the distribution can produce
  /** Multiplier buckets: probability mass and [lo, hi) multiplier range before RTP scaling. */
  buckets: { p: number; lo: number; hi: number }[];
  accent: string;
}

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  easy: {
    label: 'Easy',
    stake: 1,
    baseDistance: 60,
    maxMultiplier: 20,
    accent: '#7bc96f',
    buckets: [
      { p: 0.28, lo: 0.15, hi: 0.6 },
      { p: 0.30, lo: 0.6, hi: 1.0 },
      { p: 0.27, lo: 1.0, hi: 2.0 },
      { p: 0.11, lo: 2.0, hi: 5.0 },
      { p: 0.04, lo: 5.0, hi: 20 },
    ],
  },
  medium: {
    label: 'Medium',
    stake: 5,
    baseDistance: 90,
    maxMultiplier: 50,
    accent: '#5fb8e6',
    buckets: [
      { p: 0.34, lo: 0.1, hi: 0.6 },
      { p: 0.26, lo: 0.6, hi: 1.0 },
      { p: 0.25, lo: 1.0, hi: 2.5 },
      { p: 0.11, lo: 2.5, hi: 8 },
      { p: 0.035, lo: 8, hi: 20 },
      { p: 0.005, lo: 20, hi: 50 },
    ],
  },
  hard: {
    label: 'Hard',
    stake: 20,
    baseDistance: 130,
    maxMultiplier: 150,
    accent: '#f3a35c',
    buckets: [
      { p: 0.40, lo: 0.05, hi: 0.5 },
      { p: 0.22, lo: 0.5, hi: 1.0 },
      { p: 0.22, lo: 1.0, hi: 3 },
      { p: 0.11, lo: 3, hi: 10 },
      { p: 0.04, lo: 10, hi: 40 },
      { p: 0.01, lo: 40, hi: 150 },
    ],
  },
  expert: {
    label: 'Expert',
    stake: 100,
    baseDistance: 180,
    maxMultiplier: 500,
    accent: '#e5679a',
    buckets: [
      { p: 0.46, lo: 0.0, hi: 0.5 },
      { p: 0.19, lo: 0.5, hi: 1.0 },
      { p: 0.19, lo: 1.0, hi: 3 },
      { p: 0.10, lo: 3, hi: 12 },
      { p: 0.045, lo: 12, hi: 60 },
      { p: 0.015, lo: 60, hi: 500 },
    ],
  },
};

export type BoostKind = 'fan' | 'confetti' | 'sparkler';

export interface BoostConfig {
  label: string;
  unit: string;       // what one purchase represents
  price: number;      // price per unit, as a fraction of the tier stake
  max: number;        // maximum units that can be carried into a round
  blurb: string;
}

export const BOOST_CONFIG: Record<BoostKind, BoostConfig> = {
  fan: {
    label: 'Handheld Fan',
    unit: 'second',
    price: 0.1,
    max: 10,
    blurb: 'Hold it behind your plane to blow it along. Under the plane lifts it, off to one side nudges it over.',
  },
  confetti: {
    label: 'Confetti Cannon',
    unit: 'shot',
    price: 0.25,
    max: 6,
    blurb: 'One big pop. Fire it behind the plane for a shove; slightly underneath for a bit of lift too.',
  },
  sparkler: {
    label: 'Sparkler',
    unit: 'sparkler',
    price: 0.2,
    max: 6,
    blurb: 'Strapped to the tail like tiny rockets. Light them one at a time, or all at once if you dare.',
  },
};

export const WALLET_START = 1000;

const RTP_KEY = 'paperplanes.rtp';
const DEFAULT_RTP = 0.96;

export function getRtp(): number {
  try {
    const q = new URLSearchParams(location.search).get('rtp');
    if (q && isFinite(+q) && +q > 0 && +q <= 1) return +q;
    const stored = localStorage.getItem(RTP_KEY);
    if (stored && isFinite(+stored) && +stored > 0 && +stored <= 1) return +stored;
  } catch { /* ignore */ }
  return DEFAULT_RTP;
}

export function setRtp(v: number): void {
  try { localStorage.setItem(RTP_KEY, String(v)); } catch { /* ignore */ }
}
