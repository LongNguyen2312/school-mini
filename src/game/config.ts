export const GAME_WIDTH = 960
export const GAME_HEIGHT = 540

/** Large overworld holding all real-world hubs. */
export const WORLD_WIDTH = 6400
export const WORLD_HEIGHT = 4800

/** Movement speed in pixels per second. */
export const PLAYER_SPEED = 180
/** Hold Shift to sprint. */
export const PLAYER_RUN_SPEED = 300

/** Radius around a building door to show "Enter" prompt. */
export const ENTER_RADIUS = 70

/** Radius around a chair to show "Sit" prompt. */
export const SIT_RADIUS = 48

/** Mini-map size (screen pixels). */
export const MINIMAP_SIZE = 220
export const MINIMAP_MARGIN = 16

/** Combat / movement actions */
export const JUMP_FORCE = 420
export const JUMP_GRAVITY = 1400
export const PUNCH_RANGE = 54
export const PUNCH_FORCE = 220
export const KICK_RANGE = 64
export const KICK_FORCE = 280
export const ATTACK_COOLDOWN_MS = 170
export const HIT_CONE_DOT = 0.25
/** Punch connect frame (ms after swing starts). */
export const PUNCH_HIT_MS = 80
/** Max time a punch locks the attack anim before it can be cancelled. */
export const PUNCH_RECOVER_MS = 260

/** Apex height for jump frame sync: v² / (2g) */
export const JUMP_APEX =
  (JUMP_FORCE * JUMP_FORCE) / (2 * JUMP_GRAVITY)

/** Mouse-wheel camera zoom — continuous range, tweened in cameraZoom.ts */
export const CAMERA_ZOOM_DEFAULT = 1
export const CAMERA_ZOOM_MIN = 0.75
export const CAMERA_ZOOM_MAX = 2.25
export const CAMERA_ZOOM_STEP = 0.1
export const CAMERA_ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25] as const
