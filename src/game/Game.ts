import { Colonist } from '../entities/Colonist';
import { FoliageAnimator } from '../sim/foliageAnim';
import { WaterSim } from '../sim/water';
import { FoliageMap, syncFoliage } from '../world/foliage';
import { mulberry32 } from '../world/rng';
import { Tile } from '../world/tiles';
import { World } from '../world/World';
import { generateWorld } from '../world/worldgen';

const SHIRTS = ['#d9534f', '#5bc0de', '#f0ad4e', '#5cb85c', '#9b59b6'];

export interface Flash {
  x: number;
  y: number;
  color: string;
  time: number;
}

export const FLASH_TIME = 0.4;

export class Game {
  readonly world: World;
  readonly foliage: FoliageMap;
  readonly foliageAnim = new FoliageAnimator();
  readonly colonists: Colonist[];
  readonly water: WaterSim;
  readonly selected = new Set<Colonist>();
  flashes: Flash[] = [];

  constructor(readonly seed: number) {
    const gen = generateWorld(seed);
    this.world = gen.world;
    this.foliage = gen.foliage;
    this.colonists = gen.spawns.map((s, i) => new Colonist(i, s.x + 0.5, s.y + 1, SHIRTS[i % SHIRTS.length]));
    this.water = new WaterSim(this.world, mulberry32(seed ^ 0x9e3779b9));
  }

  tick(dt: number): void {
    for (const c of this.colonists) c.update(this.world, dt);
    syncFoliage(this.foliage, this.world);
    this.foliageAnim.update(this.colonists, this.foliage, dt);
    for (const f of this.flashes) f.time -= dt;
    this.flashes = this.flashes.filter((f) => f.time > 0);
  }

  waterTick(): void {
    this.water.step();
  }

  colonistAt(wx: number, wy: number): Colonist | null {
    for (let i = this.colonists.length - 1; i >= 0; i--) {
      if (this.colonists[i].hitTest(wx, wy)) return this.colonists[i];
    }
    return null;
  }

  select(c: Colonist, additive: boolean): void {
    if (!additive) {
      this.selected.clear();
      this.selected.add(c);
    } else if (this.selected.has(c)) {
      this.selected.delete(c);
    } else {
      this.selected.add(c);
    }
  }

  /** Orders the selected colonists to act on tile (tx, ty). */
  issueCommand(tx: number, ty: number): void {
    if (this.selected.size === 0 || !this.world.inBounds(tx, ty)) return;
    const t = this.world.get(tx, ty);
    if (t === Tile.Rock) {
      this.flash(tx, ty, '#ff4d4d');
      return;
    }
    for (const c of this.selected) {
      if (t === Tile.Dirt) c.commandDig(tx, ty);
      else c.commandMove(tx, ty);
    }
    this.flash(tx, ty, t === Tile.Dirt ? '#ffd24d' : '#ffffff');
  }

  private flash(x: number, y: number, color: string): void {
    this.flashes.push({ x, y, color, time: FLASH_TIME });
  }
}
