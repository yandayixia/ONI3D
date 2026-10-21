import { describe, expect, it } from 'vitest';
import { Tile } from '../src/world/tiles';
import { cornerCuts, makeBuf, NOISE_RES, paintTile, PixelBuf, RGB, rgbToHsv, hsvToRgb, SURFACE_ROWS, TILE_STYLE } from '../src/render/tileArt';

const N = 32;

function pixel(buf: PixelBuf, x: number, y: number): RGB {
  const o = (y * buf.width + x) * 4;
  return [buf.data[o], buf.data[o + 1], buf.data[o + 2]];
}

function paint(tile: Tile, tx: number, ty: number, exposed: boolean, tex = N): PixelBuf {
  const buf = makeBuf(tex, tex);
  paintTile(buf, 0, 0, tex, tile, tx, ty, exposed);
  return buf;
}

/** Largest relative deviation of the pixels in rows [y0, y1) from `ref`, per HSV channel. */
function deviation(buf: PixelBuf, y0: number, y1: number, ref: RGB): { h: number; s: number; v: number } {
  const [rh, rs, rv] = rgbToHsv(ref);
  const out = { h: 0, s: 0, v: 0 };
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [h, s, v] = rgbToHsv(pixel(buf, x, y));
      const dh = Math.abs(h - rh);
      out.h = Math.max(out.h, Math.min(dh, 1 - dh));
      out.s = Math.max(out.s, Math.abs(s / rs - 1));
      out.v = Math.max(out.v, Math.abs(v / rv - 1));
    }
  }
  return out;
}

describe('HSV conversion', () => {
  it('round-trips colours', () => {
    const colours: RGB[] = [
      [137, 94, 58],
      [111, 115, 126],
      [75, 134, 206],
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 128],
    ];
    for (const c of colours) {
      const back = hsvToRgb(rgbToHsv(c));
      for (let k = 0; k < 3; k++) expect(Math.abs(back[k] - c[k])).toBeLessThanOrEqual(1);
    }
  });
});

describe('paintTile', () => {
  it('is deterministic per tile, so repainting a chunk never flickers', () => {
    expect(paint(Tile.Dirt, 7, 9, true).data).toEqual(paint(Tile.Dirt, 7, 9, true).data);
    expect(paint(Tile.Dirt, 7, 9, true).data).not.toEqual(paint(Tile.Dirt, 8, 9, true).data);
  });

  it(`uses a ${NOISE_RES}x${NOISE_RES} noise grid: each cell is one colour at full detail`, () => {
    const cell = N / NOISE_RES;
    const buf = paint(Tile.Dirt, 3, 4, true);
    const colours = new Set<string>();
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        expect(pixel(buf, x, y)).toEqual(pixel(buf, x - (x % cell), y - (y % cell)));
        colours.add(pixel(buf, x, y).join());
      }
    }
    expect(colours.size).toBeGreaterThan(NOISE_RES);
  });

  it('matches the full-detail texture at lower texel densities', () => {
    const full = paint(Tile.Rock, 3, 4, true);
    const low = paint(Tile.Rock, 3, 4, true, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(pixel(low, x, y)).toEqual(pixel(full, x * 4, y * 4));
    }
  });

  for (const tile of [Tile.Dirt, Tile.Rock, Tile.Water]) {
    const st = TILE_STYLE[tile]!;

    // One step of 8-bit rounding in (max - min) shifts relative saturation by about this much.
    const [, bs, bv] = rgbToHsv(st.base);
    const sRounding = 1 / (255 * bs * bv);

    it(`keeps ${Tile[tile]} pixel noise within its HSV variance`, () => {
      const d = deviation(paint(tile, 5, 5, false), 0, N, st.base);
      expect(d.h).toBeLessThanOrEqual(st.dh + 0.01);
      expect(d.s).toBeLessThanOrEqual(st.ds + sRounding);
      expect(d.v).toBeLessThanOrEqual(st.dv + 0.02);
      // The noise layer is fully opaque outside the surface band.
      expect(Math.max(d.s / st.ds, d.v / st.dv)).toBeGreaterThan(0.6);
    });

    it(`uses the ${Tile[tile]} surface colour in exactly the top ${SURFACE_ROWS} rows when exposed, with half-strength noise`, () => {
      const exposed = paint(tile, 5, 5, true);
      const band = deviation(exposed, 0, SURFACE_ROWS, st.surface);
      const [, ss, sv] = rgbToHsv(st.surface);
      expect(band.s).toBeLessThanOrEqual(st.ds / 2 + 1 / (255 * ss * sv));
      expect(band.v).toBeLessThanOrEqual(st.dv / 2 + 0.02);
      const body = deviation(exposed, SURFACE_ROWS, N, st.base);
      expect(body.v).toBeLessThanOrEqual(st.dv + 0.02);
      // Unexposed tiles have no surface band.
      expect(paint(tile, 5, 5, false).data.slice(0, SURFACE_ROWS * N * 4)).not.toEqual(exposed.data.slice(0, SURFACE_ROWS * N * 4));
      expect(deviation(paint(tile, 5, 5, false), 0, SURFACE_ROWS, st.base).v).toBeLessThanOrEqual(st.dv + 0.02);
    });
  }

  it('paints nothing for empty tiles', () => {
    expect(paint(Tile.Empty, 1, 1, true).data.every((v) => v === 0)).toBe(true);
  });

  it('clips at the buffer edges', () => {
    const buf = makeBuf(16, 16);
    expect(() => paintTile(buf, -24, 8, N, Tile.Dirt, 0, 0, true)).not.toThrow();
    expect(pixel(buf, 0, 0)).toEqual([0, 0, 0]);
    expect(buf.data[(8 * 16 + 7) * 4 + 3]).toBe(255);
    expect(buf.data[(8 * 16 + 8) * 4 + 3]).toBe(0);
  });
});

describe('cornerCuts', () => {
  const A = NOISE_RES;
  const cutAt = (cut: Uint8Array, x: number, y: number) => cut[y * A + x] === 1;
  /** Cut cells of the top-left corner form a staircase anchored at the corner (no holes or notches). */
  const isStaircase = (cut: Uint8Array) => {
    for (let y = 0; y < A / 2; y++) {
      for (let x = 0; x < A / 2; x++) {
        if (!cutAt(cut, x, y)) continue;
        if ((x > 0 && !cutAt(cut, x - 1, y)) || (y > 0 && !cutAt(cut, x, y - 1))) return false;
      }
    }
    return true;
  };
  const topLeft = (tile: Tile, tx: number) => cornerCuts(tile, tx, 7, true, false, false, true)!;

  it('only cuts corners that are open on both adjacent sides', () => {
    expect(cornerCuts(Tile.Rock, 3, 3, true, false, false, false)).toBeNull();
    expect(cornerCuts(Tile.Dirt, 3, 3, true, false, true, false)).toBeNull();
    expect(cornerCuts(Tile.Water, 3, 3, true, true, true, true)).toBeNull();
    expect(cornerCuts(Tile.Empty, 3, 3, true, true, true, true)).toBeNull();

    const tr = cornerCuts(Tile.Dirt, 3, 3, true, true, false, false)!;
    expect(cutAt(tr, A - 1, 0)).toBe(true);
    for (let y = 0; y < A; y++) {
      for (let x = 0; x < A; x++) if (cutAt(tr, x, y)) expect(x >= A - 4 && y < 4).toBe(true);
    }
  });

  it('can cut every corner of a tile, leaving most of it solid', () => {
    for (const tile of [Tile.Dirt, Tile.Rock]) {
      const cut = cornerCuts(tile, 11, 4, true, true, true, true)!;
      for (const [x, y] of [
        [0, 0],
        [A - 1, 0],
        [0, A - 1],
        [A - 1, A - 1],
      ]) {
        expect(cutAt(cut, x, y)).toBe(true);
      }
      expect(cut.reduce((a, b) => a + b, 0)).toBeLessThan((A * A) / 2);
      expect(cutAt(cut, A / 2, A / 2)).toBe(false);
    }
  });

  it('is deterministic, but varies between tiles', () => {
    expect(topLeft(Tile.Rock, 5)).toEqual(topLeft(Tile.Rock, 5));
    for (const tile of [Tile.Dirt, Tile.Rock]) {
      const shapes = new Set<string>();
      for (let tx = 0; tx < 60; tx++) shapes.add(topLeft(tile, tx).join(''));
      expect(shapes.size).toBeGreaterThan(5);
    }
  });

  it('gives dirt and rock the same smooth staircase corners of at least 2 cells', () => {
    for (let tx = 0; tx < 60; tx++) {
      const cut = topLeft(Tile.Dirt, tx);
      expect(isStaircase(cut)).toBe(true);
      expect(cutAt(cut, 1, 0) || cutAt(cut, 0, 1)).toBe(true);
      expect(topLeft(Tile.Rock, tx)).toEqual(cut);
    }
  });

  it('leaves cut cells unpainted', () => {
    const cut = cornerCuts(Tile.Rock, 2, 2, true, true, false, false)!;
    const buf = makeBuf(N, N);
    paintTile(buf, 0, 0, N, Tile.Rock, 2, 2, true, cut);
    const cell = N / A;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const alpha = buf.data[(y * N + x) * 4 + 3];
        expect(alpha).toBe(cutAt(cut, Math.floor(x / cell), Math.floor(y / cell)) ? 0 : 255);
      }
    }
  });
});
