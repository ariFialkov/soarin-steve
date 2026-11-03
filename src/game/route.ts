/**
 * The flight route: a path along the city's street centrelines. It runs
 * straight for the first blocks, then turns at intersections (with rounded
 * corners), always making progress away from the cannon. Everything that
 * moves along the flight (Steve, the camera, the cash track, the events) is
 * positioned by arc length `s` along this route.
 */
import { Rng } from '../core/rng';

export const PX = 36;   // block pitch across (x)
export const PZ = 32;   // block pitch along (z)
export const FILLET = 11;
export const BOULEVARD_HALF = 7;     // asphalt half width of route streets
export const BOULEVARD_KERB = 13;    // corridor half width of the route street (the asphalt ribbon winds inside it)
export const STREET_HALF = 4;        // half width of ordinary streets

export interface RouteSample {
  x: number; z: number;
  tx: number; tz: number;   // unit tangent (direction of travel)
  nx: number; nz: number;   // unit normal to the right of travel
  heading: number;          // rotation.y that maps local -z onto the tangent
}

type Piece =
  | { kind: 'line'; s0: number; len: number; x: number; z: number; dx: number; dz: number }
  | { kind: 'arc'; s0: number; len: number; cx: number; cz: number; r: number; a0: number; sweep: number };

interface Node { ix: number; jz: number }  // intersection at x = ix*PX, z = -jz*PZ

export class Route {
  private rng: Rng;
  private nodes: Node[] = [];
  private pieces: Piece[] = [];
  private total = 0;
  private dir: 'N' | 'E' | 'W' = 'N';
  private legsSinceTurn = 0;
  /** boulevard street segments: v:ix:jz (x = ix*PX, from row jz to jz+1), h:jz:ix (z = -jz*PZ, from col ix to ix+1) */
  readonly boulevards = new Set<string>();
  /** blocks on the inside of a turn, which become squares: key ix:jz */
  readonly plazas = new Set<string>();
  /** intersections the route turns at */
  readonly corners: Node[] = [];

  /** Lateral meander of the boulevard's asphalt ribbon beneath the (straight) flight line. */
  private meander: { a: number; f: number; ph: number }[] = [];

  constructor(seed: string) {
    this.rng = new Rng(seed + ':route');
    // the flight always runs straight north from the cannon; the road below it winds
    this.boulevards.add('v:0:-1'); this.boulevards.add('v:0:-2');
    this.nodes.push({ ix: 0, jz: 0 });
    this.addLeg('N', 12);
    const r = this.rng;
    this.meander = [
      { a: r.range(2.6, 3.6), f: (Math.PI * 2) / r.range(150, 210), ph: r.range(0, 6.28) },
      { a: r.range(1.2, 2.0), f: (Math.PI * 2) / r.range(70, 110), ph: r.range(0, 6.28) },
    ];
  }

  /** Sideways offset of the road ribbon at route distance s (zero near the cannon). */
  roadOffset(s: number): number {
    const ramp = s < 150 ? 0 : s > 320 ? 1 : (() => { const q = (s - 150) / 170; return q * q * (3 - 2 * q); })();
    let x = 0;
    for (const m of this.meander) x += Math.sin(s * m.f + m.ph) * m.a;
    return x * ramp;
  }
  /** Slope of the road offset, for orienting markings along the ribbon. */
  roadSlope(s: number): number { return (this.roadOffset(s + 0.5) - this.roadOffset(s - 0.5)); }

  private addLeg(dir: 'N' | 'E' | 'W', blocks: number): void {
    const last = this.nodes[this.nodes.length - 1];
    let { ix, jz } = last;
    for (let b = 0; b < blocks; b++) {
      if (dir === 'N') { this.boulevards.add(`v:${ix}:${jz}`); jz += 1; }
      else if (dir === 'E') { this.boulevards.add(`h:${jz}:${ix}`); ix += 1; }
      else { this.boulevards.add(`h:${jz}:${ix - 1}`); ix -= 1; }
    }
    const node = { ix, jz };
    if (this.nodes.length >= 1 && this.dir !== dir) {
      this.corners.push(last);
      // the block on the inside of the turn becomes a square
      const inside = this.insideBlock(last, this.dir, dir);
      if (inside) this.plazas.add(`${inside.ix}:${inside.jz}`);
    }
    this.dir = dir;
    this.nodes.push(node);
    this.rebuildPieces();
  }

  private insideBlock(c: Node, from: 'N' | 'E' | 'W', to: 'N' | 'E' | 'W'): Node | null {
    // block keys: block (ix, jz) spans x in [ix*PX, (ix+1)*PX], z in [-(jz+1)*PZ, -jz*PZ]
    if (from === 'N' && to === 'E') return { ix: c.ix, jz: c.jz };          // ahead-right
    if (from === 'N' && to === 'W') return { ix: c.ix - 1, jz: c.jz };      // ahead-left
    if (from === 'E' && to === 'N') return { ix: c.ix - 1, jz: c.jz };      // behind-left of the new heading
    if (from === 'W' && to === 'N') return { ix: c.ix, jz: c.jz };
    return null;
  }

  /** Extend the route until it is at least `sMax` long (always straight on). */
  ensure(sMax: number): void {
    while (this.total < sMax + 400) {
      this.legsSinceTurn++;
      this.addLeg('N', 8);
    }
  }

  private rebuildPieces(): void {
    // merge collinear legs into single straight lines; only a real change of direction gets a fillet
    const raw = this.nodes.map(n => ({ x: n.ix * PX, z: -n.jz * PZ }));
    const pts: { x: number; z: number }[] = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
      if (i < raw.length - 1) {
        const a = pts[pts.length - 1], b = raw[i], c = raw[i + 1];
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
        if (Math.abs(cross) < 1e-6) continue;   // straight on: no corner here
      }
      pts.push(raw[i]);
    }
    const pieces: Piece[] = [];
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const startTrim = i === 0 ? 0 : FILLET;
      const endTrim = i === pts.length - 2 ? 0 : FILLET;
      const lineLen = len - startTrim - endTrim;
      pieces.push({ kind: 'line', s0: s, len: lineLen, x: a.x + dx * startTrim, z: a.z + dz * startTrim, dx, dz });
      s += lineLen;
      if (i < pts.length - 2) {
        const c = pts[i + 2];
        const len2 = Math.hypot(c.x - b.x, c.z - b.z);
        const ex = (c.x - b.x) / len2, ez = (c.z - b.z) / len2;
        const ox = b.x - dx * FILLET + ex * FILLET, oz = b.z - dz * FILLET + ez * FILLET;
        const p1x = b.x - dx * FILLET, p1z = b.z - dz * FILLET;
        const a0 = Math.atan2(p1z - oz, p1x - ox);
        const cross = dx * ez - dz * ex;
        const sweep = (Math.PI / 2) * (cross > 0 ? 1 : -1);
        pieces.push({ kind: 'arc', s0: s, len: (Math.PI / 2) * FILLET, cx: ox, cz: oz, r: FILLET, a0, sweep });
        s += (Math.PI / 2) * FILLET;
      }
    }
    this.pieces = pieces;
    this.total = s;
  }

  get length(): number { return this.total; }

  at(s: number, out?: RouteSample): RouteSample {
    if (s > this.total - 200) this.ensure(s);
    const o: RouteSample = out ?? { x: 0, z: 0, tx: 0, tz: -1, nx: 1, nz: 0, heading: 0 };
    s = Math.max(0, s);
    // find the piece (pieces are few; linear search from the end is fine)
    let p = this.pieces[this.pieces.length - 1];
    for (let i = 0; i < this.pieces.length; i++) {
      if (s < this.pieces[i].s0 + this.pieces[i].len) { p = this.pieces[i]; break; }
    }
    const u = Math.min(p.len, Math.max(0, s - p.s0));
    if (p.kind === 'line') {
      o.x = p.x + p.dx * u; o.z = p.z + p.dz * u;
      o.tx = p.dx; o.tz = p.dz;
    } else {
      const a = p.a0 + p.sweep * (u / p.len);
      o.x = p.cx + Math.cos(a) * p.r; o.z = p.cz + Math.sin(a) * p.r;
      const sgn = p.sweep > 0 ? 1 : -1;
      o.tx = -Math.sin(a) * sgn; o.tz = Math.cos(a) * sgn;
    }
    // right-hand normal: rotate the tangent by -90° about y
    o.nx = -o.tz; o.nz = o.tx;
    o.heading = Math.atan2(-o.tx, -o.tz);
    return o;
  }

  isBoulevardV(ix: number, jz: number): boolean { return this.boulevards.has(`v:${ix}:${jz}`); }
  isBoulevardH(jz: number, ix: number): boolean { return this.boulevards.has(`h:${jz}:${ix}`); }
  isPlaza(ix: number, jz: number): boolean { return this.plazas.has(`${ix}:${jz}`); }
}
