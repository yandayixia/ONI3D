import { describe, expect, it } from 'vitest';
import {
  CEILING_MOSS,
  FLOOR_MOSS,
  FLOWER_W,
  GRASS_ROWS,
  Painter,
  flowerColors,
  flowerSprite,
  grassSprite,
  paintCeilingMoss,
  paintFloorMoss,
  vineSprite,
} from '../src/render/foliageArt';
import { makeBuf, PixelBuf, RGB } from '../src/render/tileArt';
import { Flower } from '../src/world/foliage';

const N = 32;

const opaque = (buf: PixelBuf, x: number, y: number) => buf.data[(y * buf.width + x) * 4 + 3] > 0;
const colour = (buf: PixelBuf, x: number, y: number): RGB => {
  const o = (y * buf.width + x) * 4;
  return [buf.data[o], buf.data[o + 1], buf.data[o + 2]];
};
const luma = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;

function flower(front: boolean, height: number, hue: number, leaves = 2): Flower {
  return { x: 0, y: 0, front, seed: 1234, height, hue, leaves };
}

describe('moss art', () => {
  it('floor moss covers the top 1-7 rows of its tile and 1-3 rows of the tile above', () => {
    // Three tiles tall; the moss tile is the middle one.
    const buf = makeBuf(N, 3 * N);
    for (const tx of [0, 5, 17]) {
      buf.data.fill(0);
      paintFloorMoss(new Painter(buf, 0, N), tx, 3);
      for (let x = 0; x < N; x++) {
        let depth = 0;
        while (opaque(buf, x, N + depth)) depth++;
        expect(depth).toBeGreaterThanOrEqual(1);
        expect(depth).toBeLessThanOrEqual(7);
        expect(opaque(buf, x, N + 8)).toBe(false);
        let tuft = 0;
        while (opaque(buf, x, N - 1 - tuft)) tuft++;
        expect(tuft).toBeGreaterThanOrEqual(1);
        expect(tuft).toBeLessThanOrEqual(3);
      }
    }
  });

  it('ceiling moss stays within the bottom 50% of its tile and the top 20% of the tile below', () => {
    const buf = makeBuf(N, 2 * N);
    for (const tx of [0, 5, 17]) {
      buf.data.fill(0);
      paintCeilingMoss(new Painter(buf, 0, 0), tx, 3);
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < 2 * N; y++) {
          if (opaque(buf, x, y)) {
            expect(y).toBeGreaterThanOrEqual(N / 2);
            expect(y).toBeLessThan(N + Math.round(0.2 * N));
          }
        }
        // Continuous along the rock face.
        expect(opaque(buf, x, N - 1)).toBe(true);
      }
    }
  });

  it('clips moss painted across a buffer edge', () => {
    const buf = makeBuf(N, N);
    expect(() => paintCeilingMoss(new Painter(buf, 0, -N + 4), 0, 0)).not.toThrow();
    expect(() => paintFloorMoss(new Painter(buf, 0, N - 2, 8), 0, 0)).not.toThrow();
  });
});

describe('grass, vine and flower sprites', () => {
  it('grass is 0.15-0.4 tiles tall with floor-moss coloured roots', () => {
    for (let v = 0; v < 16; v++) {
      const buf = grassSprite(v);
      let top = GRASS_ROWS;
      let roots = 0;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < GRASS_ROWS; y++) if (opaque(buf, x, y)) top = Math.min(top, y);
        if (opaque(buf, x, GRASS_ROWS - 1)) {
          roots++;
          expect(colour(buf, x, GRASS_ROWS - 1)).toEqual(FLOOR_MOSS);
        }
      }
      expect(roots).toBeGreaterThan(5);
      expect(GRASS_ROWS - top).toBeLessThanOrEqual(Math.round(0.4 * N));
      expect(GRASS_ROWS - top).toBeGreaterThanOrEqual(2);
    }
  });

  it('vines span their length and start in the ceiling-moss colour', () => {
    const buf = vineSprite({ x: 4, y: 7, length: 3 });
    expect(buf.width).toBe(N);
    expect(buf.height).toBe(3 * N);
    const stem = [...Array(N).keys()].filter((x) => opaque(buf, x, 0));
    expect(stem.length).toBeGreaterThan(0);
    expect(colour(buf, stem[0], 0)).toEqual(CEILING_MOSS);
    // The stem reaches the bottom of the last tile.
    expect([...Array(N).keys()].some((x) => opaque(buf, x, 3 * N - 1))).toBe(true);
    expect(vineSprite({ x: 4, y: 7, length: 3 }).data).toEqual(buf.data);
  });

  it('flower sprites are as tall as the flower with the stem rooted on the bottom row', () => {
    for (const f of [flower(false, 0.2, 10, 0), flower(false, 0.85, 200, 3), flower(true, 0.6, 90, 1), flower(true, 1.25, 300, 5)]) {
      const buf = flowerSprite(f);
      expect(buf.width).toBe(FLOWER_W);
      expect(buf.height).toBe(Math.max(5, Math.round(f.height * N)));
      expect(opaque(buf, FLOWER_W >> 1, buf.height - 1)).toBe(true);
    }
  });

  it('background flowers have darker centres and foreground flowers lighter ones', () => {
    for (let hue = 0; hue < 360; hue += 30) {
      const back = flowerColors(flower(false, 0.5, hue));
      const front = flowerColors(flower(true, 0.8, hue));
      expect(luma(back.center)).toBeLessThan(luma(back.petal));
      expect(luma(front.center)).toBeGreaterThan(luma(front.petal));
    }
  });

  it('draws more leaf pixels for more leaves', () => {
    const count = (f: Flower) => {
      const buf = flowerSprite(f);
      let n = 0;
      for (let i = 3; i < buf.data.length; i += 4) if (buf.data[i] > 0) n++;
      return n;
    };
    expect(count(flower(true, 1, 120, 5))).toBeGreaterThan(count(flower(true, 1, 120, 1)));
    expect(count(flower(false, 0.8, 120, 3))).toBeGreaterThan(count(flower(false, 0.8, 120, 0)));
  });
});
