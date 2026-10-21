import { BODY_H, BODY_W } from '../config';
import { Foliage, FoliageMap, Vine } from '../world/foliage';

/** The parts of a colonist the animator needs. */
export interface Body {
  px: number;
  py: number;
  vx: number;
}

interface GrassWiggle {
  amp: number;
  t: number;
}

interface VineSwing {
  angle: number;
  vel: number;
}

const GRASS_FREQ = 18; // rad/s
const GRASS_DECAY = 0.35; // s, amplitude time constant
const VINE_GRAVITY = 14; // stiffness: angular accel = -(g / length) * sin(angle)
const VINE_DAMPING = 1.6;
const VINE_KICK = 0.3; // angular velocity per (tile/s of colonist speed / vine length)
const REST = 1e-3;

/**
 * Visual-only foliage motion. Grass wiggles when a colonist enters or leaves
 * it; vines swing like a damped pendulum, pushed in the colonist's direction
 * of motion. Only disturbed foliage has state.
 */
export class FoliageAnimator {
  readonly grass = new Map<number, GrassWiggle>();
  readonly vines = new Map<Vine, VineSwing>();
  private readonly touching = new Map<Body, { grass: Set<number>; vines: Set<Vine> }>();
  private vineAt = new Map<number, Vine>();
  private foliageVersion = -1;

  update(bodies: readonly Body[], map: FoliageMap, dt: number): void {
    if (map.version !== this.foliageVersion) this.reindex(map);

    for (const b of bodies) {
      const grass = new Set<number>();
      const vines = new Set<Vine>();
      const x0 = Math.floor(b.px - BODY_W / 2);
      const x1 = Math.floor(b.px + BODY_W / 2 - 1e-6);
      const y0 = Math.floor(b.py - BODY_H);
      const y1 = Math.floor(b.py - 1e-6);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const f = map.get(x, y);
          const i = y * map.width + x;
          if (f === Foliage.Grass) grass.add(i);
          else if (f === Foliage.Vine) {
            const v = this.vineAt.get(i);
            if (v) vines.add(v);
          }
        }
      }
      const prev = this.touching.get(b);
      for (const g of grass) if (!prev?.grass.has(g)) this.kickGrass(g);
      for (const v of vines) if (!prev?.vines.has(v)) this.kickVine(v, b.vx);
      if (prev) {
        for (const g of prev.grass) if (!grass.has(g)) this.kickGrass(g);
        for (const v of prev.vines) if (!vines.has(v)) this.kickVine(v, b.vx);
      }
      this.touching.set(b, { grass, vines });
    }

    for (const [k, s] of this.grass) {
      s.t += dt;
      s.amp *= Math.exp(-dt / GRASS_DECAY);
      if (s.amp < REST) this.grass.delete(k);
    }
    for (const [v, s] of this.vines) {
      s.vel += (-(VINE_GRAVITY / v.length) * Math.sin(s.angle) - VINE_DAMPING * s.vel) * dt;
      s.angle += s.vel * dt;
      if (Math.abs(s.angle) < REST && Math.abs(s.vel) < REST) this.vines.delete(v);
    }
  }

  /** Horizontal tip offset of a grass tile, as a fraction of its height (-1..1). */
  grassOffset(index: number): number {
    const s = this.grass.get(index);
    return s ? s.amp * Math.sin(s.t * GRASS_FREQ) : 0;
  }

  /** Swing angle of a vine in radians; positive swings the tip to the right. */
  vineAngle(v: Vine): number {
    return this.vines.get(v)?.angle ?? 0;
  }

  private kickGrass(index: number): void {
    this.grass.set(index, { amp: 1, t: 0 });
  }

  private kickVine(v: Vine, vx: number): void {
    if (vx === 0) return;
    let s = this.vines.get(v);
    if (!s) this.vines.set(v, (s = { angle: 0, vel: 0 }));
    s.vel += (VINE_KICK * vx) / v.length;
  }

  private reindex(map: FoliageMap): void {
    this.foliageVersion = map.version;
    this.vineAt = new Map();
    for (const v of map.vines) {
      for (let k = 0; k < v.length; k++) this.vineAt.set((v.y + k) * map.width + v.x, v);
    }
    const live = new Set(map.vines);
    for (const v of this.vines.keys()) if (!live.has(v)) this.vines.delete(v);
    for (const g of this.grass.keys()) if (map.cells[g] !== Foliage.Grass) this.grass.delete(g);
  }
}
