import { TILE_PX } from '../config';

const MIN_SCALE = 4;
const MAX_SCALE = 64;

/** Camera in tile units; `scale` is CSS pixels per tile. */
export class Camera {
  scale = TILE_PX * 2;
  viewW = 1;
  viewH = 1;

  constructor(public cx: number, public cy: number, private readonly worldW: number, private readonly worldH: number) {}

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.scale + this.cx,
      y: (sy - this.viewH / 2) / this.scale + this.cy,
    };
  }

  pan(dx: number, dy: number): void {
    this.cx += dx;
    this.cy += dy;
    this.clamp();
  }

  /** Zooms keeping the world point under the cursor fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    const after = this.screenToWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp();
  }

  private clamp(): void {
    const halfW = this.viewW / 2 / this.scale;
    const halfH = this.viewH / 2 / this.scale;
    this.cx = halfW * 2 >= this.worldW ? this.worldW / 2 : Math.max(halfW, Math.min(this.worldW - halfW, this.cx));
    this.cy = halfH * 2 >= this.worldH ? this.worldH / 2 : Math.max(halfH, Math.min(this.worldH - halfH, this.cy));
  }
}
