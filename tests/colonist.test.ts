import { describe, expect, it } from 'vitest';
import { Tile } from '../src/world/tiles';
import { simulate, spawnAt, worldFromAscii } from './helpers';

describe('Colonist', () => {
  it('falls onto the ground under gravity', () => {
    const world = worldFromAscii(['#####', '#...#', '#...#', '#...#', '#...#', '#####']);
    const c = spawnAt(2, 2);
    simulate(world, c, 2);
    expect(c.grounded).toBe(true);
    expect(c.py).toBeCloseTo(5);
  });

  it('walks to a target on flat ground', () => {
    const world = worldFromAscii(['##########', '#........#', '#........#', '#........#', '##########']);
    const c = spawnAt(1, 3);
    c.commandMove(8, 2);
    simulate(world, c, 10);
    expect(c.state).toBe('idle');
    expect(c.currentNode(world)).toEqual({ x: 8, y: 3 });
  });

  it('jumps up a 2-tile ledge', () => {
    const world = worldFromAscii(['############', '#..........#', '#..........#', '#..........#', '#......#####', '#......#####', '############']);
    const c = spawnAt(2, 5);
    c.commandMove(9, 3);
    simulate(world, c, 10);
    expect(c.currentNode(world)).toEqual({ x: 9, y: 3 });
  });

  it('jumps across a 2-wide gap without falling in', () => {
    const world = worldFromAscii([
      '############',
      '#..........#',
      '#..........#',
      '#..........#',
      '#####..#####',
      '#####..#####',
      '#####..#####',
      '############',
    ]);
    const c = spawnAt(2, 3);
    c.commandMove(9, 3);
    const { maxPy } = simulate(world, c, 10);
    expect(c.currentNode(world)).toEqual({ x: 9, y: 3 });
    expect(maxPy).toBeLessThan(4.05);
  });

  it('moves through water', () => {
    const world = worldFromAscii(['#########', '#...~...#', '#...~...#', '#########']);
    const c = spawnAt(1, 2);
    c.commandMove(7, 2);
    simulate(world, c, 10);
    expect(c.currentNode(world)).toEqual({ x: 7, y: 2 });
  });

  it('digs a dirt tile and leaves rock alone', () => {
    const world = worldFromAscii(['########', '#......#', '#......#', '#....d.#', '########']);
    const c = spawnAt(1, 3);
    c.commandDig(5, 3);
    simulate(world, c, 10);
    expect(world.get(5, 3)).toBe(Tile.Empty);
    expect(c.state).toBe('idle');
  });
});
