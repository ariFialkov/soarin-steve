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
  /** the stuntman who flies at this stake */
  character: string;
  stake: number;           // fixed stake for this tier (currency units)
  baseDistance: number;    // distance in metres that corresponds to a 1.00x result
  maxMultiplier: number;   // the largest multiplier the distribution can produce
  /** Multiplier buckets: probability mass and [lo, hi) multiplier range before RTP scaling. */
  buckets: { p: number; lo: number; hi: number }[];
  accent: string;
}

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  // Loss buckets sit near the middle (few big losses, almost no misfires) and the tables are built so
  // their raw expectation is already close to the RTP, so rescaling does not crush every loss to zero.
  easy: {
    label: 'Rookie',
    character: "Soarin' Steve",
    stake: 1,
    baseDistance: 630,
    maxMultiplier: 20,
    accent: '#7bc96f',
    buckets: [
      { p: 0.05, lo: 0.3, hi: 0.45 },
      { p: 0.30, lo: 0.45, hi: 0.8 },
      { p: 0.30, lo: 0.8, hi: 1.0 },
      { p: 0.24, lo: 1.0, hi: 1.6 },
      { p: 0.08, lo: 1.6, hi: 3 },
      { p: 0.025, lo: 3, hi: 8 },
      { p: 0.005, lo: 8, hi: 20 },
    ],
  },
  medium: {
    label: 'Pro',
    character: 'Cannonball Chris',
    stake: 5,
    baseDistance: 930,
    maxMultiplier: 50,
    accent: '#5fb8e6',
    buckets: [
      { p: 0.06, lo: 0.25, hi: 0.45 },
      { p: 0.31, lo: 0.45, hi: 0.8 },
      { p: 0.29, lo: 0.8, hi: 1.0 },
      { p: 0.22, lo: 1.0, hi: 1.6 },
      { p: 0.085, lo: 1.6, hi: 3.5 },
      { p: 0.025, lo: 3.5, hi: 10 },
      { p: 0.007, lo: 10, hi: 30 },
      { p: 0.0012, lo: 30, hi: 50 },
    ],
  },
  hard: {
    label: 'Daredevil',
    character: 'Projectile Pete',
    stake: 20,
    baseDistance: 1320,
    maxMultiplier: 150,
    accent: '#f3a35c',
    buckets: [
      { p: 0.08, lo: 0.2, hi: 0.45 },
      { p: 0.32, lo: 0.45, hi: 0.8 },
      { p: 0.28, lo: 0.8, hi: 1.0 },
      { p: 0.20, lo: 1.0, hi: 1.5 },
      { p: 0.075, lo: 1.5, hi: 3 },
      { p: 0.025, lo: 3, hi: 10 },
      { p: 0.006, lo: 10, hi: 40 },
      { p: 0.0012, lo: 40, hi: 90 },
      { p: 0.0003, lo: 90, hi: 150 },
    ],
  },
  expert: {
    label: 'Legend',
    character: 'Heatseeker Hank',
    stake: 100,
    baseDistance: 1800,
    maxMultiplier: 500,
    accent: '#e5679a',
    buckets: [
      { p: 0.10, lo: 0.15, hi: 0.42 },
      { p: 0.32, lo: 0.42, hi: 0.8 },
      { p: 0.27, lo: 0.8, hi: 1.0 },
      { p: 0.19, lo: 1.0, hi: 1.5 },
      { p: 0.075, lo: 1.5, hi: 3 },
      { p: 0.025, lo: 3, hi: 10 },
      { p: 0.006, lo: 10, hi: 40 },
      { p: 0.0012, lo: 40, hi: 120 },
      { p: 0.0003, lo: 120, hi: 300 },
      { p: 0.00008, lo: 300, hi: 500 },
    ],
  },
};

export type BoostKind = 'blower' | 'confetti' | 'rockets';

export interface BoostConfig {
  label: string;
  unit: string;       // what one purchase represents
  price: number;      // price per unit, as a fraction of the tier stake
  max: number;        // maximum units that can be carried into a round
  blurb: string;
}

export const BOOST_CONFIG: Record<BoostKind, BoostConfig> = {
  blower: {
    label: 'Leaf Blower',
    unit: 'second',
    price: 0.1,
    max: 10,
    blurb: 'Hold it behind Steve to blow him along. Under him lifts him, off to one side nudges him over.',
  },
  confetti: {
    label: 'Confetti Cannon',
    unit: 'shot',
    price: 0.25,
    max: 6,
    blurb: 'One big circus pop. Fire it behind Steve for a shove; slightly underneath for a bit of lift too.',
  },
  rockets: {
    label: 'Bottle Rockets',
    unit: 'rocket',
    price: 0.2,
    max: 6,
    blurb: 'Strapped to his backpack before the show. Light them one at a time, or all at once if you dare.',
  },
};

export const WALLET_START = 1000;

const RTP_KEY = 'soarinsteve.rtp';
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
