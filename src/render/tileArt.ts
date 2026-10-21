import { TILE_TEX } from '../config';
import { Tile } from '../world/tiles';

export type RGB = [number, number, number];

/** An RGBA pixel buffer. ImageData satisfies it, so art can be painted in Node tests too. */
export interface PixelBuf {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function makeBuf(width: number, height: number): PixelBuf {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Writes an opaque (or `a`-alpha) pixel; out-of-bounds writes are ignored. */
export function putPixel(buf: PixelBuf, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const o = (y * buf.width + x) * 4;
  buf.data[o] = c[0];
  buf.data[o + 1] = c[1];
  buf.data[o + 2] = c[2];
  buf.data[o + 3] = a;
}

export function hashInt(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic hash of integer coordinates to [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  return hashInt(x, y, z) / 4294967296;
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** RGB 0..255 to HSV with every component in 0..1. */
export function rgbToHsv([r, g, b]: RGB): RGB {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** HSV (0..1, hue wraps) to RGB 0..255, rounded. */
export function hsvToRgb([h, s, v]: RGB): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const rgb = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

export interface TileStyle {
  base: RGB;
  surface: RGB;
  /** Pixel noise: hue shift (fraction of the wheel), saturation and value scale. */
  dh: number;
  ds: number;
  dv: number;
}

export const TILE_STYLE: Partial<Record<Tile, TileStyle>> = {
  [Tile.Dirt]: { base: [137, 94, 58], surface: [184, 129, 84], dh: 0.01, ds: 0.15, dv: 0.2 },
  [Tile.Rock]: { base: [111, 115, 126], surface: [151, 156, 167], dh: 0.05, ds: 0.12, dv: 0.07 },
  [Tile.Water]: { base: [75, 134, 206], surface: [127, 182, 238], dh: 0.02, ds: 0.05, dv: 0.03 },
};

/** Rows (of TILE_TEX) that use the surface colour when a tile is exposed. */
export const SURFACE_ROWS = 8;
/**
 * Pixel noise cells per tile side; each cell spans TILE_TEX / NOISE_RES texels
 * at full detail. Moss, grass and vines are drawn on the same cell grid.
 */
export const NOISE_RES = 8;
/** Opacity of the noise layer (21) inside the surface band. */
export const SURFACE_NOISE_ALPHA = 0.5;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Layer 21 noise for one pixel; u0..u2 in [-1, 1]. */
export function jitter(c: RGB, st: TileStyle, u0: number, u1: number, u2: number): RGB {
  const [h, s, v] = rgbToHsv(c);
  return hsvToRgb([h + u0 * st.dh, clamp01(s * (1 + u1 * st.ds)), clamp01(v * (1 + u2 * st.dv))]);
}

// Noise is quantised to LEVELS steps per HSV channel, so each tile style needs
// only a small precomputed palette (layer 20 colour with layer 21 composited).
const LEVELS = 8;
const PAL = LEVELS ** 3;
const palettes = new Map<string, Uint8Array>();

function palette(tile: Tile, surface: boolean): Uint8Array {
  const key = `${tile}:${surface}`;
  let pal = palettes.get(key);
  if (pal) return pal;
  const st = TILE_STYLE[tile]!;
  const base = surface ? st.surface : st.base;
  const a = surface ? SURFACE_NOISE_ALPHA : 1;
  const u = (k: number) => (k / (LEVELS - 1)) * 2 - 1;
  pal = new Uint8Array(PAL * 3);
  for (let k = 0; k < PAL; k++) {
    const noisy = jitter(base, st, u(k % LEVELS), u(Math.floor(k / LEVELS) % LEVELS), u(Math.floor(k / LEVELS ** 2)));
    const c = lerpRGB(base, noisy, a);
    pal.set([Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], k * 3);
  }
  palettes.set(key, pal);
  return pal;
}

/**
 * Paints tile (tx, ty) into `buf` at pixel (ox, oy), `tex` texels wide.
 * Layer 20 is the base colour, with the top SURFACE_ROWS replaced by the
 * surface colour when `exposed`; layer 21 is per-pixel HSV noise over it, at
 * SURFACE_NOISE_ALPHA inside the surface band. Noise is hashed from the
 * position on a NOISE_RES x NOISE_RES grid per tile, so repaints and every
 * detail level match. Cells set in `cut` (see cornerCuts) are left unpainted.
 */
export function paintTile(
  buf: PixelBuf,
  ox: number,
  oy: number,
  tex: number,
  tile: Tile,
  tx: number,
  ty: number,
  exposed: boolean,
  cut: Uint8Array | null = null,
): void {
  if (!TILE_STYLE[tile]) return;
  const body = palette(tile, false);
  const top = palette(tile, true);
  const band = exposed ? Math.round((SURFACE_ROWS * tex) / TILE_TEX) : 0;
  const step = NOISE_RES / tex;
  const d = buf.data;
  for (let sy = 0; sy < tex; sy++) {
    const y = oy + sy;
    if (y < 0 || y >= buf.height) continue;
    const pal = sy < band ? top : body;
    const cy = Math.floor(sy * step);
    const gy = ty * NOISE_RES + cy;
    for (let sx = 0; sx < tex; sx++) {
      const x = ox + sx;
      if (x < 0 || x >= buf.width) continue;
      const cx = Math.floor(sx * step);
      if (cut && cut[cy * NOISE_RES + cx]) continue;
      const k = (hashInt(tx * NOISE_RES + cx, gy, tile) % PAL) * 3;
      const o = (y * buf.width + x) * 4;
      d[o] = pal[k];
      d[o + 1] = pal[k + 1];
      d[o + 2] = pal[k + 2];
      d[o + 3] = 255;
    }
  }
}

/** Corner cuts reach at most this many cells along either edge. */
const CUT_ROWS = 4;

/**
 * Row widths (in cells, starting at the corner's edge row) of the notch cut
 * from one exposed corner: a smooth staircase 2–3 cells wide, shrinking by
 * one cell every one or two rows. Dirt and rock share it.
 */
function cornerProfile(tx: number, ty: number, corner: number): number[] {
  const h = (k: number) => hash3(tx * 4 + corner, ty, 60 + k);
  const rows: number[] = [];
  let w = 2 + Math.floor(h(0) * 2);
  let held = false;
  while (w > 0 && rows.length < CUT_ROWS) {
    rows.push(w);
    // Each width lasts one or two rows.
    if (!held && h(rows.length) < 0.4) {
      held = true;
    } else {
      w--;
      held = false;
    }
  }
  return rows;
}

/**
 * Cells (NOISE_RES x NOISE_RES, 1 = removed) knocked out of a dirt or rock
 * tile's corners where it is open on both adjacent sides, so outer corners
 * are not sharp. Each corner's shape is hashed from the tile position and
 * randomly mirrored across its diagonal, so every corner differs but repaints
 * match. Returns null when the tile has no exposed corner. Visual only.
 */
export function cornerCuts(tile: Tile, tx: number, ty: number, top: boolean, right: boolean, bottom: boolean, left: boolean): Uint8Array | null {
  if (tile !== Tile.Dirt && tile !== Tile.Rock) return null;
  const corners = [top && left, top && right, bottom && left, bottom && right];
  if (!corners.some(Boolean)) return null;
  const A = NOISE_RES;
  const cut = new Uint8Array(A * A);
  corners.forEach((exposed, corner) => {
    if (!exposed) return;
    const flip = hash3(tx * 4 + corner, ty, 59) < 0.5;
    cornerProfile(tx, ty, corner).forEach((w, k) => {
      for (let i = 0; i < w; i++) {
        // Distance from the corner along x (i) and y (k), optionally swapped.
        const [dx, dy] = flip ? [k, i] : [i, k];
        const x = corner & 1 ? A - 1 - dx : dx;
        const y = corner & 2 ? A - 1 - dy : dy;
        cut[y * A + x] = 1;
      }
    });
  });
  return cut;
}

const WALL: RGB = [36, 31, 33];

/** Background cave wall (layer 10): staggered dim blocks with a little pixel noise. */
export function paintWall(buf: PixelBuf, ox: number, oy: number, tex: number, tx: number, ty: number): void {
  const step = TILE_TEX / tex;
  for (let sy = 0; sy < tex; sy++) {
    const gy = ty * TILE_TEX + Math.floor(sy * step);
    const row = gy >> 3;
    for (let sx = 0; sx < tex; sx++) {
      const gx = tx * TILE_TEX + Math.floor(sx * step);
      const block = hash3((gx + (row & 1) * 4) >> 3, row, 7);
      const k = (0.8 + block * 0.3) * (1 + (hash3(gx, gy, 8) * 2 - 1) * 0.05);
      putPixel(buf, ox + sx, oy + sy, [WALL[0] * k, WALL[1] * k, WALL[2] * k]);
    }
  }
}
