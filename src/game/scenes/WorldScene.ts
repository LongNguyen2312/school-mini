import Phaser from 'phaser'
import { ENTER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '../config'
import { bindCameraZoom } from '../cameraZoom'
import {
  computeRoadLayout,
  getPlacedLocations,
  isOnRoad,
  type PlacedLocation,
} from '../data/geo'
import { mapsUrl } from '../data/locations'
import { PLAYER_BALD_SHEET, PLAYER_SHEET } from '../data/playerAnims'
import { Player } from '../entities/Player'
import { RemotePlayer } from '../entities/RemotePlayer'
import { MultiplayerClient } from '../../multiplayer/client'
import {
  interiorZone,
  OVERWORLD_ZONE,
  type PlayerMove,
  type PlayerProfile,
  type PlayerPublic,
} from '../../multiplayer/types'
import { Minimap } from '../ui/Minimap'
import {
  TOUCH_ACTION_EVENT,
  TouchControls,
  isTouchDevice,
  type TouchAction,
} from '../ui/TouchControls'
import { ControlsHelp } from '../ui/ControlsHelp'
import { crispText } from '../ui/crispText'
import { makeChatBubble, showChatBubble, snapBubble } from '../ui/chatBubble'
import { installHudCamera, registerHud } from '../ui/hudCamera'
import { pinToScreen } from '../ui/pinToScreen'

interface WorldSceneData {
  spawnX?: number
  spawnY?: number
}

export class WorldScene extends Phaser.Scene {
  private player!: Player
  private hubs: PlacedLocation[] = []
  private roadLayout: ReturnType<typeof computeRoadLayout> | null = null
  private prompt!: Phaser.GameObjects.Text
  private status!: Phaser.GameObjects.Text
  private nearestHub: PlacedLocation | null = null
  private interactKey!: Phaser.Input.Keyboard.Key
  private spawnX?: number
  private spawnY?: number
  private minimap!: Minimap
  private touch: TouchControls | null = null
  private controls!: ControlsHelp
  private remotes = new Map<string, RemotePlayer>()
  private mp: MultiplayerClient | null = null
  private profile: PlayerProfile | null = null
  private localName!: Phaser.GameObjects.Text
  private localBubble!: Phaser.GameObjects.Text
  private localBubbleUntil = 0
  private lastNetSent = 0
  private lastNetX = 0
  private lastNetY = 0
  private lastNetAnim = ''
  private lastNetSmoking = false

  constructor() {
    super('WorldScene')
  }

  init(data: WorldSceneData) {
    this.spawnX = data.spawnX
    this.spawnY = data.spawnY
  }

  preload() {
    // Keep shared textures across scene sleep/wake — removing+reloading can blank WebGL
    if (!this.textures.exists(PLAYER_SHEET.key)) {
      this.load.spritesheet(PLAYER_SHEET.key, '/assets/player.png?v=look8', {
        frameWidth: PLAYER_SHEET.frameWidth,
        frameHeight: PLAYER_SHEET.frameHeight,
      })
    }
    if (!this.textures.exists(PLAYER_BALD_SHEET.key)) {
      this.load.spritesheet(PLAYER_BALD_SHEET.key, '/assets/player_bald.png?v=look8', {
        frameWidth: PLAYER_BALD_SHEET.frameWidth,
        frameHeight: PLAYER_BALD_SHEET.frameHeight,
      })
    }
    if (!this.textures.exists('grass')) {
      this.load.image('grass', '/assets/grass/grass_seamless.png?v=flat1')
    }
    if (!this.textures.exists('path')) {
      this.load.image('path', '/assets/path.png?v=classic1')
    }
  }

  create() {
    this.textures.get(PLAYER_SHEET.key)?.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.textures.get(PLAYER_BALD_SHEET.key)?.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.textures.get('grass')?.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.textures.get('path')?.setFilter(Phaser.Textures.FilterMode.NEAREST)

    this.hubs = getPlacedLocations()

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    this.cameras.main.setBackgroundColor('#5c9c54')
    this.cameras.main.setRoundPixels(false)
    bindCameraZoom(this)

    this.buildWorld()

    const start =
      this.spawnX != null && this.spawnY != null
        ? { x: this.spawnX, y: this.spawnY }
        : {
            x: this.hubs[0]?.x ?? WORLD_WIDTH / 2,
            y: (this.hubs[0]?.y ?? WORLD_HEIGHT / 2) + 120,
          }

    this.player = new Player(this, start.x, start.y)
    this.player.setTargets([])
    this.player.actionFlush = () => {
      this.lastNetSent = 0
      this.lastNetAnim = ''
      this.lastNetSmoking = false
    }
    this.cameras.main.startFollow(this.player.sprite, false, 1, 1)

    this.profile = (this.registry.get('profile') as PlayerProfile | undefined) ?? null
    if (this.profile) {
      // Defer one tick so the player spritesheet is fully uploaded to WebGL
      this.time.delayedCall(0, () => {
        if (!this.profile || !this.player) return
        this.player.applyAppearance(this.profile.bald, this.profile.shirtColor)
      })
    }

    this.localName = crispText(
      this.add
        .text(start.x, start.y - 36, this.profile?.name ?? '', {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#ffe566',
          stroke: '#000000',
          strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(12),
    )

    this.localBubble = makeChatBubble(this, start.x, start.y - 52)

    this.events.on(Phaser.Scenes.Events.WAKE, this.onWake, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.WAKE, this.onWake, this)
      this.teardownMultiplayer()
    })

    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    this.prompt = crispText(
      this.add
        .text(0, 0, '', {
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 6 },
        })
        .setDepth(100)
        .setVisible(false),
    )

    this.status = crispText(
      this.add
        .text(0, 0, '', {
          fontFamily: 'Arial, sans-serif',
          fontSize: '13px',
          color: '#e8eef5',
          backgroundColor: '#12161cee',
          padding: { x: 10, y: 6 },
        })
        .setDepth(100)
        .setVisible(false),
    )

    this.controls = new ControlsHelp(this, 'world')
    this.minimap = new Minimap(
      this,
      this.hubs,
      (x, y) => this.player.moveToWorld(x, y),
      () => this.player.sprite,
    )

    registerHud(this, this.controls.root)
    registerHud(this, this.minimap.root)
    registerHud(this, this.prompt)
    registerHud(this, this.status)
    if (isTouchDevice()) {
      this.touch = new TouchControls(this)
      registerHud(this, this.touch.root)
      this.events.on(TOUCH_ACTION_EVENT, (action: TouchAction) => {
        if (action === 'interact' && this.nearestHub) this.interactWithHub(this.nearestHub)
      })
    }
    installHudCamera(this)

    this.layoutHud()
    this.events.on('controls-resized', () => this.layoutHud())
    this.scale.on('resize', () => {
      this.layoutHud()
      this.minimap.relayout()
      this.touch?.layout()
    })

    this.setupMultiplayer(start)
  }

  update(time: number, delta: number) {
    this.player.update(time, delta)
    this.minimap.update(this.player.sprite.x, this.player.sprite.y)
    this.updateNearestHub()
    this.updatePrompt()
    this.updateLocalHud()
    this.syncMultiplayer(time)
    for (const remote of this.remotes.values()) remote.update(delta)

    if (Phaser.Input.Keyboard.JustDown(this.interactKey) && this.nearestHub) {
      this.interactWithHub(this.nearestHub)
    }
  }

  /** Called from React chat bar */
  sendChat(text: string) {
    this.mp?.sendChat(text)
  }

  private updateLocalHud() {
    const x = this.player.sprite.x
    const y = this.player.sprite.y
    this.localName.setPosition(Math.round(x), Math.round(y - 36))
    snapBubble(this.localBubble, x, y - 54)
    if (this.localBubble.visible && performance.now() > this.localBubbleUntil) {
      this.localBubble.setVisible(false)
    }
  }

  private setupMultiplayer(start: { x: number; y: number }) {
    if (!this.profile) return

    this.mp = new MultiplayerClient(this.profile, start, this.worldMpHandlers())
    this.mp.connect()
    this.registry.set('mp', this.mp)
    this.registry.set('sendChat', (text: string) => this.sendChat(text))
  }

  private worldMpHandlers() {
    return {
      onStatus: (text: string) => {
        this.status.setText(text).setVisible(true)
        this.layoutHud()
        this.time.delayedCall(2500, () => {
          if (this.status.text === text) this.status.setVisible(false)
        })
      },
      onNameTaken: (name: string) => {
        window.dispatchEvent(
          new CustomEvent('sm-name-taken', {
            detail: { name, message: `Tên “${name}” đã có người dùng. Chọn tên khác.` },
          }),
        )
      },
      onSync: (players: PlayerPublic[], selfId: string) => {
        const seen = new Set<string>()
        for (const p of players) {
          if (p.id === selfId) continue
          if (p.zone !== OVERWORLD_ZONE) continue
          seen.add(p.id)
          this.upsertRemote(p)
        }
        for (const id of [...this.remotes.keys()]) {
          if (!seen.has(id)) {
            this.remotes.get(id)?.destroy()
            this.remotes.delete(id)
          }
        }
        this.refreshPunchTargets()
        this.publishOnline(players, selfId)
      },
      onJoined: (p: PlayerPublic) => {
        if (p.zone !== OVERWORLD_ZONE) return
        this.upsertRemote(p)
        this.refreshPunchTargets()
        this.publishOnlineFromRemotes()
      },
      onLeft: (id: string) => {
        this.remotes.get(id)?.destroy()
        this.remotes.delete(id)
        this.refreshPunchTargets()
        this.publishOnlineFromRemotes()
      },
      onMoved: (m: PlayerMove) => {
        if (m.zone !== OVERWORLD_ZONE) {
          this.remotes.get(m.id)?.destroy()
          this.remotes.delete(m.id)
          this.refreshPunchTargets()
          return
        }
        this.applyRemoteMove(m)
      },
      onZone: (p: PlayerPublic) => {
        if (p.zone !== OVERWORLD_ZONE) {
          this.remotes.get(p.id)?.destroy()
          this.remotes.delete(p.id)
          this.refreshPunchTargets()
          this.publishOnlineFromRemotes()
          return
        }
        this.upsertRemote(p)
        this.refreshPunchTargets()
        this.publishOnlineFromRemotes()
      },
      onChat: (id: string, name: string, text: string) => {
        window.dispatchEvent(
          new CustomEvent('sm-chat', {
            detail: { id, name, text, at: Date.now() },
          }),
        )
        if (id === this.mp?.id) {
          this.localBubbleUntil = showChatBubble(this.localBubble, text)
          return
        }
        this.remotes.get(id)?.showChat(text)
      },
      onHit: (targetId: string, dirX: number, dirY: number, force: number) => {
        if (targetId === this.mp?.id) {
          this.player.applyKnockback(dirX, dirY, force)
          this.lastNetSent = 0
          this.lastNetAnim = ''
      this.lastNetSmoking = false
          return
        }
        this.remotes.get(targetId)?.applyKnockback(dirX, dirY, force)
      },
    }
  }

  private publishOnline(
    players: PlayerPublic[],
    selfId: string,
  ) {
    const list = players.map((p) => ({
      id: p.id,
      name: p.name,
      self: p.id === selfId,
    }))
    window.dispatchEvent(new CustomEvent('sm-players', { detail: list }))
  }

  private publishOnlineFromRemotes() {
    const selfId = this.mp?.id ?? ''
    const selfName = this.profile?.name ?? 'Bạn'
    const list = [
      { id: selfId || 'self', name: selfName, self: true },
      ...[...this.remotes.values()].map((r) => ({
        id: r.id,
        name: r.name,
        self: false,
      })),
    ]
    window.dispatchEvent(new CustomEvent('sm-players', { detail: list }))
  }

  private refreshPunchTargets() {
    const mp = this.mp
    this.player.setTargets(
      [...this.remotes.values()].map((remote) => ({
        get x() {
          return remote.x
        },
        get y() {
          return remote.y
        },
        applyKnockback: (dirX: number, dirY: number, force: number) => {
          remote.applyKnockback(dirX, dirY, force)
          mp?.sendHit(remote.id, dirX, dirY, force)
        },
      })),
    )
  }

  private teardownMultiplayer() {
    this.mp?.destroy()
    this.mp = null
    this.registry.remove('mp')
    for (const r of this.remotes.values()) r.destroy()
    this.remotes.clear()
    this.registry.remove('sendChat')
  }

  private upsertRemote(p: PlayerPublic) {
    if (p.zone !== OVERWORLD_ZONE) return
    const existing = this.remotes.get(p.id)
    if (existing) {
      existing.applyFull(p)
      return
    }
    this.remotes.set(p.id, new RemotePlayer(this, p))
  }

  private applyRemoteMove(m: PlayerMove) {
    if (m.zone !== OVERWORLD_ZONE) return
    const remote = this.remotes.get(m.id)
    if (remote) {
      remote.applyMove(m)
      return
    }
  }

  private syncMultiplayer(time: number) {
    if (!this.mp) return
    const x = this.player.sprite.x
    const y = this.player.sprite.y
    const anim = this.player.getNetAnim()
    const facing = this.player.getFacing()
    const smoking = this.player.isSmoking
    const dx = x - this.lastNetX
    const dy = y - this.lastNetY
    const distSq = dx * dx + dy * dy
    const animChanged = anim !== this.lastNetAnim
    const smokeChanged = smoking !== this.lastNetSmoking
    if (distSq < 0.8 * 0.8 && !animChanged && !smokeChanged) return
    // ~33 Hz khi đi; anim đổi gửi sớm
    const minGap = (animChanged || smokeChanged) && distSq < 1 ? 16 : 30
    if (time - this.lastNetSent < minGap) return

    let vx = 0
    let vy = 0
    const elapsed = time - this.lastNetSent
    const moving =
      anim.startsWith('walk') || anim.startsWith('run') || anim.startsWith('jump')
    if (moving && this.lastNetSent > 0 && elapsed >= 16 && elapsed <= 120) {
      const dt = elapsed / 1000
      vx = dx / dt
      vy = dy / dt
      const sp = Math.hypot(vx, vy)
      if (sp > 420) {
        const s = 420 / sp
        vx *= s
        vy *= s
      }
    }

    this.lastNetSent = time
    this.lastNetX = x
    this.lastNetY = y
    this.lastNetAnim = anim
    this.lastNetSmoking = smoking
    this.mp.sendMove(x, y, facing, anim, vx, vy, smoking)
  }

  private layoutHud() {
    this.controls.layout()
    if (this.status.visible) {
      pinToScreen(this, this.status, 16, 16 + this.controls.panelHeight + 10)
    }
  }

  private buildWorld() {
    this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'grass')
      .setOrigin(0)
      .setDepth(0)
      .setTileScale(4, 4)

    this.drawSingleRoad()
    this.scatterMapTrees()

    for (const hub of this.hubs) {
      this.buildHub(hub)
    }
  }

  /** path.png has a grass border — bake a seamless fill so junctions join cleanly. */
  private bakeSeamlessPath() {
    if (this.textures.exists('path-seam')) return
    const size = 32
    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(0xcbb892, 1)
    g.fillRect(0, 0, size, size)
    const rng = new Phaser.Math.RandomDataGenerator(['path-seam-v1'])
    for (let i = 0; i < 90; i++) {
      g.fillStyle(rng.pick([0xbba87a, 0xd4c4a0, 0xa89870, 0xc4b488, 0xd8c8a8]), 1)
      g.fillRect(rng.between(0, size - 1), rng.between(0, size - 1), rng.between(1, 2), rng.between(1, 2))
    }
    g.generateTexture('path-seam', size, size)
    g.destroy()
    this.textures.get('path-seam')?.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  private drawSingleRoad() {
    if (this.hubs.length === 0) return
    this.bakeSeamlessPath()

    const layout = computeRoadLayout(this.hubs)
    this.roadLayout = layout
    const { ROAD, segs, junctions } = layout

    for (const s of segs) {
      if (Math.abs(s.y2 - s.y1) < 1) this.drawHRoad(s.x1, s.x2, s.y1, ROAD)
      else this.drawVRoad(s.y1, s.y2, s.x1, ROAD)
    }

    for (const j of junctions) {
      this.drawJunction(j.x, j.y, ROAD)
    }
  }

  private drawHRoad(x1: number, x2: number, y: number, road = 56) {
    const a = Math.round(Math.min(x1, x2))
    const b = Math.round(Math.max(x1, x2))
    const yy = Math.round(y)
    const w = b - a
    if (w < 4) return
    const TEX = 32
    const spr = this.add.tileSprite((a + b) / 2, yy, w, road, 'path-seam')
    // Stretch across thickness so the 32px texture doesn't tile into a false "double road"
    spr.setTileScale(1, road / TEX)
    spr.setDepth(1).setAlpha(0.98)
  }

  private drawVRoad(y1: number, y2: number, x: number, road = 56) {
    const a = Math.round(Math.min(y1, y2))
    const b = Math.round(Math.max(y1, y2))
    const xx = Math.round(x)
    const h = b - a
    if (h < 4) return
    const TEX = 32
    const spr = this.add.tileSprite(xx, (a + b) / 2, road, h, 'path-seam')
    spr.setTileScale(road / TEX, 1)
    spr.setDepth(1).setAlpha(0.98)
  }

  private drawJunction(x: number, y: number, road = 56) {
    const TEX = 32
    const spr = this.add.tileSprite(Math.round(x), Math.round(y), road, road, 'path-seam')
    spr.setTileScale(road / TEX, road / TEX)
    spr.setDepth(1).setAlpha(0.98)
  }

  /** Sparse trees on road verges + occasional trees out on the meadow. */
  private scatterMapTrees() {
    const layout = this.roadLayout ?? computeRoadLayout(this.hubs)
    const rng = new Phaser.Math.RandomDataGenerator(['school-mini-trees-v5'])
    const clear = this.hubs.map((h) => ({ x: h.x, y: h.y, r: 340 }))
    const verge = layout.ROAD / 2 + 48

    const nearHub = (x: number, y: number) => {
      for (const z of clear) {
        const dx = x - z.x
        const dy = (y - z.y) * 1.1
        if (dx * dx + dy * dy < z.r * z.r) return true
      }
      return false
    }

    // Road-side trees (few)
    for (const s of layout.segs) {
      const dx = s.x2 - s.x1
      const dy = s.y2 - s.y1
      const len = Math.hypot(dx, dy)
      if (len < 220) continue
      const steps = Math.max(1, Math.floor(len / 480))
      const horizontal = Math.abs(dy) < 1

      for (let i = 1; i <= steps; i++) {
        const t = (i - 0.35 + rng.frac() * 0.3) / (steps + 1)
        const cx = s.x1 + dx * t + rng.between(-40, 40)
        const cy = s.y1 + dy * t + rng.between(-40, 40)
        const side = rng.frac() < 0.5 ? -1 : 1
        const tx = horizontal ? cx : cx + side * verge
        const ty = horizontal ? cy + side * verge : cy

        if (nearHub(tx, ty)) continue
        if (isOnRoad(tx, ty, layout, 4)) continue
        const roll = rng.frac()
        if (roll < 0.32) this.addTree(tx, ty, rng.realInRange(0.85, 1.1))
        else if (roll < 0.4) this.addBush(tx, ty)
      }
    }

    // Occasional field trees — wide grid, low density
    const margin = 220
    const step = 520
    for (let gy = margin; gy < WORLD_HEIGHT - margin; gy += step) {
      for (let gx = margin; gx < WORLD_WIDTH - margin; gx += step) {
        if (rng.frac() > 0.28) continue
        const x = gx + rng.between(-140, 140)
        const y = gy + rng.between(-140, 140)
        if (nearHub(x, y)) continue
        if (isOnRoad(x, y, layout, 40)) continue
        if (rng.frac() < 0.7) this.addTree(x, y, rng.realInRange(0.8, 1.15))
        else this.addBush(x, y)
      }
    }
  }

  private buildHub(hub: PlacedLocation) {
    const { x, y, kind } = hub

    this.add
      .rectangle(x, y + 20, 420, 340, hub.groundColor, 0.5)
      .setDepth(1)
      .setStrokeStyle(2, 0x2a3a2a, 0.6)

    // Oval plaza in front of the door — driveway stub meets here (T-junction look)
    this.add.ellipse(x, y + 70, 210, 78, 0xd4c4a8, 0.98).setDepth(1)
    this.drawJunction(x, y + 80, this.roadLayout?.ROAD ?? 56)

    if (kind === 'ktv') {
      this.drawKtv(hub)
    } else if (kind === 'restaurant') {
      this.drawShop(hub)
    } else {
      this.drawHouse(hub)
    }

    this.decorateAround(hub)
  }

  /** Two-story house silhouette: walls, peaked roof, chimney, windows, door. */
  private drawHouse(hub: PlacedLocation) {
    const { x, y } = hub
    const wall = hub.color
    const roof = Phaser.Display.Color.IntegerToColor(wall).darken(40).color
    const trim = Phaser.Display.Color.IntegerToColor(wall).lighten(25).color
    const g = this.add.graphics().setDepth(2)

    const bw = hub.kind === 'hometown' ? 210 : 190
    const bh = hub.kind === 'hometown' ? 150 : 130
    const baseY = y - 10

    // Shadow under house
    g.fillStyle(0x000000, 0.18)
    g.fillEllipse(x, baseY + bh / 2 + 18, bw + 30, 36)

    // Main walls
    g.fillStyle(wall, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)
    g.lineStyle(3, 0x1a1a2e, 0.9)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)

    // Second-story band (hometown) or floor line
    if (hub.kind === 'hometown') {
      g.lineStyle(2, 0x1a1a2e, 0.35)
      g.lineBetween(x - bw / 2 + 4, baseY - 10, x + bw / 2 - 4, baseY - 10)
    }

    // Peaked roof
    const roofH = 56
    const roofY = baseY - bh / 2
    g.fillStyle(roof, 1)
    g.fillTriangle(x - bw / 2 - 18, roofY, x + bw / 2 + 18, roofY, x, roofY - roofH)
    g.lineStyle(3, 0x1a1a2e, 0.95)
    g.strokeTriangle(x - bw / 2 - 18, roofY, x + bw / 2 + 18, roofY, x, roofY - roofH)

    // Chimney
    g.fillStyle(0x6a5a4a, 1)
    g.fillRect(x + bw / 4, roofY - roofH + 8, 22, 36)
    g.fillStyle(0x4a3a2a, 1)
    g.fillRect(x + bw / 4 - 3, roofY - roofH + 4, 28, 10)

    // Windows
    const win = (wx: number, wy: number) => {
      g.fillStyle(0xc8e8f8, 1)
      g.fillRect(wx - 14, wy - 14, 28, 28)
      g.lineStyle(2, 0x1a1a2e, 0.85)
      g.strokeRect(wx - 14, wy - 14, 28, 28)
      g.lineBetween(wx, wy - 14, wx, wy + 14)
      g.lineBetween(wx - 14, wy, wx + 14, wy)
    }
    win(x - bw / 3.2, baseY - 18)
    win(x + bw / 3.2, baseY - 18)
    if (hub.kind === 'hometown') {
      win(x - bw / 3.2, baseY + 28)
      win(x + bw / 3.2, baseY + 28)
    }

    // Door
    g.fillStyle(0x3a2a1a, 1)
    g.fillRect(x - 18, baseY + bh / 2 - 48, 36, 48)
    g.fillStyle(0xd4b060, 1)
    g.fillCircle(x + 10, baseY + bh / 2 - 24, 3)

    // Porch step
    g.fillStyle(trim, 1)
    g.fillRect(x - 30, baseY + bh / 2 - 2, 60, 10)

    // Label
    crispText(
      this.add
        .text(x, roofY - roofH - 18, hub.shortName, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          color: '#ffffff',
          stroke: '#1a1a2e',
          strokeThickness: 4,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(4),
    )
  }

  /** Distinct shop facades — name lives on the signboard, not floating above. */
  private drawShop(hub: PlacedLocation) {
    switch (hub.id) {
      case 'che-cau-nguyet':
        this.drawCheShop(hub)
        break
      case 'ga-nguyen-con':
        this.drawGaShop(hub)
        break
      case 'bun-chi-rau':
        this.drawBunShop(hub)
        break
      case 'nhau-tc':
        this.drawNhauShop(hub)
        break
      case 'mat-xa-nguoi-mu':
        this.drawMatXaShop(hub)
        break
      default:
        this.drawGenericShop(hub)
    }
  }

  private putSignName(x: number, y: number, label: string, color = '#ffffff') {
    const long = label.length > 14
    crispText(
      this.add
        .text(x, y, label, {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: long ? '12px' : '14px',
          color,
          stroke: '#1a1a2e',
          strokeThickness: 3,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(4),
    )
  }

  private drawCheShop(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 210
    const bh = 100
    const baseY = y - 18

    g.fillStyle(0x000000, 0.14)
    g.fillEllipse(x, baseY + bh / 2 + 20, bw + 30, 34)

    g.fillStyle(0xf5c4d8, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 10)
    g.lineStyle(3, 0x1a1a2e, 0.85)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 10)

    g.fillStyle(0xd96a9a, 1)
    g.fillRect(x - bw / 2 - 10, baseY - bh / 2 - 16, bw + 20, 18)
    for (let i = 0; i < 7; i++) {
      g.fillCircle(x - bw / 2 + 16 + i * 30, baseY - bh / 2 + 2, 12)
    }

    g.fillStyle(0xffffff, 1)
    g.fillRoundedRect(x - 88, baseY - bh / 2 + 6, 176, 32, 6)
    g.lineStyle(2, 0xd96a9a, 1)
    g.strokeRoundedRect(x - 88, baseY - bh / 2 + 6, 176, 32, 6)
    this.putSignName(x, baseY - bh / 2 + 22, hub.shortName, '#c04080')

    g.fillStyle(0x8ec8e8, 0.55)
    g.fillRect(x - bw / 2 + 18, baseY + 4, bw - 36, bh / 2 - 10)
    g.fillStyle(0xffffff, 1)
    g.fillCircle(x - 40, baseY + bh / 2 - 8, 10)
    g.fillCircle(x, baseY + bh / 2 - 8, 10)
    g.fillCircle(x + 40, baseY + bh / 2 - 8, 10)
    g.fillStyle(0xff88bb, 1)
    g.fillCircle(x - 40, baseY + bh / 2 - 12, 5)
    g.fillStyle(0x88dd66, 1)
    g.fillCircle(x, baseY + bh / 2 - 12, 5)
    g.fillStyle(0xffcc44, 1)
    g.fillCircle(x + 40, baseY + bh / 2 - 12, 5)

    g.fillStyle(0xffffff, 1)
    g.fillCircle(x - 75, y + 95, 16)
    g.fillCircle(x + 70, y + 98, 16)
  }

  private drawGaShop(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 220
    const bh = 115
    const baseY = y - 22

    g.fillStyle(0x000000, 0.16)
    g.fillEllipse(x, baseY + bh / 2 + 22, bw + 36, 38)

    g.fillStyle(0xd4894a, 1)
    g.fillRect(x - bw / 2, baseY - bh / 2, bw, bh)
    g.lineStyle(3, 0x1a1a2e, 0.9)
    g.strokeRect(x - bw / 2, baseY - bh / 2, bw, bh)

    g.fillStyle(0x8a6a4a, 1)
    g.fillTriangle(x - bw / 2 - 14, baseY - bh / 2, x + bw / 2 + 14, baseY - bh / 2, x, baseY - bh / 2 - 42)
    g.lineStyle(2, 0x1a1a2e, 0.9)
    g.strokeTriangle(x - bw / 2 - 14, baseY - bh / 2, x + bw / 2 + 14, baseY - bh / 2, x, baseY - bh / 2 - 42)

    g.fillStyle(0x4a3a2a, 1)
    g.fillRect(x + 70, baseY - bh / 2 - 50, 16, 28)
    g.fillStyle(0xcccccc, 0.45)
    g.fillCircle(x + 78, baseY - bh / 2 - 58, 10)
    g.fillCircle(x + 88, baseY - bh / 2 - 70, 8)

    g.fillStyle(0x3a2410, 1)
    g.fillRoundedRect(x - 96, baseY - bh / 2 + 4, 192, 36, 3)
    g.lineStyle(2, 0xf0c060, 0.9)
    g.strokeRoundedRect(x - 96, baseY - bh / 2 + 4, 192, 36, 3)
    this.putSignName(x, baseY - bh / 2 + 22, hub.shortName, '#ffe08a')

    g.fillStyle(0x2a1810, 1)
    g.fillRect(x - bw / 2 + 20, baseY + 2, bw - 40, bh / 2 - 6)
    g.fillStyle(0xff6622, 0.7)
    g.fillRect(x - 50, baseY + 28, 100, 12)
    g.fillStyle(0xffaa33, 0.8)
    g.fillRect(x - 40, baseY + 24, 80, 6)

    for (let i = 0; i < 5; i++) {
      g.lineStyle(2, 0x5a3a20, 1)
      g.lineBetween(x - 55 + i * 28, baseY + 8, x - 55 + i * 28, baseY + 26)
      g.fillStyle(0xe8a050, 1)
      g.fillCircle(x - 55 + i * 28, baseY + 14, 5)
    }
  }

  private drawBunShop(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 200
    const bh = 120
    const baseY = y - 20

    g.fillStyle(0x000000, 0.14)
    g.fillEllipse(x, baseY + bh / 2 + 20, bw + 28, 34)

    g.fillStyle(0x8fd070, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)
    g.lineStyle(3, 0x1a1a2e, 0.9)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)

    g.fillStyle(0x3d7a45, 1)
    g.fillRect(x - bw / 2 - 8, baseY - bh / 2 - 20, bw + 16, 24)
    g.fillStyle(0x5aaa54, 1)
    g.fillCircle(x - 60, baseY - bh / 2 - 8, 14)
    g.fillCircle(x - 20, baseY - bh / 2 - 14, 16)
    g.fillCircle(x + 30, baseY - bh / 2 - 10, 15)
    g.fillCircle(x + 70, baseY - bh / 2 - 6, 12)

    g.fillStyle(0xf5f5e8, 1)
    g.fillRoundedRect(x - 78, baseY - bh / 2 + 8, 156, 30, 4)
    g.lineStyle(2, 0x2a5a2a, 1)
    g.strokeRoundedRect(x - 78, baseY - bh / 2 + 8, 156, 30, 4)
    this.putSignName(x, baseY - bh / 2 + 23, hub.shortName, '#2a6a2a')

    g.fillStyle(0xd8f0c8, 1)
    g.fillRect(x - bw / 2 + 16, baseY + 2, 50, bh / 2 + 4)
    g.fillRect(x + bw / 2 - 66, baseY + 2, 50, bh / 2 + 4)
    g.fillStyle(0x3d7a45, 1)
    g.fillCircle(x - 40, baseY + 10, 8)
    g.fillCircle(x + 40, baseY + 12, 8)
    g.fillCircle(x - 28, baseY + 22, 6)
    g.fillCircle(x + 52, baseY + 20, 7)

    g.fillStyle(0x5a4030, 1)
    g.fillRect(x - 16, baseY + bh / 2 - 44, 32, 44)
  }

  private drawNhauShop(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 230
    const bh = 125
    const baseY = y - 24

    g.fillStyle(0x000000, 0.18)
    g.fillEllipse(x, baseY + bh / 2 + 22, bw + 40, 40)

    g.fillStyle(0xa03828, 1)
    g.fillRect(x - bw / 2, baseY - bh / 2, bw, bh)
    g.lineStyle(3, 0x1a1a2e, 0.95)
    g.strokeRect(x - bw / 2, baseY - bh / 2, bw, bh)

    g.fillStyle(0x5a2018, 1)
    g.fillRect(x - bw / 2 - 12, baseY - bh / 2 - 22, bw + 24, 26)
    g.lineStyle(2, 0x1a1a2e, 0.8)
    for (let i = 0; i < 8; i++) {
      g.lineBetween(
        x - bw / 2 - 8 + i * 32,
        baseY - bh / 2 - 22,
        x - bw / 2 - 8 + i * 32,
        baseY - bh / 2 + 4,
      )
    }

    g.fillStyle(0xf0d060, 1)
    g.fillRoundedRect(x - 92, baseY - bh / 2 - 2, 184, 38, 4)
    g.lineStyle(3, 0x1a1a2e, 1)
    g.strokeRoundedRect(x - 92, baseY - bh / 2 - 2, 184, 38, 4)
    this.putSignName(x, baseY - bh / 2 + 17, hub.shortName, '#1a1a2e')

    g.fillStyle(0x2a1810, 1)
    g.fillRect(x - bw / 2 + 14, baseY + 8, bw - 28, bh / 2 - 4)
    g.fillStyle(0xf0a040, 0.25)
    g.fillRect(x - bw / 2 + 18, baseY + 12, bw - 36, bh / 2 - 12)

    g.fillStyle(0x6a6a6a, 1)
    g.fillEllipse(x - 80, y + 100, 28, 34)
    g.fillEllipse(x - 48, y + 102, 26, 32)
    g.fillStyle(0x8a8a8a, 1)
    g.fillEllipse(x - 80, y + 90, 20, 10)

    g.fillStyle(0x2266cc, 1)
    g.fillRect(x + 40, y + 95, 18, 14)
    g.fillRect(x + 70, y + 98, 18, 14)
    g.fillRect(x + 100, y + 94, 18, 14)
  }

  private drawMatXaShop(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 215
    const bh = 115
    const baseY = y - 20

    g.fillStyle(0x000000, 0.12)
    g.fillEllipse(x, baseY + bh / 2 + 18, bw + 28, 32)

    g.fillStyle(0xb8d0e8, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 8)
    g.lineStyle(3, 0x3a5068, 0.9)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 8)

    g.fillStyle(0x6a8aaa, 1)
    g.fillRect(x - bw / 2 - 6, baseY - bh / 2 - 14, bw + 12, 16)

    g.fillStyle(0x2a4a6a, 1)
    g.fillRoundedRect(x - 100, baseY - bh / 2 + 2, 200, 36, 5)
    g.lineStyle(2, 0xd0e8ff, 0.85)
    g.strokeRoundedRect(x - 100, baseY - bh / 2 + 2, 200, 36, 5)
    this.putSignName(x, baseY - bh / 2 + 20, hub.shortName, '#e8f4ff')

    const win = (wx: number) => {
      g.fillStyle(0xffe8c8, 1)
      g.fillRect(wx - 28, baseY + 8, 56, 42)
      g.fillStyle(0x4a6a8a, 0.55)
      g.fillRect(wx - 28, baseY + 8, 12, 42)
      g.fillRect(wx + 16, baseY + 8, 12, 42)
    }
    win(x - 55)
    win(x + 55)

    g.fillStyle(0x3a5a78, 1)
    g.fillRect(x - 14, baseY + bh / 2 - 40, 28, 40)
    g.fillStyle(0xd0e0f0, 1)
    g.fillCircle(x + 8, baseY + bh / 2 - 20, 3)

    g.fillStyle(0x5a4030, 1)
    g.fillRect(x - 90, y + 92, 50, 14)
    g.fillRect(x + 40, y + 94, 50, 14)
    g.fillStyle(0x4a9054, 1)
    g.fillCircle(x - 75, y + 88, 8)
    g.fillCircle(x - 55, y + 86, 7)
    g.fillCircle(x + 55, y + 90, 8)
    g.fillCircle(x + 75, y + 88, 7)
  }

  private drawGenericShop(hub: PlacedLocation) {
    const { x, y } = hub
    const wall = hub.color
    const roof = Phaser.Display.Color.IntegerToColor(wall).darken(45).color
    const awning = Phaser.Display.Color.IntegerToColor(wall).lighten(15).color
    const g = this.add.graphics().setDepth(2)
    const bw = 200
    const bh = 110
    const baseY = y - 20

    g.fillStyle(0x000000, 0.16)
    g.fillEllipse(x, baseY + bh / 2 + 22, bw + 40, 40)
    g.fillStyle(wall, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 3)
    g.lineStyle(3, 0x1a1a2e, 0.9)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 3)
    g.fillStyle(roof, 1)
    g.fillRect(x - bw / 2 - 8, baseY - bh / 2 - 18, bw + 16, 22)
    g.fillStyle(awning, 1)
    g.fillRoundedRect(x - bw / 2 + 10, baseY - bh / 2 - 4, bw - 20, 34, 4)
    g.lineStyle(2, 0x1a1a2e, 0.8)
    g.strokeRoundedRect(x - bw / 2 + 10, baseY - bh / 2 - 4, bw - 20, 34, 4)
    this.putSignName(x, baseY - bh / 2 + 13, hub.shortName)
    g.fillStyle(0x2a2018, 1)
    g.fillRect(x - bw / 2 + 16, baseY - 8, bw - 32, bh / 2 + 8)
  }

  /** Dark KTV box with purple/pink LED strips that pulse. */
  private drawKtv(hub: PlacedLocation) {
    const { x, y } = hub
    const g = this.add.graphics().setDepth(2)
    const bw = 210
    const bh = 130
    const baseY = y - 16

    g.fillStyle(0x000000, 0.22)
    g.fillEllipse(x, baseY + bh / 2 + 20, bw + 36, 40)

    // Dark facade
    g.fillStyle(0x1a1224, 1)
    g.fillRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)
    g.lineStyle(3, 0x3a2040, 1)
    g.strokeRoundedRect(x - bw / 2, baseY - bh / 2, bw, bh, 4)

    // Flat roof
    g.fillStyle(0x0e0a14, 1)
    g.fillRect(x - bw / 2 - 6, baseY - bh / 2 - 16, bw + 12, 18)

    // Neon "KARAOKE" sign board
    g.fillStyle(0x2a1040, 1)
    g.fillRoundedRect(x - 78, baseY - bh / 2 - 8, 156, 40, 6)

    const neonSign = crispText(
      this.add
        .text(x, baseY - bh / 2 + 12, 'KARAOKE', {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: '20px',
          color: '#ff66ee',
          stroke: '#ff22aa',
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(4),
    )

    this.tweens.add({
      targets: neonSign,
      alpha: { from: 0.55, to: 1 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    // Interior glow
    g.fillStyle(0x4a1868, 1)
    g.fillRect(x - bw / 2 + 18, baseY - 6, bw - 36, bh / 2 + 4)
    g.fillStyle(0xff66cc, 0.25)
    g.fillRect(x - bw / 2 + 22, baseY - 2, bw - 44, bh / 2 - 4)

    // Door
    g.fillStyle(0x120818, 1)
    g.fillRect(x - 22, baseY + bh / 2 - 52, 44, 52)
    g.fillStyle(0xff44cc, 0.7)
    g.fillCircle(x + 12, baseY + bh / 2 - 28, 3)

    // LED strip dots (animated)
    const leds: Phaser.GameObjects.Arc[] = []
    const colors = [0xff44cc, 0x66aaff, 0xffee55, 0xaa66ff, 0x44ffcc]
    for (let i = 0; i < 12; i++) {
      const lx = x - bw / 2 + 14 + i * 16
      const led = this.add
        .circle(lx, baseY - bh / 2 + 8, 4, colors[i % colors.length]!)
        .setDepth(3)
      leds.push(led)
    }
    // Vertical strips on sides
    for (let i = 0; i < 6; i++) {
      const ly = baseY - bh / 2 + 28 + i * 16
      leds.push(this.add.circle(x - bw / 2 + 8, ly, 3.5, colors[i % colors.length]!).setDepth(3))
      leds.push(this.add.circle(x + bw / 2 - 8, ly, 3.5, colors[(i + 2) % colors.length]!).setDepth(3))
    }

    this.tweens.add({
      targets: leds,
      alpha: { from: 0.35, to: 1 },
      duration: 280,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: (_t: unknown, i: number) => (i % 5) * 70,
    })

    // Soft ground glow
    this.add.ellipse(x, baseY + bh / 2 + 8, 180, 50, 0xff44cc, 0.12).setDepth(1)

    crispText(
      this.add
        .text(x, baseY - bh / 2 - 34, hub.shortName, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          color: '#ff99ee',
          stroke: '#1a1a2e',
          strokeThickness: 4,
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(4),
    )
  }

  private decorateAround(hub: PlacedLocation) {
    const { x, y, kind } = hub
    // Bushes beside plaza — keep clear of stub road at y+80
    this.addBush(x - 110, y + 40)
    this.addBush(x + 115, y + 42)

    if (kind === 'home') {
      this.addTree(x - 160, y + 20, 1.05)
    } else if (kind === 'hometown') {
      this.addTree(x - 170, y - 20, 1.05)
      this.add
        .rectangle(x + 195, y + 50, 110, 70, 0x8fbc5a)
        .setDepth(1)
        .setStrokeStyle(2, 0x5a4030)
    } else if (kind === 'ktv') {
      this.addBush(x - 110, y + 100)
    } else if (hub.id !== 'mat-xa-nguoi-mu') {
      this.addTree(x - 170, y + 15, 1.0)
    }
  }

  private addBush(x: number, y: number) {
    if (this.roadLayout && isOnRoad(x, y, this.roadLayout, 2)) return
    this.add.circle(x, y, 16, 0x3d7a45).setDepth(2)
    this.add.circle(x - 10, y + 4, 12, 0x4a9054).setDepth(2)
    this.add.circle(x + 10, y + 2, 11, 0x356b3c).setDepth(2)
  }

  private addTree(x: number, y: number, scale = 1) {
    if (this.roadLayout && isOnRoad(x, y, this.roadLayout, 6)) return
    const s = scale
    this.add.circle(x, y + 10 * s, 8 * s, 0x5a4030).setDepth(2)
    this.add.circle(x, y - 8 * s, 22 * s, 0x3d7a45).setDepth(2)
    this.add.circle(x - 10 * s, y - 2 * s, 14 * s, 0x4a9054).setDepth(2)
    this.add.circle(x + 10 * s, y - 4 * s, 14 * s, 0x356b3c).setDepth(2)
  }

  private updateNearestHub() {
    const px = this.player.sprite.x
    const py = this.player.sprite.y
    let best: PlacedLocation | null = null
    let bestDist = ENTER_RADIUS + 20

    for (const hub of this.hubs) {
      const dist = Phaser.Math.Distance.Between(px, py, hub.x, hub.y + 50)
      if (dist < bestDist) {
        bestDist = dist
        best = hub
      }
    }

    this.nearestHub = best
  }

  private updatePrompt() {
    if (!this.nearestHub) {
      this.prompt.setVisible(false)
      return
    }

    const hub = this.nearestHub
    const action =
      hub.kind === 'restaurant' || hub.kind === 'home' || hub.kind === 'ktv'
        ? `E — Vào ${hub.shortName}`
        : `E — Xem Google Maps · ${hub.shortName}`

    this.prompt.setText(action).setVisible(true)
    const margin = 16
    pinToScreen(
      this,
      this.prompt,
      this.scale.width - this.prompt.width - margin,
      margin,
    )
  }

  private onWake(_sys: Phaser.Scenes.Systems, data?: WorldSceneData) {
    if (data?.spawnX != null && data?.spawnY != null && this.player) {
      this.player.moveToWorld(data.spawnX, data.spawnY)
      this.player.sprite.setPosition(data.spawnX, data.spawnY)
    }
    this.cameras.main.startFollow(this.player.sprite, false, 1, 1)
    // Reclaim MP handlers after InteriorScene
    if (this.mp) {
      this.mp.setHandlers(this.worldMpHandlers())
      const x = this.player.sprite.x
      const y = this.player.sprite.y
      this.mp.sendZone(OVERWORLD_ZONE, x, y)
      this.mp.requestSync()
      this.lastNetSent = 0
      this.lastNetAnim = ''
      this.lastNetSmoking = false
    }
  }

  private interactWithHub(hub: PlacedLocation) {
    // Home / quán / KTV / mát xa — vào interior ngồi bàn gọi phục vụ
    if (hub.kind === 'restaurant' || hub.kind === 'home' || hub.kind === 'ktv') {
      const zone = interiorZone(hub.id)
      // Announce leave overworld before sleep (exact spawn fixed inside InteriorScene)
      this.mp?.sendZone(zone, hub.x, hub.y + 100)
      this.scene.sleep()
      this.scene.launch('InteriorScene', {
        locationId: hub.id,
        returnX: hub.x,
        returnY: hub.y + 100,
      })
      return
    }

    window.open(mapsUrl(hub), '_blank', 'noopener,noreferrer')
    this.status
      .setText(
        `${hub.name}\n${hub.lat.toFixed(6)}, ${hub.lng.toFixed(6)}${
          hub.coordsApproximate ? ' (toạ độ tạm)' : ''
        }`,
      )
      .setVisible(true)
    this.layoutHud()
    this.time.delayedCall(4000, () => {
      this.status.setVisible(false)
    })
  }
}
