/** Gentle rolling terrain: a seeded sum of sines, flat around the launch tower. */
import { Rng } from '../core/rng';

export class Terrain {
  private waves: { ax: number; az: number; f: number; ph: number; amp: number }[] = [];

  constructor(seed: string) {
    const rng = new Rng(seed + ':terrain');
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const wl = rng.range(260, 720);
      this.waves.push({ ax: Math.cos(a), az: Math.sin(a), f: (Math.PI * 2) / wl, ph: rng.range(0, Math.PI * 2), amp: rng.range(3, 6.5) });
    }
  }

  /** Ground height at a world position. */
  at(x: number, z: number): number {
    let h = 0;
    for (const w of this.waves) h += Math.sin((x * w.ax + z * w.az) * w.f + w.ph) * w.amp;
    // flatten around the launch tower so the first blocks are level
    const d = Math.hypot(x, z);
    const k = d < 90 ? 0 : d > 300 ? 1 : (() => { const q = (d - 90) / 210; return q * q * (3 - 2 * q); })();
    return h * k;
  }
}
