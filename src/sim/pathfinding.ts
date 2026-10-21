import { World } from '../world/World';

/**
 * Path graph nodes are "foot tiles": a colonist standing at node (x, y) has its
 * body in (x, y) and (x, y-1) and stands on the solid tile (x, y+1).
 */
export type EdgeKind = 'walk' | 'up' | 'drop' | 'jump';
const KINDS: EdgeKind[] = ['walk', 'up', 'drop', 'jump'];

export interface PathNode {
  x: number;
  y: number;
  /** How this node is reached from the previous one. */
  kind: EdgeKind;
  fromX: number;
  fromY: number;
}

export interface PathResult {
  path: PathNode[];
  /** False when the goal was unreachable and the path leads to the closest node instead. */
  reached: boolean;
}

export function isStandable(world: World, x: number, y: number): boolean {
  return (
    world.inBounds(x, y) &&
    world.inBounds(x, y - 1) &&
    !world.isSolid(x, y) &&
    !world.isSolid(x, y - 1) &&
    world.isSolid(x, y + 1)
  );
}

type Emit = (x: number, y: number, cost: number, kind: number) => void;

const MAX_GAP_DX = 3; // landing 3 tiles away clears a 2-wide gap
const MAX_JUMP_UP = 2;
const MAX_GAP_DY = 2;

function corridorClear(world: World, x: number, y: number, tx: number, ty: number): boolean {
  const dir = Math.sign(tx - x);
  const bottom = Math.min(y, ty);
  const top = bottom - 2;
  for (let c = x; c !== tx + dir; c += dir) {
    for (let r = top; r <= bottom; r++) if (world.isSolid(c, r)) return false;
  }
  return true;
}

export function forEachNeighbor(world: World, x: number, y: number, emit: Emit): void {
  for (const dir of [-1, 1]) {
    const nx = x + dir;

    if (isStandable(world, nx, y)) {
      emit(nx, y, 1, 0);
    } else if (!world.isSolid(nx, y) && !world.isSolid(nx, y - 1) && !world.isSolid(nx, y + 1)) {
      // Walk off the ledge and fall to the first floor below.
      let yy = y + 1;
      while (yy < world.height && !world.isSolid(nx, yy + 1)) yy++;
      if (isStandable(world, nx, yy)) emit(nx, yy, 1 + (yy - y), 2);
    }

    // Jump up onto a ledge 1 or 2 tiles higher (needs headroom above start).
    for (let up = 1; up <= MAX_JUMP_UP; up++) {
      if (world.isSolid(x, y - 1 - up)) break;
      if (isStandable(world, nx, y - up)) {
        emit(nx, y - up, 1 + up, 1);
        break;
      }
    }

    // Jump across a gap.
    if (!isStandable(world, nx, y)) {
      for (let d = 2; d <= MAX_GAP_DX; d++) {
        const tx = x + dir * d;
        for (let dy = -MAX_GAP_DY; dy <= MAX_GAP_DY; dy++) {
          const ty = y + dy;
          if (isStandable(world, tx, ty) && corridorClear(world, x, y, tx, ty)) {
            emit(tx, ty, d + Math.abs(dy) + 1, 3);
          }
        }
      }
    }
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    const items = this.items;
    const prio = this.prio;
    let i = items.length;
    items.push(item);
    prio.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= p) break;
      items[i] = items[parent];
      prio[i] = prio[parent];
      i = parent;
    }
    items[i] = item;
    prio[i] = p;
  }

  pop(): number {
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prio.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prio[r] < prio[l] ? r : l;
        if (prio[c] >= lastPrio) break;
        items[i] = items[c];
        prio[i] = prio[c];
        i = c;
      }
      items[i] = lastItem;
      prio[i] = lastPrio;
    }
    return top;
  }
}

/**
 * A* over standable nodes. If no goal node is reachable, returns a path to the
 * explored node closest (Manhattan) to (hx, hy).
 */
export function findPath(
  world: World,
  sx: number,
  sy: number,
  isGoal: (x: number, y: number) => boolean,
  hx: number,
  hy: number,
  maxExpand = 40000,
): PathResult {
  const W = world.width;
  const N = W * world.height;
  const g = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const kind = new Uint8Array(N);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const h = (x: number, y: number) => Math.abs(x - hx) + Math.abs(y - hy);

  const start = sy * W + sx;
  g[start] = 0;
  heap.push(start, h(sx, sy));
  let best = start;
  let bestH = h(sx, sy);
  let found = -1;
  let expanded = 0;

  while (heap.size > 0 && expanded < maxExpand) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    if (isGoal(cx, cy)) {
      found = cur;
      break;
    }
    const ch = h(cx, cy);
    if (ch < bestH || (ch === bestH && g[cur] < g[best])) {
      best = cur;
      bestH = ch;
    }
    const gc = g[cur];
    forEachNeighbor(world, cx, cy, (nx, ny, cost, k) => {
      const ni = ny * W + nx;
      if (closed[ni]) return;
      const ng = gc + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        kind[ni] = k;
        heap.push(ni, ng + h(nx, ny));
      }
    });
  }

  const end = found >= 0 ? found : best;
  const path: PathNode[] = [];
  for (let i = end; i !== start; i = parent[i]) {
    const p = parent[i];
    path.push({ x: i % W, y: (i / W) | 0, kind: KINDS[kind[i]], fromX: p % W, fromY: (p / W) | 0 });
  }
  path.reverse();
  return { path, reached: found >= 0 };
}

/** Maps a clicked non-solid tile to the standable node at or below it. */
export function resolveStandTarget(world: World, tx: number, ty: number): { x: number; y: number } | null {
  if (!world.inBounds(tx, ty) || world.isSolid(tx, ty)) return null;
  let y = ty;
  while (y < world.height - 1 && !world.isSolid(tx, y + 1)) y++;
  return isStandable(world, tx, y) ? { x: tx, y } : null;
}

/** Whether a colonist standing at node (x, y) can reach tile (tx, ty) to dig it. */
export function canReachTile(x: number, y: number, tx: number, ty: number): boolean {
  return Math.abs(tx - x) <= 1 && ty >= y - 2 && ty <= y + 1;
}
