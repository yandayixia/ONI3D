import { TILE_TEX } from '../config';
import { Flower, Vine } from '../world/foliage';
import { hash3, hsvToRgb, lerpRGB, makeBuf, PixelBuf, putPixel, RGB } from './tileArt';

const N = TILE_TEX;

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
const VINE_SPIKE: RGB = [234, 242, 228];
const SHAFT: RGB = [66, 124, 54];
const LEAF: RGB = [92, 160, 70];

/** Grass sprites are this many TILE_TEX rows tall (the tallest patch plus room to lean). */
export const GRASS_ROWS = 14;
export const GRASS_VARIANTS = 16;
/** Flower sprites are this many texels wide, centred on the stem. */
export const FLOWER_W = 15;

/**
 * Plots art authored on the TILE_TEX grid into a buffer at another texel
 * density (`tex` texels per tile), offset by pixel (ox, oy). Writes outside
 * the buffer are clipped, so art may spill across chunk edges.
 */
export class Painter {
  private readonly s: number;

  constructor(readonly buf: PixelBuf, readonly ox: number, readonly oy: number, tex = N) {
    this.s = tex / N;
  }

  dot(gx: number, gy: number, c: RGB): void {
    putPixel(this.buf, this.ox + Math.floor(gx * this.s), this.oy + Math.floor(gy * this.s), c);
  }

  /** Copies the opaque pixels of a TILE_TEX-grid sprite with its top-left at (gx, gy). */
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

/**
 * Floor moss on tile (tx, ty), with the painter's origin at the tile's
 * top-left: a bumpy 1–7 row carpet on the tile's top, with tufts reaching
 * 1–3 rows (1–10%) into the tile above.
 */
export function paintFloorMoss(p: Painter, tx: number, ty: number): void {
  for (let gx = 0; gx < N; gx++) {
    const wx = tx * N + gx;
    // Depth changes in 2-texel steps so the edge reads as chunky pixel art.
    const depth = 1 + Math.floor(hash3(wx >> 1, ty, 11) * 7);
    for (let gy = 0; gy < depth; gy++) {
      const r = hash3(wx, ty * N + gy, 12);
      p.dot(gx, gy, gy === depth - 1 ? FLOOR_MOSS_DARK : r < 0.2 ? FLOOR_MOSS_LIGHT : FLOOR_MOSS);
    }
    const tuft = 1 + Math.floor(hash3(wx, ty, 13) ** 2 * 3);
    for (let k = 1; k <= tuft; k++) p.dot(gx, -k, k === tuft ? FLOOR_MOSS_LIGHT : FLOOR_MOSS);
  }
}

/**
 * Ceiling moss on tile (tx, ty), with the painter's origin at the tile's
 * top-left: a web of diagonal strands covering the bottom 20–50% of the tile
 * and the top 10–20% of the tile below.
 */
export function paintCeilingMoss(p: Painter, tx: number, ty: number): void {
  const cover = Math.round((0.2 + hash3(tx, ty, 21) * 0.3) * N);
  const below = Math.round((0.1 + hash3(tx, ty, 22) * 0.1) * N);
  for (let gx = 0; gx < N; gx++) {
    const wx = tx * N + gx;
    const top = N - Math.round(cover * (0.6 + 0.4 * hash3(wx >> 1, ty, 23)));
    const bottom = N + Math.round(below * (0.4 + 0.6 * hash3(wx, ty, 24)));
    for (let gy = top; gy < bottom; gy++) {
      const web = (gx + gy) % 4 === 0 || (gx - gy + 64) % 4 === 0;
      const r = hash3(wx, ty * N + gy, 25);
      if (gy === bottom - 1) p.dot(gx, gy, CEILING_MOSS_DARK);
      else if (web) p.dot(gx, gy, r < 0.25 ? CEILING_MOSS_LIGHT : CEILING_MOSS);
      else if (gy >= N - 2 && gy <= N + 1) p.dot(gx, gy, CEILING_MOSS); // dense band along the rock face
      else if (r < 0.15) p.dot(gx, gy, CEILING_MOSS_DARK);
    }
  }
}

/**
 * One grass patch, TILE_TEX wide and GRASS_ROWS tall, bottom-aligned: 0.15–0.4
 * tile tall strokes in several greens. Roots use the floor-moss colour so the
 * patch blends into the moss under it.
 */
export function grassSprite(variant: number): PixelBuf {
  const buf = makeBuf(N, GRASS_ROWS);
  const patch = Math.round((0.15 + hash3(variant, 0, 31) * 0.25) * N);
  for (let gx = 1; gx < N - 1; gx += 2) {
    if (hash3(variant, gx, 32) < 0.2) continue;
    const h = Math.max(2, Math.round(patch * (0.5 + 0.5 * hash3(variant, gx, 33))));
    const lean = Math.floor(hash3(variant, gx, 34) * 3) - 1;
    const shade = GRASS[Math.floor(hash3(variant, gx, 35) * GRASS.length)];
    for (let k = 0; k < h; k++) {
      const x = gx + Math.trunc((lean * k) / 4);
      const c = k < 2 ? FLOOR_MOSS : k === h - 1 ? GRASS_TIP : shade;
      putPixel(buf, x, GRASS_ROWS - 1 - k, c);
    }
  }
  return buf;
}

/**
 * A hanging vine, TILE_TEX wide and `length` tiles tall: a wandering two-pixel
 * stem with white spike pixels. The top fades in from the ceiling-moss colour
 * so it grows seamlessly out of the moss above.
 */
export function vineSprite(v: Vine): PixelBuf {
  const h = v.length * N;
  const buf = makeBuf(N, h);
  let x = 14 + Math.floor(hash3(v.x, v.y, 41) * 4);
  for (let y = 0; y < h; y++) {
    if (y > 0 && y % 4 === 0) {
      const r = hash3(v.x, v.y * N + y, 42);
      x = Math.max(10, Math.min(N - 12, x + (r < 0.3 ? -1 : r > 0.7 ? 1 : 0)));
    }
    const stem = y < 8 ? lerpRGB(CEILING_MOSS, VINE, y / 8) : VINE;
    const tip = y >= h - 3;
    putPixel(buf, x, y, stem);
    if (!tip) putPixel(buf, x + 1, y, y < 8 ? stem : VINE_DARK);
    const r = hash3(v.x, v.y * N + y, 43);
    if (!tip && y > 4 && r < 0.18) putPixel(buf, r < 0.09 ? x - 1 : x + 2, y, VINE_SPIKE);
    else if (!tip && y > 6 && r > 0.94) {
      // A small leaf.
      const side = r > 0.97 ? 1 : -1;
      putPixel(buf, side > 0 ? x + 2 : x - 1, y, VINE);
      putPixel(buf, side > 0 ? x + 3 : x - 2, y - 1, VINE);
    }
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
