import type * as Party from 'partykit/server'

export type Facing = 'up' | 'down' | 'left' | 'right'

const OVERWORLD_ZONE = 'overworld'

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
}

type JoinMsg = {
  type: 'join'
  name: string
  bald: boolean
  shirtColor: number
  x: number
  y: number
}

type CheckNameMsg = {
  type: 'checkName'
  name: string
}

type ResyncMsg = { type: 'resync' }

type ZoneMsg = {
  type: 'zone'
  zone: string
  x: number
  y: number
}

type MoveMsg = {
  type: 'move'
  x: number
  y: number
  facing: Facing
  anim: string
  vx: number
  vy: number
}

type ChatMsg = {
  type: 'chat'
  text: string
}

type HitMsg = {
  type: 'hit'
  targetId: string
  dirX: number
  dirY: number
  force: number
}

type ClientMsg = JoinMsg | CheckNameMsg | ResyncMsg | ZoneMsg | MoveMsg | ChatMsg | HitMsg

type PlayerMove = {
  id: string
  zone: string
  x: number
  y: number
  facing: Facing
  anim: string
  vx: number
  vy: number
}

type ServerMsg =
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

const MAX_CHAT = 80
const MAX_NAME = 16
const MAX_HIT_FORCE = 400
const MAX_SPEED = 420
const MAX_ZONE = 48

function send(conn: Party.Connection, msg: ServerMsg) {
  conn.send(JSON.stringify(msg))
}

function broadcast(room: Party.Room, msg: ServerMsg, except?: string[]) {
  room.broadcast(JSON.stringify(msg), except)
}

function clampVel(v: number) {
  if (!Number.isFinite(v)) return 0
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v))
}

function nameKey(name: string) {
  return name.trim().toLowerCase().normalize('NFC')
}

function sanitizeZone(raw: string) {
  const z = String(raw || OVERWORLD_ZONE).slice(0, MAX_ZONE)
  if (z === OVERWORLD_ZONE) return OVERWORLD_ZONE
  if (/^interior:[a-z0-9-]+$/i.test(z)) return z
  return OVERWORLD_ZONE
}

export default class WorldRoom implements Party.Server {
  players = new Map<string, PlayerPublic>()

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    send(conn, { type: 'hello', id: conn.id })
  }

  private isNameTaken(name: string, exceptId?: string) {
    const key = nameKey(name)
    for (const [id, p] of this.players) {
      if (exceptId && id === exceptId) continue
      if (nameKey(p.name) === key) return true
    }
    return false
  }

  onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    if (typeof raw !== 'string') return
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return
    }

    if (msg.type === 'join') {
      const name = (msg.name || 'Khách').trim().slice(0, MAX_NAME) || 'Khách'
      if (this.isNameTaken(name, sender.id)) {
        send(sender, { type: 'nameTaken', name })
        return
      }
      const player: PlayerPublic = {
        id: sender.id,
        name,
        bald: Boolean(msg.bald),
        shirtColor: msg.shirtColor >>> 0,
        zone: OVERWORLD_ZONE,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        facing: 'down',
        anim: 'idle-down',
      }
      this.players.set(sender.id, player)
      send(sender, { type: 'sync', players: [...this.players.values()] })
      broadcast(this.room, { type: 'playerJoined', player }, [sender.id])
      return
    }

    if (msg.type === 'checkName') {
      const name = (msg.name || 'Khách').trim().slice(0, MAX_NAME) || 'Khách'
      if (this.isNameTaken(name, sender.id)) {
        send(sender, { type: 'nameTaken', name })
      } else {
        send(sender, { type: 'nameOk', name })
      }
      return
    }

    const me = this.players.get(sender.id)
    if (!me) return

    if (msg.type === 'resync') {
      send(sender, { type: 'sync', players: [...this.players.values()] })
      return
    }

    if (msg.type === 'zone') {
      me.zone = sanitizeZone(msg.zone)
      me.x = Number(msg.x) || me.x
      me.y = Number(msg.y) || me.y
      me.anim = me.zone === OVERWORLD_ZONE ? me.anim : 'idle-down'
      broadcast(this.room, { type: 'playerZone', player: me }, [sender.id])
      return
    }

    if (msg.type === 'move') {
      me.x = Number(msg.x) || me.x
      me.y = Number(msg.y) || me.y
      me.facing = msg.facing || me.facing
      me.anim = String(msg.anim || me.anim).slice(0, 32)
      const vx = clampVel(Number(msg.vx) || 0)
      const vy = clampVel(Number(msg.vy) || 0)
      broadcast(
        this.room,
        {
          type: 'playerMoved',
          move: {
            id: me.id,
            zone: me.zone,
            x: me.x,
            y: me.y,
            facing: me.facing,
            anim: me.anim,
            vx,
            vy,
          },
        },
        [sender.id],
      )
      return
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '')
        .trim()
        .slice(0, MAX_CHAT)
      if (!text) return
      broadcast(this.room, { type: 'chat', id: me.id, name: me.name, text })
      return
    }

    if (msg.type === 'hit') {
      const target = this.players.get(msg.targetId)
      if (!target || msg.targetId === sender.id) return
      if (target.zone !== me.zone) return
      const dist = Math.hypot(target.x - me.x, target.y - me.y)
      if (dist > 90) return
      const force = Math.min(MAX_HIT_FORCE, Math.max(0, Number(msg.force) || 0))
      const dirX = Number(msg.dirX) || 0
      const dirY = Number(msg.dirY) || 0
      const len = Math.hypot(dirX, dirY) || 1
      const push = Math.min(72, force * 0.22)
      target.x += (dirX / len) * push
      target.y += (dirY / len) * push
      target.anim = 'hit'
      broadcast(
        this.room,
        {
          type: 'hit',
          fromId: sender.id,
          targetId: msg.targetId,
          dirX,
          dirY,
          force,
        },
        [sender.id],
      )
    }
  }

  onClose(conn: Party.Connection) {
    if (!this.players.has(conn.id)) return
    this.players.delete(conn.id)
    broadcast(this.room, { type: 'playerLeft', id: conn.id })
  }
}

WorldRoom satisfies Party.Worker
