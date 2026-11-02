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
visit it works offline.

## How a round is decided

1. The player picks a tier (which fixes the stake) and a stunt suit from that tier, and
   optionally buys mid-flight boosts. Boost costs are added to the wager.
2. When the cannon fires, the client sends one bet request to `src/core/server.ts`.
   That module is a mock of a game server, written like a remote API so it can be moved to a
   real backend untouched. It:
   - debits the total wager,
   - draws a uniform random number from `sha256(serverSeed:clientSeed:nonce)`,
   - maps it to a multiplier using the tier's bucket table (`src/core/outcome.ts`), scaled so
     the **expected multiplier is exactly the configured RTP**,
   - returns the payout, the distance (`multiplier × tier base distance`) and a world seed.
3. Only then does the client build a flight plan (`src/game/flightPlan.ts`): a precomputed
   position/velocity/height curve that ends at that distance, with boosts and obstacles placed
   where the curve speeds up or slows down. Objects are chosen to suit Steve's altitude at that
   point: aerial ones (gulls, balloons, banner planes, blimps, airliner jetwash, fireworks) and
   ground ones that bend the height curve down to meet them and bounce him back up (trampolines,
   bouncy castles, tyre stacks, industrial fans) or barely (traffic cones, a hot dog cart, a
   mattress). Some flights end in a dumpster or a hay truck, which stop him dead with no skid.
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

## The city

`src/game/city.ts` generates an endless city along the avenue the plane flies over. It is laid out
on a fixed grid (avenue, cross streets every block, five side streets each way) so nothing is ever
placed in a road. Districts follow a seeded random walk: suburbs, residential blocks, commercial
strips, downtown towers, parks, a river crossing with a bridge, industrial yards and an old town,
with landmarks (clock tower, cathedral, stadium, a turning ferris wheel, obelisk plaza, triumphal
arch over the avenue, domed hall, radio mast, water tower) every few blocks. Each chunk is baked
into three merged meshes (plain, windowed, glass) so the whole view stays at a couple of hundred
draw calls. The cash track is painted down the avenue in a slightly different shade of whatever
the avenue is made of in that district.

## Steve and his wardrobe

Steve is a jointed figure built from primitives (`src/game/steve.ts`) with a library of poses
(cannonball tuck, superman, flying squirrel, flail, sprawl, sit, gingerly, brush, hero, triumph)
that the engine blends between as the flight progresses, plus a tumbling spin for the launch,
bounces and the wipeout. After touchdown he lies stunned with stars circling, sits up, stands
gingerly, brushes off both shoulders, shakes it off and strikes the pose before the result card.

58 stunt suits across four tiers (Rookie $1, Pro $5, Daredevil $20, Legend $100) set his colours,
emblem and cape and give him one of seven flight personalities (steady, swoop, rockabye, twirl,
flutter, dart, drift). A 1.00× flight crosses roughly 420 m of city on Rookie up to 1.2 km on
Legend; longer flights are compressed logarithmically so even a 500× result fits in one sitting.
Each tier has a free default suit; the rest are bought from the wallet.

## Controls

- **Menu**: tap anywhere outside the side buttons to play. Side groups slide away.
- **Fire**: drag down to pack the powder (the barrel rises and shakes), let go to fire.
- **Leaf blower**: select it, then press and hold behind Steve (drag to move, tap to jump).
  Behind pushes forward, below lifts, off to one side nudges sideways.
- **Confetti cannon**: select it, then tap behind Steve. Slightly below gives lift.
- **Bottle rockets**: strapped to his backpack before the round. Select, then tap to light the
  next one; tap quickly to fire several.

## Layout

```
src/core      config (RTP, tiers, boosts), RNG, outcome maths, mock server, player profile
src/data      the suit wardrobe
src/game      three.js engine, Steve's rig and poses, cannon, flight plan, city, events, audio
src/ui        DOM menu / HUD / wardrobe / shop / settings, SVG suit thumbnails
tests         node:test checks for the economy and flight planner
```

## Moving to production

- Replace `src/core/server.ts` with real HTTP calls; the request/response types are already
  the API contract. Keep the outcome maths server side.
- Wallet, suit ownership and boost inventory must live on the server too; `src/core/store.ts`
  is a local demo profile.
- The RTP setting in the Settings panel exists for demos and should be removed from a real
  client.
