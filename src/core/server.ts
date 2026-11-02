/**
 * Mock game server.
 *
 * This module is the single place where money and outcomes are decided.
 * It is written to look like a remote API (async, request/response, opaque
 * round ids, hashed server seeds) so it can be lifted onto a real backend
 * without touching the presentation layer. The front end only ever receives a
 * finished `RoundResult`; the flight it animates afterwards is theatre.
 *
 * Provable fairness: each round publishes sha256(serverSeed) before the bet,
 * and reveals serverSeed afterwards. The outcome is derived from
 * sha256(serverSeed + ':' + clientSeed + ':' + nonce).
 */
import { BOOST_CONFIG, TIER_CONFIG, WALLET_START, getRtp, type BoostKind, type Tier } from './config';
import { resolveOutcome } from './outcome';
import { Rng, randomHex, sha256 } from './rng';

export interface BetRequest {
  tier: Tier;
  suitId: string;
  boosts: Record<BoostKind, number>;
  clientSeed: string;
}

export interface RoundResult {
  roundId: string;
  tier: Tier;
  suitId: string;
  stake: number;
  boostCost: number;
  totalWager: number;
  multiplier: number;
  payout: number;
  distance: number;        // metres
  rtp: number;
  /** Seed the client uses to generate the world for this round (deterministic). */
  worldSeed: string;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  balanceAfter: number;
}

const WALLET_KEY = 'soarinsteve.wallet';
const NONCE_KEY = 'soarinsteve.nonce';

function load(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && isFinite(+v)) return +v;
  } catch { /* ignore */ }
  return fallback;
}
function save(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
}

class MockServer {
  private balance = load(WALLET_KEY, WALLET_START);
  private nonce = load(NONCE_KEY, 0);
  private pendingSeed: string | null = null;
  private pendingHash: string | null = null;

  getBalance(): number { return this.balance; }

  async resetWallet(): Promise<number> {
    this.balance = WALLET_START;
    save(WALLET_KEY, this.balance);
    return this.balance;
  }

  /** Publish the commitment for the next round. */
  async nextSeedHash(): Promise<string> {
    if (!this.pendingSeed) {
      this.pendingSeed = randomHex(16);
      this.pendingHash = await sha256(this.pendingSeed);
    }
    return this.pendingHash!;
  }

  boostCost(tier: Tier, boosts: Record<BoostKind, number>): number {
    const stake = TIER_CONFIG[tier].stake;
    let cost = 0;
    for (const k of Object.keys(boosts) as BoostKind[]) {
      const n = Math.max(0, Math.min(BOOST_CONFIG[k].max, Math.floor(boosts[k] || 0)));
      cost += n * BOOST_CONFIG[k].price * stake;
    }
    return round2(cost);
  }

  /** Debit a plane purchase. */
  async purchase(amount: number): Promise<number> {
    amount = round2(amount);
    if (amount > this.balance) throw new Error('Insufficient balance');
    this.balance = round2(this.balance - amount);
    save(WALLET_KEY, this.balance);
    return this.balance;
  }

  /**
   * Place a bet. The result (multiplier, payout, distance) is fully determined here,
   * before the client renders anything. Boost purchases are part of the wager and
   * are paid at the same RTP as the stake.
   */
  async placeBet(req: BetRequest): Promise<RoundResult> {
    const cfg = TIER_CONFIG[req.tier];
    const stake = cfg.stake;
    const boostCost = this.boostCost(req.tier, req.boosts);
    const totalWager = round2(stake + boostCost);
    if (totalWager > this.balance) throw new Error('Insufficient balance');

    const serverSeedHash = await this.nextSeedHash();
    const serverSeed = this.pendingSeed!;
    this.pendingSeed = null;
    this.pendingHash = null;
    const nonce = ++this.nonce;
    save(NONCE_KEY, this.nonce);

    const digest = await sha256(`${serverSeed}:${req.clientSeed}:${nonce}`);
    // first 52 bits -> uniform in [0,1)
    const u = parseInt(digest.slice(0, 13), 16) / 2 ** 52;
    const rtp = getRtp();
    const outcome = resolveOutcome(req.tier, u, rtp);
    const multiplier = Math.min(outcome.multiplier, cfg.maxMultiplier * 2);
    const payout = round2(totalWager * multiplier);

    this.balance = round2(this.balance - totalWager + payout);
    save(WALLET_KEY, this.balance);

    // (a real server would add a network round trip here; the client keeps the
    // plane moving while it waits, see Engine.launch)

    return {
      roundId: randomHex(8),
      tier: req.tier,
      suitId: req.suitId,
      stake,
      boostCost,
      totalWager,
      multiplier,
      payout,
      distance: Math.max(1.5, multiplier * cfg.baseDistance),
      rtp,
      worldSeed: digest.slice(13, 29),
      serverSeedHash,
      serverSeed,
      clientSeed: req.clientSeed,
      nonce,
      balanceAfter: this.balance,
    };
  }
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const server = new MockServer();

/** Verifies a published round (for the fairness panel). */
export async function verifyRound(r: RoundResult): Promise<boolean> {
  const hash = await sha256(r.serverSeed);
  if (hash !== r.serverSeedHash) return false;
  const digest = await sha256(`${r.serverSeed}:${r.clientSeed}:${r.nonce}`);
  const u = parseInt(digest.slice(0, 13), 16) / 2 ** 52;
  const o = resolveOutcome(r.tier, u, r.rtp);
  return Math.abs(o.multiplier - r.multiplier) < 1e-9 || Math.abs(Math.min(o.multiplier, TIER_CONFIG[r.tier].maxMultiplier * 2) - r.multiplier) < 1e-9;
}

export { Rng };
