import { describe, expect, it } from 'vitest';
import { Tile } from '../src/world/tiles';
import { generateWorld } from '../src/world/worldgen';
import { countTiles } from './helpers';

describe('generateWorld', () => {
  const gen = generateWorld(12345);
  const { world } = gen;

  it('is 200x200', () => {
    expect(world.width).toBe(200);
    expect(world.height).toBe(200);
  });

  it('carves ~20% empty and turns ~half the dirt into rock', () => {
    expect(gen.stats.emptyFraction).toBeGreaterThan(0.19);
    expect(gen.stats.emptyFraction).toBeLessThan(0.21);
    expect(gen.stats.rockFractionOfDirt).toBeGreaterThan(0.48);
    expect(gen.stats.rockFractionOfDirt).toBeLessThan(0.52);
  });

  it('opens a 20x4 clearing at the center with a solid floor and 3 colonists', () => {
    const r = gen.clearing;
    expect(r).toEqual({ x: 90, y: 98, w: 20, h: 4 });
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) expect(world.get(x, y)).toBe(Tile.Empty);
    }
    for (let x = r.x; x < r.x + r.w; x++) expect(world.isSolid(x, r.y + r.h)).toBe(true);
    expect(gen.spawns).toHaveLength(3);
    for (const s of gen.spawns) expect(world.isSolid(s.x, s.y + 1)).toBe(true);
  });

  it('places two 10x4 water clusters ~50 tiles above and below center', () => {
    expect(gen.waterClusters).toHaveLength(2);
    const [above, below] = gen.waterClusters;
    expect(Math.abs(above.y + 2 - 50)).toBeLessThanOrEqual(3);
    expect(Math.abs(below.y + 2 - 150)).toBeLessThanOrEqual(3);
    for (const r of gen.waterClusters) {
      expect(r.w).toBe(10);
      expect(r.h).toBe(4);
    }
    expect(countTiles(world, Tile.Water)).toBe(80);
  });

  it('is deterministic for a seed', () => {
    expect(generateWorld(12345).world.tiles).toEqual(world.tiles);
    expect(generateWorld(999).world.tiles).not.toEqual(world.tiles);
  });
});
