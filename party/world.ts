import { Server, routePartykitRequest, type Connection } from 'partyserver'

type Env = {
  Main: DurableObjectNamespace<WorldRoom>
}

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
  smoking: boolean
  bed: number
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
  smoking: boolean
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

/** Spa bed the player is lying on (1–10), 0 = none. */
type BedMsg = { type: 'bed'; bed: number }

/** Therapist small talk, relayed to everyone in the same zone. */
type NpcSayMsg = { type: 'npcSay'; bed: number; line: number }

type ClientMsg =
  | JoinMsg
  | CheckNameMsg
  | ResyncMsg
  | ZoneMsg
  | MoveMsg
  | ChatMsg
  | HitMsg
  | BedMsg
  | NpcSayMsg

type PlayerMove = {
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
  | { type: 'ktvSync'; startedAt: number; serverNow: number }
  | { type: 'ktvStop' }
  | { type: 'playerBed'; id: string; bed: number }
  | { type: 'npcSay'; zone: string; bed: number; line: number }

const MAX_CHAT = 80
const MAX_BED = 20
const MAX_NPC_LINE = 20
const MAX_NAME = 16
const MAX_HIT_FORCE = 400
const MAX_SPEED = 420
const MAX_ZONE = 48
const KTV_ZONE = 'interior:ktv-corner'

function send(conn: Connection, msg: ServerMsg) {
  conn.send(JSON.stringify(msg))
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

export class WorldRoom extends Server<Env> {
  players = new Map<string, PlayerPublic>()
  /** Epoch ms when the current KTV session began; null when empty. */
  private ktvStartedAt: number | null = null

  private emit(msg: ServerMsg, except?: string[]) {
    this.broadcast(JSON.stringify(msg), except)
  }

  onConnect(conn: Connection) {
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

  private countInZone(zone: string) {
    let n = 0
    for (const p of this.players.values()) {
      if (p.zone === zone) n++
    }
    return n
  }

  /** Start / keep / stop shared KTV timeline; optionally push sync to one connection. */
  private refreshKtv(syncTo?: Connection) {
    const n = this.countInZone(KTV_ZONE)
    if (n === 0) {
      if (this.ktvStartedAt != null) {
        this.ktvStartedAt = null
        this.emit({ type: 'ktvStop' })
      }
      return
    }
    if (this.ktvStartedAt == null) {
      this.ktvStartedAt = Date.now()
    }
    if (syncTo) {
      send(syncTo, {
        type: 'ktvSync',
        startedAt: this.ktvStartedAt,
        serverNow: Date.now(),
      })
    }
  }

  onMessage(sender: Connection, raw: string | ArrayBuffer | ArrayBufferView) {
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
        smoking: false,
        bed: 0,
      }
      this.players.set(sender.id, player)
      send(sender, { type: 'sync', players: [...this.players.values()] })
      this.emit({ type: 'playerJoined', player }, [sender.id])
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
      const prevZone = me.zone
      me.zone = sanitizeZone(msg.zone)
      me.x = Number(msg.x) || me.x
      me.y = Number(msg.y) || me.y
      me.anim = me.zone === OVERWORLD_ZONE ? me.anim : 'idle-down'
      me.bed = 0
      this.emit({ type: 'playerZone', player: me }, [sender.id])
      if (me.zone === KTV_ZONE) {
        this.refreshKtv(sender)
      } else if (prevZone === KTV_ZONE) {
        this.refreshKtv()
      }
      return
    }

    if (msg.type === 'bed') {
      const bed = Math.trunc(Number(msg.bed) || 0)
      me.bed = bed >= 1 && bed <= MAX_BED ? bed : 0
      this.emit({ type: 'playerBed', id: me.id, bed: me.bed }, [sender.id])
      return
    }

    if (msg.type === 'npcSay') {
      const bed = Math.trunc(Number(msg.bed) || 0)
      const line = Math.trunc(Number(msg.line))
      if (bed !== me.bed || bed < 1) return
      if (!(line >= 0 && line < MAX_NPC_LINE)) return
      this.emit({ type: 'npcSay', zone: me.zone, bed, line }, [sender.id])
      return
    }

    if (msg.type === 'move') {
      me.x = Number(msg.x) || me.x
      me.y = Number(msg.y) || me.y
      me.facing = msg.facing || me.facing
      me.anim = String(msg.anim || me.anim).slice(0, 32)
      me.smoking = Boolean(msg.smoking)
      const vx = clampVel(Number(msg.vx) || 0)
      const vy = clampVel(Number(msg.vy) || 0)
      this.emit(
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
            smoking: me.smoking,
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
      this.emit({ type: 'chat', id: me.id, name: me.name, text })
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
      this.emit(
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

  onClose(conn: Connection) {
    const left = this.players.get(conn.id)
    if (!left) return
    this.players.delete(conn.id)
    this.emit({ type: 'playerLeft', id: conn.id })
    if (left.zone === KTV_ZONE) {
      this.refreshKtv()
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response('school-mini multiplayer server', { status: 200 })
    )
  },
} satisfies ExportedHandler<Env>
