import { describe, expect, it } from 'vitest';
import { PHYSICS_DT } from '../src/config';
import { Body, FoliageAnimator } from '../src/sim/foliageAnim';
import { Foliage, FoliageMap, Vine } from '../src/world/foliage';

/** A 12x8 map with a 3-tall vine at x=5 (rows 2-4) and a grass tile at (8, 4). */
function makeMap(): { map: FoliageMap; vine: Vine } {
  const map = new FoliageMap(12, 8);
  const vine = { x: 5, y: 2, length: 3 };
  map.vines.push(vine);
  for (let k = 0; k < 3; k++) map.cells[(2 + k) * 12 + 5] = Foliage.Vine;
  map.cells[4 * 12 + 8] = Foliage.Grass;
  return { map, vine };
}

/** Moves the body at its velocity for `seconds`, stepping the animator; returns the first nonzero vine angle. */
function walk(anim: FoliageAnimator, map: FoliageMap, body: Body, vine: Vine, seconds: number): number {
  let first = 0;
  for (let t = 0; t < seconds; t += PHYSICS_DT) {
    body.px += body.vx * PHYSICS_DT;
    anim.update([body], map, PHYSICS_DT);
    if (first === 0) first = anim.vineAngle(vine);
  }
  return first;
}

describe('FoliageAnimator', () => {
  it('swings a vine in the direction the colonist walks through it', () => {
    const right = makeMap();
    expect(walk(new FoliageAnimator(), right.map, { px: 3.5, py: 5, vx: 4 }, right.vine, 0.6)).toBeGreaterThan(0);
    const left = makeMap();
    expect(walk(new FoliageAnimator(), left.map, { px: 7.2, py: 5, vx: -4 }, left.vine, 0.6)).toBeLessThan(0);
  });

  it('kicks the vine again when the colonist leaves it', () => {
    const { map, vine } = makeMap();
    const anim = new FoliageAnimator();
    const body = { px: 4.5, py: 5, vx: 4 };
    walk(anim, map, body, vine, 0.25); // enter, x ~ 5.5
    body.vx = 0;
    walk(anim, map, body, vine, 30); // stand inside until the vine rests
    expect(anim.vines.size).toBe(0);
    body.vx = 4;
    walk(anim, map, body, vine, 0.5); // walk out
    expect(anim.vines.size).toBe(1);
    expect(anim.vineAngle(vine)).not.toBe(0);
  });

  it('comes to rest and drops its state', () => {
    const { map, vine } = makeMap();
    const anim = new FoliageAnimator();
    walk(anim, map, { px: 3.5, py: 5, vx: 4 }, vine, 0.6);
    expect(anim.vines.size).toBe(1);
    const still = { px: 0.5, py: 5, vx: 0 };
    for (let t = 0; t < 30; t += PHYSICS_DT) anim.update([still], map, PHYSICS_DT);
    expect(anim.vines.size).toBe(0);
    expect(anim.grass.size).toBe(0);
    expect(anim.vineAngle(vine)).toBe(0);
  });

  it('wiggles grass on entry from either direction', () => {
    for (const [px, vx] of [
      [7, 4],
      [10, -4],
    ]) {
      const { map, vine } = makeMap();
      const anim = new FoliageAnimator();
      const body = { px, py: 5, vx };
      let moved = false;
      for (let t = 0; t < 0.5; t += PHYSICS_DT) {
        body.px += vx * PHYSICS_DT;
        anim.update([body], map, PHYSICS_DT);
        if (anim.grassOffset(4 * 12 + 8) !== 0) moved = true;
      }
      expect(moved).toBe(true);
      expect(anim.vineAngle(vine)).toBe(0);
    }
  });

  it('leaves untouched foliage without state', () => {
    const { map } = makeMap();
    const anim = new FoliageAnimator();
    const body = { px: 1.5, py: 5, vx: 2 };
    for (let t = 0; t < 1; t += PHYSICS_DT) {
      body.px += body.vx * PHYSICS_DT;
      anim.update([body], map, PHYSICS_DT);
    }
    expect(anim.vines.size).toBe(0);
    expect(anim.grass.size).toBe(0);
  });

  it('forgets vines that were removed from the map', () => {
    const { map, vine } = makeMap();
    const anim = new FoliageAnimator();
    walk(anim, map, { px: 3.5, py: 5, vx: 4 }, vine, 0.6);
    map.vines = [];
    map.version++;
    anim.update([], map, PHYSICS_DT);
    expect(anim.vines.size).toBe(0);
  });
});
