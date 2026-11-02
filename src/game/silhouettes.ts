/**
 * Top-view outlines for each plane silhouette. Points are the right half of the
 * outline, from the nose going clockwise to the tail. x = right, z = forward is
 * negative (nose at -0.5, tail at +0.5). Lengths are normalised to ~1.
 */
import type { Silhouette } from '../data/planes';

export interface SilhouetteDef {
  outline: [number, number][];  // [x, z] right half
  dihedral: number;             // radians each wing is raised
  keelDepth: number;            // depth of the fold line under the centre
  tipFins?: number;             // height of vertical fins at wing tips
  tailFin?: number;             // height of a vertical fin at the tail
  canard?: [number, number][];  // optional extra fore-wing outline (right half)
  wingStart: number;            // z where the wing root starts (for crease lines)
}

export const SILHOUETTES: Record<Silhouette, SilhouetteDef> = {
  dart: {
    outline: [[0, -0.5], [0.035, -0.3], [0.17, 0.44], [0.17, 0.5], [0, 0.5]],
    dihedral: 0.12, keelDepth: 0.075, wingStart: -0.3,
  },
  glider: {
    outline: [[0, -0.5], [0.045, -0.26], [0.44, 0.1], [0.47, 0.3], [0.38, 0.42], [0.12, 0.44], [0.12, 0.5], [0, 0.5]],
    dihedral: 0.16, keelDepth: 0.06, wingStart: -0.26,
  },
  delta: {
    outline: [[0, -0.5], [0.02, -0.38], [0.4, 0.42], [0.42, 0.5], [0, 0.5]],
    dihedral: 0.08, keelDepth: 0.08, wingStart: -0.38, tailFin: 0.09,
  },
  canard: {
    outline: [[0, -0.5], [0.03, -0.1], [0.07, 0.05], [0.37, 0.36], [0.37, 0.5], [0, 0.5]],
    canard: [[0, -0.42], [0.03, -0.4], [0.17, -0.3], [0.17, -0.2], [0.03, -0.18], [0, -0.18]],
    dihedral: 0.1, keelDepth: 0.07, wingStart: -0.1, tipFins: 0.07,
  },
  swept: {
    outline: [[0, -0.5], [0.03, -0.2], [0.32, 0.3], [0.34, 0.42], [0.13, 0.37], [0.11, 0.5], [0, 0.5]],
    dihedral: 0.1, keelDepth: 0.08, wingStart: -0.2, tailFin: 0.11,
  },
  stunt: {
    outline: [[0, -0.5], [0.05, -0.3], [0.31, -0.18], [0.31, 0.2], [0.1, 0.24], [0.1, 0.4], [0.24, 0.43], [0.24, 0.5], [0, 0.5]],
    dihedral: 0.06, keelDepth: 0.07, wingStart: -0.3, tipFins: 0.1,
  },
  wing: {
    outline: [[0, -0.42], [0.08, -0.38], [0.46, 0.22], [0.47, 0.44], [0.22, 0.34], [0, 0.4]],
    dihedral: 0.14, keelDepth: 0.04, wingStart: -0.38,
  },
  bird: {
    outline: [[0, -0.5], [0.04, -0.3], [0.3, -0.06], [0.44, 0.0], [0.5, 0.1], [0.4, 0.2], [0.13, 0.28], [0.15, 0.44], [0.22, 0.5], [0, 0.46]],
    dihedral: 0.2, keelDepth: 0.06, wingStart: -0.3,
  },
};

/** Wing half-span (max x) of a silhouette. */
export function halfSpan(s: Silhouette): number {
  return Math.max(...SILHOUETTES[s].outline.map(p => p[0]));
}
