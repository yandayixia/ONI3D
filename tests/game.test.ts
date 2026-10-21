import { describe, expect, it } from 'vitest';
import { PHYSICS_DT, WATER_DT } from '../src/config';
import { Game } from '../src/game/Game';
import { Tile } from '../src/world/tiles';
import { countTiles } from './helpers';

function run(game: Game, seconds: number): void {
  let waterAcc = 0;
  for (let t = 0; t < seconds; t += PHYSICS_DT) {
    game.tick(PHYSICS_DT);
    waterAcc += PHYSICS_DT;
    if (waterAcc >= WATER_DT) {
      game.waterTick();
      waterAcc -= WATER_DT;
    }
  }
}

describe('Game on a generated map', () => {
  for (const seed of [1, 42, 2024]) {
    it(`seed ${seed}: colonists settle, cross the clearing, and water is conserved`, () => {
      const game = new Game(seed);
      const water = countTiles(game.world, Tile.Water);
      run(game, 1);
      for (const c of game.colonists) expect(c.currentNode(game.world)).toEqual({ x: Math.floor(c.px), y: 101 });

      const c = game.colonists[0];
      game.select(c, false);
      game.issueCommand(108, 100);
      run(game, 8);
      expect(c.state).toBe('idle');
      expect(c.currentNode(game.world)).toEqual({ x: 108, y: 101 });
      expect(countTiles(game.world, Tile.Water)).toBe(water);
    });
  }
});
