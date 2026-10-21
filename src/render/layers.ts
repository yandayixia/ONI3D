/**
 * World render layers, drawn in ascending order (passes on the same layer keep
 * their registration order). Ranges 0–9, 11–19, 27–30 and 32–49 are reserved.
 * UI overlays (selection, hover, dig targets) are drawn after every layer.
 */
export enum Layer {
  /** 10–19: background. The cave wall is drawn first, then background flowers. */
  Wall = 10,
  BackFlower = 10,
  /** Terrain base colour (with surface band). */
  Terrain = 20,
  /** Terrain pixel noise. */
  TerrainNoise = 21,
  Grass = 22,
  Vine = 23,
  Moss = 24,
  Colonist = 25,
  /** Water is drawn above colonists so they look submerged. */
  Water = 26,
  FrontFlower = 31,
}
