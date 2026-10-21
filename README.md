# Colony Sim

A browser-based colony simulation prototype with a 2D side-view tile platformer view. The world is a 200×200 tile grid of dirt, rock, water and open caves. You directly control a small group of colonists: select them with the mouse, send them to a location, or order them to dig out dirt.

Built with TypeScript, Vite and the HTML5 Canvas 2D API. There is no game framework and no image assets; sprites are drawn in code.

## Getting started

```sh
npm install
npm run dev       # start the dev server and open the game in your browser
npm test          # run the Vitest suite
npm run build     # type-check and build to dist/
npm run preview   # serve the production build
```

Each load generates a new random map. Add `?seed=<number>` to the URL (e.g. `http://localhost:5173/?seed=42`) to get the same map every time. The current seed is shown in the top-left HUD.

## Controls

| Input | Action |
| --- | --- |
| Left-click a colonist | Select it (replaces the current selection) |
| Shift + left-click a colonist | Add it to / remove it from the selection |
| Left-click an empty or water tile | Selected colonists move there |
| Left-click a dirt tile | Selected colonists go dig it out |
| Left-click a rock tile | Refused (the tile flashes red) |
| Right-click / Esc | Deselect all |
| WASD / arrow keys / middle-drag | Pan the camera |
| Mouse wheel | Zoom (anchored at the cursor) |

While colonists are selected, the hovered tile is outlined yellow (dig), red (can't dig) or white (move). Selected colonists show their planned path as a dotted line.

## Game rules

### Tiles

| Tile | Solid | Diggable | Affected by gravity |
| --- | --- | --- | --- |
| Empty | no | — | — |
| Dirt | yes | yes | no |
| Rock | yes | no | no |
| Water | no | — | yes |

Colonists can stand on dirt and rock. Water is passable: colonists walk and sink through it. The map edge acts as solid rock.

### Water

Water updates 10 times per second. Each water tile:

1. Falls 1 tile if the tile below is empty.
2. Stays put if the tile below is dirt or rock.
3. If the tile below is water, tries to move 1 tile left or right (random order) into an empty tile. This makes a connected body of water spread out and level into a flat surface.

Water ignores colonists, and the total amount of water never changes.

### Colonists

- 1×2 tiles in size. The collision box is slightly smaller (0.8 × 1.9) so they fit 1-wide shafts and 2-tall tunnels.
- Affected by gravity whenever there is no solid tile beneath them. They sink more slowly in water but otherwise move through it normally.
- Walk at 4 tiles/s. A jump peaks at about 2.3 tiles, enough to climb a 2-tile ledge or clear a 2-tile-wide gap.
- States:
  - **Idle**: standing still.
  - **Moving**: following a planned path to the clicked spot. If the spot can't be reached, the colonist goes as close as it can.
  - **Working**: standing next to a dirt tile and digging it. Digging takes 1.5 s and replaces the tile with empty space. Colonists can dig tiles beside them, just above their head, or directly under their feet.
- Whenever terrain changes (e.g. another colonist digs), moving colonists re-plan their route. A colonist that makes no progress for 3 s re-plans, and gives up after 4 retries.
- Colonists don't collide with each other.

### Pathfinding

The path graph's nodes are "foot tiles": a tile where a colonist's 2-tall body fits and there is a solid tile underneath. A* search uses these moves:

- **Walk** 1 tile left/right on the same level.
- **Step up** 1 or 2 tiles onto an adjacent ledge (needs headroom).
- **Drop** off a ledge to the first floor below.
- **Gap jump** 2–3 tiles horizontally (clearing a gap up to 2 wide), landing up to 2 tiles higher or lower, if the arc is clear.

## World generation

Maps are generated from a seed (`src/world/worldgen.ts`):

1. Fill the entire 200×200 map with dirt.
2. Sample a Perlin noise field (3-octave fBm) and turn the top 20% of values into empty tiles, which carves cave-like pockets. Thresholding at the 80th percentile keeps the empty share at about 20% for every seed.
3. Sample a second, independent Perlin noise field over the remaining dirt tiles and turn the half above the median into rock.
4. Open a 20×4 empty clearing at the center of the map (x 90–109, y 98–101). Any gaps in the row beneath it are filled with dirt so the colony has a floor. Spawn 3 colonists side by side in the clearing.
5. Place two 10×4 water clusters, one about 50 tiles above and one about 50 tiles below the colony (±3 tiles vertically, ±20 tiles horizontally from center). They overwrite whatever was there, then fall and spread into nearby caves once the simulation runs.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell: full-window canvas and HUD |
| `src/main.ts` | Boot, fixed-timestep game loop (physics 60 Hz, water 10 Hz), HUD |
| `src/config.ts` | All tuning constants |
| `src/world/tiles.ts` | Tile types and the solidity rule |
| `src/world/World.ts` | Tile grid, change counters for terrain and water |
| `src/world/noise.ts` | Seeded 2D Perlin noise and fBm |
| `src/world/rng.ts` | Seeded PRNG (mulberry32) |
| `src/world/worldgen.ts` | The 5-step map generator |
| `src/sim/water.ts` | Cellular water simulation |
| `src/sim/pathfinding.ts` | Path graph and A* search |
| `src/entities/Colonist.ts` | Colonist physics, state machine and path following |
| `src/game/Game.ts` | Game state: world, colonists, selection, commands |
| `src/input/Input.ts` | Mouse selection and commands, camera keys |
| `src/render/Camera.ts` | Pan/zoom and screen-to-world conversion |
| `src/render/Renderer.ts` | Draws terrain, water, colonists and overlays |
| `tests/` | Vitest tests for worldgen, water, pathfinding, colonists and a full game run |

## Tuning

Gameplay numbers live in `src/config.ts`: world size, gravity, walk/air speed, jump height, fall speed in and out of water, dig time, stuck/retry limits and simulation tick rates. Generation parameters (empty fraction, clearing size, water cluster size and distance) are constants at the top of `src/world/worldgen.ts`.

## Known limitations

- When a pool has a few extra tiles that don't fill a whole new layer, they keep sliding back and forth on the surface. This follows directly from the random left/right rule.
- Colonists ordered as a group all head for the same tile and overlap there.
- There is no fall damage, drowning or other colonist needs yet.
