import { Game } from '../game/Game';
import { Camera } from '../render/Camera';

const PAN_SPEED_PX = 900; // screen pixels per second

export class Input {
  /** Tile under the cursor, if the cursor is over the canvas. */
  hover: { x: number; y: number } | null = null;
  private readonly keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private drag: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly camera: Camera, private readonly game: Game) {
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.drag = null;
    });
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mouseleave', () => {
      this.mouse = null;
      this.hover = null;
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.game.selected.clear();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (dx || dy) {
      const step = (PAN_SPEED_PX * dt) / this.camera.scale;
      this.camera.pan(dx * step, dy * step);
    }
    this.updateHover();
  }

  private updateHover(): void {
    if (!this.mouse) return;
    const w = this.camera.screenToWorld(this.mouse.x, this.mouse.y);
    this.hover = { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2) {
      this.game.selected.clear();
      return;
    }
    if (e.button !== 0) return;

    const w = this.camera.screenToWorld(e.clientX, e.clientY);
    const hit = this.game.colonistAt(w.x, w.y);
    if (hit) {
      this.game.select(hit, e.shiftKey);
      return;
    }
    this.game.issueCommand(Math.floor(w.x), Math.floor(w.y));
  }

  private onMouseMove(e: MouseEvent): void {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.drag) {
      const s = this.camera.scale;
      this.camera.pan(-(e.clientX - this.drag.x) / s, -(e.clientY - this.drag.y) / s);
      this.drag = { x: e.clientX, y: e.clientY };
    }
    this.updateHover();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }
}
