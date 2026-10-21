import { Tile } from '../world/tiles';
import { World } from '../world/World';

/**
 * Cellular water. Each step, every water tile:
 *  - falls 1 tile if the tile below is empty;
 *  - stays put if resting on dirt/rock;
 *  - if resting on water, tries to slide 1 tile left or right (random order)
 *    into an empty tile, which levels connected bodies into a flat surface.
 */
export class WaterSim {
  private readonly moved: Uint8Array;
  private flip = false;

  constructor(private readonly world: World, private readonly rng: () => number = Math.random) {
    this.moved = new Uint8Array(world.width * world.height);
  }

  step(): void {
    const { width: w, height: h, tiles: t } = this.world;
    const moved = this.moved;
    moved.fill(0);
    // Alternate horizontal scan direction to avoid drifting one way.
    this.flip = !this.flip;
    let changed = false;

    for (let y = h - 1; y >= 0; y--) {
      for (let k = 0; k < w; k++) {
        const x = this.flip ? w - 1 - k : k;
        const i = y * w + x;
        if (t[i] !== Tile.Water || moved[i]) continue;

        const below = y + 1 < h ? t[i + w] : Tile.Rock;
        if (below === Tile.Empty) {
          t[i] = Tile.Empty;
          t[i + w] = Tile.Water;
          moved[i + w] = 1;
          changed = true;
          continue;
        }
        if (below !== Tile.Water) continue;

        const first = this.rng() < 0.5 ? -1 : 1;
        for (const d of [first, -first]) {
          const nx = x + d;
          if (nx < 0 || nx >= w) continue;
          if (t[i + d] === Tile.Empty) {
            t[i] = Tile.Empty;
            t[i + d] = Tile.Water;
            moved[i + d] = 1;
            changed = true;
            break;
          }
        }
      }
    }

    if (changed) this.world.waterVersion++;
  }
}
