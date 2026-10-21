import { WORLD_H, WORLD_W } from '../config';
import { FoliageMap, generateFoliage } from './foliage';
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

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface GenResult {
  world: World;
  foliage: FoliageMap;
  /** Foot tiles (x, y) for the starting colonists. */
  spawns: { x: number; y: number }[];
  /** The nominal clearing rect, before edge jagging. */
  clearing: Rect;
  /** The tiles actually carved for the clearing. */
  clearingCells: { x: number; y: number }[];
  /** The four water pits from step 2, before edge jagging. */
  waterClusters: Rect[];
  /** -1 (left) or 1 (right): the side of the clearing the starting pond is on. */
  dominantSide: number;
  pond: Rect;
  stats: {
    /** Fraction of the map carved into caves in step 3. */
    emptyFraction: number;
    /** Fraction of the remaining dirt that became rock in step 4. */
    rockFractionOfDirt: number;
    /** Water tiles on the finished map. */
    waterTiles: number;
  };
}

const EMPTY_FRACTION = 0.2;
const CLEARING_W = 20;
const CLEARING_H = 4;
const PIT_W: [number, number] = [15, 25];
const PIT_H: [number, number] = [4, 8];
const PIT_DIST = 50;
const PIT_OFFSET_X: [number, number] = [15, 35];
const POND_W = 10;
const POND_H = 4;
const POND_GAP: [number, number] = [20, 30];

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

/**
 * Edge jagging process: fills `r` with `t`, but every tile along the given
 * sides is moved -1..1 tiles along that side's outward normal (+1 also fills
 * the tile just outside, -1 leaves this edge tile unfilled). Sides are always
 * processed top, bottom, left, right. Only in-bounds tiles are written; they
 * are returned.
 */
export function jagRect(world: World, r: Rect, t: Tile, sides: Side[], rng: () => number): { x: number; y: number }[] {
  // Mask over the rect grown by 1 on every side.
  const mw = r.w + 2;
  const mask = new Uint8Array(mw * (r.h + 2));
  const at = (x: number, y: number) => (y - r.y + 1) * mw + (x - r.x + 1);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) mask[at(x, y)] = 1;
  }
  const push = (x: number, y: number, nx: number, ny: number) => {
    const d = randInt(rng, -1, 1);
    if (d > 0) mask[at(x + nx, y + ny)] = 1;
    else if (d < 0) mask[at(x, y)] = 0;
  };
  const right = r.x + r.w - 1;
  const bottom = r.y + r.h - 1;
  if (sides.includes('top')) for (let x = r.x; x <= right; x++) push(x, r.y, 0, -1);
  if (sides.includes('bottom')) for (let x = r.x; x <= right; x++) push(x, bottom, 0, 1);
  if (sides.includes('left')) for (let y = r.y; y <= bottom; y++) push(r.x, y, -1, 0);
  if (sides.includes('right')) for (let y = r.y; y <= bottom; y++) push(right, y, 1, 0);

  const cells: { x: number; y: number }[] = [];
  for (let y = r.y - 1; y <= bottom + 1; y++) {
    for (let x = r.x - 1; x <= right + 1; x++) {
      if (!mask[at(x, y)] || !world.inBounds(x, y)) continue;
      world.tiles[y * world.width + x] = t;
      cells.push({ x, y });
    }
  }
  return cells;
}

export function generateWorld(seed: number, width = WORLD_W, height = WORLD_H): GenResult {
  const rng = mulberry32(seed);
  const world = new World(width, height);
  const n = width * height;
  const tiles = world.tiles;
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);

  // 1. Fill the map with dirt.
  tiles.fill(Tile.Dirt);

  // 2. Four jagged water pits: two ~50 tiles above the center and two ~50
  //    below, one left and one right of center so a pair never overlaps.
  const waterClusters: Rect[] = [];
  for (const dir of [-1, 1]) {
    for (const side of [-1, 1]) {
      const w = randInt(rng, PIT_W[0], PIT_W[1]);
      const h = randInt(rng, PIT_H[0], PIT_H[1]);
      const px = cx + side * randInt(rng, PIT_OFFSET_X[0], PIT_OFFSET_X[1]);
      const py = cy + dir * PIT_DIST + randInt(rng, -3, 3);
      waterClusters.push({ x: px - Math.floor(w / 2), y: py - Math.floor(h / 2), w, h });
    }
  }
  for (const r of waterClusters) jagRect(world, r, Tile.Water, ['top', 'bottom', 'left', 'right'], rng);

  // 3. Dig caves: carve ~20% of the map using noise A. Thresholding at the
  //    80th percentile makes the empty fraction exact regardless of seed.
  //    Water pits are left alone.
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
    if (caveVals[i] > caveThreshold && tiles[i] !== Tile.Water) {
      tiles[i] = Tile.Empty;
      emptyCount++;
    }
  }

  // 4. Dirt to rock: turn half of the remaining dirt into rock using an
  //    independent noise B (median threshold over dirt cells only).
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

  // 5. Spawn point: open the starting clearing at the center (jagged top,
  //    left and right edges), with a guaranteed floor under every column.
  const clearing: Rect = { x: cx - CLEARING_W / 2, y: cy - CLEARING_H / 2, w: CLEARING_W, h: CLEARING_H };
  const clearingCells = jagRect(world, clearing, Tile.Empty, ['top', 'left', 'right'], rng);
  const floorY = clearing.y + clearing.h;
  for (const c of clearingCells) {
    if (c.y === floorY - 1 && !world.isSolid(c.x, floorY)) tiles[floorY * width + c.x] = Tile.Dirt;
  }
  const feetY = floorY - 1;
  const spawns = [cx - 2, cx, cx + 2].map((x) => ({ x, y: feetY }));
  const dominantSide = rng() < 0.5 ? -1 : 1;

  // 6. Starting pond beside the clearing on the dominant side, at about the
  //    elevation of the spawn platform.
  const gap = randInt(rng, POND_GAP[0], POND_GAP[1]);
  const pondBottom = feetY + randInt(rng, -2, 2);
  const pond: Rect = {
    x: dominantSide > 0 ? clearing.x + clearing.w + gap : clearing.x - gap - POND_W,
    y: pondBottom - POND_H + 1,
    w: POND_W,
    h: POND_H,
  };
  fillRect(world, pond, Tile.Water);

  // 7. Foliage.
  const foliage = generateFoliage(world, rng);

  let waterTiles = 0;
  for (let i = 0; i < n; i++) if (tiles[i] === Tile.Water) waterTiles++;

  return {
    world,
    foliage,
    spawns,
    clearing,
    clearingCells,
    waterClusters,
    dominantSide,
    pond,
    stats: {
      emptyFraction: emptyCount / n,
      rockFractionOfDirt: rockCount / dirtIdx.length,
      waterTiles,
    },
  };
}
