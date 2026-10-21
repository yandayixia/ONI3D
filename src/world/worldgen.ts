import { WORLD_H, WORLD_W } from '../config';
import { Perlin } from './noise';
import { mulberry32, randInt } from './rng';
import { Tile } from './tiles';
import { World } from './World';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GenResult {
  world: World;
  /** Foot tiles (x, y) for the starting colonists. */
  spawns: { x: number; y: number }[];
  clearing: Rect;
  waterClusters: Rect[];
  stats: {
    /** Fraction of the map that was empty after step 2. */
    emptyFraction: number;
    /** Fraction of the remaining dirt that became rock in step 3. */
    rockFractionOfDirt: number;
  };
}

const EMPTY_FRACTION = 0.2;
const CLEARING_W = 20;
const CLEARING_H = 4;
const WATER_W = 10;
const WATER_H = 4;
const WATER_DIST = 50;

/** Value at quantile q (0..1) of the given samples. */
function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function fillRect(world: World, r: Rect, t: Tile): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (world.inBounds(x, y)) world.tiles[y * world.width + x] = t;
    }
  }
}

export function generateWorld(seed: number, width = WORLD_W, height = WORLD_H): GenResult {
  const rng = mulberry32(seed);
  const world = new World(width, height);
  const n = width * height;
  const tiles = world.tiles;

  // 1. Fill the map with dirt.
  tiles.fill(Tile.Dirt);

  // 2. Carve ~20% of the map into caves using noise A. Thresholding at the
  //    80th percentile makes the empty fraction exact regardless of seed.
  const caveNoise = new Perlin(rng);
  const caveVals = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      caveVals[y * width + x] = caveNoise.fbm(x / 24, y / 24, 3);
    }
  }
  const caveThreshold = quantile(caveVals, 1 - EMPTY_FRACTION);
  let emptyCount = 0;
  for (let i = 0; i < n; i++) {
    if (caveVals[i] > caveThreshold) {
      tiles[i] = Tile.Empty;
      emptyCount++;
    }
  }

  // 3. Turn half of the remaining dirt into rock using an independent noise B
  //    (median threshold over dirt cells only).
  const rockNoise = new Perlin(rng);
  const dirtIdx: number[] = [];
  for (let i = 0; i < n; i++) if (tiles[i] === Tile.Dirt) dirtIdx.push(i);
  const rockVals = new Float32Array(dirtIdx.length);
  dirtIdx.forEach((i, k) => {
    const x = i % width;
    const y = (i / width) | 0;
    rockVals[k] = rockNoise.fbm(x / 16 + 1000, y / 16 + 1000, 3);
  });
  const rockThreshold = quantile(rockVals, 0.5);
  let rockCount = 0;
  dirtIdx.forEach((i, k) => {
    if (rockVals[k] > rockThreshold) {
      tiles[i] = Tile.Rock;
      rockCount++;
    }
  });

  // 4. Open the starting clearing at the center, with a guaranteed floor.
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const clearing: Rect = { x: cx - CLEARING_W / 2, y: cy - CLEARING_H / 2, w: CLEARING_W, h: CLEARING_H };
  fillRect(world, clearing, Tile.Empty);
  const floorY = clearing.y + clearing.h;
  for (let x = clearing.x; x < clearing.x + clearing.w; x++) {
    if (!world.isSolid(x, floorY)) tiles[floorY * width + x] = Tile.Dirt;
  }
  const feetY = floorY - 1;
  const spawns = [cx - 2, cx, cx + 2].map((x) => ({ x, y: feetY }));

  // 5. Two water clusters roughly 50 tiles above and below the colony.
  const waterClusters: Rect[] = [-1, 1].map((dir) => {
    const wx = cx + randInt(rng, -20, 20) - WATER_W / 2;
    const wy = cy + dir * WATER_DIST + randInt(rng, -3, 3) - WATER_H / 2;
    return { x: wx, y: wy, w: WATER_W, h: WATER_H };
  });
  for (const r of waterClusters) fillRect(world, r, Tile.Water);

  return {
    world,
    spawns,
    clearing,
    waterClusters,
    stats: {
      emptyFraction: emptyCount / n,
      rockFractionOfDirt: rockCount / dirtIdx.length,
    },
  };
}
