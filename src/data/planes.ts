/**
 * The plane bank.
 *
 * Names, folding-difficulty tiers and trait tags follow the public-domain
 * catalogue at Fold 'N' Fly (https://www.foldnfly.com), which is credited in
 * the in-game credits. Everything visual here (silhouette, colours, flight
 * character) is our own stylised take so each plane feels distinct in flight.
 */
import { TIER_CONFIG, type Tier } from '../core/config';

export type Tag = 'distance' | 'time aloft' | 'acrobatic' | 'decorative';

export type Silhouette =
  | 'dart'     // classic narrow dart
  | 'glider'   // wide, long wings
  | 'delta'    // broad triangle
  | 'canard'   // small front wings + main wings
  | 'swept'    // swept-back fighter look
  | 'stunt'    // square-ish wings with tail fins and flaps
  | 'wing'     // flying wing, almost no fuselage
  | 'bird';    // bird-like, wing tips angled up, tail feathers

export type FlightStyle =
  | 'steady'   // calm, minimal sway
  | 'swoop'    // long slow vertical waves
  | 'rockabye' // rolls gently side to side
  | 'twirl'    // the occasional lazy barrel roll
  | 'flutter'  // light, quick little bobs
  | 'dart'     // fast, straight, tiny yaw hunting
  | 'drift';   // wanders left and right like a leaf

export interface PlaneDef {
  id: string;
  name: string;
  tier: Tier;
  tags: Tag[];
  /** Price in currency units. 0 => the tier's free default plane. */
  price: number;
  silhouette: Silhouette;
  paper: string;     // base paper colour
  accent: string;    // stripe / fold accent colour
  pattern: 'plain' | 'stripe' | 'dots' | 'edge' | 'chevron';
  flight: FlightStyle;
  blurb: string;
}

const P = (
  id: string, name: string, tier: Tier, tags: Tag[], priceFactor: number,
  silhouette: Silhouette, paper: string, accent: string, pattern: PlaneDef['pattern'],
  flight: FlightStyle, blurb: string,
): PlaneDef => ({
  id, name, tier, tags,
  price: Math.round(TIER_CONFIG[tier].stake * priceFactor * 100) / 100,
  silhouette, paper, accent, pattern, flight, blurb,
});

export const PLANES: PlaneDef[] = [
  // ───────────────────────────── EASY ─────────────────────────────
  P('basic-dart', 'The Basic Dart', 'easy', ['distance'], 0, 'dart', '#f7f2e8', '#c9c0b0', 'plain', 'dart', 'The one everybody learns first. Honest, straight and quick.'),
  P('stable', 'The Stable', 'easy', ['distance', 'time aloft'], 3, 'glider', '#fbf6ea', '#9bc7e8', 'edge', 'steady', 'Wide wings and a calm temperament. Barely notices the wind.'),
  P('buzz', 'The Buzz', 'easy', ['distance'], 4, 'swept', '#fff4d6', '#f2c14e', 'stripe', 'flutter', 'A little stubby and a lot of fun. Zips along with a wiggle.'),
  P('sea-glider', 'The Sea Glider', 'easy', ['time aloft'], 5, 'glider', '#e8f4fb', '#4a9bd1', 'edge', 'swoop', 'Long and slow with lovely rising and falling swoops.'),
  P('bulldog-dart', 'The Bulldog Dart', 'easy', ['distance'], 4, 'dart', '#f3ece0', '#8d5a3b', 'chevron', 'steady', 'Blunt nose, tough as nails. Shrugs off a knock or two.'),
  P('hunting-flight', 'The Hunting Flight', 'easy', ['distance'], 5, 'swept', '#f0ead8', '#5d7a3c', 'stripe', 'dart', 'Lean and purposeful. Hunts down the far markers.'),
  P('sprinter', 'The Sprinter', 'easy', ['distance'], 6, 'dart', '#fdf1f1', '#e2574c', 'stripe', 'dart', 'Built for the hundred-metre dash of paper planes.'),
  P('super-dart', 'The Super Dart', 'easy', ['distance'], 6, 'dart', '#eef2fb', '#3c5fd1', 'chevron', 'steady', 'The Basic Dart after a gym membership.'),
  P('dart-jet', 'The Dart Jet', 'easy', ['distance'], 7, 'swept', '#f4f4f4', '#444a55', 'edge', 'dart', 'Swept wings and a serious face. Mostly for show.'),
  P('glider', 'The Glider', 'easy', ['time aloft'], 6, 'glider', '#f9f6ec', '#c8a2d6', 'plain', 'swoop', 'Floats like it has nowhere particular to be.'),
  P('tube', 'The Tube', 'easy', ['acrobatic'], 8, 'wing', '#fff9e6', '#f28e2b', 'dots', 'twirl', 'A ring of paper that rolls through the air. Delightfully odd.'),
  P('arrow', 'The Arrow', 'easy', ['distance'], 7, 'dart', '#f5efe6', '#2e8b6f', 'edge', 'dart', 'Points one way. Goes that way.'),
  P('jet', 'The Jet', 'easy', ['distance'], 8, 'swept', '#eef7f1', '#1fa37a', 'stripe', 'flutter', 'Cheerful and quick, with a hop in its step.'),
  P('sailor', 'The Sailor', 'easy', ['time aloft'], 9, 'glider', '#eaf3fb', '#1d5c9e', 'stripe', 'rockabye', 'Rocks side to side like a boat in a gentle swell.'),
  P('moth', 'The Moth', 'easy', ['time aloft', 'decorative'], 10, 'bird', '#f7f0e2', '#b58b57', 'dots', 'flutter', 'Fluttery and soft, attracted to the far lights.'),
  P('flipper', 'The Flipper', 'easy', ['acrobatic'], 12, 'stunt', '#fdf3e7', '#f06a8a', 'chevron', 'twirl', 'Loves a lazy barrel roll whenever it feels like one.'),

  // ───────────────────────────── MEDIUM ─────────────────────────────
  P('hammer', 'The Hammer', 'medium', ['distance'], 0, 'dart', '#f6f1e7', '#8a8f99', 'plain', 'steady', 'Heavy nose, long glide, no nonsense. Your free medium plane.'),
  P('harrier', 'The Harrier', 'medium', ['distance', 'time aloft'], 3, 'swept', '#f2f4f7', '#4f6d8f', 'edge', 'steady', 'A reliable all-rounder that goes exactly where you point it.'),
  P('starship', 'The Starship', 'medium', ['decorative', 'distance'], 4, 'delta', '#f3f0fa', '#6c4fd1', 'chevron', 'swoop', 'Looks like it should have warp drive. Does not, but close.'),
  P('dragon', 'The Dragon', 'medium', ['acrobatic'], 5, 'bird', '#fbeeea', '#c43d2f', 'dots', 'twirl', 'Loops and rolls with a flick of its paper tail.'),
  P('falcon', 'The Falcon', 'medium', ['distance'], 5, 'bird', '#f4efe4', '#7a4b2a', 'stripe', 'dart', 'Dives for the far markers like it means it.'),
  P('star-crusher', 'The Star Crusher', 'medium', ['distance'], 6, 'swept', '#eef0f3', '#22262e', 'chevron', 'steady', 'Angular, aggressive, and very proud of itself.'),
  P('stunt-plane', 'The Stunt Plane', 'medium', ['acrobatic'], 6, 'stunt', '#fff6e0', '#f0a030', 'stripe', 'twirl', 'Flaps, fins and a wild streak. Expect loops.'),
  P('square-plane', 'The Square Plane', 'medium', ['time aloft'], 4, 'wing', '#f1f6f1', '#4c9a5c', 'edge', 'drift', 'A square that flies. Drifts left and right like a leaf.'),
  P('ufo', 'The UFO', 'medium', ['decorative', 'acrobatic'], 8, 'wing', '#eef9f7', '#1fb6a6', 'dots', 'drift', 'Wobbly saucer that hovers and wanders. Not from around here.'),
  P('eagle', 'The Eagle', 'medium', ['time aloft'], 7, 'bird', '#f6f1e6', '#5e4b3c', 'edge', 'swoop', 'Broad wings that ride the thermals in long slow arcs.'),
  P('nakamura-lock', 'The Nakamura Lock', 'medium', ['time aloft', 'distance'], 7, 'glider', '#f8f4ec', '#d45f8e', 'plain', 'steady', 'The classic locked-nose glider. Smooth as silk.'),
  P('ring-glider', 'The Ring Glider', 'medium', ['acrobatic'], 9, 'wing', '#fff3ec', '#f26b3a', 'stripe', 'twirl', 'Rolls through the sky in cheerful spirals.'),
  P('hummingbird', 'The Hummingbird', 'medium', ['time aloft', 'decorative'], 9, 'bird', '#eff9f1', '#2fa36b', 'dots', 'flutter', 'Tiny quick flutters. Never sits still.'),
  P('seagull', 'The Seagull', 'medium', ['time aloft'], 8, 'bird', '#f4f7fa', '#7f93a8', 'edge', 'rockabye', 'Rocks on the sea breeze and steals your chips.'),
  P('spinning-blade', 'The Spinning Blade', 'medium', ['acrobatic'], 10, 'delta', '#f7f0f7', '#9b3fb3', 'chevron', 'twirl', 'Spins, rolls and generally shows off.'),
  P('twin-glider', 'The Twin Glider', 'medium', ['time aloft'], 11, 'canard', '#fbf7ea', '#c8a21c', 'stripe', 'swoop', 'Two sets of wings for twice the float.'),

  // ───────────────────────────── HARD ─────────────────────────────
  P('condor', 'The Condor', 'hard', ['time aloft', 'distance'], 0, 'glider', '#f5f1e8', '#6b6f78', 'plain', 'swoop', 'Enormous wingspan, enormous patience. Your free hard plane.'),
  P('lightning', 'The Lightning', 'hard', ['distance'], 3, 'swept', '#fdf8e4', '#f2c230', 'chevron', 'dart', 'Crackles across the sky in a straight, fast line.'),
  P('raptor', 'The Raptor', 'hard', ['distance', 'acrobatic'], 4, 'swept', '#f3f1ef', '#9c2f2f', 'stripe', 'steady', 'Sharp, swept and slightly intimidating.'),
  P('spinner', 'The Spinner', 'hard', ['acrobatic'], 4, 'wing', '#f1f4fb', '#3d7bd6', 'dots', 'twirl', 'Pirouettes along the centreline like a ballerina.'),
  P('thunderbird', 'The Thunderbird', 'hard', ['distance'], 5, 'bird', '#f4f0ea', '#394a9c', 'edge', 'rockabye', 'Big, bold and rocks with the gusts.'),
  P('boomerang', 'The Boomerang', 'hard', ['acrobatic'], 5, 'wing', '#fff2e3', '#e77c2f', 'chevron', 'drift', 'Curves left, curves right, somehow still goes forward.'),
  P('canard', 'The Canard', 'hard', ['distance'], 6, 'canard', '#f6f3ee', '#5c8d6a', 'edge', 'steady', 'Little front wings keep its nose level and its mind clear.'),
  P('flying-wing', 'The Flying Wing', 'hard', ['time aloft'], 6, 'wing', '#f0f0f2', '#2b2f36', 'plain', 'swoop', 'All wing, no fuss. Glides on forever.'),
  P('fighter', 'The Fighter', 'hard', ['decorative', 'distance'], 7, 'swept', '#eef2ee', '#3f6b4a', 'chevron', 'dart', 'Looks ready for an air show. Flies like it too.'),
  P('bat-plane', 'The Bat Plane', 'hard', ['decorative', 'acrobatic'], 8, 'bird', '#ebe9ef', '#2a2340', 'dots', 'flutter', 'Nocturnal, scalloped wings and a flappy flight path.'),
  P('shuttle', 'The Shuttle', 'hard', ['decorative'], 9, 'delta', '#f6f6f3', '#9aa3b0', 'stripe', 'steady', 'Blunt, broad and stately. Re-entry not included.'),
  P('interceptor', 'The Interceptor', 'hard', ['distance'], 10, 'swept', '#f2f3f8', '#1c3f8a', 'edge', 'dart', 'Pure speed with a hint of swagger.'),
  P('twin-jet', 'The Twin Jet', 'hard', ['distance', 'decorative'], 11, 'canard', '#f8f3ea', '#d6482b', 'stripe', 'steady', 'Two tails, one goal: the horizon.'),
  P('swallow', 'The Swallow', 'hard', ['time aloft', 'acrobatic'], 12, 'bird', '#eef4fb', '#2d6fb5', 'edge', 'twirl', 'Forked tail, playful loops, surprisingly long range.'),

  // ───────────────────────────── EXPERT ─────────────────────────────
  P('trap-glider', 'The Trap Glider', 'expert', ['time aloft', 'distance'], 0, 'glider', '#f4f1ea', '#7c8591', 'plain', 'swoop', 'A long-winged master glider. Your free expert plane.'),
  P('barn-owl', 'The Barn Owl', 'expert', ['decorative', 'time aloft'], 3, 'bird', '#f8f2e4', '#a87a4a', 'dots', 'rockabye', 'Silent, wide and wise. Rocks softly through the night air.'),
  P('delta-fighter', 'The Delta Fighter', 'expert', ['distance'], 4, 'delta', '#f3f3f5', '#444c5c', 'chevron', 'dart', 'A razor-edged triangle with a long memory for distance.'),
  P('jet-fighter', 'The Jet Fighter', 'expert', ['decorative', 'distance'], 4, 'swept', '#f1f5f1', '#2e6f3e', 'stripe', 'steady', 'The full fighter silhouette, canopy creases and all.'),
  P('starfighter', 'The Starfighter', 'expert', ['decorative', 'acrobatic'], 5, 'canard', '#f3f0fb', '#5b3fc9', 'chevron', 'twirl', 'Spins and rolls like it is dodging asteroids.'),
  P('fox', 'The Fox', 'expert', ['decorative'], 5, 'bird', '#fdf0e6', '#e0702a', 'edge', 'flutter', 'Pointy ears, bushy tail, sly little flight path.'),
  P('hawk', 'The Hawk', 'expert', ['distance', 'time aloft'], 6, 'bird', '#f6f1e8', '#6a4a30', 'stripe', 'swoop', 'Circles high and then commits. A long, elegant glide.'),
  P('phoenix', 'The Phoenix', 'expert', ['decorative', 'distance'], 7, 'bird', '#fff0e0', '#e8482b', 'chevron', 'twirl', 'Rises, dips, rises again. Loves a dramatic comeback.'),
  P('concorde', 'The Concorde', 'expert', ['decorative', 'distance'], 8, 'delta', '#f8f8f6', '#9b9ea6', 'edge', 'steady', 'Drooped nose, swept delta, supersonic attitude.'),
  P('stealth', 'The Stealth', 'expert', ['decorative', 'distance'], 9, 'wing', '#ededf0', '#1e2128', 'plain', 'steady', 'Angular and quiet. You will not see it coming.'),
  P('needle', 'The Needle', 'expert', ['distance'], 10, 'dart', '#f5f3ef', '#b4142e', 'stripe', 'dart', 'Impossibly thin. Threads through the wind.'),
  P('albatross', 'The Albatross', 'expert', ['time aloft', 'distance'], 12, 'glider', '#eef5fb', '#3a86c8', 'edge', 'swoop', 'The longest wings in the hangar. Rides every current.'),
];

export function planesForTier(tier: Tier): PlaneDef[] {
  return PLANES.filter(p => p.tier === tier);
}

export function defaultPlaneFor(tier: Tier): PlaneDef {
  return PLANES.find(p => p.tier === tier && p.price === 0)!;
}

export function planeById(id: string): PlaneDef {
  return PLANES.find(p => p.id === id) ?? PLANES[0];
}
