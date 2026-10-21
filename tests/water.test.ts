import { describe, expect, it } from 'vitest';
import { WaterSim } from '../src/sim/water';
import { mulberry32 } from '../src/world/rng';
import { Tile } from '../src/world/tiles';
import { countTiles, worldFromAscii } from './helpers';

describe('WaterSim', () => {
  it('falls until it lands on solid ground', () => {
    const world = worldFromAscii(['#~#', '#.#', '#.#', '###']);
    const sim = new WaterSim(world, mulberry32(1));
    for (let i = 0; i < 5; i++) sim.step();
    expect(world.get(1, 2)).toBe(Tile.Water);
    expect(countTiles(world, Tile.Water)).toBe(1);
  });

  it('does not move when resting on dirt or rock', () => {
    const world = worldFromAscii(['.....', '..~..', '..d..']);
    const sim = new WaterSim(world, mulberry32(1));
    for (let i = 0; i < 20; i++) sim.step();
    expect(world.get(2, 1)).toBe(Tile.Water);
  });

  it('levels a stacked block into a flat layer and conserves volume', () => {
    const world = worldFromAscii([
      '###########',
      '#...~~~...#',
      '#...~~~...#',
      '#...~~~...#',
      '###########',
    ]);
    const sim = new WaterSim(world, mulberry32(7));
    for (let i = 0; i < 2000; i++) sim.step();
    expect(countTiles(world, Tile.Water)).toBe(9);
    for (let x = 1; x <= 9; x++) expect(world.get(x, 3)).toBe(Tile.Water);
  });
});
