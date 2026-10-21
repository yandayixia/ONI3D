import { PHYSICS_DT, WATER_DT } from './config';
import { Game } from './game/Game';
import { Input } from './input/Input';
import { Camera } from './render/Camera';
import { Renderer } from './render/Renderer';

const params = new URLSearchParams(location.search);
const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && params.has('seed') ? seedParam >>> 0 : (Math.random() * 2 ** 32) >>> 0;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const game = new Game(seed);
const spawn = game.colonists[1];
const camera = new Camera(spawn.px, spawn.py - 1, game.world.width, game.world.height);
const input = new Input(canvas, camera, game);
const renderer = new Renderer(canvas, game.world);

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  camera.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let physAcc = 0;
let waterAcc = 0;
let fps = 0;
let hudTimer = 0;

function updateHud(): void {
  const sel = [...game.selected].map((c) => `  #${c.id + 1}: ${c.state}`).join('\n');
  hud.textContent =
    `seed ${seed}   ${fps.toFixed(0)} fps\n` +
    `selected: ${game.selected.size}${sel ? '\n' + sel : ''}\n\n` +
    'click colonist: select (shift: multi)\n' +
    'click empty/water: move   click dirt: dig\n' +
    'right-click / Esc: deselect\n' +
    'WASD/arrows or middle-drag: pan   wheel: zoom';
}

function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  fps = fps * 0.9 + (dt > 0 ? 1 / dt : 0) * 0.1;

  input.update(dt);
  physAcc += dt;
  waterAcc += dt;
  while (physAcc >= PHYSICS_DT) {
    game.tick(PHYSICS_DT);
    physAcc -= PHYSICS_DT;
  }
  while (waterAcc >= WATER_DT) {
    game.waterTick();
    waterAcc -= WATER_DT;
  }
  renderer.draw(game, camera, input);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    updateHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
