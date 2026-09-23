import PartySocket from 'partysocket'
import {
  OVERWORLD_ZONE,
  partyHost,
  type ClientMsg,
  type PlayerMove,
  type PlayerProfile,
  type PlayerPublic,
  type ServerMsg,
} from './types'

export type MultiplayerHandlers = {
  onSync: (players: PlayerPublic[], selfId: string) => void
  onJoined: (player: PlayerPublic) => void
  onLeft: (id: string) => void
  onMoved: (move: PlayerMove) => void
  onZone?: (player: PlayerPublic) => void
  onChat: (id: string, name: string, text: string) => void
  onHit: (targetId: string, dirX: number, dirY: number, force: number) => void
  onNameTaken?: (name: string) => void
  onStatus?: (text: string) => void
}

export class MultiplayerClient {
  private socket: PartySocket | null = null
  private selfId = ''
  private joined = false
  private handlers: MultiplayerHandlers
  private profile: PlayerProfile
  private spawn: { x: number; y: number }
  private zone = OVERWORLD_ZONE

  constructor(
    profile: PlayerProfile,
    spawn: { x: number; y: number },
    handlers: MultiplayerHandlers,
  ) {
    this.profile = profile
    this.spawn = spawn
    this.handlers = handlers
  }

  get id() {
    return this.selfId
  }

  get currentZone() {
    return this.zone
  }

  setHandlers(handlers: MultiplayerHandlers) {
    this.handlers = handlers
  }

  connect() {
    if (this.socket) return
    const host = partyHost()
    this.handlers.onStatus?.(`Đang kết nối ${host}…`)

    this.socket = new PartySocket({
      host,
      room: 'village',
      party: 'main',
    })

    this.socket.addEventListener('open', () => {
      this.handlers.onStatus?.('Đã vào phòng')
    })

    this.socket.addEventListener('close', () => {
      this.joined = false
      this.handlers.onStatus?.('Mất kết nối — đang thử lại…')
    })

    this.socket.addEventListener('error', () => {
      this.handlers.onStatus?.('Lỗi kết nối PartyKit (chạy npm run dev:party)')
    })

    this.socket.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data) as ServerMsg
      } catch {
        return
      }
      this.handle(msg)
    })
  }

  private handle(msg: ServerMsg) {
    if (msg.type === 'hello') {
      this.selfId = msg.id
      this.zone = OVERWORLD_ZONE
      this.send({
        type: 'join',
        name: this.profile.name,
        bald: this.profile.bald,
        shirtColor: this.profile.shirtColor,
        x: this.spawn.x,
        y: this.spawn.y,
      })
      return
    }
    if (msg.type === 'nameTaken') {
      this.joined = false
      this.handlers.onNameTaken?.(msg.name)
      this.socket?.close()
      return
    }
    if (msg.type === 'sync') {
      this.joined = true
      this.handlers.onSync(msg.players, this.selfId)
      return
    }
    if (msg.type === 'playerJoined') {
      if (msg.player.id === this.selfId) return
      this.handlers.onJoined(msg.player)
      return
    }
    if (msg.type === 'playerLeft') {
      this.handlers.onLeft(msg.id)
      return
    }
    if (msg.type === 'playerMoved') {
      if (msg.move.id === this.selfId) return
      this.handlers.onMoved(msg.move)
      return
    }
    if (msg.type === 'playerZone') {
      if (msg.player.id === this.selfId) return
      this.handlers.onZone?.(msg.player)
      return
    }
    if (msg.type === 'chat') {
      this.handlers.onChat(msg.id, msg.name, msg.text)
      return
    }
    if (msg.type === 'hit') {
      this.handlers.onHit(msg.targetId, msg.dirX, msg.dirY, msg.force)
    }
  }

  sendZone(zone: string, x: number, y: number) {
    if (!this.joined) return
    this.zone = zone
    this.send({ type: 'zone', zone, x, y })
  }

  requestSync() {
    if (!this.joined) return
    this.send({ type: 'resync' })
  }

  sendMove(
    x: number,
    y: number,
    facing: PlayerPublic['facing'],
    anim: string,
    vx: number,
    vy: number,
  ) {
    if (!this.joined) return
    this.send({ type: 'move', x, y, facing, anim, vx, vy })
  }

  sendChat(text: string) {
    if (!this.joined) return
    this.send({ type: 'chat', text })
  }

  sendHit(targetId: string, dirX: number, dirY: number, force: number) {
    if (!this.joined) return
    this.send({ type: 'hit', targetId, dirX, dirY, force })
  }

  private send(msg: ClientMsg) {
    this.socket?.send(JSON.stringify(msg))
  }

  destroy() {
    this.socket?.close()
    this.socket = null
    this.joined = false
  }
}
