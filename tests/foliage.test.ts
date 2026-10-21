import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfinding';
import { Foliage, FoliageMap, generateFoliage, syncFoliage } from '../src/world/foliage';
import { Tile } from '../src/world/tiles';
import { worldFromAscii } from './helpers';

const always = (v: number) => () => v;

/** Cycles through the given values. */
function cycle(...vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

/** Foliage rows as text: '.' empty, 'f' floor moss, 'c' ceiling moss, 'v' vine, 'g' grass. */
function show(map: FoliageMap): string[] {
  const ch = ['.', 'f', 'c', 'v', 'g'];
  const rows: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let row = '';
    for (let x = 0; x < map.width; x++) row += ch[map.get(x, y)];
    rows.push(row);
  }
  return rows;
}

describe('generateFoliage: moss', () => {
  it('grows floor moss on exposed rock at a 15% chance', () => {
    const rows = ['.....', '#####'];
    expect(show(generateFoliage(worldFromAscii(rows), always(0.1)))[1]).toBe('fffff');
    expect(show(generateFoliage(worldFromAscii(rows), always(0.5)))[1]).toBe('.....');
  });

  it('raises the rock chance to 80% within 20 tiles of water', () => {
    const rows = ['~' + '.'.repeat(29), '#'.repeat(30)];
    const map = generateFoliage(worldFromAscii(rows), always(0.5));
    // x=0 has water above (not empty); 1..20 are within 20 tiles; 21+ are not.
    expect(show(map)[1]).toBe('.' + 'f'.repeat(20) + '.'.repeat(9));
  });

  it('grows floor moss on exposed dirt only between two dirt tiles', () => {
    expect(show(generateFoliage(worldFromAscii(['.....', 'ddddd']), always(0.99)))[1]).toBe('.fff.');
    expect(show(generateFoliage(worldFromAscii(['.....', 'ddd#d']), always(0.99)))[1]).toBe('.f...');
  });

  it('treats water above as not empty', () => {
    expect(show(generateFoliage(worldFromAscii(['~~~~~', 'ddddd']), always(0.1)))[1]).toBe('.....');
  });

  it('grows ceiling moss under exposed tiles by the same rules', () => {
    const map = generateFoliage(worldFromAscii(['ddddd', '.....', '~~~~~']), always(0.99));
    expect(show(map)).toEqual(['.ccc.', '.....', '.....']);
  });

  it('gives a one-tile shelf ceiling moss, not floor moss', () => {
    const map = generateFoliage(worldFromAscii(['.....', 'ddddd', '.....']), always(0.99));
    expect(show(map)[1]).toBe('.ccc.');
  });
});

describe('generateFoliage: grass, vines and flowers', () => {
  it('grows grass above floor moss that has a floor-moss neighbour', () => {
    expect(show(generateFoliage(worldFromAscii(['.....', 'ddddd']), always(0.99)))).toEqual(['.ggg.', '.fff.']);
    // Lone moss tiles (x=1 and x=5) get no grass.
    expect(show(generateFoliage(worldFromAscii(['.......', 'ddd#ddd']), always(0.99)))).toEqual(['.......', '.f...f.']);
  });

  it('does not place a vine without room below', () => {
    // Every vine roll succeeds, but the tiles under the ceiling moss hold grass.
    const map = generateFoliage(worldFromAscii(['ddddd', '.....', 'ddddd']), always(0.1));
    expect(map.vines).toEqual([]);
    expect(show(map)[1]).toBe('.ggg.');
  });

  it('limits vine length to the open tiles below, up to 5', () => {
    // Vine roll, then length roll, for each ceiling moss tile.
    const short = generateFoliage(worldFromAscii(['ddddd', '.....', '.....', '.....', '~~~~~']), cycle(0.1, 0.99));
    expect(short.vines.map((v) => v.length)).toEqual([3, 3, 3]);
    const long = generateFoliage(worldFromAscii(['ddddd', ...Array(7).fill('.....'), '~~~~~']), cycle(0.1, 0.99));
    expect(long.vines.map((v) => v.length)).toEqual([5, 5, 5]);
    for (const v of long.vines) {
      expect(long.get(v.x, v.y - 1)).toBe(Foliage.CeilingMoss);
      for (let k = 0; k < 5; k++) expect(long.get(v.x, v.y + k)).toBe(Foliage.Vine);
      expect(long.get(v.x, v.y + 5)).toBe(Foliage.Empty);
    }
  });

  it('puts flowers only on grass, outside the foliage array, and keeps foreground flowers under a low ceiling', () => {
    // Dirt above x=1 and x=3, water above x=2. Rolls: chance 0.05 passes, then
    // 0.99 for every flower parameter (the tallest size, the most leaves).
    const world = worldFromAscii(['~d~d~', '.....', 'ddddd']);
    const map = generateFoliage(world, cycle(0.05, 0.99, 0.99, 0.99, 0.99, 0.99));
    expect(show(map)[1]).toBe('.ggg.');
    expect(map.flowers).toHaveLength(6);
    for (const f of map.flowers) {
      expect(map.get(f.x, f.y)).toBe(Foliage.Grass);
      expect(f.leaves).toBe(f.front ? 5 : 3);
    }
    const front = new Map(map.flowers.filter((f) => f.front).map((f) => [f.x, f.height]));
    expect(front.get(1)).toBeLessThan(1);
    expect(front.get(3)).toBeLessThan(1);
    expect(front.get(2)).toBeGreaterThan(1.1); // 2 tiles of headroom: not clamped
    for (const f of map.flowers.filter((f) => !f.front)) expect(f.height).toBeLessThanOrEqual(2 * 0.4 * 1.1);
  });

  it('never changes the terrain, so pathfinding is unaffected', () => {
    const rows = ['#######', '#ddddd#', '#.....#', '#.....#', '#ddddd#', '#######'];
    const world = worldFromAscii(rows);
    const before = Uint8Array.from(world.tiles);
    const path = findPath(world, 1, 3, (x, y) => x === 5 && y === 3, 5, 3);
    generateFoliage(world, always(0.05));
    expect(world.tiles).toEqual(before);
    expect(findPath(world, 1, 3, (x, y) => x === 5 && y === 3, 5, 3)).toEqual(path);
  });
});

describe('syncFoliage', () => {
  const rows = ['ddddd', '.....', '.....', 'ddddd', 'ddddd'];

  it('does nothing while the terrain is unchanged', () => {
    const world = worldFromAscii(rows);
    const map = generateFoliage(world, always(0.05));
    const cells = Uint8Array.from(map.cells);
    syncFoliage(map, world);
    expect(map.version).toBe(0);
    expect(map.cells).toEqual(cells);
  });

  it('removes moss, grass, flowers and vines that lose their support when tiles are dug', () => {
    const world = worldFromAscii(rows);
    const map = generateFoliage(world, always(0.05));
    expect(show(map)).toEqual(['.ccc.', '.vvv.', '.ggg.', '.fff.', '.....']);
    expect(map.flowers.filter((f) => f.x === 2)).toHaveLength(2);

    world.set(2, 3, Tile.Empty); // floor moss under the middle grass
    world.set(3, 0, Tile.Empty); // ceiling moss holding the right vine
    syncFoliage(map, world);

    expect(show(map)).toEqual(['.cc..', '.vv..', '.g.g.', '.f.f.', '.....']);
    expect(map.vines.map((v) => v.x)).toEqual([1, 2]);
    expect(map.flowers.some((f) => f.x === 2)).toBe(false);
    expect(map.flowers.some((f) => f.x === 1)).toBe(true);
    expect(map.version).toBe(1);
  });
});
