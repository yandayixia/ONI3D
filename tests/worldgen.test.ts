import { describe, expect, it } from 'vitest';
import { Foliage } from '../src/world/foliage';
import { Tile, isSolidTile } from '../src/world/tiles';
import { generateWorld, GenResult } from '../src/world/worldgen';
import { countTiles } from './helpers';

const SEEDS = [1, 42, 2024, 12345, 777, 31337, 9, 4242];

function eachGen(fn: (gen: GenResult, seed: number) => void): void {
  for (const seed of SEEDS) fn(generateWorld(seed), seed);
}

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

  it('places four water pits: two ~50 tiles above and two ~50 below, one each side of center', () => {
    eachGen(({ waterClusters }) => {
      expect(waterClusters).toHaveLength(4);
      waterClusters.forEach((r, k) => {
        expect(r.w).toBeGreaterThanOrEqual(15);
        expect(r.w).toBeLessThanOrEqual(25);
        expect(r.h).toBeGreaterThanOrEqual(4);
        expect(r.h).toBeLessThanOrEqual(8);
        const centerY = r.y + Math.floor(r.h / 2);
        expect(Math.abs(centerY - (k < 2 ? 50 : 150))).toBeLessThanOrEqual(3);
        // Left pit of each pair ends before center; right pit starts after it (jag included).
        if (k % 2 === 0) expect(r.x + r.w).toBeLessThan(100 - 1);
        else expect(r.x - 1).toBeGreaterThan(100);
      });
    });
  });

  it('keeps the pits filled with water through the cave and rock passes', () => {
    eachGen(({ world, waterClusters }) => {
      for (const r of waterClusters) {
        // The rect shrunk by one (the part edge jagging never removes) is all water.
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
          for (let x = r.x + 1; x < r.x + r.w - 1; x++) expect(world.get(x, y)).toBe(Tile.Water);
        }
      }
    });
  });

  it('opens a jagged clearing at the center with a solid floor and 3 colonists', () => {
    eachGen(({ world, clearing, clearingCells, spawns }) => {
      expect(clearing).toEqual({ x: 90, y: 98, w: 20, h: 4 });
      for (const c of clearingCells) {
        expect(world.get(c.x, c.y)).toBe(Tile.Empty);
        // Jagged by at most one tile on top/left/right; the bottom edge is exact.
        expect(c.x).toBeGreaterThanOrEqual(89);
        expect(c.x).toBeLessThanOrEqual(110);
        expect(c.y).toBeGreaterThanOrEqual(97);
        expect(c.y).toBeLessThanOrEqual(101);
        if (c.y === 101) expect(world.isSolid(c.x, 102)).toBe(true);
      }
      for (let y = 99; y <= 101; y++) {
        for (let x = 91; x <= 108; x++) expect(world.get(x, y)).toBe(Tile.Empty);
      }
      expect(spawns).toHaveLength(3);
      for (const s of spawns) {
        expect(world.isSolid(s.x, s.y + 1)).toBe(true);
        expect(world.get(s.x, s.y)).toBe(Tile.Empty);
        expect(world.get(s.x, s.y - 1)).toBe(Tile.Empty);
      }
    });
  });

  it('places a 10x4 starting pond 20-30 tiles beside the clearing on the dominant side', () => {
    const sides = new Set<number>();
    eachGen(({ world, clearing, pond, dominantSide }) => {
      sides.add(dominantSide);
      expect([-1, 1]).toContain(dominantSide);
      expect(pond.w).toBe(10);
      expect(pond.h).toBe(4);
      const gap = dominantSide > 0 ? pond.x - (clearing.x + clearing.w) : clearing.x - (pond.x + pond.w);
      expect(gap).toBeGreaterThanOrEqual(20);
      expect(gap).toBeLessThanOrEqual(30);
      expect(Math.abs(pond.y + pond.h - 1 - 101)).toBeLessThanOrEqual(2);
      for (let y = pond.y; y < pond.y + pond.h; y++) {
        for (let x = pond.x; x < pond.x + pond.w; x++) expect(world.get(x, y)).toBe(Tile.Water);
      }
    });
    expect(sides.size).toBe(2);
  });

  it('reports the water tile count', () => {
    eachGen(({ world, stats }) => expect(countTiles(world, Tile.Water)).toBe(stats.waterTiles));
  });

  it('grows foliage only where its rules allow', () => {
    eachGen(({ world, foliage }) => {
      const counts = new Map<Foliage, number>();
      for (let i = 0; i < foliage.cells.length; i++) {
        const f = foliage.cells[i] as Foliage;
        counts.set(f, (counts.get(f) ?? 0) + 1);
        const t = world.tiles[i];
        if (f === Foliage.FloorMoss || f === Foliage.CeilingMoss) expect(isSolidTile(t)).toBe(true);
        if (f === Foliage.Grass || f === Foliage.Vine) expect(t).toBe(Tile.Empty);
      }
      for (const f of [Foliage.FloorMoss, Foliage.CeilingMoss, Foliage.Grass, Foliage.Vine]) {
        expect(counts.get(f) ?? 0).toBeGreaterThan(0);
      }
      expect(foliage.flowers.some((f) => f.front)).toBe(true);
      expect(foliage.flowers.some((f) => !f.front)).toBe(true);
      for (const f of foliage.flowers) expect(foliage.get(f.x, f.y)).toBe(Foliage.Grass);
    });
  });

  it('is deterministic for a seed, foliage included', () => {
    const again = generateWorld(12345);
    expect(again.world.tiles).toEqual(world.tiles);
    expect(again.foliage.cells).toEqual(gen.foliage.cells);
    expect(again.foliage.flowers).toEqual(gen.foliage.flowers);
    expect(again.foliage.vines).toEqual(gen.foliage.vines);
    expect(generateWorld(999).world.tiles).not.toEqual(world.tiles);
  });

  it('finishes each generation in under a second', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const t0 = performance.now();
      generateWorld(seed);
      expect(performance.now() - t0).toBeLessThan(1000);
    }
  });
});
