import { Tile, isSolidTile } from './tiles';

export class World {
  readonly tiles: Uint8Array;
  /** Bumped whenever a solid tile appears or disappears (terrain changed). */
  version = 0;
  /** Bumped whenever water moves or is added/removed. */
  waterVersion = 0;

  constructor(readonly width: number, readonly height: number) {
    this.tiles = new Uint8Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Out-of-bounds reads as rock so nothing leaves the map. */
  get(x: number, y: number): Tile {
    if (!this.inBounds(x, y)) return Tile.Rock;
    return this.tiles[y * this.width + x];
  }

  set(x: number, y: number, t: Tile): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    const old = this.tiles[i] as Tile;
    if (old === t) return;
    this.tiles[i] = t;
    if (isSolidTile(old) || isSolidTile(t)) this.version++;
    if (old === Tile.Water || t === Tile.Water) this.waterVersion++;
  }

  isSolid(x: number, y: number): boolean {
    return isSolidTile(this.get(x, y));
  }
}
