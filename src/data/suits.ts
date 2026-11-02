/**
 * Soarin' Steve's wardrobe: 58 stunt suits across four stake tiers. Each suit
 * sets his colours and emblem and gives him a flight personality.
 */
import { TIER_CONFIG, type Tier } from '../core/config';

export type Tag = 'distance' | 'hang time' | 'acrobatic' | 'showy';
export type Emblem = 'plain' | 'star' | 'stripe' | 'bolt' | 'dots' | 'chevron';

export type FlightStyle =
  | 'steady'   // calm, minimal sway
  | 'swoop'    // long slow vertical waves
  | 'rockabye' // rolls gently side to side
  | 'twirl'    // the occasional lazy barrel roll
  | 'flutter'  // light, quick little bobs
  | 'dart'     // fast, straight, tiny yaw hunting
  | 'drift';   // wanders left and right like a leaf

export interface SuitDef {
  id: string;
  name: string;
  tier: Tier;
  tags: Tag[];
  /** Price in currency units. 0 => the tier's free default suit. */
  price: number;
  primary: string;    // torso + legs
  secondary: string;  // sleeves, boots, trunks
  accent: string;     // belt, helmet, emblem
  skin: string;
  emblem: Emblem;
  cape: boolean;
  flight: FlightStyle;
  blurb: string;
}

const S = (
  id: string, name: string, tier: Tier, tags: Tag[], priceFactor: number,
  primary: string, secondary: string, accent: string, emblem: Emblem, cape: boolean,
  flight: FlightStyle, blurb: string,
): SuitDef => ({
  id, name, tier, tags,
  price: Math.round(TIER_CONFIG[tier].stake * priceFactor * 100) / 100,
  primary, secondary, accent, skin: '#f1c9a5', emblem, cape, flight, blurb,
});

export const SUITS: SuitDef[] = [
  // ───────────────────────────── ROOKIE ─────────────────────────────
  S('big-top-red', 'Big Top Red', 'easy', ['distance'], 0, '#d8392b', '#f4e3c1', '#f2c14e', 'star', false, 'steady', 'The suit he was shot out in the very first time. Honest, red and quick.'),
  S('sawdust', 'Sawdust Classic', 'easy', ['distance', 'hang time'], 3, '#c9a86a', '#6b4a2b', '#f4e3c1', 'stripe', false, 'steady', 'Smells faintly of the ring. Flies straight and true.'),
  S('ringmaster', 'Ringmaster Stripe', 'easy', ['showy'], 4, '#2b2b2b', '#d8392b', '#f2c14e', 'stripe', true, 'flutter', 'Top-hat energy in suit form. Wobbles cheerfully.'),
  S('popcorn', 'Popcorn Dots', 'easy', ['hang time'], 5, '#fff3bf', '#d8392b', '#f2c14e', 'dots', false, 'swoop', 'Light and buttery. Rises and falls in long swoops.'),
  S('candy-cane', 'Candy Cane', 'easy', ['distance'], 4, '#ffffff', '#d8392b', '#d8392b', 'stripe', false, 'dart', 'Peppermint sharp. Goes where it is pointed.'),
  S('peanut', 'Peanut Gallery', 'easy', ['distance'], 5, '#c8a26a', '#8a5a3c', '#fff3bf', 'plain', false, 'steady', 'Humble and salty. Shrugs off a knock.'),
  S('tent-pole', 'Tent Pole', 'easy', ['distance'], 6, '#3f5f8a', '#f4e3c1', '#d8392b', 'chevron', false, 'dart', 'Tall, straight, dependable. Built for the long haul.'),
  S('sideshow', 'Sideshow Blue', 'easy', ['showy', 'acrobatic'], 6, '#2b7bb9', '#ffffff', '#f2c14e', 'star', true, 'twirl', 'Step right up! Loves a lazy barrel roll.'),
  S('clown-car', 'Clown Car', 'easy', ['acrobatic'], 7, '#f2c14e', '#2b7bb9', '#d8392b', 'dots', false, 'drift', 'Honk honk. Wanders left and right like it lost the keys.'),
  S('lemonade', 'Lemonade', 'easy', ['hang time'], 6, '#fff176', '#ffffff', '#7bc96f', 'plain', false, 'swoop', 'Cool, sweet and floaty on a hot day.'),
  S('cotton-candy', 'Cotton Candy', 'easy', ['hang time', 'showy'], 8, '#ff9ecb', '#9fd8ff', '#ffffff', 'dots', true, 'flutter', 'Fluffy pink with a bob in its step.'),
  S('carousel', 'Carousel', 'easy', ['acrobatic'], 7, '#f8f1e4', '#c9a0dc', '#f2c14e', 'chevron', false, 'rockabye', 'Round and round. Rocks side to side like a painted horse.'),
  S('kettle-corn', 'Kettle Corn', 'easy', ['distance'], 8, '#e8d5a8', '#8a5a3c', '#d8392b', 'plain', false, 'steady', 'Sweet, salty and strangely aerodynamic.'),
  S('tightrope', 'Tightrope', 'easy', ['distance'], 9, '#2b2b2b', '#f4e3c1', '#ffffff', 'stripe', false, 'dart', 'Balance is everything. Dead straight.'),
  S('balloon-boy', 'Balloon Boy', 'easy', ['hang time'], 10, '#7bc96f', '#ffffff', '#d8392b', 'dots', false, 'drift', 'Floats about like he is tied to a bunch of them.'),
  S('juggler', 'Juggler', 'easy', ['acrobatic', 'showy'], 12, '#9b59b6', '#f2c14e', '#ffffff', 'dots', true, 'twirl', 'Three balls, one Steve, several spins.'),

  // ───────────────────────────── PRO ─────────────────────────────
  S('trapeze-teal', 'Trapeze Teal', 'medium', ['hang time'], 0, '#1fb6a6', '#ffffff', '#f2c14e', 'star', false, 'swoop', 'Catches every updraft like a net. Your free pro suit.'),
  S('lion-tamer', 'Lion Tamer', 'medium', ['distance'], 3, '#d8392b', '#f2c14e', '#2b2b2b', 'chevron', true, 'steady', 'Fearless, whip in hand. Goes straight through.'),
  S('fire-eater', 'Fire Eater', 'medium', ['distance', 'showy'], 4, '#ff6b35', '#2b2b2b', '#ffd166', 'bolt', false, 'dart', 'Hot stuff. Burns a straight line across the sky.'),
  S('strongman', 'Strongman', 'medium', ['distance'], 5, '#2b2b2b', '#f1c9a5', '#d8392b', 'stripe', false, 'steady', 'Leopard print optional. Heavy, steady, far.'),
  S('knife-thrower', 'Knife Thrower', 'medium', ['distance'], 5, '#3b3f47', '#c0392b', '#dfe3e8', 'bolt', false, 'dart', 'Pinpoint accurate. Never wobbles.'),
  S('sword-swallower', 'Sword Swallower', 'medium', ['acrobatic'], 6, '#5c6b73', '#dfe3e8', '#f2c14e', 'plain', false, 'twirl', 'Spins like the blade he just put away.'),
  S('unicyclist', 'Unicyclist', 'medium', ['acrobatic'], 6, '#e67e22', '#ffffff', '#2b7bb9', 'dots', false, 'rockabye', 'Constantly correcting. Rocks and rolls.'),
  S('plate-spinner', 'Plate Spinner', 'medium', ['hang time'], 4, '#ffffff', '#2b7bb9', '#d8392b', 'dots', false, 'flutter', 'Keeps everything up in the air, mostly himself.'),
  S('pretzel', 'Human Pretzel', 'medium', ['acrobatic', 'showy'], 8, '#c9a86a', '#8a5a3c', '#ffffff', 'chevron', false, 'drift', 'Bends every which way. Hard to predict.'),
  S('mime', 'Mime Time', 'medium', ['hang time'], 7, '#ffffff', '#2b2b2b', '#d8392b', 'stripe', false, 'swoop', 'Trapped in an invisible glider. Floats forever.'),
  S('fortune-teller', 'Fortune Teller', 'medium', ['hang time', 'showy'], 7, '#6c3483', '#f2c14e', '#ffffff', 'star', true, 'swoop', 'Saw the landing coming. Did not flinch.'),
  S('bullwhip', 'Bullwhip', 'medium', ['distance'], 9, '#8a5a3c', '#2b2b2b', '#f2c14e', 'bolt', false, 'dart', 'Cracks across the city in one clean line.'),
  S('magician', 'Magician', 'medium', ['acrobatic', 'showy'], 9, '#2b2b2b', '#ffffff', '#d8392b', 'star', true, 'twirl', 'Now you see him. Now he is upside down.'),
  S('escape-artist', 'Escape Artist', 'medium', ['distance'], 8, '#34495e', '#dfe3e8', '#f2c14e', 'chevron', false, 'rockabye', 'Wriggles out of every obstacle, eventually.'),
  S('trick-rider', 'Trick Rider', 'medium', ['acrobatic'], 10, '#d8392b', '#ffffff', '#2b7bb9', 'star', true, 'twirl', 'Rides the wind like a galloping horse.'),
  S('snake-charmer', 'Snake Charmer', 'medium', ['hang time'], 11, '#27ae60', '#f2c14e', '#6c3483', 'dots', false, 'drift', 'Sways hypnotically from side to side.'),

  // ───────────────────────────── DAREDEVIL ─────────────────────────────
  S('midnight-stunt', 'Midnight Stunt', 'hard', ['hang time', 'distance'], 0, '#1c2541', '#dfe3e8', '#f2c14e', 'star', true, 'swoop', 'Dark blue with a silver star. Your free daredevil suit.'),
  S('wall-of-death', 'Wall of Death', 'hard', ['distance'], 3, '#2b2b2b', '#d8392b', '#ffffff', 'bolt', false, 'dart', 'Pure speed. No brakes were ever fitted.'),
  S('flaming-hoop', 'Flaming Hoop', 'hard', ['distance', 'acrobatic'], 4, '#ff6b35', '#ffd166', '#2b2b2b', 'chevron', false, 'steady', 'Goes through things rather than around them.'),
  S('globe-of-steel', 'Globe of Steel', 'hard', ['acrobatic'], 4, '#8e97a3', '#2b2b2b', '#d8392b', 'stripe', false, 'twirl', 'Spins loops like he is still inside the cage.'),
  S('rocket-sled', 'Rocket Sled', 'hard', ['distance'], 5, '#dfe3e8', '#d8392b', '#2b7bb9', 'bolt', false, 'dart', 'Strapped to something fast, as usual.'),
  S('barrel-roll', 'Barrel Roll', 'hard', ['acrobatic'], 5, '#8a5a3c', '#f2c14e', '#ffffff', 'stripe', false, 'twirl', 'Does exactly what it says on the barrel.'),
  S('loop-the-loop', 'Loop the Loop', 'hard', ['acrobatic', 'showy'], 6, '#2b7bb9', '#f2c14e', '#d8392b', 'chevron', true, 'rockabye', 'Big swinging arcs. Hold on to your lunch.'),
  S('shark-jumper', 'Shark Jumper', 'hard', ['distance', 'showy'], 6, '#1fb6a6', '#ffffff', '#2b2b2b', 'bolt', false, 'swoop', 'Clears anything with teeth. Long, low swoops.'),
  S('bridge-jumper', 'Bridge Jumper', 'hard', ['hang time'], 7, '#5c6b73', '#f4e3c1', '#d8392b', 'plain', false, 'flutter', 'Nervous flutter, surprisingly long glide.'),
  S('cliff-diver', 'Cliff Diver', 'hard', ['hang time', 'acrobatic'], 8, '#2980b9', '#ffffff', '#f2c14e', 'star', false, 'swoop', 'Head first, arms out, no hesitation.'),
  S('wingwalker', 'Wingwalker', 'hard', ['hang time'], 9, '#f4e3c1', '#8a5a3c', '#d8392b', 'stripe', true, 'drift', 'Used to strolling about at altitude.'),
  S('monster-truck', 'Monster Truck', 'hard', ['distance'], 10, '#27ae60', '#2b2b2b', '#f2c14e', 'bolt', false, 'steady', 'Crushes obstacles. Big, loud, unstoppable.'),
  S('nitro', 'Nitro', 'hard', ['distance'], 11, '#9b59b6', '#ffd166', '#ffffff', 'bolt', false, 'dart', 'Press the button. Regret nothing.'),
  S('high-diver', 'High Diver', 'hard', ['hang time', 'showy'], 12, '#e74c3c', '#ffffff', '#2b7bb9', 'chevron', true, 'swoop', 'Ten metres is for beginners.'),

  // ───────────────────────────── LEGEND ─────────────────────────────
  S('golden-cannonball', 'Golden Cannonball', 'expert', ['distance', 'hang time'], 0, '#f2c14e', '#d8392b', '#ffffff', 'star', true, 'steady', 'The suit of legends. Your free legend suit.'),
  S('great-zucchini', 'The Great Zucchini', 'expert', ['showy', 'acrobatic'], 3, '#27ae60', '#ffd166', '#ffffff', 'stripe', true, 'twirl', 'A stage name that stuck. Loves a flourish.'),
  S('comet', 'Comet', 'expert', ['distance'], 4, '#dfe3e8', '#2b7bb9', '#ffd166', 'bolt', true, 'dart', 'Streaks across the sky with a tail of sparks.'),
  S('starfall', 'Starfall', 'expert', ['hang time', 'showy'], 4, '#1c2541', '#ffd166', '#ffffff', 'dots', true, 'swoop', 'Drops slow and glittering like a shooting star.'),
  S('thunderclap', 'Thunderclap', 'expert', ['distance'], 5, '#34495e', '#ffd166', '#dfe3e8', 'bolt', false, 'steady', 'Arrives before the sound does.'),
  S('phoenix', 'Phoenix', 'expert', ['distance', 'acrobatic'], 5, '#e8482b', '#ffd166', '#ff6b35', 'chevron', true, 'twirl', 'Rises, dips, rises again. Loves a comeback.'),
  S('aurora', 'Aurora', 'expert', ['hang time'], 6, '#1fb6a6', '#9b59b6', '#ffffff', 'dots', true, 'drift', 'Shimmers and wanders like the northern lights.'),
  S('supernova', 'Supernova', 'expert', ['distance', 'showy'], 7, '#ffffff', '#ff6b35', '#2b2b2b', 'star', true, 'dart', 'Blinding. Fast. Over far too soon for the obstacles.'),
  S('dragon-scale', 'Dragon Scale', 'expert', ['acrobatic'], 8, '#145a32', '#f2c14e', '#d8392b', 'chevron', true, 'rockabye', 'Scaly green with golden trim. Sways like a tail.'),
  S('royal-flush', 'Royal Flush', 'expert', ['showy', 'distance'], 9, '#6c3483', '#f2c14e', '#ffffff', 'star', true, 'steady', 'Purple and gold. Never bluffs on distance.'),
  S('diamond-dust', 'Diamond Dust', 'expert', ['hang time', 'showy'], 10, '#dfe3e8', '#9fd8ff', '#ffffff', 'dots', true, 'flutter', 'Sparkles on the way down. Light as a snowflake.'),
  S('eclipse', 'Eclipse', 'expert', ['distance', 'hang time'], 12, '#2b2b2b', '#ffd166', '#ff6b35', 'star', true, 'swoop', 'A dark suit with a ring of fire. The longest glides in the show.'),
];

export function suitsForTier(tier: Tier): SuitDef[] {
  return SUITS.filter(s => s.tier === tier);
}

export function defaultSuitFor(tier: Tier): SuitDef {
  return SUITS.find(s => s.tier === tier && s.price === 0)!;
}

export function suitById(id: string): SuitDef {
  return SUITS.find(s => s.id === id) ?? SUITS[0];
}
