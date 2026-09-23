/** Spritesheet: public/assets/player.png (LPC-composed, 64×64 frames) */
export const PLAYER_SHEET = {
  key: 'player',
  frameWidth: 64,
  frameHeight: 64,
  /** Display scale — native 64px LPC, nearest-neighbor. */
  scale: 1.2,
} as const

/** Bald variant: public/assets/player_bald.png (no hair/beard/shades). */
export const PLAYER_BALD_SHEET = {
  key: 'player-bald',
  frameWidth: 64,
  frameHeight: 64,
  scale: 1.2,
} as const

/** Columns in the packed sheet (row-major). */
export const PLAYER_SHEET_COLS = 9

const C = PLAYER_SHEET_COLS

const row = (r: number, count: number) => {
  const frames: number[] = []
  for (let c = 0; c < count; c++) frames.push(r * C + c)
  return frames
}

/**
 * Layout (scripts/compose_lpc_player.py):
 * 0–7 idle/walk · 8–11 run
 * 12–15 jump U/D/R/L · 16–19 sit U/D/R/L
 * 20 lie · 21 smoke
 * 22–25 punch · 26–29 kick · 30 hit
 */
export const PLAYER_FRAMES = {
  idleUp: row(0, 4),
  walkUp: row(1, 9),
  idleDown: row(2, 4),
  walkDown: row(3, 9),
  idleRight: row(4, 4),
  walkRight: row(5, 9),
  idleLeft: row(6, 4),
  walkLeft: row(7, 9),

  runUp: row(8, 8),
  runDown: row(9, 8),
  runRight: row(10, 8),
  runLeft: row(11, 8),

  jumpUp: row(12, 5),
  jumpDown: row(13, 5),
  jumpRight: row(14, 5),
  jumpLeft: row(15, 5),

  sitUp: row(16, 3),
  sitDown: row(17, 3),
  sitRight: row(18, 3),
  sitLeft: row(19, 3),

  lie: row(20, 6),
  smoke: row(21, 10),

  punchUp: row(22, 5),
  punchDown: row(23, 5),
  punchRight: row(24, 5),
  punchLeft: row(25, 5),

  kickUp: row(26, 9),
  kickDown: row(27, 9),
  kickRight: row(28, 9),
  kickLeft: row(29, 9),

  hit: row(30, 6),
} as const
