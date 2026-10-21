// World
export const WORLD_W = 200;
export const WORLD_H = 200;
export const TILE_PX = 16;

// Simulation rates
export const PHYSICS_DT = 1 / 60;
export const WATER_DT = 1 / 10;

// Colonist body (tile units). Rendered as 1x2; the collision box is a bit
// smaller so colonists fit 1-wide shafts and 2-tall tunnels without snagging.
export const BODY_W = 0.8;
export const BODY_H = 1.9;

// Colonist movement (tiles, seconds)
export const GRAVITY = 40;
export const MAX_FALL = 25;
export const MAX_FALL_WATER = 6;
export const WALK_SPEED = 4;
export const AIR_SPEED = 5;
export const GROUND_ACCEL = 60;
export const AIR_ACCEL = 30;
export const JUMP_HEIGHT = 2.3;
export const JUMP_VEL = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
export const JUMP_COOLDOWN = 0.35;
/** How far past the start tile's center a colonist walks before a gap jump. */
export const JUMP_EDGE_OFFSET = 0.55;

// Colonist behaviour
export const DIG_TIME = 1.5;
export const STUCK_TIME = 3;
export const MAX_REPLANS = 4;
