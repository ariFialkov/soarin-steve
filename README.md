# Soarin' Steve

A whimsical "launch and watch" betting game. Pack the powder, fire the circus cannon, and watch
Soarin' Steve, daredevil human cannonball, fly across a sprawling city past boosts and obstacles
while a cash track ticks up along the avenue below. He tucks, soars, fans out, wipes out, and gets
back up for the pose. Runs as a PWA on desktop and mobile.

> **Important design note.** The game *looks* skill based (how hard you pack the cannon, when you
> use a boost), but every round is settled by the server module the instant the cannon fires,
> before Steve moves. The flight is theatre that lands exactly on the resolved result. See
> [How a round is decided](#how-a-round-is-decided).

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build + service worker in dist/
npm run preview    # serve dist/
npm test           # outcome maths + flight plan checks
```

Install it as an app from the browser menu ("Add to Home Screen" / "Install"). After the first
visit it works offline. The web app manifest is written as `dist/manifest.json` (not
`.webmanifest`) so hosts that reject that extension accept the build.

## How a round is decided

1. The player picks a tier (which fixes the stake) and optionally loads mid-flight boosts in the
   panel on the menu's left edge. Boost costs are added to the wager.
2. When the cannon fires, the client sends one bet request to `src/core/server.ts`.
   That module is a mock of a game server, written like a remote API so it can be moved to a
   real backend untouched. It:
   - debits the total wager,
   - draws a uniform random number from `sha256(serverSeed:clientSeed:nonce)`,
   - maps it to a multiplier using the tier's bucket table (`src/core/outcome.ts`), scaled so
     the **expected multiplier is exactly the configured RTP**,
   - returns the payout, the distance (`multiplier × tier base distance`) and a world seed.
3. Only then does the client build a flight plan (`src/game/flightPlan.ts`): a precomputed
   position/velocity/height curve that ends at that distance. Vertical motion uses **one gravity
   for the whole flight** (kept in a believable band): Steve follows true ballistic arcs between
   contact points (the muzzle, any bounce pad, the touchdown), and boosts and hits are instant
   vertical kicks under that same gravity, each arc solved so it meets its next contact. On long
   flights the boosts carry him in a hop-hop-hop across the sky rather than gravity being turned
   down. Horizontal motion is closed-form, so the arrival point is exact. On touchdown he tumbles
   along the road for exactly v²/(2·friction): the touchdown speed and the surface he lands on
   (asphalt, old-town cobbles, park pavers or a bridge deck) decide how far and how bouncily. Objects are chosen to suit
   Steve's altitude at that point: aerial ones (gulls, balloons, banner planes, blimps, airliner
   jetwash, fireworks) and ground ones that bounce him back up high (trampolines, bouncy castles,
   tyre stacks, industrial fans) or barely (traffic cones, a hot dog cart, a mattress). How hard
   he is hit scales with how much speed the plan takes away. Some flights end in a dumpster or a
   hay truck, which stop him dead with no skid.
   Nothing static spawns within view of the cannon, so obstacles appear out of the haze among the
   city's ordinary traffic. Very short results become a misfire. The scenery explains the result;
   it never decides it.
4. Mid-flight boosts (leaf blower, confetti cannon, bottle rockets) only change the *rate* at
   which the plan is played back, scaled by how fast Steve is already going. Once he is down he
   is down. The end point cannot change.

Every result carries the hashed server seed (published before the bet), the revealed seed, the
client seed and the nonce, and the result card re-verifies the outcome from them.

### RTP and tuning

`src/core/config.ts` holds everything an operator would tune:

- `DEFAULT_RTP` (96%), overridable at runtime with `?rtp=0.95` or from Settings → House
  (persisted locally, demo only).
- Per tier: stake, base distance for a 1.00× result, max multiplier and the bucket table that
  shapes the distribution (bust frequency, tail weight). Changing bucket shapes never changes
  the RTP, because the table is rescaled to hit it.
- Boost prices (as a fraction of the stake) and carry limits.

`npm test` checks that the expected multiplier of every tier equals the configured RTP, and that
flight plans always end exactly at the resolved distance.

## The city and the route

The flight follows a **route** (`src/game/route.ts`): a perfectly straight line down the city's
central boulevard (a test guarantees it never turns). Steve, the camera, the cash track and every
event are positioned by distance along it, and both Steve and the camera always face straight down
it. The boulevard's road ribbon winds beneath the flight line inside a wide corridor, painted in
the surface of each district.

The city itself (`src/game/city.ts`) is an endless grid of blocks over gently rolling **terrain**
(`src/game/terrain.ts`): streets follow the ground, blocks sit on flat terraces with deep kerbs.
Districts are noise patches rather than bands (suburbs, residential, commercial, downtown, parks,
industrial yards, old town) and whole rows become rivers, which the route crosses on bridges and
other streets simply stop at. Landmarks (clock tower, cathedral, stadium, a turning ferris wheel,
obelisk plaza, triumphal arch over the boulevard, domed hall, radio mast, water tower) are
scattered by hash. The world streams in macro tiles of 3×3 blocks around the route: full detail
near the path, cheap massing beyond, each tile baked into three merged meshes. Traffic drives the
streets, birds, balloons, blimps, airliners and helicopters cross the sky, and harmless filler
obstacles sit around the city so a crane or a flock is not a tell.

## The stuntmen

Each stake has its own stuntman, built from the same rig with his own proportions and features
(`PHYSIQUES` in `src/game/steve.ts`):

| Stake | Stuntman | Build |
|---|---|---|
| Rookie ($1) | Soarin' Steve | the original |
| Pro ($5) | Cannonball Chris | short and round, handlebar moustache |
| Daredevil ($20) | Projectile Pete | tall and tubular, nose-cone helmet |
| Legend ($100) | Heatseeker Hank | buff, square-jawed, rocket shoes that fire in flight |

His shadow is a planar projection of his body onto the ground along the sun, drawn as one merged
mesh with a stencil so limbs never double-darken (one extra draw, no change to the city shaders).

## Steve

Steve is a jointed figure built from primitives (`src/game/steve.ts`) with a library of poses
(cannonball tuck, superman, flying squirrel, flail, sprawl, sit, gingerly, brush, hero, triumph).
Each joint follows its pose with an under-damped spring and lags behind the body's acceleration,
so he moves like a rag doll rather than snapping between poses; the engine adds a tumbling spin
for the launch, bounces and the wipeout. His cape is a 9×12 Verlet cloth tied at the two collarbones, simulated in his body's frame (so
speed never stretches it), with long-range attachment limits, collision with his back and
backpack, a capped oncoming airflow and ripples that travel down it from the shoulders. Steve is
human-sized (about 1.65 units, next to 3.8-unit cars) and a grounding step keeps every limb on top
of the road while he tumbles, lies stunned, sits up and stands. After touchdown he lies stunned with stars circling, sits up, stands
gingerly, brushes off both shoulders, shakes it off and strikes the pose before the result card.

58 stunt suits across four tiers (Rookie $1, Pro $5, Daredevil $20, Legend $100) set the
stuntman's colours, emblem and cape and give him one of seven flight personalities (steady, swoop,
rockabye, twirl, flutter, dart, drift). A 1.00× flight crosses roughly 630 m of city on Rookie up
to 1.8 km on Legend; longer flights are compressed logarithmically so even a 500× result fits in
one sitting.

The payout tables are built so their raw expectation is already near the RTP, so rescaling does
not crush losses: big losses (under 0.3×) are 2 to 12% of rounds depending on stake, the median
round returns about 0.6 to 0.75×, and misfires are a rare Legend-only surprise. A test guards it.
Each stuntman flies in his tier's signature suit. The suit catalogue (`src/data/suits.ts`) is
still in the code but no longer has a menu of its own.

## Look

The interface is styled like a daredevil show poster: navy plates with gold trim, red ribbons, a
marquee sign with chasing bulbs, slanted buttons, and a speedometer-style powder gauge. Display
type is Bungee and UI type is Barlow Condensed, both bundled with the app (via Fontsource) so
they work offline. Numbers sit directly on solid plates, never on a translucent highlight.

## Controls

- **Menu**: tap anywhere outside the side buttons to play. Side groups slide away.
- **Fire**: drag down to pack the powder (the gauge needle climbs, the barrel rises and shakes), let go to fire.
- **Leaf blower**: select it, then press and hold behind Steve (drag to move, tap to jump).
  Behind pushes forward, below lifts, off to one side nudges sideways.
- **Confetti cannon**: select it, then tap behind Steve. Slightly below gives lift.
- **Bottle rockets**: strapped to his backpack before the round. Select, then tap to light the
  next one; tap quickly to fire several.

## Layout

```
src/core      config (RTP, tiers, boosts), RNG, outcome maths, mock server, player profile
src/data      suit catalogue (each tier flies its default suit)
src/game      three.js engine, Steve's rig and poses, cannon, flight plan, city, events, audio
src/ui        DOM menu (stakes + always-open boost loadout) / HUD / settings / result card
tests         node:test checks for the economy and flight planner
```

## Moving to production

- Replace `src/core/server.ts` with real HTTP calls; the request/response types are already
  the API contract. Keep the outcome maths server side.
- Wallet, suit ownership and boost inventory must live on the server too; `src/core/store.ts`
  is a local demo profile.
- The RTP setting in the Settings panel exists for demos and should be removed from a real
  client.
