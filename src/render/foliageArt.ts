import { TILE_TEX } from '../config';
import { Flower, Vine } from '../world/foliage';
import { hash3, hsvToRgb, lerpRGB, makeBuf, NOISE_RES, PixelBuf, putPixel, RGB } from './tileArt';

const N = TILE_TEX;
/**
 * Moss, grass and vines are authored in cells of the terrain noise grid
 * (A x A cells per tile, each TILE_TEX / A texels), so they match the terrain's
 * pixel size. Spec fractions of a tile are converted to whole cells below.
 */
const A = NOISE_RES;

export const FLOOR_MOSS: RGB = [92, 150, 64];
const FLOOR_MOSS_DARK: RGB = [64, 112, 50];
const FLOOR_MOSS_LIGHT: RGB = [126, 182, 84];
export const CEILING_MOSS: RGB = [44, 86, 56];
const CEILING_MOSS_DARK: RGB = [30, 62, 42];
const CEILING_MOSS_LIGHT: RGB = [62, 110, 70];
const GRASS: RGB[] = [
  [70, 138, 54],
  [92, 164, 62],
  [58, 120, 48],
  [112, 184, 76],
];
const GRASS_TIP: RGB = [150, 210, 104];
const VINE: RGB = [72, 138, 58];
const VINE_DARK: RGB = [52, 108, 46];
export const VINE_SPIKE: RGB = [234, 242, 228];
const SHAFT: RGB = [66, 124, 54];
const LEAF: RGB = [92, 160, 70];

/** Grass sprites are A cells wide and this many cells tall: the tallest patch (0.4 tile ≈ 3 cells). */
export const GRASS_ROWS = 3;
export const GRASS_VARIANTS = 16;
/** Flower sprites are this many texels wide, centred on the stem. */
export const FLOWER_W = 15;

/**
 * Plots art authored on a grid of `unit` cells per tile into a buffer at
 * `tex` texels per tile, with the art's (0, 0) at pixel (ox, oy). Each cell
 * fills its whole scaled block. Writes outside the buffer are clipped, so art
 * may spill across chunk edges.
 */
export class Painter {
  private readonly s: number;

  constructor(readonly buf: PixelBuf, readonly ox: number, readonly oy: number, tex = N, unit = A) {
    this.s = tex / unit;
  }

  dot(gx: number, gy: number, c: RGB): void {
    const x0 = this.ox + Math.floor(gx * this.s);
    const y0 = this.oy + Math.floor(gy * this.s);
    const x1 = Math.max(x0 + 1, this.ox + Math.floor((gx + 1) * this.s));
    const y1 = Math.max(y0 + 1, this.oy + Math.floor((gy + 1) * this.s));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) putPixel(this.buf, x, y, c);
    }
  }

  /** Copies the opaque pixels of a sprite (in this painter's units) with its top-left at (gx, gy). */
  blit(src: PixelBuf, gx: number, gy: number): void {
    const d = src.data;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const o = (y * src.width + x) * 4;
        if (d[o + 3] > 0) this.dot(gx + x, gy + y, [d[o], d[o + 1], d[o + 2]]);
      }
    }
  }
}

/** Splits a tile's A columns into runs 1 or 2 cells wide, so moss edges step in chunks. */
export function mossSegments(tx: number, ty: number, salt: number): number[] {
  const widths: number[] = [];
  for (let x = 0; x < A; ) {
    const w = x === A - 1 || hash3(tx * A + x, ty, salt) < 0.5 ? 1 : 2;
    widths.push(w);
    x += w;
  }
  return widths;
}

/**
 * Floor moss on tile (tx, ty), with the painter's origin at the tile's
 * top-left: a carpet 1–2 cells deep (the spec's 1–7 texel rows) on top of the
 * tile, with tufts filling the bottom cell (1–10%) of the tile above. Both
 * step in 1–2 cell wide runs. Cells cut from the tile's corners (and tufts
 * above them) are skipped.
 */
export function paintFloorMoss(p: Painter, tx: number, ty: number, cut: Uint8Array | null = null): void {
  let x = 0;
  for (const w of mossSegments(tx, ty, 11)) {
    const depth = 1 + Math.floor(hash3(tx * A + x, ty, 12) * 2);
    const tuft = hash3(tx * A + x, ty, 13) < 0.5;
    for (let gx = x; gx < x + w; gx++) {
      for (let gy = 0; gy < depth; gy++) {
        if (cut?.[gy * A + gx]) continue;
        const light = hash3(tx * A + gx, ty * A + gy, 14) < 0.2;
        p.dot(gx, gy, depth > 1 && gy === depth - 1 ? FLOOR_MOSS_DARK : light ? FLOOR_MOSS_LIGHT : FLOOR_MOSS);
      }
      if (tuft && !cut?.[gx]) p.dot(gx, -1, FLOOR_MOSS_LIGHT);
    }
    x += w;
  }
}

/**
 * Ceiling moss on tile (tx, ty), with the painter's origin at the tile's
 * top-left: a web over the bottom 2–4 cells (20–50%) of the tile and 1–2
 * cells (10–20%) of the tile below, in 1–2 cell wide runs. The rows touching
 * the rock face are solid; further out the web has holes. Cells cut from the
 * tile's corners (and the spill below them) are skipped.
 */
export function paintCeilingMoss(p: Painter, tx: number, ty: number, cut: Uint8Array | null = null): void {
  let x = 0;
  for (const w of mossSegments(tx, ty, 21)) {
    const top = A - 2 - Math.floor(hash3(tx * A + x, ty, 22) * 3);
    const bottom = A + 1 + Math.floor(hash3(tx * A + x, ty, 23) * 2);
    for (let gx = x; gx < x + w; gx++) {
      for (let gy = top; gy < bottom; gy++) {
        if (cut?.[Math.min(gy, A - 1) * A + gx]) continue;
        const r = hash3(tx * A + gx, ty * A + gy, 24);
        if (gy === bottom - 1) p.dot(gx, gy, CEILING_MOSS_DARK);
        else if (gy === A - 1 || gy === A) p.dot(gx, gy, CEILING_MOSS);
        else if ((gx + gy) % 2 === 0 || r < 0.3) p.dot(gx, gy, r < 0.25 ? CEILING_MOSS_LIGHT : CEILING_MOSS);
      }
    }
    x += w;
  }
}

/**
 * One grass patch, A cells wide and GRASS_ROWS tall, bottom-aligned: blades
 * one cell wide, 2–3 cells tall (0.25–0.375 tile) at most. Roots use the
 * floor-moss colour so the patch blends into the moss under it.
 */
export function grassSprite(variant: number): PixelBuf {
  const buf = makeBuf(A, GRASS_ROWS);
  const patch = 2 + Math.floor(hash3(variant, 0, 31) * 2);
  for (let gx = 0; gx < A; gx++) {
    if (hash3(variant, gx, 32) < 0.3) continue;
    const h = 1 + Math.floor(hash3(variant, gx, 33) * patch);
    const shade = GRASS[Math.floor(hash3(variant, gx, 35) * GRASS.length)];
    for (let k = 0; k < h; k++) {
      putPixel(buf, gx, GRASS_ROWS - 1 - k, k === 0 ? FLOOR_MOSS : k === h - 1 ? GRASS_TIP : shade);
    }
  }
  return buf;
}

/**
 * A hanging vine, A cells wide and `length` tiles tall: a knobbly stem 2–3
 * cells wide that wanders a cell at a time, with white spike cells beside it
 * and a one-cell tip. The top fades in from the ceiling-moss colour so it
 * grows seamlessly out of the moss above.
 */
export function vineSprite(v: Vine): PixelBuf {
  const h = v.length * A;
  const buf = makeBuf(A, h);
  let x = 2 + Math.floor(hash3(v.x, v.y, 41) * 2);
  let w = 2;
  for (let y = 0; y < h; y++) {
    if (y % 2 === 0) {
      w = hash3(v.x, v.y * A + y, 44) < 0.5 ? 2 : 3;
      const r = hash3(v.x, v.y * A + y, 42);
      if (y > 0) x += r < 0.3 ? -1 : r > 0.7 ? 1 : 0;
      x = Math.max(1, Math.min(A - 1 - w, x));
    }
    const tip = y === h - 1;
    const width = tip ? 1 : w;
    const stem = y < 2 ? lerpRGB(CEILING_MOSS, VINE, y / 2) : VINE;
    for (let i = 0; i < width; i++) putPixel(buf, x + i, y, y >= 2 && i === width - 1 && !tip ? VINE_DARK : stem);
    const r = hash3(v.x, v.y * A + y, 43);
    if (!tip && y >= 2 && r < 0.2) putPixel(buf, r < 0.1 ? x - 1 : x + width, y, VINE_SPIKE);
  }
  return buf;
}

/** Petal and centre colours: background centres are darker, foreground centres lighter. */
export function flowerColors(f: Flower): { petal: RGB; center: RGB } {
  const h = f.hue / 360;
  return {
    petal: hsvToRgb([h, 0.6, 0.9]),
    center: f.front ? hsvToRgb([h, 0.15, 1]) : hsvToRgb([h, 0.75, 0.42]),
  };
}

/**
 * A flower sprite, FLOWER_W wide and round(height * TILE_TEX) tall, with the
 * stem at the horizontal centre and its root on the bottom row (the bottom of
 * the grass tile it grows in).
 */
export function flowerSprite(f: Flower): PixelBuf {
  const h = Math.max(5, Math.round(f.height * N));
  const buf = makeBuf(FLOWER_W, h);
  const cx = FLOWER_W >> 1;
  const r = f.front ? (h > 24 ? 3 : 2) : h > 14 ? 2 : 1;
  const { petal, center } = flowerColors(f);

  // Stem, with an optional one-pixel kink.
  const kink = 1 + Math.floor(hash3(f.seed, 0, 51) * (h - 2 * r - 1));
  const kinkDir = hash3(f.seed, 1, 51) < 0.5 ? -1 : 1;
  const stemX = (y: number) => (y < kink + r ? cx + kinkDir : cx);
  for (let y = r + 1; y < h; y++) putPixel(buf, stemX(y), y, SHAFT);

  // Leaves alternate sides up the lower part of the stem.
  const span = h - 2 * r - 3;
  for (let i = 0; i < f.leaves; i++) {
    const side = (i + (f.seed & 1)) % 2 ? 1 : -1;
    const ly = h - 2 - Math.floor(((i + 1) * span) / (f.leaves + 1));
    const sx = stemX(ly);
    putPixel(buf, sx + side, ly, LEAF);
    putPixel(buf, sx + 2 * side, ly - 1, LEAF);
    if (f.front) putPixel(buf, sx + 3 * side, ly - 1, LEAF);
  }

  // Head: a disc of petals around a centre.
  const hx = stemX(r);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + 0.5) continue;
      putPixel(buf, hx + dx, r + dy, d2 <= (r >= 2 ? 1 : 0) ? center : petal);
    }
  }
  return buf;
}

/** Horizontal offset (in TILE_TEX texels) of a flower's stem from its tile's centre. */
export function flowerOffset(f: Flower): number {
  return Math.floor(hash3(f.seed, 2, 51) * 13) - 6;
}
