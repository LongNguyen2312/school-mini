export type Facing = 'up' | 'down' | 'left' | 'right'

export const OVERWORLD_ZONE = 'overworld'

export type PlayerProfile = {
  name: string
  /** true = đầu trọc (không tóc/râu) */
  bald: boolean
  shirtColor: number
}

export type PlayerPublic = {
  id: string
  name: string
  bald: boolean
  shirtColor: number
  zone: string
  x: number
  y: number
  facing: Facing
  anim: string
  smoking: boolean
  /** Spa bed number the player is lying on, 0 = none. */
  bed: number
}

/** Slim move tick — no name/look (those only arrive on join/sync/zone). */
export type PlayerMove = {
  id: string
  zone: string
  x: number
  y: number
  facing: Facing
  anim: string
  vx: number
  vy: number
  smoking: boolean
}

export type ClientMsg =
  | {
      type: 'join'
      name: string
      bald: boolean
      shirtColor: number
      x: number
      y: number
    }
  | { type: 'checkName'; name: string }
  | { type: 'resync' }
  | {
      type: 'zone'
      zone: string
      x: number
      y: number
    }
  | {
      type: 'move'
      x: number
      y: number
      facing: Facing
      anim: string
      vx: number
      vy: number
      smoking: boolean
    }
  | { type: 'chat'; text: string }
  | { type: 'bed'; bed: number }
  | { type: 'npcSay'; bed: number; line: number }
  | {
      type: 'hit'
      targetId: string
      dirX: number
      dirY: number
      force: number
    }

export type ServerMsg =
  | { type: 'hello'; id: string }
  | { type: 'sync'; players: PlayerPublic[] }
  | { type: 'playerJoined'; player: PlayerPublic }
  | { type: 'playerLeft'; id: string }
  | { type: 'playerMoved'; move: PlayerMove }
  | { type: 'playerZone'; player: PlayerPublic }
  | { type: 'chat'; id: string; name: string; text: string }
  | { type: 'nameTaken'; name: string }
  | { type: 'nameOk'; name: string }
  | {
      type: 'hit'
      fromId: string
      targetId: string
      dirX: number
      dirY: number
      force: number
    }
  /** Shared KTV BGM timeline — seek = (serverNow - startedAt). */
  | { type: 'ktvSync'; startedAt: number; serverNow: number }
  | { type: 'ktvStop' }
  | { type: 'playerBed'; id: string; bed: number }
  | { type: 'npcSay'; zone: string; bed: number; line: number }

export const SHIRT_COLORS: { id: string; label: string; color: number }[] = [
  { id: 'white', label: 'Trắng', color: 0xffffff },
  { id: 'red', label: 'Đỏ', color: 0xff6b6b },
  { id: 'blue', label: 'Xanh dương', color: 0x6bb3ff },
  { id: 'green', label: 'Xanh lá', color: 0x6bff9a },
  { id: 'yellow', label: 'Vàng', color: 0xffe066 },
  { id: 'purple', label: 'Tím', color: 0xc9a0ff },
  { id: 'orange', label: 'Cam', color: 0xffa94d },
  { id: 'pink', label: 'Hồng', color: 0xff8cc8 },
  { id: 'black', label: 'Đen', color: 0x333333 },
]

export function partyHost(): string {
  return import.meta.env.VITE_PARTYKIT_HOST || '127.0.0.1:1999'
}

export function interiorZone(locationId: string) {
  return `interior:${locationId}`
}

export const KTV_ZONE = interiorZone('ktv-corner')

