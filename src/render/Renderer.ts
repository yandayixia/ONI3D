import { Colonist } from '../entities/Colonist';
import { FLASH_TIME, Game } from '../game/Game';
import { Input } from '../input/Input';
import { Flower, Foliage, FoliageMap, Vine } from '../world/foliage';
import { Tile, isSolidTile } from '../world/tiles';
import { World } from '../world/World';
import { DIG_TIME, TILE_TEX } from '../config';
import { Camera } from './Camera';
import {
  FLOWER_W,
  GRASS_ROWS,
  GRASS_VARIANTS,
  Painter,
  flowerOffset,
  flowerSprite,
  grassSprite,
  paintCeilingMoss,
  paintFloorMoss,
  vineSprite,
} from './foliageArt';
import { Layer } from './layers';
import { PixelBuf, hashInt, makeBuf, paintTile, paintWall } from './tileArt';

/** The world is baked in CHUNK x CHUNK tile pieces, rebuilt only when their tiles change. */
const CHUNK = 16;
/** Texel budget for cached chunk canvases; least recently drawn chunks are dropped beyond it. */
const CHUNK_BUDGET = 32 * 1024 * 1024;
/** Chunk rebuilds per frame while an older image of the chunk can be shown meanwhile. */
const REBUILDS_PER_FRAME = 4;
const WATER_ALPHA = 0.8;
const WATER_VARIANTS = 4;
/** Grass tips lean at most this far (tiles) when wiggling. */
const GRASS_LEAN = 0.25;

// 8x16 colonist sprite. h=hair s=skin e=eye c=shirt p=pants b=boots
const SPRITE_TOP = [
  '..hhhh..',
  '.hhhhhh.',
  '.hssssh.',
  '.sssese.',
  '.ssssss.',
  '..ssss..',
  '..cccc..',
  '.cccccc.',
  'sccccccs',
  'sccccccs',
  '.cccccc.',
];
const LEGS = [
  ['.pppppp.', '.pp..pp.', '.pp..pp.', '.pp..pp.', '.bb..bb.'],
  ['.pppppp.', 'pp...pp.', 'pp....pp', 'pp....pp', 'bb....bb'],
];
const PALETTE: Record<string, string> = {
  h: '#3b2a1a',
  s: '#e8b98a',
  e: '#1b1b1b',
  p: '#3b4a6b',
  b: '#262626',
};

/** Visible tile range [x0, x1) x [y0, y1), and one CSS pixel in tile units. */
interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: number;
}

interface Pass {
  layer: Layer;
  draw: (game: Game, view: View) => void;
}

interface Chunk {
  /** Layers 10–21: wall, background flowers, terrain base and noise. */
  back: HTMLCanvasElement;
  /** Layer 24: moss. */
  moss: HTMLCanvasElement;
  tex: number;
  dirty: boolean;
  used: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toCanvas(buf: PixelBuf): HTMLCanvasElement {
  const c = makeCanvas(buf.width, buf.height);
  const img = buf instanceof ImageData ? buf : new ImageData(buf.width, buf.height);
  if (img !== buf) img.data.set(buf.data);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly passes: Pass[];
  private readonly chunks = new Map<number, Chunk>();
  private readonly chunksX: number;
  /** What the baked chunks were built from: solid tile type (0 if not solid) and foliage per tile. */
  private readonly tileSnap: Uint8Array;
  private readonly cellSnap: Uint8Array;
  private worldVersion = -1;
  private foliageVersion = -1;
  private tex = TILE_TEX;
  private frame = 0;
  private rebuilds = 0;
  private readonly sprites = new Map<string, HTMLCanvasElement[]>();
  private readonly waterSprites: HTMLCanvasElement[] = [];
  private readonly grassSprites: HTMLCanvasElement[] = [];
  private readonly vineSprites = new Map<Vine, HTMLCanvasElement>();
  private readonly flowerBufs = new Map<Flower, PixelBuf>();
  private readonly flowerSprites = new Map<Flower, HTMLCanvasElement>();

  constructor(private readonly canvas: HTMLCanvasElement, world: World) {
    this.ctx = canvas.getContext('2d')!;
    this.chunksX = Math.ceil(world.width / CHUNK);
    this.tileSnap = new Uint8Array(world.width * world.height);
    this.cellSnap = new Uint8Array(world.width * world.height);
    for (let i = 0; i < world.tiles.length; i++) this.tileSnap[i] = isSolidTile(world.tiles[i]) ? world.tiles[i] : 0;

    for (let v = 0; v < WATER_VARIANTS * 2; v++) {
      const buf = makeBuf(TILE_TEX, TILE_TEX);
      paintTile(buf, 0, 0, TILE_TEX, Tile.Water, v % WATER_VARIANTS, 0, v >= WATER_VARIANTS);
      this.waterSprites.push(toCanvas(buf));
    }
    for (let v = 0; v < GRASS_VARIANTS; v++) this.grassSprites.push(toCanvas(grassSprite(v)));

    // Stable sort: passes on the same layer keep this order.
    this.passes = (
      [
        { layer: Layer.Wall, draw: (g, v) => this.drawChunks(g, v, 'back') },
        { layer: Layer.Grass, draw: (g, v) => this.drawGrass(g, v) },
        { layer: Layer.Vine, draw: (g, v) => this.drawVines(g, v) },
        { layer: Layer.Moss, draw: (g, v) => this.drawChunks(g, v, 'moss') },
        { layer: Layer.Colonist, draw: (g, v) => this.drawColonists(g, v) },
        { layer: Layer.Water, draw: (g, v) => this.drawWater(g.world, v) },
        { layer: Layer.FrontFlower, draw: (g, v) => this.drawFrontFlowers(g.foliage, v) },
      ] as Pass[]
    ).sort((a, b) => a.layer - b.layer);
  }

  draw(game: Game, cam: Camera, input: Input): void {
    const { ctx, canvas } = this;
    const world = game.world;
    const dpr = window.devicePixelRatio || 1;

    this.syncCaches(world, game.foliage);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = cam.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (cam.viewW / 2 - cam.cx * cam.scale) * dpr, (cam.viewH / 2 - cam.cy * cam.scale) * dpr);
    ctx.imageSmoothingEnabled = false;
    const px = 1 / cam.scale; // one CSS pixel in tile units

    // Texel density follows zoom so zoomed-out views bake small chunks.
    this.tex = s >= 24 ? TILE_TEX : s >= 12 ? TILE_TEX / 2 : TILE_TEX / 4;
    this.frame++;
    this.rebuilds = REBUILDS_PER_FRAME;
    const tl = cam.screenToWorld(0, 0);
    const br = cam.screenToWorld(cam.viewW, cam.viewH);
    const view: View = {
      x0: Math.max(0, Math.floor(tl.x)),
      y0: Math.max(0, Math.floor(tl.y)),
      x1: Math.min(world.width, Math.ceil(br.x)),
      y1: Math.min(world.height, Math.ceil(br.y)),
      px,
    };

    for (const pass of this.passes) pass.draw(game, view);

    for (const c of game.colonists) {
      if (c.goal?.kind === 'dig') this.drawDigTarget(c, px);
    }
    for (const c of game.selected) this.drawSelection(c, px);
    this.drawHover(game, input, px);
    for (const f of game.flashes) {
      ctx.globalAlpha = f.time / FLASH_TIME;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(f.x, f.y, 1, 1);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#444b5a';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(0, 0, world.width, world.height);

    this.evictChunks();
  }

  /** Marks chunks dirty around every tile whose terrain or foliage changed since the last bake. */
  private syncCaches(world: World, foliage: FoliageMap): void {
    if (world.version === this.worldVersion && foliage.version === this.foliageVersion) return;
    if (foliage.version !== this.foliageVersion) {
      const vines = new Set(foliage.vines);
      const flowers = new Set(foliage.flowers);
      for (const v of this.vineSprites.keys()) if (!vines.has(v)) this.vineSprites.delete(v);
      for (const f of this.flowerBufs.keys()) if (!flowers.has(f)) this.flowerBufs.delete(f);
      for (const f of this.flowerSprites.keys()) if (!flowers.has(f)) this.flowerSprites.delete(f);
    }
    this.worldVersion = world.version;
    this.foliageVersion = foliage.version;
    const { width: w, tiles } = world;
    for (let i = 0; i < tiles.length; i++) {
      const t = isSolidTile(tiles[i]) ? tiles[i] : 0;
      if (t === this.tileSnap[i] && foliage.cells[i] === this.cellSnap[i]) continue;
      this.tileSnap[i] = t;
      this.cellSnap[i] = foliage.cells[i];
      // Neighbours depend on this tile too (surface band, moss spill, flowers).
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ch = this.chunks.get(this.chunkKey(Math.floor((x + dx) / CHUNK), Math.floor((y + dy) / CHUNK)));
          if (ch) ch.dirty = true;
        }
      }
    }
  }

  private chunkKey(cx: number, cy: number): number {
    return cy * this.chunksX + cx;
  }

  private drawChunks(game: Game, v: View, which: 'back' | 'moss'): void {
    if (v.x1 <= v.x0 || v.y1 <= v.y0) return;
    const { world } = game;
    for (let cy = Math.floor(v.y0 / CHUNK); cy <= Math.floor((v.y1 - 1) / CHUNK); cy++) {
      for (let cx = Math.floor(v.x0 / CHUNK); cx <= Math.floor((v.x1 - 1) / CHUNK); cx++) {
        const key = this.chunkKey(cx, cy);
        let ch = this.chunks.get(key);
        // Rebuild only in the first chunk pass so a chunk's back and moss images always match.
        // Missing chunks are always built; stale ones are rebuilt a few per frame.
        if (which === 'back' && (!ch || ((ch.dirty || ch.tex !== this.tex) && this.rebuilds-- > 0))) {
          ch = this.buildChunk(game, cx, cy);
          this.chunks.set(key, ch);
        }
        if (!ch) continue;
        ch.used = this.frame;
        const w = Math.min(CHUNK, world.width - cx * CHUNK);
        const h = Math.min(CHUNK, world.height - cy * CHUNK);
        this.ctx.drawImage(ch[which], cx * CHUNK, cy * CHUNK, w, h);
      }
    }
  }

  private buildChunk(game: Game, cx: number, cy: number): Chunk {
    const { world, foliage } = game;
    const tex = this.tex;
    const tx0 = cx * CHUNK;
    const ty0 = cy * CHUNK;
    const cw = Math.min(CHUNK, world.width - tx0);
    const chh = Math.min(CHUNK, world.height - ty0);

    // Layer 10: the cave wall behind every open tile, then background flowers.
    const back = new ImageData(cw * tex, chh * tex);
    for (let ty = ty0; ty < ty0 + chh; ty++) {
      for (let tx = tx0; tx < tx0 + cw; tx++) {
        if (!world.isSolid(tx, ty)) paintWall(back, (tx - tx0) * tex, (ty - ty0) * tex, tex, tx, ty);
      }
    }
    for (const f of foliage.flowers) {
      // Flowers reach up to one tile above and a few texels sideways.
      if (f.front || f.x < tx0 - 1 || f.x > tx0 + cw || f.y < ty0 || f.y > ty0 + chh) continue;
      const spr = this.flowerBuf(f);
      const p = new Painter(back, (f.x - tx0) * tex, (f.y + 1 - ty0) * tex, tex);
      p.blit(spr, TILE_TEX / 2 + flowerOffset(f) - (FLOWER_W >> 1), -spr.height);
    }

    // Layers 20–21: terrain base colour and pixel noise.
    for (let ty = ty0; ty < ty0 + chh; ty++) {
      for (let tx = tx0; tx < tx0 + cw; tx++) {
        const t = world.get(tx, ty);
        if (!isSolidTile(t)) continue;
        paintTile(back, (tx - tx0) * tex, (ty - ty0) * tex, tex, t, tx, ty, !world.isSolid(tx, ty - 1));
      }
    }

    // Layer 24: moss, including moss on the rows just outside that spills in.
    const moss = new ImageData(cw * tex, chh * tex);
    for (let ty = ty0 - 1; ty <= ty0 + chh; ty++) {
      for (let tx = tx0; tx < tx0 + cw; tx++) {
        const f = foliage.get(tx, ty);
        if (f !== Foliage.FloorMoss && f !== Foliage.CeilingMoss) continue;
        const p = new Painter(moss, (tx - tx0) * tex, (ty - ty0) * tex, tex);
        if (f === Foliage.FloorMoss) paintFloorMoss(p, tx, ty);
        else paintCeilingMoss(p, tx, ty);
      }
    }

    return { back: toCanvas(back), moss: toCanvas(moss), tex, dirty: false, used: this.frame };
  }

  private evictChunks(): void {
    let texels = 0;
    for (const ch of this.chunks.values()) texels += ch.back.width * ch.back.height * 2;
    if (texels <= CHUNK_BUDGET) return;
    const old = [...this.chunks].filter(([, ch]) => ch.used !== this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key, ch] of old) {
      if (texels <= CHUNK_BUDGET) break;
      texels -= ch.back.width * ch.back.height * 2;
      this.chunks.delete(key);
    }
  }

  private flowerBuf(f: Flower): PixelBuf {
    let buf = this.flowerBufs.get(f);
    if (!buf) this.flowerBufs.set(f, (buf = flowerSprite(f)));
    return buf;
  }

  private drawGrass(game: Game, v: View): void {
    const { ctx } = this;
    const { foliage, foliageAnim } = game;
    const h = GRASS_ROWS / TILE_TEX;
    for (let y = v.y0; y < v.y1; y++) {
      for (let x = v.x0; x < v.x1; x++) {
        const i = y * foliage.width + x;
        if (foliage.cells[i] !== Foliage.Grass) continue;
        const spr = this.grassSprites[hashInt(x, y, 5) % GRASS_VARIANTS];
        // Tip offset snapped to whole texels to keep the pixel-art look.
        const lean = Math.round(foliageAnim.grassOffset(i) * GRASS_LEAN * TILE_TEX) / TILE_TEX;
        if (lean === 0) {
          ctx.drawImage(spr, x, y + 1 - h, 1, h);
          continue;
        }
        ctx.save();
        ctx.translate(x, y + 1);
        ctx.transform(1, 0, -lean / h, 1, 0, 0); // shear around the roots
        ctx.drawImage(spr, 0, -h, 1, h);
        ctx.restore();
      }
    }
  }

  private drawVines(game: Game, v: View): void {
    const { ctx } = this;
    const { foliage, foliageAnim } = game;
    for (const vine of foliage.vines) {
      if (vine.x < v.x0 - 1 || vine.x > v.x1 || vine.y > v.y1 || vine.y + vine.length < v.y0) continue;
      let spr = this.vineSprites.get(vine);
      if (!spr) this.vineSprites.set(vine, (spr = toCanvas(vineSprite(vine))));
      const angle = foliageAnim.vineAngle(vine);
      if (angle === 0) {
        ctx.drawImage(spr, vine.x, vine.y, 1, vine.length);
        continue;
      }
      // Bend the vine: offset grows with the square of the distance from the
      // root, reaching sin(angle) * length at the tip. Drawn in 2-texel slices.
      const sin = Math.sin(angle);
      for (let sy = 0; sy < spr.height; sy += 2) {
        const d = (sy + 1) / TILE_TEX;
        const off = Math.round(((sin * d * d) / vine.length) * TILE_TEX) / TILE_TEX;
        ctx.drawImage(spr, 0, sy, TILE_TEX, 2, vine.x + off, vine.y + sy / TILE_TEX, 1, 2 / TILE_TEX);
      }
    }
  }

  private drawColonists(game: Game, v: View): void {
    for (const c of game.selected) this.drawPath(c, v.px);
    for (const c of game.colonists) this.drawColonist(c);
  }

  private drawWater(world: World, v: View): void {
    const { ctx } = this;
    ctx.globalAlpha = WATER_ALPHA;
    for (let y = v.y0; y < v.y1; y++) {
      for (let x = v.x0; x < v.x1; x++) {
        if (world.get(x, y) !== Tile.Water) continue;
        const surface = world.get(x, y - 1) === Tile.Empty ? WATER_VARIANTS : 0;
        ctx.drawImage(this.waterSprites[surface + (hashInt(x, y, 3) % WATER_VARIANTS)], x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFrontFlowers(foliage: FoliageMap, v: View): void {
    for (const f of foliage.flowers) {
      if (!f.front || f.x < v.x0 - 1 || f.x > v.x1 || f.y < v.y0 - 1 || f.y > v.y1 + 1) continue;
      let spr = this.flowerSprites.get(f);
      if (!spr) this.flowerSprites.set(f, (spr = toCanvas(this.flowerBuf(f))));
      const h = spr.height / TILE_TEX;
      const x = f.x + (TILE_TEX / 2 + flowerOffset(f) - (FLOWER_W >> 1)) / TILE_TEX;
      this.ctx.drawImage(spr, x, f.y + 1 - h, FLOWER_W / TILE_TEX, h);
    }
  }

  private spriteFrames(shirt: string): HTMLCanvasElement[] {
    let frames = this.sprites.get(shirt);
    if (frames) return frames;
    frames = LEGS.map((legs) => {
      const c = makeCanvas(8, 16);
      const g = c.getContext('2d')!;
      [...SPRITE_TOP, ...legs].forEach((row, y) => {
        for (let x = 0; x < 8; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          g.fillStyle = ch === 'c' ? shirt : PALETTE[ch];
          g.fillRect(x, y, 1, 1);
        }
      });
      return c;
    });
    this.sprites.set(shirt, frames);
    return frames;
  }

  private drawColonist(c: Colonist): void {
    const ctx = this.ctx;
    const frames = this.spriteFrames(c.shirt);
    const walking = c.grounded && Math.abs(c.vx) > 0.5;
    const frame = !c.grounded ? 1 : walking ? Math.floor(c.animTime * 2.5) % 2 : 0;
    // Bob while digging.
    const bob = c.state === 'working' ? Math.abs(Math.sin(c.digProgress * 12)) * 0.08 : 0;
    ctx.save();
    ctx.translate(c.px, c.py - 2 + bob);
    if (c.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(frames[frame], -0.5, 0, 1, 2);
    ctx.restore();
  }

  private drawSelection(c: Colonist, px: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(c.px - 0.6, c.py - 2.1, 1.2, 2.2);
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(c.px - 0.3, c.py - 2.7);
    ctx.lineTo(c.px + 0.3, c.py - 2.7);
    ctx.lineTo(c.px, c.py - 2.3);
    ctx.closePath();
    ctx.fill();
  }

  private drawPath(c: Colonist, px: number): void {
    if (c.pathIndex >= c.path.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(c.px, c.py - 0.5);
    for (let i = c.pathIndex; i < c.path.length; i++) {
      const n = c.path[i];
      ctx.lineTo(n.x + 0.5, n.y + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawDigTarget(c: Colonist, px: number): void {
    const ctx = this.ctx;
    const { tx, ty } = c.goal!;
    ctx.strokeStyle = '#ffd24d';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.strokeRect(tx + px, ty + px, 1 - 2 * px, 1 - 2 * px);
    ctx.setLineDash([]);
    if (c.digProgress > 0) {
      const p = Math.min(1, c.digProgress / DIG_TIME);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(tx, ty - 0.3, 1, 0.2);
      ctx.fillStyle = '#ffd24d';
      ctx.fillRect(tx, ty - 0.3, p, 0.2);
    }
  }

  private drawHover(game: Game, input: Input, px: number): void {
    const h = input.hover;
    if (!h || !game.world.inBounds(h.x, h.y)) return;
    let color = 'rgba(255, 255, 255, 0.5)';
    if (game.selected.size > 0) {
      const t = game.world.get(h.x, h.y);
      color = t === Tile.Dirt ? '#ffd24d' : t === Tile.Rock ? '#ff4d4d' : '#ffffff';
    }
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(h.x, h.y, 1, 1);
  }
}
