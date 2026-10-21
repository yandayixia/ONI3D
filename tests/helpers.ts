import { Colonist } from '../src/entities/Colonist';
import { PHYSICS_DT } from '../src/config';
import { Tile } from '../src/world/tiles';
import { World } from '../src/world/World';

const CHARS: Record<string, Tile> = { '.': Tile.Empty, d: Tile.Dirt, '#': Tile.Rock, '~': Tile.Water };

/** Builds a world from ASCII rows: '.' empty, 'd' dirt, '#' rock, '~' water. */
export function worldFromAscii(rows: string[]): World {
  const world = new World(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) world.tiles[y * world.width + x] = CHARS[row[x]];
  });
  return world;
}

export function countTiles(world: World, t: Tile): number {
  let n = 0;
  for (const v of world.tiles) if (v === t) n++;
  return n;
}

/** Spawns a colonist standing at foot tile (x, y). */
export function spawnAt(x: number, y: number): Colonist {
  return new Colonist(0, x + 0.5, y + 1, '#fff');
}

/** Steps a colonist until it goes idle (or time runs out). Returns min/max feet y seen. */
export function simulate(world: World, c: Colonist, seconds: number): { maxPy: number } {
  let maxPy = c.py;
  for (let t = 0; t < seconds; t += PHYSICS_DT) {
    c.update(world, PHYSICS_DT);
    maxPy = Math.max(maxPy, c.py);
    if (c.state === 'idle' && c.grounded && t > 0.1) break;
  }
  return { maxPy };
}
