export enum Tile {
  Empty = 0,
  Dirt = 1,
  Rock = 2,
  Water = 3,
}

/** Solid tiles block colonists. Water is passable. */
export function isSolidTile(t: Tile): boolean {
  return t === Tile.Dirt || t === Tile.Rock;
}
