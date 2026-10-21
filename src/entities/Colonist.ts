import * as C from '../config';
import { canReachTile, findPath, isStandable, PathNode, resolveStandTarget } from '../sim/pathfinding';
import { Tile, isSolidTile } from '../world/tiles';
import { World } from '../world/World';

export type ColonistState = 'idle' | 'moving' | 'working';

interface Goal {
  kind: 'move' | 'dig';
  tx: number;
  ty: number;
}

const EPS = 1e-4;

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * A colonist is a 1x2 tile body affected by gravity. Position (px, py) is the
 * bottom-center of the body (its feet), in tile units.
 */
export class Colonist {
  vx = 0;
  vy = 0;
  grounded = false;
  facing = 1;
  animTime = 0;

  goal: Goal | null = null;
  path: PathNode[] = [];
  pathIndex = 0;
  digProgress = 0;
  private working = false;
  private needPlan = false;
  private plannedVersion = -1;
  private stuckTimer = 0;
  private replans = 0;
  private jumpCooldown = 0;

  constructor(
    readonly id: number,
    public px: number,
    public py: number,
    readonly shirt: string,
  ) {}

  get state(): ColonistState {
    if (!this.goal) return 'idle';
    return this.working ? 'working' : 'moving';
  }

  commandMove(tx: number, ty: number): void {
    this.setGoal({ kind: 'move', tx, ty });
  }

  commandDig(tx: number, ty: number): void {
    this.setGoal({ kind: 'dig', tx, ty });
  }

  stop(): void {
    this.goal = null;
    this.path = [];
    this.pathIndex = 0;
    this.working = false;
    this.digProgress = 0;
    this.needPlan = false;
  }

  private setGoal(goal: Goal): void {
    this.stop();
    this.goal = goal;
    this.needPlan = true;
    this.replans = 0;
    this.stuckTimer = 0;
  }

  /** The standable node the colonist is currently standing on, or null when airborne. */
  currentNode(world: World): { x: number; y: number } | null {
    if (!this.grounded) return null;
    const fy = Math.floor(this.py - 0.01);
    const hw = C.BODY_W / 2;
    const candidates = [Math.floor(this.px), Math.floor(this.px - hw + 0.01), Math.floor(this.px + hw - 0.01)];
    for (const cx of candidates) {
      if (isStandable(world, cx, fy)) return { x: cx, y: fy };
    }
    return null;
  }

  update(world: World, dt: number): void {
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    let inputX = 0;
    let wantJump = false;

    const goal = this.goal;
    if (goal) {
      if (goal.kind === 'dig' && world.get(goal.tx, goal.ty) !== Tile.Dirt) {
        this.stop();
      } else {
        if (world.version !== this.plannedVersion) this.needPlan = true;
        const cur = this.currentNode(world);
        // Replan only from solid ground; keep following the old path mid-air.
        if (this.needPlan && cur) this.plan(world, cur);
        if (!this.needPlan || this.pathIndex < this.path.length) {
          [inputX, wantJump] = this.follow(world, cur, dt);
        }
      }
    }

    this.physics(world, dt, inputX, wantJump);
  }

  private plan(world: World, cur: { x: number; y: number }): void {
    const goal = this.goal!;
    let isGoal: (x: number, y: number) => boolean;
    let hx = goal.tx;
    let hy = goal.ty;
    if (goal.kind === 'move') {
      const t = resolveStandTarget(world, goal.tx, goal.ty);
      if (t) {
        hx = t.x;
        hy = t.y;
        isGoal = (x, y) => x === t.x && y === t.y;
      } else {
        isGoal = () => false;
      }
    } else {
      isGoal = (x, y) => canReachTile(x, y, goal.tx, goal.ty);
    }
    const res = findPath(world, cur.x, cur.y, isGoal, hx, hy);
    this.path = res.path;
    this.pathIndex = 0;
    this.needPlan = false;
    this.plannedVersion = world.version;
  }

  /** Path-following controller. Returns [horizontal input -1..1, jump]. */
  private follow(world: World, cur: { x: number; y: number } | null, dt: number): [number, boolean] {
    const goal = this.goal!;

    if (this.pathIndex >= this.path.length) {
      if (goal.kind === 'dig' && cur && canReachTile(cur.x, cur.y, goal.tx, goal.ty)) {
        this.working = true;
        const dir = Math.sign(goal.tx + 0.5 - this.px);
        if (dir !== 0) this.facing = dir;
        this.digProgress += dt;
        if (this.digProgress >= C.DIG_TIME) {
          world.set(goal.tx, goal.ty, Tile.Empty);
          this.stop();
        }
        return [0, false];
      }
      // Arrived (or got as close as possible), or the dig target is unreachable.
      if (this.grounded) this.stop();
      return [0, false];
    }

    const node = this.path[this.pathIndex];
    const isLast = this.pathIndex === this.path.length - 1;
    const targetX = node.x + 0.5;
    const onNode = cur !== null && cur.x === node.x && cur.y === node.y;
    const onFrom = cur !== null && cur.x === node.fromX && cur.y === node.fromY;

    if (onNode && (!isLast || Math.abs(targetX - this.px) < 0.1)) {
      this.pathIndex++;
      this.stuckTimer = 0;
      return this.follow(world, cur, dt);
    }

    // Landed somewhere unexpected: replan from here next tick.
    if (cur && !onNode && !onFrom) {
      this.needPlan = true;
      return [0, false];
    }

    this.stuckTimer += dt;
    if (this.stuckTimer > C.STUCK_TIME) {
      this.stuckTimer = 0;
      if (++this.replans > C.MAX_REPLANS) this.stop();
      else this.needPlan = true;
      return [0, false];
    }

    let inputX = clamp((targetX - this.px) * 6, -1, 1);
    let jump = false;
    if (this.grounded && onFrom) {
      const dir = Math.sign(node.x - node.fromX);
      if (node.kind === 'up') {
        inputX = dir;
        jump = true;
      } else if (node.kind === 'jump') {
        // Walk to the edge of the start tile, then leap.
        const edgeX = node.fromX + 0.5 + dir * C.JUMP_EDGE_OFFSET;
        inputX = dir;
        if ((edgeX - this.px) * dir <= 0) jump = true;
      }
    }
    return [inputX, jump];
  }

  private physics(world: World, dt: number, inputX: number, wantJump: boolean): void {
    const inWater = this.overlaps(world, Tile.Water);
    const maxSpeed = this.grounded ? C.WALK_SPEED : C.AIR_SPEED;
    const accel = (this.grounded ? C.GROUND_ACCEL : C.AIR_ACCEL) * dt;
    this.vx = approach(this.vx, inputX * maxSpeed, accel);

    if (wantJump && this.grounded && this.jumpCooldown <= 0) {
      this.vy = -C.JUMP_VEL;
      this.grounded = false;
      this.jumpCooldown = C.JUMP_COOLDOWN;
    }
    this.vy = Math.min(this.vy + C.GRAVITY * dt, inWater ? C.MAX_FALL_WATER : C.MAX_FALL);

    if (inputX !== 0) this.facing = inputX > 0 ? 1 : -1;
    this.moveX(world, this.vx * dt);
    this.moveY(world, this.vy * dt);
    this.grounded = this.vy >= 0 && this.collides(world, this.px, this.py + 0.02);
    this.animTime += Math.abs(this.vx) * dt;
  }

  private moveX(world: World, d: number): void {
    if (d === 0) return;
    const nx = this.px + d;
    if (!this.collides(world, nx, this.py)) {
      this.px = nx;
      return;
    }
    const hw = C.BODY_W / 2;
    this.px = d > 0 ? Math.floor(nx + hw) - hw - EPS : Math.floor(nx - hw) + 1 + hw + EPS;
    this.vx = 0;
  }

  private moveY(world: World, d: number): void {
    if (d === 0) return;
    const ny = this.py + d;
    if (!this.collides(world, this.px, ny)) {
      this.py = ny;
      return;
    }
    this.py = d > 0 ? Math.floor(ny) : Math.floor(ny - C.BODY_H) + 1 + C.BODY_H + EPS;
    this.vy = 0;
  }

  private forEachOverlappedTile(px: number, py: number, fn: (t: Tile) => boolean, world: World): boolean {
    const hw = C.BODY_W / 2;
    const x0 = Math.floor(px - hw);
    const x1 = Math.floor(px + hw - 1e-6);
    const y0 = Math.floor(py - C.BODY_H);
    const y1 = Math.floor(py - 1e-6);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (fn(world.get(x, y))) return true;
    }
    return false;
  }

  private collides(world: World, px: number, py: number): boolean {
    return this.forEachOverlappedTile(px, py, isSolidTile, world);
  }

  private overlaps(world: World, tile: Tile): boolean {
    return this.forEachOverlappedTile(this.px, this.py, (t) => t === tile, world);
  }

  /** Whether a world-space point lies within the drawn 1x2 sprite. */
  hitTest(wx: number, wy: number): boolean {
    return wx >= this.px - 0.5 && wx <= this.px + 0.5 && wy >= this.py - 2 && wy <= this.py;
  }
}
