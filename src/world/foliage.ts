import { randInt } from './rng';
import { Tile, isSolidTile } from './tiles';
import { World } from './World';

/** What grows on or in a tile. Flowers are kept in a separate list, not here. */
export enum Foliage {
  Empty = 0,
  FloorMoss = 1,
  CeilingMoss = 2,
  Vine = 3,
  Grass = 4,
}

export interface Vine {
  x: number;
  /** Top vine tile (directly below its ceiling moss). */
  y: number;
  length: number;
}

export interface Flower {
  /** The grass tile it grows in. */
  x: number;
  y: number;
  /** Foreground (layer 31) or background (layer 10). */
  front: boolean;
  seed: number;
  /** Height in tiles, measured up from the bottom of the grass tile. */
  height: number;
  /** Petal hue in degrees. */
  hue: number;
  leaves: number;
}

const MOSS_CHANCE = 0.15;
const MOSS_CHANCE_WET = 0.8;
const WATER_RADIUS = 20;
const VINE_CHANCE = 0.2;
const VINE_MAX = 20;
const FLOWER_CHANCE = 0.1;
/** Colonist height in tiles; flower sizes are fractions of it. */
const COLONIST_H = 2;

export class FoliageMap {
  readonly cells: Uint8Array;
  vines: Vine[] = [];
  flowers: Flower[] = [];
  /** Bumped whenever foliage is removed. */
  version = 0;
  /** The world.version this map was last checked against. */
  worldVersion = 0;

  constructor(readonly width: number, readonly height: number) {
    this.cells = new Uint8Array(width * height);
  }

  get(x: number, y: number): Foliage {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return Foliage.Empty;
    return this.cells[y * this.width + x];
  }
}

/** Returns a lookup for "is there water within `r` tiles (square radius)", via a summed-area table. */
function waterNearby(world: World, r: number): (x: number, y: number) => boolean {
  const { width: w, height: h, tiles } = world;
  const sw = w + 1;
  const sat = new Int32Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] === Tile.Water) row++;
      sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
    }
  }
  return (x, y) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1);
    const y1 = Math.min(h, y + r + 1);
    return sat[y1 * sw + x1] - sat[y0 * sw + x1] - sat[y1 * sw + x0] + sat[y0 * sw + x0] > 0;
  };
}

/** Moss rule for a tile whose open side is at y + dy. */
function growsMoss(world: World, x: number, y: number, dy: number, wet: (x: number, y: number) => boolean, rng: () => number): boolean {
  const t = world.get(x, y);
  if (!isSolidTile(t) || world.get(x, y + dy) !== Tile.Empty) return false;
  if (t === Tile.Rock) return rng() < (wet(x, y) ? MOSS_CHANCE_WET : MOSS_CHANCE);
  return world.get(x - 1, y) === Tile.Dirt && world.get(x + 1, y) === Tile.Dirt;
}

/** Foliage spawn passes, run after the terrain is final. Never changes the terrain. */
export function generateFoliage(world: World, rng: () => number): FoliageMap {
  const { width: w, height: h } = world;
  const map = new FoliageMap(w, h);
  const cells = map.cells;
  const wet = waterNearby(world, WATER_RADIUS);

  // 1. Floor moss.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (growsMoss(world, x, y, -1, wet, rng)) cells[y * w + x] = Foliage.FloorMoss;
    }
  }

  // 2. Ceiling moss. A one-tile shelf can qualify for both; ceiling moss wins.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (growsMoss(world, x, y, 1, wet, rng)) cells[y * w + x] = Foliage.CeilingMoss;
    }
  }

  // 3. Grass above floor moss that has floor-moss neighbours.
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cells[i] !== Foliage.FloorMoss) continue;
      if (map.get(x - 1, y) !== Foliage.FloorMoss && map.get(x + 1, y) !== Foliage.FloorMoss) continue;
      if (world.get(x, y - 1) === Tile.Empty && cells[i - w] === Foliage.Empty) cells[i - w] = Foliage.Grass;
    }
  }

  // 4. Hanging vines under ceiling moss, as long as the space below allows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== Foliage.CeilingMoss || rng() >= VINE_CHANCE) continue;
      let maxLen = 0;
      while (maxLen < VINE_MAX) {
        const vy = y + 1 + maxLen;
        if (vy >= h || world.get(x, vy) !== Tile.Empty || cells[vy * w + x] !== Foliage.Empty) break;
        maxLen++;
      }
      if (maxLen === 0) continue;
      const length = randInt(rng, 1, maxLen);
      for (let k = 1; k <= length; k++) cells[(y + k) * w + x] = Foliage.Vine;
      map.vines.push({ x, y: y + 1, length });
    }
  }

  // 5 & 6. Background and foreground flowers on grass.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== Foliage.Grass) continue;
      if (rng() < FLOWER_CHANCE) map.flowers.push(makeFlower(world, x, y, false, rng));
      if (rng() < FLOWER_CHANCE) map.flowers.push(makeFlower(world, x, y, true, rng));
    }
  }

  map.worldVersion = world.version;
  return map;
}

function makeFlower(world: World, x: number, y: number, front: boolean, rng: () => number): Flower {
  const [lo, hi, variance] = front ? [0.3, 0.55, 0.15] : [0.1, 0.4, 0.1];
  let height = COLONIST_H * (lo + rng() * (hi - lo)) * (1 + (rng() * 2 - 1) * variance);
  if (front) {
    // Foreground flowers draw over terrain, so keep them below a low ceiling.
    const headroom = world.isSolid(x, y - 1) ? 1 : 2;
    height = Math.min(height, headroom - 0.1);
  }
  return {
    x,
    y,
    front,
    seed: (rng() * 4294967296) >>> 0,
    height,
    hue: rng() * 360,
    leaves: front ? randInt(rng, 1, 5) : randInt(rng, 0, 3),
  };
}

/**
 * Removes foliage the terrain no longer supports (e.g. after digging): moss on
 * a tile that is gone, grass without floor moss below, vines cut off from their
 * ceiling moss, and flowers whose grass is gone. Nothing regrows.
 */
export function syncFoliage(map: FoliageMap, world: World): void {
  if (map.worldVersion === world.version) return;
  map.worldVersion = world.version;
  const { width: w, cells } = map;
  const tiles = world.tiles;
  let changed = false;

  for (let i = 0; i < cells.length; i++) {
    const f = cells[i];
    if ((f === Foliage.FloorMoss || f === Foliage.CeilingMoss) && !isSolidTile(tiles[i])) {
      cells[i] = Foliage.Empty;
      changed = true;
    }
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === Foliage.Grass && (i + w >= cells.length || cells[i + w] !== Foliage.FloorMoss)) {
      cells[i] = Foliage.Empty;
      changed = true;
    }
  }

  const vines: Vine[] = [];
  for (const v of map.vines) {
    const rooted = map.get(v.x, v.y - 1) === Foliage.CeilingMoss;
    if (!rooted) {
      for (let k = 0; k < v.length; k++) cells[(v.y + k) * w + v.x] = Foliage.Empty;
      changed = true;
    } else {
      vines.push(v);
    }
  }
  map.vines = vines;

  const flowers = map.flowers.filter((f) => cells[f.y * w + f.x] === Foliage.Grass);
  if (flowers.length !== map.flowers.length) changed = true;
  map.flowers = flowers;

  if (changed) map.version++;
}
