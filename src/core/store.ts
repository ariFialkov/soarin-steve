/** Persistent player profile: owned planes, selections, settings. */
import { TIERS, type BoostKind, type Tier } from './config';
import { SUITS, defaultSuitFor } from '../data/suits';

export interface Profile {
  owned: string[];
  selected: Record<Tier, string>;
  tier: Tier;
  boosts: Record<BoostKind, number>;
  sound: boolean;
  quality: 'low' | 'high';
  clientSeed: string;
  rounds: number;
}

const KEY = 'soarinsteve.profile.v1';

function fresh(): Profile {
  const selected = {} as Record<Tier, string>;
  for (const t of TIERS) selected[t] = defaultSuitFor(t).id;
  return {
    owned: TIERS.map(t => defaultSuitFor(t).id),
    selected,
    tier: 'easy',
    boosts: { blower: 0, confetti: 0, rockets: 0 },
    sound: true,
    quality: 'high',
    clientSeed: Math.random().toString(36).slice(2, 10),
    rounds: 0,
  };
}

function loadProfile(): Profile {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      const merged: Profile = { ...base, ...p, selected: { ...base.selected, ...(p.selected || {}) }, boosts: { ...base.boosts, ...(p.boosts || {}) } };
      // make sure defaults are always owned and selections are valid
      for (const t of TIERS) {
        const d = defaultSuitFor(t).id;
        if (!merged.owned.includes(d)) merged.owned.push(d);
        const sel = SUITS.find(pl => pl.id === merged.selected[t]);
        if (!sel || sel.tier !== t || !merged.owned.includes(sel.id)) merged.selected[t] = d;
      }
      return merged;
    }
  } catch { /* ignore */ }
  return base;
}

export const profile: Profile = loadProfile();

export function saveProfile(): void {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ }
}

export function resetProfile(): void {
  Object.assign(profile, fresh());
  saveProfile();
}
