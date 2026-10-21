import { describe, expect, it } from 'vitest';
import {
  CEILING_MOSS,
  FLOOR_MOSS,
  FLOWER_W,
  GRASS_ROWS,
  Painter,
  VINE_SPIKE,
  flowerColors,
  flowerSprite,
  grassSprite,
  mossSegments,
  paintCeilingMoss,
  paintFloorMoss,
  vineSprite,
} from '../src/render/foliageArt';
import { makeBuf, NOISE_RES, PixelBuf, RGB } from '../src/render/tileArt';
import { Flower } from '../src/world/foliage';

const N = 32;
const A = NOISE_RES;
const CELL = N / A;

const opaque = (buf: PixelBuf, x: number, y: number) => buf.data[(y * buf.width + x) * 4 + 3] > 0;
const colour = (buf: PixelBuf, x: number, y: number): RGB => {
  const o = (y * buf.width + x) * 4;
  return [buf.data[o], buf.data[o + 1], buf.data[o + 2]];
};
const rgba = (buf: PixelBuf, x: number, y: number) => Array.from(buf.data.slice((y * buf.width + x) * 4, (y * buf.width + x) * 4 + 4));
const luma = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Every CELL x CELL block of the buffer is a single colour (or fully transparent). */
function expectCellAligned(buf: PixelBuf): void {
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) expect(rgba(buf, x, y)).toEqual(rgba(buf, x - (x % CELL), y - (y % CELL)));
  }
}

function flower(front: boolean, height: number, hue: number, leaves = 2): Flower {
  return { x: 0, y: 0, front, seed: 1234, height, hue, leaves };
}

describe('moss art', () => {
  it('splits a tile into 1-2 cell wide moss runs', () => {
    for (const [tx, ty, salt] of [
      [0, 0, 11],
      [5, 9, 11],
      [17, 3, 21],
      [100, 42, 21],
    ]) {
      const widths = mossSegments(tx, ty, salt);
      for (const w of widths) expect([1, 2]).toContain(w);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(A);
    }
  });

  it('floor moss reaches 1-2 cells into its tile and at most 1 cell into the tile above', () => {
    // Three tiles tall; the moss tile is the middle one.
    const buf = makeBuf(N, 3 * N);
    let tufts = 0;
    for (const tx of [0, 5, 17, 33]) {
      buf.data.fill(0);
      paintFloorMoss(new Painter(buf, 0, N), tx, 3);
      expectCellAligned(buf);
      for (let x = 0; x < N; x++) {
        let depth = 0;
        while (opaque(buf, x, N + depth)) depth++;
        expect(depth === CELL || depth === 2 * CELL).toBe(true);
        let tuft = 0;
        while (opaque(buf, x, N - 1 - tuft)) tuft++;
        expect(tuft === 0 || tuft === CELL).toBe(true);
        if (tuft) tufts++;
      }
    }
    expect(tufts).toBeGreaterThan(0);
  });

  it('ceiling moss covers 2-4 cells of its tile and 1-2 cells of the tile below', () => {
    const buf = makeBuf(N, 2 * N);
    for (const tx of [0, 5, 17, 33]) {
      buf.data.fill(0);
      paintCeilingMoss(new Painter(buf, 0, 0), tx, 3);
      expectCellAligned(buf);
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < 2 * N; y++) {
          if (opaque(buf, x, y)) {
            expect(y).toBeGreaterThanOrEqual(N - 4 * CELL);
            expect(y).toBeLessThan(N + 2 * CELL);
          }
        }
        // Solid along the rock face.
        expect(opaque(buf, x, N - 1)).toBe(true);
        expect(opaque(buf, x, N)).toBe(true);
      }
    }
  });

  it('scales cells to the texel density and clips at buffer edges', () => {
    const low = makeBuf(8, 8);
    paintFloorMoss(new Painter(low, 0, 2, 8), 0, 0);
    expect(opaque(low, 0, 2)).toBe(true); // one cell = one texel at 8 texels per tile
    expect(() => paintCeilingMoss(new Painter(makeBuf(N, N), 0, -N + 4), 0, 0)).not.toThrow();
  });
});

describe('grass, vine and flower sprites', () => {
  it('grass blades are one cell wide, 1-3 cells tall, with floor-moss coloured roots', () => {
    for (let v = 0; v < 16; v++) {
      const buf = grassSprite(v);
      expect(buf.width).toBe(A);
      expect(buf.height).toBe(GRASS_ROWS);
      let blades = 0;
      for (let x = 0; x < A; x++) {
        if (!opaque(buf, x, GRASS_ROWS - 1)) {
          for (let y = 0; y < GRASS_ROWS; y++) expect(opaque(buf, x, y)).toBe(false);
          continue;
        }
        blades++;
        expect(colour(buf, x, GRASS_ROWS - 1)).toEqual(FLOOR_MOSS);
        // A blade is one continuous column rising from its root.
        let h = 0;
        while (h < GRASS_ROWS && opaque(buf, x, GRASS_ROWS - 1 - h)) h++;
        for (let y = 0; y < GRASS_ROWS - h; y++) expect(opaque(buf, x, y)).toBe(false);
      }
      expect(blades).toBeGreaterThan(0);
    }
  });

  it('vines are 2-3 cells wide, span their length and start in the ceiling-moss colour', () => {
    for (const v of [
      { x: 4, y: 7, length: 3 },
      { x: 60, y: 21, length: 5 },
      { x: 9, y: 2, length: 1 },
    ]) {
      const buf = vineSprite(v);
      expect(buf.width).toBe(A);
      expect(buf.height).toBe(v.length * A);
      for (let y = 0; y < buf.height - 1; y++) {
        let stem = 0;
        for (let x = 0; x < A; x++) {
          if (opaque(buf, x, y) && colour(buf, x, y).join() !== VINE_SPIKE.join()) stem++;
        }
        expect(stem).toBeGreaterThanOrEqual(2);
        expect(stem).toBeLessThanOrEqual(3);
      }
      const top = [...Array(A).keys()].find((x) => opaque(buf, x, 0))!;
      expect(colour(buf, top, 0)).toEqual(CEILING_MOSS);
      expect([...Array(A).keys()].filter((x) => opaque(buf, x, buf.height - 1))).toHaveLength(1);
      expect(vineSprite(v).data).toEqual(buf.data);
    }
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

describe('moss on cut corners', () => {
  it('skips cut cells and the moss that would hang off them', () => {
    const cut = new Uint8Array(A * A);
    cut[0] = cut[1] = cut[A] = 1; // top-left notch
    cut[(A - 1) * A + A - 1] = 1; // bottom-right cell
    const floor = makeBuf(N, 3 * N);
    for (let tx = 0; tx < 20; tx++) paintFloorMoss(new Painter(floor, 0, N), tx, 3, cut);
    for (const [cx, cy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, -1], // tuft above a cut column
      [1, -1],
    ]) {
      expect(opaque(floor, cx * CELL, N + cy * CELL)).toBe(false);
    }
    expect(opaque(floor, 2 * CELL, N)).toBe(true);

    const ceiling = makeBuf(N, 2 * N);
    for (let tx = 0; tx < 20; tx++) paintCeilingMoss(new Painter(ceiling, 0, 0), tx, 3, cut);
    expect(opaque(ceiling, (A - 1) * CELL, N - 1)).toBe(false);
    expect(opaque(ceiling, (A - 1) * CELL, N)).toBe(false); // spill under the cut cell
    expect(opaque(ceiling, (A - 2) * CELL, N - 1)).toBe(true);
  });
});
