import { describe, expect, it } from 'vitest';
import { Tile } from '../src/world/tiles';
import { World } from '../src/world/World';
import { jagRect, Rect } from '../src/world/worldgen';
import { countTiles } from './helpers';

// randInt(rng, -1, 1) rolls -1 for 0, 0 for 0.5 and +1 for 0.99.
const always = (v: number) => () => v;
const ALL = ['top', 'bottom', 'left', 'right'] as const;
const rect: Rect = { x: 2, y: 2, w: 4, h: 3 };

describe('jagRect (edge jagging)', () => {
  it('fills exactly the rect when every roll is 0', () => {
    const world = new World(10, 10);
    const cells = jagRect(world, rect, Tile.Water, [...ALL], always(0.5));
    expect(cells).toHaveLength(12);
    expect(countTiles(world, Tile.Water)).toBe(12);
  });

  it('shrinks every requested edge by one when every roll is -1', () => {
    const world = new World(10, 10);
    const cells = jagRect(world, rect, Tile.Water, [...ALL], always(0));
    expect(cells).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(countTiles(world, Tile.Water)).toBe(2);
  });

  it('grows every requested edge by one (no diagonal corners) when every roll is +1', () => {
    const world = new World(10, 10);
    const cells = jagRect(world, rect, Tile.Water, [...ALL], always(0.99));
    expect(cells).toHaveLength(12 + 2 * 4 + 2 * 3);
    expect(world.get(1, 1)).toBe(Tile.Empty);
    expect(world.get(1, 2)).toBe(Tile.Water);
    expect(world.get(2, 1)).toBe(Tile.Water);
  });

  it('leaves sides that were not requested untouched', () => {
    const world = new World(10, 10);
    jagRect(world, rect, Tile.Water, ['top'], always(0.99));
    for (let x = 2; x < 6; x++) expect(world.get(x, 1)).toBe(Tile.Water);
    for (let y = 2; y < 5; y++) {
      expect(world.get(1, y)).toBe(Tile.Empty);
      expect(world.get(6, y)).toBe(Tile.Empty);
    }
    for (let x = 2; x < 6; x++) expect(world.get(x, 5)).toBe(Tile.Empty);
  });

  it('only writes in-bounds tiles for a rect hanging off the map', () => {
    const world = new World(5, 5);
    const cells = jagRect(world, { x: -2, y: -2, w: 4, h: 4 }, Tile.Water, [...ALL], always(0.99));
    for (const c of cells) expect(world.inBounds(c.x, c.y)).toBe(true);
    expect(countTiles(world, Tile.Water)).toBe(cells.length);
    expect(world.get(2, 0)).toBe(Tile.Water); // grown right edge
    expect(world.get(3, 0)).toBe(Tile.Empty);
  });

  it('handles a rect entirely outside the map', () => {
    const world = new World(5, 5);
    expect(jagRect(world, { x: 20, y: 20, w: 3, h: 3 }, Tile.Water, [...ALL], always(0.99))).toEqual([]);
    expect(countTiles(world, Tile.Water)).toBe(0);
  });

  it('copes with 1-wide rects', () => {
    const world = new World(10, 10);
    expect(jagRect(world, { x: 4, y: 4, w: 1, h: 1 }, Tile.Water, [...ALL], always(0))).toEqual([]);
    expect(jagRect(world, { x: 4, y: 2, w: 1, h: 5 }, Tile.Water, [...ALL], always(0.5))).toHaveLength(5);
    expect(jagRect(world, { x: 0, y: 0, w: 0, h: 0 }, Tile.Water, [...ALL], always(0.99))).toEqual([]);
  });
});
