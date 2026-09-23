export type Direction = 'down' | 'left' | 'right' | 'up'

export function facingVector(facing: Direction): { x: number; y: number } {
  switch (facing) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'up':
      return { x: 0, y: -1 }
    default:
      return { x: 0, y: 1 }
  }
}

/** Something that can be punched. */
export interface Hittable {
  readonly x: number
  readonly y: number
  applyKnockback(dirX: number, dirY: number, force: number): void
}
