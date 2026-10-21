import { describe, expect, it } from 'vitest';
import { CORNER_BL, CORNER_BR, CORNER_TL, CORNER_TR, cutsAt, filledCells, waterCornerFills } from '../src/render/terrainEdges';
import { NOISE_RES } from '../src/render/tileArt';
import { worldFromAscii } from './helpers';

function fills(rows: string[]): Map<string, number> {
  const world = worldFromAscii(rows);
  const out = new Map<string, number>();
  for (const [i, c] of waterCornerFills(world, 0, 0, world.width, world.height)) {
    out.set(`${i % world.width},${Math.floor(i / world.width)}`, c);
  }
  return out;
}

describe('waterCornerFills', () => {
  it('fills the near corners of terrain beside water', () => {
    expect(fills(['.....', '.~d..', '.....'])).toEqual(new Map([['2,1', CORNER_TL | CORNER_BL]]));
    expect(fills(['.....', '.#~..', '.....'])).toEqual(new Map([['1,1', CORNER_TR | CORNER_BR]]));
  });

  it('fills the top corners of terrain below water', () => {
    expect(fills(['.~.', '.d.', '...'])).toEqual(new Map([['1,1', CORNER_TL | CORNER_TR]]));
  });

  it('fills the touching top corner of terrain diagonally below water', () => {
    expect(fills(['~..', '.d.', '...'])).toEqual(new Map([['1,1', CORNER_TL]]));
    expect(fills(['..~', '.#.', '...'])).toEqual(new Map([['1,1', CORNER_TR]]));
  });

  it('never fills from water below or diagonally above-below', () => {
    expect(fills(['...', '.d.', '.~.'])).toEqual(new Map());
    expect(fills(['...', '.d.', '~.~'])).toEqual(new Map());
  });

  it('merges corners from several water tiles into one entry per terrain tile', () => {
    expect(fills(['~~.', '~d.', '...'])).toEqual(new Map([['1,1', CORNER_TL | CORNER_TR | CORNER_BL]]));
  });

  it('ignores the map edge, which reads as rock', () => {
    expect(fills(['~.', '..'])).toEqual(new Map());
  });
});

describe('filledCells', () => {
  const A = NOISE_RES;

  it('returns only cut cells inside the requested corners', () => {
    // An isolated tile: every corner is cut.
    const world = worldFromAscii(['...', '.d.', '...']);
    const cut = cutsAt(world, 1, 1)!;
    const left = filledCells(cut, CORNER_TL | CORNER_BL);
    expect(left.length).toBeGreaterThan(0);
    for (const c of left) {
      expect(cut[c]).toBe(1);
      expect(c % A).toBeLessThan(A / 2);
    }
    const all = filledCells(cut, CORNER_TL | CORNER_TR | CORNER_BL | CORNER_BR);
    expect(all.length).toBe(cut.reduce((a, b) => a + b, 0));
    expect(filledCells(cut, 0)).toEqual([]);
  });

  it('fills the notch beside a pool and leaves the far side alone', () => {
    // Water to the left of a dirt step that is open above and to both sides.
    const world = worldFromAscii(['....', '.~d.', '####']);
    const [corners] = waterCornerFills(world, 0, 0, 4, 3).values();
    const cut = cutsAt(world, 2, 1)!;
    const cells = filledCells(cut, corners);
    expect(cells.some((c) => c === 0)).toBe(true); // top-left cell
    expect(cells.some((c) => c % A >= A / 2)).toBe(false); // nothing on the right
  });
});
