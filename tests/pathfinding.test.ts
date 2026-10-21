import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfinding';
import { worldFromAscii } from './helpers';

function reaches(rows: string[], sx: number, sy: number, gx: number, gy: number): boolean {
  const world = worldFromAscii(rows);
  return findPath(world, sx, sy, (x, y) => x === gx && y === gy, gx, gy).reached;
}

describe('findPath', () => {
  it('walks along flat ground', () => {
    expect(reaches(['#######', '#.....#', '#.....#', '#######'], 1, 2, 5, 2)).toBe(true);
  });

  it('jumps up a 2-tile ledge but not a 3-tile wall', () => {
    const two = ['#########', '#.......#', '#.......#', '#.......#', '#....####', '#....####', '#########'];
    expect(reaches(two, 1, 5, 6, 3)).toBe(true);
    const three = ['#########', '#.......#', '#.......#', '#....####', '#....####', '#....####', '#########'];
    expect(reaches(three, 1, 5, 6, 2)).toBe(false);
  });

  it('jumps a 2-wide gap but not a 3-wide one', () => {
    const gap2 = ['##########', '#........#', '#........#', '#........#', '####..####', '####..####', '####..####', '####..####', '##########'];
    expect(reaches(gap2, 1, 3, 8, 3)).toBe(true);
    const gap3 = ['##########', '#........#', '#........#', '#........#', '###...####', '###...####', '###...####', '###...####', '##########'];
    expect(reaches(gap3, 1, 3, 8, 3)).toBe(false);
  });

  it('drops down from a ledge', () => {
    const rows = ['########', '#......#', '#......#', '####...#', '####...#', '########'];
    expect(reaches(rows, 1, 2, 6, 4)).toBe(true);
  });

  it('treats water as passable', () => {
    expect(reaches(['#######', '#..~..#', '#..~..#', '#######'], 1, 2, 5, 2)).toBe(true);
  });
});
