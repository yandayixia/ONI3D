import { Colonist } from '../entities/Colonist';
import { FLASH_TIME, Game } from '../game/Game';
import { Input } from '../input/Input';
import { Tile } from '../world/tiles';
import { World } from '../world/World';
import { DIG_TIME } from '../config';
import { Camera } from './Camera';

/** Texels per tile in the cached terrain texture. */
const TEX = 4;

type RGB = [number, number, number];
const BG: RGB = [20, 23, 32];
const DIRT: RGB = [122, 84, 52];
const ROCK: RGB = [104, 108, 118];
const WATER: [number, number, number, number] = [52, 120, 220, 150];
const WATER_SURFACE: [number, number, number, number] = [120, 180, 255, 190];

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

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private readonly water: HTMLCanvasElement;
  private terrainVersion = -1;
  private waterVersion = -1;
  private readonly sprites = new Map<string, HTMLCanvasElement[]>();

  constructor(private readonly canvas: HTMLCanvasElement, world: World) {
    this.ctx = canvas.getContext('2d')!;
    this.terrain = makeCanvas(world.width * TEX, world.height * TEX);
    this.water = makeCanvas(world.width, world.height);
  }

  draw(game: Game, cam: Camera, input: Input): void {
    const { ctx, canvas } = this;
    const world = game.world;
    const dpr = window.devicePixelRatio || 1;

    if (world.version !== this.terrainVersion) this.rebuildTerrain(world);
    if (world.waterVersion !== this.waterVersion) this.rebuildWater(world);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = cam.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (cam.viewW / 2 - cam.cx * cam.scale) * dpr, (cam.viewH / 2 - cam.cy * cam.scale) * dpr);
    ctx.imageSmoothingEnabled = false;
    const px = 1 / cam.scale; // one CSS pixel in tile units

    ctx.drawImage(this.terrain, 0, 0, world.width, world.height);

    for (const c of game.selected) this.drawPath(c, px);
    for (const c of game.colonists) this.drawColonist(c);

    // Water goes over colonists so they look submerged.
    ctx.drawImage(this.water, 0, 0, world.width, world.height);

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
  }

  private rebuildTerrain(world: World): void {
    this.terrainVersion = world.version;
    const w = world.width * TEX;
    const img = new ImageData(w, world.height * TEX);
    const d = img.data;
    for (let ty = 0; ty < world.height; ty++) {
      for (let tx = 0; tx < world.width; tx++) {
        const t = world.get(tx, ty);
        const solid = t === Tile.Dirt || t === Tile.Rock;
        const base = t === Tile.Dirt ? DIRT : t === Tile.Rock ? ROCK : BG;
        const shade = solid ? 0.88 + hash(tx, ty) * 0.24 : 1;
        const exposedTop = solid && !world.isSolid(tx, ty - 1);
        for (let sy = 0; sy < TEX; sy++) {
          for (let sx = 0; sx < TEX; sx++) {
            let k = shade;
            if (solid) {
              k *= 0.94 + hash(tx * TEX + sx, ty * TEX + sy) * 0.12;
              if (exposedTop && sy === 0) k *= t === Tile.Dirt ? 1.35 : 1.25;
            }
            const o = ((ty * TEX + sy) * w + tx * TEX + sx) * 4;
            d[o] = Math.min(255, base[0] * k);
            d[o + 1] = Math.min(255, base[1] * k);
            d[o + 2] = Math.min(255, base[2] * k);
            d[o + 3] = 255;
          }
        }
      }
    }
    this.terrain.getContext('2d')!.putImageData(img, 0, 0);
  }

  private rebuildWater(world: World): void {
    this.waterVersion = world.waterVersion;
    const img = new ImageData(world.width, world.height);
    const d = img.data;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (world.get(x, y) !== Tile.Water) continue;
        const c = world.get(x, y - 1) === Tile.Water ? WATER : WATER_SURFACE;
        const o = (y * world.width + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = c[3];
      }
    }
    this.water.getContext('2d')!.putImageData(img, 0, 0);
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
