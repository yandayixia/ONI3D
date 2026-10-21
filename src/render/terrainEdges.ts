import { Tile, isSolidTile } from '../world/tiles';
import { World } from '../world/World';
import { cornerCuts, NOISE_RES } from './tileArt';

/** Corner bits, matching cornerCuts' corner order. */
export const CORNER_TL = 1;
export const CORNER_TR = 2;
export const CORNER_BL = 4;
export const CORNER_BR = 8;

/** Cells cut from the exposed corners of the terrain tile at (x, y), or null. */
export function cutsAt(world: World, x: number, y: number): Uint8Array | null {
  const t = world.get(x, y);
  if (!isSolidTile(t)) return null;
  return cornerCuts(t, x, y, !world.isSolid(x, y - 1), !world.isSolid(x + 1, y), !world.isSolid(x, y + 1), !world.isSolid(x - 1, y));
}

// Terrain tiles around a water tile, and which of their corners face it:
// left/right neighbours their near side, the tile below its top corners, and
// the diagonals below the corner touching the water.
const WATER_NEIGHBOURS: [dx: number, dy: number, corners: number][] = [
  [-1, 0, CORNER_TR | CORNER_BR],
  [1, 0, CORNER_TL | CORNER_BL],
  [0, 1, CORNER_TL | CORNER_TR],
  [-1, 1, CORNER_TR],
  [1, 1, CORNER_TL],
];

/**
 * For water tiles in [x0, x1) x [y0, y1), the corners of neighbouring terrain
 * tiles that face the water, keyed by tile index. Cells cut from those
 * corners are drawn as water so pools fill the rounded corners.
 */
export function waterCornerFills(world: World, x0: number, y0: number, x1: number, y1: number): Map<number, number> {
  const fills = new Map<number, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (world.get(x, y) !== Tile.Water) continue;
      for (const [dx, dy, corners] of WATER_NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny) || !world.isSolid(nx, ny)) continue;
        const i = ny * world.width + nx;
        fills.set(i, (fills.get(i) ?? 0) | corners);
      }
    }
  }
  return fills;
}

/** Indices of the cut cells that belong to the given corners (each corner owns its quadrant). */
export function filledCells(cut: Uint8Array, corners: number): number[] {
  const A = NOISE_RES;
  const half = A / 2;
  const cells: number[] = [];
  for (let cy = 0; cy < A; cy++) {
    for (let cx = 0; cx < A; cx++) {
      const corner = 1 << ((cx >= half ? 1 : 0) | (cy >= half ? 2 : 0));
      if (cut[cy * A + cx] && corners & corner) cells.push(cy * A + cx);
    }
  }
  return cells;
}
