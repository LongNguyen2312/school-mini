import Phaser from 'phaser'
import { bindCameraZoom } from '../cameraZoom'
import { SIT_RADIUS } from '../config'
import { FEMALE_STAFF_IDS, getOrderLine, MASSAGE_LINES } from '../data/orderLines'
import { KTV_TRACKS, KTV_VOLUME } from '../data/ktvPlaylist'
import { PLAYER_BALD_SHEET, PLAYER_SHEET } from '../data/playerAnims'
import { getLocationById, mapsUrl, type GameLocation } from '../data/locations'
import { Npc } from '../entities/Npc'
import { Player } from '../entities/Player'
import { RemotePlayer } from '../entities/RemotePlayer'
import type { MultiplayerClient } from '../../multiplayer/client'
import {
  interiorZone,
  OVERWORLD_ZONE,
  type PlayerMove,
  type PlayerProfile,
  type PlayerPublic,
} from '../../multiplayer/types'
import { ControlsHelp } from '../ui/ControlsHelp'
import { KtvMuteButton } from '../ui/KtvMuteButton'
import {
  TOUCH_ACTION_EVENT,
  TouchControls,
  isTouchDevice,
  type TouchAction,
} from '../ui/TouchControls'
import { makeChatBubble, showChatBubble, snapBubble } from '../ui/chatBubble'
import { crispText, refreshCrispText } from '../ui/crispText'
import { installHudCamera, registerHud } from '../ui/hudCamera'
import { pinToScreen } from '../ui/pinToScreen'

interface InteriorData {
  locationId: string
  returnX: number
  returnY: number
}

interface Seat {
  x: number
  y: number
  facing: 'up' | 'down' | 'left' | 'right'
  occupiedByNpc: boolean
  marker: Phaser.GameObjects.Rectangle
  /** 'lie' = massage bed; default sit */
  mode?: 'sit' | 'lie'
  therapist?: Npc
  /** Spa bed number (1–10), shared across clients. */
  bedNo?: number
}

/** DOM events that count as a user gesture for unlocking media playback. */
const KTV_GESTURE_EVENTS = ['pointerup', 'touchend', 'mousedown', 'keydown'] as const

let ktvAudioEl: HTMLAudioElement | null = null

/**
 * Streamed <audio> rather than Phaser WebAudio: long tracks decoded to PCM
 * exhaust memory on phones, and iOS mutes WebAudio when the silent switch is on.
 * Reused across KTV visits so buffered data and iOS play permission carry over.
 */
function ktvAudioElement(src: string) {
  if (!ktvAudioEl) {
    ktvAudioEl = new Audio()
    ktvAudioEl.loop = true
    ktvAudioEl.preload = 'auto'
    ktvAudioEl.volume = KTV_VOLUME
  }
  if (!ktvAudioEl.src.endsWith(src)) ktvAudioEl.src = src
  return ktvAudioEl
}

/**
 * Full-viewport interior — sit at a table and the waiter runs over to take the order.
 */
export class InteriorScene extends Phaser.Scene {
  private player!: Player
  private location!: GameLocation
  private returnX = 0
  private returnY = 0
  private npcs: Npc[] = []
  private owner: Npc | null = null
  private waiter: Npc | null = null
  private seats: Seat[] = []
  private nearestSeat: Seat | null = null
  private seatedSeat: Seat | null = null
  private wasSitting = false
  private orderOpen = false
  private bedTherapists = new Map<number, { npc: Npc; x: number; y: number }>()
  /** Remote player id → spa bed they're lying on. */
  private remoteBeds = new Map<string, number>()
  private localBed = 0
  private massageChatTimer: Phaser.Time.TimerEvent | null = null
  private lastMassageLine = -1
  private orderServing = false
  private prompt!: Phaser.GameObjects.Text
  private title!: Phaser.GameObjects.Text
  private speechBubble!: Phaser.GameObjects.Container
  private speechBg!: Phaser.GameObjects.Rectangle
  private speechText!: Phaser.GameObjects.Text
  private speechHint!: Phaser.GameObjects.Text
  private speechFollow: Phaser.GameObjects.Sprite | null = null
  private speechAnchor: { x: number; y: number } | null = null
  private tvAnchor = { x: 0, y: 0 }
  private controls!: ControlsHelp
  private interactKey!: Phaser.Input.Keyboard.Key
  private roomLayer!: Phaser.GameObjects.Container
  private exitX = 0
  private exitY = 0
  private counterSpot = { x: 0, y: 0 }
  private ledLights: Phaser.GameObjects.Arc[] = []
  private ledColors = [0xff44cc, 0x44aaff, 0xffee44, 0xff6644, 0xaa66ff]
  private ledTick = 0
  private remotes = new Map<string, RemotePlayer>()
  private mp: MultiplayerClient | null = null
  private zone = ''
  private lastNetSent = 0
  private lastNetX = 0
  private lastNetY = 0
  private lastNetAnim = ''
  private lastNetSmoking = false
  private localName!: Phaser.GameObjects.Text
  private localBubble!: Phaser.GameObjects.Text
  private localBubbleUntil = 0
  private ktvAudio: HTMLAudioElement | null = null
  private ktvMuted = false
  private ktvMuteBtn: KtvMuteButton | null = null
  private touch: TouchControls | null = null
  /** Shared session start (server epoch ms). */
  private ktvStartedAt = 0
  /** serverNow - Date.now() when last sync arrived. */
  private ktvClockSkew = 0
  private ktvAwaitingSync = false
  private ktvFallbackTimer: Phaser.Time.TimerEvent | null = null
  private ktvResyncTimer: Phaser.Time.TimerEvent | null = null

  constructor() {
    super('InteriorScene')
  }

  init(data: InteriorData) {
    const loc = getLocationById(data.locationId)
    if (!loc) {
      this.returnToWorld()
      return
    }
    this.location = loc
    this.returnX = data.returnX
    this.returnY = data.returnY
  }

  preload() {
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

    // Do NOT remove+reload textures — blanks WebGL on Phaser 4 (same as WorldScene).
    if (!this.textures.exists('npc-bikini')) {
      this.load.image('npc-bikini', '/assets/npc/bikini.png?v=4')
    }
    if (!this.textures.exists('npc-bikini-walk')) {
      this.load.spritesheet('npc-bikini-walk', '/assets/npc/bikini_walk.png?v=4', {
        frameWidth: 64,
        frameHeight: 64,
      })
    }

    const loads: [string, string][] = [
      ['npc-owner', '/assets/npc/owner.png?v=2'],
      ['npc-waiter', '/assets/npc/waiter.png?v=2'],
      ['npc-owner-f', '/assets/npc/owner_f.png?v=2'],
      ['npc-waiter-f', '/assets/npc/waiter_f.png?v=2'],
    ]
    for (const [key, url] of loads) {
      if (!this.textures.exists(key)) this.load.image(key, url)
    }

    const walks: [string, string][] = [
      ['npc-waiter-walk', '/assets/npc/waiter_walk.png?v=2'],
      ['npc-waiter-f-walk', '/assets/npc/waiter_f_walk.png?v=2'],
      ['npc-owner-walk', '/assets/npc/owner_walk.png?v=2'],
      ['npc-owner-f-walk', '/assets/npc/owner_f_walk.png?v=2'],
    ]
    for (const [key, url] of walks) {
      if (!this.textures.exists(key)) {
        this.load.spritesheet(key, url, { frameWidth: 64, frameHeight: 64 })
      }
    }

  }

  create() {
    for (const key of [
      PLAYER_SHEET.key,
      PLAYER_BALD_SHEET.key,
      'npc-owner',
      'npc-waiter',
      'npc-owner-f',
      'npc-waiter-f',
      'npc-waiter-walk',
      'npc-waiter-f-walk',
      'npc-owner-walk',
      'npc-owner-f-walk',
      'npc-bikini',
      'npc-bikini-walk',
    ]) {
      this.textures.get(key)?.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }

    this.cameras.main.setBackgroundColor('#2a221c')
    bindCameraZoom(this)
    this.roomLayer = this.add.container(0, 0)

    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E)

    this.prompt = crispText(
      this.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#000000cc',
          padding: { x: 12, y: 7 },
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setDepth(100),
    )

    this.title = crispText(
      this.add
        .text(0, 0, this.location.name, {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '22px',
          color: '#ffffff',
          stroke: '#1a1a2e',
          strokeThickness: 5,
        })
        .setOrigin(0.5, 0)
        .setDepth(100),
    )

    this.buildSpeechBubble()

    this.controls = new ControlsHelp(this, 'interior')

    this.input.keyboard!.on('keydown-M', () => {
      window.open(mapsUrl(this.location), '_blank', 'noopener,noreferrer')
    })

    this.layoutRoom(true)

    registerHud(this, this.controls.root)
    registerHud(this, this.prompt)
    registerHud(this, this.title)
    if (this.location.id === 'ktv-corner') {
      this.ktvMuteBtn = new KtvMuteButton(this, (muted) => this.setKtvMuted(muted))
      registerHud(this, this.ktvMuteBtn.root)
    }
    if (isTouchDevice()) {
      this.touch = new TouchControls(this)
      registerHud(this, this.touch.root)
      this.events.on(TOUCH_ACTION_EVENT, (action: TouchAction) => {
        if (action === 'interact') this.handleInteract()
      })
    }
    installHudCamera(this)

    this.layoutHud()
    this.events.on('controls-resized', () => this.layoutHud())

    // Home: player is the host — show greeting above their head
    if (this.location.kind === 'home') {
      this.showHomeGreeting()
    }

    this.startKtvMusic()
    this.setupInteriorMultiplayer()

    this.scale.on('resize', () => {
      const px = this.player?.sprite.x
      const py = this.player?.sprite.y
      const sitting = this.player?.isSitting ?? false
      const keepHomeLine = this.location.kind === 'home' && this.orderOpen
      this.hideOrder()
      this.layoutRoom(false)
      this.layoutHud()
      if (this.player && px != null && py != null) {
        this.player.sitAt(
          Phaser.Math.Clamp(px, 60, this.scale.width - 60),
          Phaser.Math.Clamp(py, 60, this.scale.height - 60),
          sitting ? 'up' : 'down',
        )
        if (!sitting) this.player.standUp()
      }
      if (keepHomeLine) this.showHomeGreeting()
    })
  }

  update(time: number, delta: number) {
    this.player.update(time, delta)
    for (const npc of this.npcs) npc.update()
    this.syncInteriorMultiplayer(time)
    for (const remote of this.remotes.values()) remote.update(delta)
    this.updateLocalHud()

    this.updateNearestSeat()
    this.updateSitService()
    this.refreshMassage()
    this.updateSpeechFollow()
    this.updateLedLights(delta)
    this.updatePrompt()

    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.handleInteract()
    }
  }

  private updateLedLights(delta: number) {
    if (this.ledLights.length === 0) return
    this.ledTick += delta
    if (this.ledTick < 120) return
    this.ledTick = 0
    for (const light of this.ledLights) {
      const c = this.ledColors[Math.floor(Math.random() * this.ledColors.length)]
      light.setFillStyle(c, 0.75 + Math.random() * 0.25)
      light.setScale(0.85 + Math.random() * 0.4)
    }
  }

  /** World-space speech bubble — sits above a sprite and follows it. */
  private buildSpeechBubble() {
    const wrapW = 280
    this.speechBg = this.add
      .rectangle(0, 0, wrapW + 24, 80, 0x12161c, 0.94)
      .setOrigin(0.5, 1)
      .setStrokeStyle(2, 0xffffff, 0.45)

    this.speechText = crispText(
      this.add
        .text(0, -18, '', {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '14px',
          color: '#fff8f0',
          align: 'center',
          wordWrap: { width: wrapW },
          lineSpacing: 4,
          stroke: '#0a0a0a',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1),
    )

    this.speechHint = crispText(
      this.add
        .text(0, -4, 'E — Đóng', {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '11px',
          color: '#c8d0d8',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1),
    )

    this.speechBubble = this.add
      .container(0, 0, [this.speechBg, this.speechText, this.speechHint])
      .setDepth(50)
      .setVisible(false)
  }

  private layoutHud() {
    const w = this.scale.width
    this.controls.layout()
    pinToScreen(this, this.title, w / 2, 8)
    this.ktvMuteBtn?.layout()
    this.touch?.layout()
  }

  private clearNpcs() {
    for (const npc of this.npcs) npc.destroy()
    this.npcs = []
    this.bedTherapists.clear()
  }

  private clearLeds() {
    for (const light of this.ledLights) light.destroy()
    this.ledLights = []
    this.ledTick = 0
  }

  private clearSeats() {
    this.seats = []
    this.nearestSeat = null
    this.seatedSeat = null
  }

  private layoutRoom(spawnPlayer: boolean) {
    const w = this.scale.width
    const h = this.scale.height
    const id = this.location.id
    const home = this.location.kind === 'home'
    const isKtv = id === 'ktv-corner'
    const isSpa = id === 'mat-xa-nguoi-mu'
    const female = FEMALE_STAFF_IDS.has(id)

    this.clearLeds()
    this.roomLayer.removeAll(true)
    this.clearNpcs()
    this.clearSeats()
    this.orderServing = false
    this.wasSitting = false
    this.owner = null
    this.waiter = null

    this.physics.world.setBounds(24, 24, w - 48, h - 48)
    this.cameras.main.setBounds(0, 0, w, h)
    this.cameras.main.setScroll(0, 0)
    this.cameras.main.stopFollow()

    if (home) {
      this.paintRoomShell(w, h, 0xd4c4a8, 0x6a5040)
      this.buildLivingRoom(w, h)
    } else if (isKtv) {
      this.paintRoomShell(w, h, 0x1a1028, 0x3a1848)
      this.buildKtvRoom(w, h)
    } else if (isSpa) {
      this.paintRoomShell(w, h, 0xc8d8e0, 0x6a8090)
      this.buildSpaRoom(w, h)
    } else {
      this.paintRoomShell(w, h, 0xc4a882, 0x5a4030)
      this.buildShopFront(w, h, female, 'Chủ quán', 'Phục vụ')
      this.buildDiningArea(w, h)
    }

    this.exitX = w / 2
    this.exitY = h - 48
    this.roomLayer.add(this.add.rectangle(this.exitX, this.exitY, 100, 40, 0x3a2a1a))
    this.roomLayer.add(
      crispText(
        this.add
          .text(this.exitX, this.exitY, 'CỬA', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '15px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )

    const titleSize = Math.round(Math.max(18, Math.min(26, w / 36)))
    this.title.setFontSize(titleSize)
    refreshCrispText(this.title)

    if (spawnPlayer || !this.player) {
      this.player = new Player(this, w / 2, h - 110)
      const profile = this.registry.get('profile') as PlayerProfile | undefined
      if (profile) this.player.applyAppearance(profile.bald, profile.shirtColor)
    }
    this.player.actionFlush = () => {
      this.lastNetSent = 0
      this.lastNetAnim = ''
      this.lastNetSmoking = false
    }
    this.player.sitInterceptor = () => this.trySitOrStand()
    this.player.setTargets(this.npcs)
  }

  private paintRoomShell(w: number, h: number, floor: number, wall: number) {
    this.roomLayer.add(this.add.rectangle(w / 2, h / 2, w, h, floor))
    this.roomLayer.add(this.add.rectangle(w / 2, 20, w, 40, wall))
    this.roomLayer.add(this.add.rectangle(w / 2, h - 20, w, 40, wall))
    this.roomLayer.add(this.add.rectangle(20, h / 2, 40, h, wall))
    this.roomLayer.add(this.add.rectangle(w - 20, h / 2, 40, h, wall))
  }

  /** Shop — counter + owner + staff. */
  private buildShopFront(
    w: number,
    h: number,
    female: boolean,
    ownerLabel: string,
    staffLabel: string,
  ) {
    const counterY = h * 0.16
    this.roomLayer.add(
      this.add.rectangle(w / 2, counterY, Math.min(520, w * 0.55), 56, this.location.color),
    )
    this.roomLayer.add(
      crispText(
        this.add
          .text(w / 2, counterY, female ? 'QUẦY LỄ TÂN' : 'QUẦY ORDER', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '18px',
            color: '#ffffff',
            stroke: '#1a1a2e',
            strokeThickness: 4,
          })
          .setOrigin(0.5),
      ),
    )

    this.counterSpot = { x: w / 2 + 70, y: counterY + 70 }
    this.owner = new Npc(this, w / 2 - 40, counterY + 58, ownerLabel, 'owner', female)
    this.waiter = new Npc(this, this.counterSpot.x, this.counterSpot.y, staffLabel, 'waiter', female)
    this.npcs.push(this.owner, this.waiter)
  }

  /** KTV — stage + DJ, dancers, bar, flashing LEDs, booth seats. */
  private buildKtvRoom(w: number, h: number) {
    const cx = w / 2
    const stageY = h * 0.22

    // Stage platform
    this.roomLayer.add(
      this.add.rectangle(cx, stageY, Math.min(520, w * 0.72), 110, 0x2a1840).setStrokeStyle(3, 0xff44cc),
    )
    this.roomLayer.add(this.add.rectangle(cx, stageY - 40, Math.min(420, w * 0.58), 18, 0x4a2868))
    this.roomLayer.add(
      crispText(
        this.add
          .text(cx, stageY - 58, 'SÂN KHẤU', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '16px',
            color: '#ff88ee',
            stroke: '#1a0a20',
            strokeThickness: 4,
          })
          .setOrigin(0.5),
      ),
    )

    // Flashing LED strip around stage
    const ledCount = 14
    const stageW = Math.min(500, w * 0.68)
    for (let i = 0; i < ledCount; i++) {
      const t = i / (ledCount - 1)
      const lx = cx - stageW / 2 + t * stageW
      const ly = stageY - 62
      const light = this.add.circle(lx, ly, 7, this.ledColors[i % this.ledColors.length], 0.9)
      light.setDepth(8)
      this.ledLights.push(light)
    }
    // Side LEDs
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const light = this.add.circle(
          cx + side * (stageW / 2 + 8),
          stageY - 30 + i * 22,
          6,
          this.ledColors[(i + 2) % this.ledColors.length],
          0.85,
        )
        light.setDepth(8)
        this.ledLights.push(light)
      }
    }

    // DJ booth (left of stage) + DJ
    const djX = cx - stageW * 0.32
    const djY = stageY + 8
    this.roomLayer.add(
      this.add.rectangle(djX, djY + 6, 78, 36, 0x1a1228).setStrokeStyle(2, 0x66e0ff),
    )
    this.roomLayer.add(this.add.rectangle(djX - 18, djY, 22, 14, 0x2a3040).setStrokeStyle(1, 0x88aacc))
    this.roomLayer.add(this.add.rectangle(djX + 18, djY, 22, 14, 0x2a3040).setStrokeStyle(1, 0x88aacc))
    this.roomLayer.add(this.add.circle(djX - 18, djY, 5, 0x44ddff, 0.9))
    this.roomLayer.add(this.add.circle(djX + 18, djY, 5, 0xff66cc, 0.9))
    this.roomLayer.add(
      crispText(
        this.add
          .text(djX, djY - 22, 'DJ', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '11px',
            color: '#88eeff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )
    this.npcs.push(new Npc(this, djX, djY + 22, 'DJ', 'dj', false, 0x88ddff))

    // Dancers on stage (bikini) — right of DJ
    const dancerTints = [0xff88cc, 0x88ddff, 0xffee88]
    for (let i = 0; i < 3; i++) {
      const dx = cx - 40 + i * 80
      const dy = stageY + 18
      const dancer = new Npc(this, dx, dy, 'Dancer', 'dancer', true, dancerTints[i])
      this.npcs.push(dancer)
    }

    // Reception / staff (female)
    this.counterSpot = { x: w * 0.16, y: h * 0.4 }
    this.roomLayer.add(
      this.add.rectangle(this.counterSpot.x, this.counterSpot.y - 20, 100, 40, 0x6a2a8a),
    )
    this.roomLayer.add(
      crispText(
        this.add
          .text(this.counterSpot.x, this.counterSpot.y - 20, 'LỄ TÂN', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )
    this.owner = new Npc(this, this.counterSpot.x - 30, this.counterSpot.y + 30, 'Chủ quán', 'owner', true)
    this.waiter = new Npc(this, this.counterSpot.x + 30, this.counterSpot.y + 30, 'Nhân viên', 'waiter', true)
    this.npcs.push(this.owner, this.waiter)

    // Bar — bán rượu (right side)
    const barX = w * 0.82
    const barY = h * 0.4
    this.roomLayer.add(
      this.add.rectangle(barX, barY, 130, 56, 0x3a2010).setStrokeStyle(3, 0xd4a050),
    )
    this.roomLayer.add(this.add.rectangle(barX, barY - 36, 120, 28, 0x2a1810).setStrokeStyle(2, 0x8a6040))
    // Bottles on back shelf
    const bottleColors = [0xff6644, 0x44cc88, 0xffdd44, 0xaa66ff, 0x66aaff, 0xff88aa]
    for (let i = 0; i < bottleColors.length; i++) {
      const bx = barX - 48 + i * 18
      this.roomLayer.add(this.add.rectangle(bx, barY - 40, 8, 18, bottleColors[i]))
      this.roomLayer.add(this.add.rectangle(bx, barY - 50, 5, 5, 0xe8e0d0))
    }
    this.roomLayer.add(
      crispText(
        this.add
          .text(barX, barY - 8, 'BAR · RƯỢU', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '13px',
            color: '#ffe8a0',
            stroke: '#1a0a00',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )
    this.npcs.push(new Npc(this, barX + 8, barY + 8, 'Bartender', 'bartender', true, 0xffcc88))
    // Bar stools
    for (let i = 0; i < 3; i++) {
      const sx = barX - 40 + i * 40
      const sy = barY + 42
      this.roomLayer.add(this.add.circle(sx, sy, 10, 0x4a3020).setStrokeStyle(2, 0x8a6840))
      this.addSeat(sx, sy + 4, 'up')
    }

    // Booth seats facing stage
    const boothY = h * 0.62
    const booths = w < 700 ? 2 : 3
    const span = Math.min(480, w * 0.55)
    const boothCx = w * 0.38
    for (let i = 0; i < booths; i++) {
      const bx = boothCx - span / 2 + (span / (booths - 1 || 1)) * i
      this.roomLayer.add(
        this.add.rectangle(bx, boothY, 100, 48, 0x3a2048).setStrokeStyle(2, 0xaa66cc),
      )
      this.addSeat(bx - 28, boothY + 8, 'up')
      this.addSeat(bx + 28, boothY + 8, 'up')
    }
  }

  /** Mát xa — 10 curtained beds; bikini staff only (no lễ tân). */
  private buildSpaRoom(w: number, h: number) {
    this.owner = null
    this.waiter = null
    this.counterSpot = { x: w / 2, y: h * 0.2 }

    const cols = 5
    const rows = 2
    const marginX = w * 0.1
    const usableW = w - marginX * 2
    const stepX = usableW / (cols - 1)
    const rowYs = [h * 0.36, h * 0.68]

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col + 1
        const bx = marginX + stepX * col
        const by = rowYs[row]
        this.addMassageBay(bx, by, index)
      }
    }

    // Keep a waiter ref for combat targets / fallback (first therapist)
    this.waiter = this.npcs[0] ?? null
  }

  private addMassageBay(x: number, y: number, index: number) {
    const curtainH = 130
    this.roomLayer.add(this.add.rectangle(x - 58, y, 5, curtainH, 0xe8f0f4).setStrokeStyle(1, 0xa0b0b8))
    this.roomLayer.add(this.add.rectangle(x + 58, y, 5, curtainH, 0xe8f0f4).setStrokeStyle(1, 0xa0b0b8))
    this.roomLayer.add(this.add.rectangle(x, y - curtainH / 2, 116, 7, 0xd0dce2))
    this.roomLayer.add(this.add.rectangle(x - 58, y, 14, curtainH - 14, 0xf2f8fa, 0.5))
    this.roomLayer.add(this.add.rectangle(x + 58, y, 14, curtainH - 14, 0xf2f8fa, 0.5))

    this.roomLayer.add(
      this.add.rectangle(x, y, 72, 100, 0xf0e6d8).setStrokeStyle(2, 0xb8a890),
    )
    this.roomLayer.add(this.add.rectangle(x, y - 40, 56, 18, 0xffffff).setStrokeStyle(1, 0xc8c0b0))
    this.roomLayer.add(
      crispText(
        this.add
          .text(x, y - 6, `${index}`, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '12px',
            color: '#3a4a5a',
            stroke: '#ffffff',
            strokeThickness: 2,
          })
          .setOrigin(0.5),
      ),
    )

    const therapist = new Npc(this, x + 38, y + 10, 'Nhân viên', 'therapist', true)
    this.npcs.push(therapist)

    // Bed is a lie spot (not a chair)
    this.addSeat(x, y + 8, 'up', { mode: 'lie', therapist, bedNo: index })
    this.bedTherapists.set(index, { npc: therapist, x, y: y + 8 })
  }

  /** Home — one living-room set; player is the host (no NPC). */
  private buildLivingRoom(w: number, h: number) {
    const cx = w / 2
    const cy = h * 0.48
    const tvY = h * 0.12

    // TV console on the north wall
    this.roomLayer.add(this.add.rectangle(cx, h * 0.14, Math.min(280, w * 0.4), 28, 0x3a2a22))
    this.roomLayer.add(this.add.rectangle(cx, tvY, Math.min(160, w * 0.22), 48, 0x1a1a22))
    this.roomLayer.add(
      crispText(
        this.add
          .text(cx, tvY, 'TIVI', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '13px',
            color: '#e8eef5',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )
    // Speech sits just below the TV
    this.tvAnchor = { x: cx, y: tvY + 40 }

    // Rug
    this.roomLayer.add(
      this.add
        .rectangle(cx, cy, Math.min(340, w * 0.55), Math.min(220, h * 0.32), 0xb89a78)
        .setStrokeStyle(2, 0x8a7048),
    )

    // Coffee table (one set)
    this.roomLayer.add(
      this.add.rectangle(cx, cy, 110, 70, 0x8b5a3c).setStrokeStyle(2, 0x5a3a28),
    )
    this.roomLayer.add(
      crispText(
        this.add
          .text(cx, cy, 'BÀN TRÀ', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '12px',
            color: '#fff8f0',
            stroke: '#2a1a10',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )

    // Sofa (south)
    this.roomLayer.add(
      this.add.rectangle(cx, cy + 95, 160, 42, 0x4a6a8a).setStrokeStyle(2, 0x2a3a4a),
    )
    this.addSeat(cx - 36, cy + 95, 'up')
    this.addSeat(cx + 36, cy + 95, 'up')

    // Armchairs left / right
    this.roomLayer.add(
      this.add.rectangle(cx - 120, cy, 44, 52, 0x6a5a4a).setStrokeStyle(2, 0x3a2a22),
    )
    this.addSeat(cx - 120, cy, 'right')
    this.roomLayer.add(
      this.add.rectangle(cx + 120, cy, 44, 52, 0x6a5a4a).setStrokeStyle(2, 0x3a2a22),
    )
    this.addSeat(cx + 120, cy, 'left')

    // Kitchenette (empty — host is the player)
    this.roomLayer.add(
      this.add.rectangle(w - 90, h * 0.28, 70, 90, 0x7a8a7a).setStrokeStyle(2, 0x3a4a3a),
    )
    this.roomLayer.add(
      crispText(
        this.add
          .text(w - 90, h * 0.22, 'BẾP', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '13px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      ),
    )
  }

  private showHomeGreeting() {
    const line = getOrderLine(this.location.id)
    if (!line) return
    this.showSpeech(line, { anchor: this.tvAnchor })
  }

  private trySitOrStand() {
    if (this.player.isSitting || this.player.isLying) {
      this.player.standUp()
      return true
    }
    if (this.nearestSeat) {
      this.seatedSeat = this.nearestSeat
      if (this.nearestSeat.mode === 'lie') {
        this.player.lieAt(this.nearestSeat.x, this.nearestSeat.y)
      } else {
        this.player.sitAt(this.nearestSeat.x, this.nearestSeat.y - 8, this.nearestSeat.facing)
      }
      return true
    }
    return false
  }

  private updateSitService() {
    if (this.location.kind === 'home') return

    const resting = this.player.isSitting || this.player.isLying
    if (resting && !this.wasSitting) {
      this.startWaiterOrder()
    } else if (!resting && this.wasSitting) {
      this.onPlayerStood()
    }
    this.wasSitting = resting
  }

  private startWaiterOrder() {
    const line = getOrderLine(this.location.id)
    if (!line || !this.seatedSeat) return
    if (this.orderServing) return

    this.orderServing = true
    const seat = this.seatedSeat

    // Spa: therapist at this bed speaks immediately (no walk)
    if (seat.mode === 'lie' && seat.therapist) {
      this.showSpeech(line, { follow: seat.therapist.sprite })
      this.startMassage(seat)
      return
    }

    const greeter = this.waiter
    if (!greeter) {
      this.orderServing = false
      return
    }

    const approachX = seat.x + (seat.facing === 'left' ? 36 : seat.facing === 'right' ? -36 : 0)
    const approachY = seat.y + (seat.facing === 'up' ? 40 : seat.facing === 'down' ? -40 : 28)

    greeter.goTo(approachX, approachY, () => {
      if (!this.player.isSitting && !this.player.isLying) {
        this.orderServing = false
        greeter.goHome()
        return
      }
      this.showSpeech(line, { follow: greeter.sprite })
    })
  }

  private startMassage(seat: Seat) {
    if (!seat.bedNo) return
    this.stopMassage()
    this.localBed = seat.bedNo
    this.mp?.sendBed(seat.bedNo)
    this.refreshMassage()
    this.scheduleMassageChat()
  }

  /** The lying player's client drives chatter for its bed and relays it. */
  private scheduleMassageChat() {
    this.massageChatTimer?.remove(false)
    this.massageChatTimer = this.time.delayedCall(Phaser.Math.Between(7000, 12000), () => {
      const bed = this.localBed
      if (!bed || !this.player.isLying) return
      let i = Phaser.Math.Between(0, MASSAGE_LINES.length - 1)
      if (MASSAGE_LINES.length > 1 && i === this.lastMassageLine) {
        i = (i + 1) % MASSAGE_LINES.length
      }
      this.lastMassageLine = i
      this.bedTherapists.get(bed)?.npc.say(MASSAGE_LINES[i])
      this.mp?.sendNpcSay(bed, i)
      this.scheduleMassageChat()
    })
  }

  private stopMassage() {
    this.massageChatTimer?.remove(false)
    this.massageChatTimer = null
    if (this.localBed) {
      this.localBed = 0
      this.mp?.sendBed(0)
    }
    this.refreshMassage()
  }

  /** Therapists knead whenever anyone (local or remote) is on their bed. */
  private refreshMassage() {
    if (this.bedTherapists.size === 0) return
    const occupied = new Set<number>()
    if (this.localBed) occupied.add(this.localBed)
    for (const [id, bed] of this.remoteBeds) {
      if (bed && this.remotes.has(id)) occupied.add(bed)
    }
    for (const [bed, spot] of this.bedTherapists) {
      if (occupied.has(bed)) {
        if (!spot.npc.isMassaging) spot.npc.startMassage(spot.x, spot.y)
      } else if (spot.npc.isMassaging) {
        spot.npc.stopMassage()
      }
    }
  }

  private onPlayerStood() {
    this.stopMassage()
    this.hideOrder()
    this.orderServing = false
    this.seatedSeat = null
    // Spa therapists stay at beds — only reception waiter walks home
    if (this.location.id !== 'mat-xa-nguoi-mu') {
      this.waiter?.goHome()
    }
  }

  private showSpeech(
    line: string,
    target: { follow?: Phaser.GameObjects.Sprite; anchor?: { x: number; y: number } },
  ) {
    this.orderOpen = true
    this.speechFollow = target.follow ?? null
    this.speechAnchor = target.anchor ?? null
    this.speechText.setText(line)
    refreshCrispText(this.speechText)

    const padX = 20
    const padY = 14
    const hintGap = 6
    const textH = this.speechText.height
    const boxW = Math.max(160, this.speechText.width + padX * 2)
    const boxH = textH + this.speechHint.height + hintGap + padY * 2

    this.speechBg.setSize(boxW, boxH)
    this.speechHint.setPosition(0, -padY)
    this.speechText.setPosition(0, -padY - this.speechHint.height - hintGap)
    refreshCrispText(this.speechHint)

    this.speechBubble.setVisible(true)
    this.updateSpeechFollow()
  }

  private updateSpeechFollow() {
    if (!this.orderOpen) return
    if (this.speechFollow?.active) {
      const headY = this.speechFollow.y - 52 * this.speechFollow.scaleY
      this.speechBubble.setPosition(Math.round(this.speechFollow.x), Math.round(headY))
      return
    }
    if (this.speechAnchor) {
      // Anchor is the top of the bubble (bg origin is bottom → place so bubble hangs under TV)
      const top = this.speechAnchor.y
      this.speechBubble.setPosition(
        Math.round(this.speechAnchor.x),
        Math.round(top + this.speechBg.height),
      )
    }
  }

  private hideOrder() {
    this.orderOpen = false
    this.speechFollow = null
    this.speechAnchor = null
    this.speechBubble.setVisible(false)
  }

  private buildDiningArea(w: number, h: number) {
    const cols = w < 700 ? 2 : 3
    const rows = 2
    const startY = h * 0.42
    const gapY = h * 0.24
    const marginX = w * 0.16
    const usableW = w - marginX * 2
    const stepX = cols <= 1 ? 0 : usableW / (cols - 1)

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = marginX + stepX * col
        const y = startY + row * gapY
        this.addTable(x, y)
      }
    }
  }

  private addSeat(
    x: number,
    y: number,
    facing: Seat['facing'],
    opts?: { mode?: 'sit' | 'lie'; therapist?: Npc; bedNo?: number },
  ) {
    const isLie = opts?.mode === 'lie'
    const marker = this.add
      .rectangle(x, y, isLie ? 36 : 28, isLie ? 20 : 28, isLie ? 0xc8b090 : 0x4a7c59)
      .setStrokeStyle(2, isLie ? 0x8a7050 : 0x2a4a32)
      .setAlpha(isLie ? 0.35 : 1)
    this.roomLayer.add(marker)
    this.seats.push({
      x,
      y,
      facing,
      occupiedByNpc: false,
      marker,
      mode: opts?.mode ?? 'sit',
      therapist: opts?.therapist,
      bedNo: opts?.bedNo,
    })
  }

  private addTable(x: number, y: number) {
    this.roomLayer.add(
      this.add.rectangle(x, y, 90, 60, 0x8b5a3c).setStrokeStyle(2, 0x5a3a28),
    )
    this.addSeat(x, y + 55, 'up')
    this.addSeat(x, y - 55, 'down')
    this.addSeat(x - 70, y, 'right')
    this.addSeat(x + 70, y, 'left')
  }

  private updateNearestSeat() {
    if (this.player.isSitting || this.player.isLying) {
      this.nearestSeat = null
      return
    }

    let best: Seat | null = null
    let bestDist = SIT_RADIUS + (this.location.id === 'mat-xa-nguoi-mu' ? 24 : 0)
    for (const seat of this.seats) {
      if (seat.occupiedByNpc) continue
      const d = Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        seat.x,
        seat.y,
      )
      if (d < bestDist) {
        bestDist = d
        best = seat
      }
    }
    this.nearestSeat = best
  }

  private pinPrompt() {
    const margin = 16
    pinToScreen(
      this,
      this.prompt,
      this.scale.width - this.prompt.width - margin,
      margin,
    )
  }

  private updatePrompt() {
    if (this.orderOpen) {
      this.prompt.setVisible(false)
      return
    }

    if (this.player.isSitting || this.player.isLying) {
      const waiting =
        this.orderServing && this.location.kind !== 'home' && this.location.id !== 'mat-xa-nguoi-mu'
          ? ' · Phục vụ đang tới…'
          : ''
      const action = this.player.isLying ? 'E / C — Dậy' : 'E / C — Đứng dậy'
      this.prompt.setText(`${action}${waiting}`).setVisible(true)
      refreshCrispText(this.prompt)
      this.pinPrompt()
      return
    }

    const nearExit =
      Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        this.exitX,
        this.exitY,
      ) < 80

    if (this.nearestSeat) {
      const tip =
        this.nearestSeat.mode === 'lie'
          ? 'E / C — Nằm giường'
          : this.location.kind === 'home'
            ? 'E / C — Ngồi'
            : 'E / C — Ngồi · gọi phục vụ'
      this.prompt.setText(tip).setVisible(true)
      refreshCrispText(this.prompt)
      this.pinPrompt()
      return
    }

    if (nearExit) {
      this.prompt.setText('E — Ra ngoài').setVisible(true)
      refreshCrispText(this.prompt)
      this.pinPrompt()
      return
    }

    this.prompt.setVisible(false)
  }

  private handleInteract() {
    if (this.orderOpen) {
      this.hideOrder()
      return
    }

    if (this.trySitOrStand()) return

    const nearExit =
      Phaser.Math.Distance.Between(
        this.player.sprite.x,
        this.player.sprite.y,
        this.exitX,
        this.exitY,
      ) < 80

    if (nearExit && !this.player.isSitting && !this.player.isLying) {
      this.returnToWorld()
    }
  }

  private returnToWorld() {
    this.stopMassage()
    this.stopKtvMusic()
    this.teardownInteriorMultiplayer()
    const payload = { spawnX: this.returnX, spawnY: this.returnY }
    this.scene.stop()
    if (this.scene.isSleeping('WorldScene')) {
      this.scene.wake('WorldScene', payload)
    } else {
      this.scene.start('WorldScene', payload)
    }
  }

  private startKtvMusic() {
    if (this.location.id !== 'ktv-corner') return
    const file = KTV_TRACKS[0]
    if (!file) return
    this.ktvAudio = ktvAudioElement(`/assets/audio/${file}`)
    this.ktvAudio.muted = this.ktvMuted

    this.game.events.on(Phaser.Core.Events.FOCUS, this.onKtvRefocus, this)
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.onKtvRefocus, this)

    // Online: wait for server timeline (first entrant starts it). Offline: play local.
    this.mp = (this.registry.get('mp') as MultiplayerClient | undefined) ?? null
    if (this.mp) {
      this.ktvAwaitingSync = true
      this.ktvFallbackTimer?.remove(false)
      this.ktvFallbackTimer = this.time.delayedCall(2500, () => {
        if (!this.ktvAwaitingSync) return
        this.ktvAwaitingSync = false
        const now = Date.now()
        this.applyKtvSync(now, now)
      })
      return
    }

    const now = Date.now()
    this.applyKtvSync(now, now)
  }

  private applyKtvSync(startedAt: number, serverNow: number) {
    if (this.location.id !== 'ktv-corner' || !this.ktvAudio) return

    this.ktvAwaitingSync = false
    this.ktvFallbackTimer?.remove(false)
    this.ktvFallbackTimer = null
    this.ktvClockSkew = serverNow - Date.now()
    this.ktvStartedAt = startedAt
    this.playKtvAtTimeline()
    this.ensureKtvResyncTimer()
  }

  private ensureKtvResyncTimer() {
    if (this.ktvResyncTimer) return
    this.ktvResyncTimer = this.time.addEvent({
      delay: 12000,
      loop: true,
      callback: () => this.correctKtvDrift(),
    })
  }

  private ktvServerNow() {
    return Date.now() + this.ktvClockSkew
  }

  private setKtvMuted(muted: boolean) {
    this.ktvMuted = muted
    if (this.ktvAudio) this.ktvAudio.muted = muted
  }

  private ktvDurationSec(): number {
    const d = this.ktvAudio?.duration ?? 0
    return Number.isFinite(d) && d > 0 ? d : 0
  }

  private ktvSeekSeconds(): number {
    const dur = this.ktvDurationSec()
    if (dur <= 0) return 0
    const elapsed = Math.max(0, (this.ktvServerNow() - this.ktvStartedAt) / 1000)
    return elapsed % dur
  }

  private playKtvAtTimeline() {
    const audio = this.ktvAudio
    if (!audio || !this.ktvStartedAt) return
    if (this.ktvDurationSec() > 0) {
      audio.currentTime = this.ktvSeekSeconds()
    } else {
      audio.addEventListener('loadedmetadata', this.onKtvMetadata, { once: true })
    }
    // Mobile browsers reject play() outside a user gesture — retry on the next tap/key.
    audio.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.waitForKtvGesture()
    })
  }

  private onKtvMetadata = () => this.correctKtvDrift()

  private waitForKtvGesture() {
    for (const ev of KTV_GESTURE_EVENTS) {
      document.addEventListener(ev, this.onKtvGesture, true)
    }
  }

  private clearKtvGesture() {
    for (const ev of KTV_GESTURE_EVENTS) {
      document.removeEventListener(ev, this.onKtvGesture, true)
    }
  }

  private onKtvGesture = () => {
    this.clearKtvGesture()
    this.playKtvAtTimeline()
  }

  private correctKtvDrift() {
    const audio = this.ktvAudio
    if (!audio || !this.ktvStartedAt || this.ktvDurationSec() <= 0) return
    const expected = this.ktvSeekSeconds()
    if (Math.abs(expected - audio.currentTime) > 0.85) {
      audio.currentTime = expected
    }
  }

  private onKtvRefocus() {
    if (this.ktvAudio?.paused && this.ktvStartedAt) {
      this.playKtvAtTimeline()
    } else {
      this.correctKtvDrift()
    }
  }

  private stopKtvMusic() {
    this.game.events.off(Phaser.Core.Events.FOCUS, this.onKtvRefocus, this)
    this.game.events.off(Phaser.Core.Events.VISIBLE, this.onKtvRefocus, this)
    this.stopKtvPlayback()
    this.ktvAudio?.removeEventListener('loadedmetadata', this.onKtvMetadata)
    this.ktvAudio = null

    this.ktvMuteBtn?.destroy()
    this.ktvMuteBtn = null
    this.ktvMuted = false
  }

  /** Stop playback only (stay in KTV UI) — last person left / server stop. */
  private stopKtvPlayback() {
    this.ktvAwaitingSync = false
    this.ktvFallbackTimer?.remove(false)
    this.ktvFallbackTimer = null
    this.ktvResyncTimer?.remove(false)
    this.ktvResyncTimer = null
    this.ktvStartedAt = 0
    this.clearKtvGesture()
    this.ktvAudio?.pause()
  }

  private setupInteriorMultiplayer() {
    this.zone = interiorZone(this.location.id)
    this.mp = (this.registry.get('mp') as MultiplayerClient | undefined) ?? null
    if (!this.mp) return

    const profile = this.registry.get('profile') as PlayerProfile | undefined
    const name = profile?.name ?? ''
    this.localName = crispText(
      this.add
        .text(this.player.sprite.x, this.player.sprite.y - 36, name, {
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
    this.localBubble = makeChatBubble(this, this.player.sprite.x, this.player.sprite.y - 52)

    this.mp.setHandlers({
      onSync: (players, selfId) => {
        const seen = new Set<string>()
        for (const p of players) {
          if (p.id === selfId) continue
          if (p.zone !== this.zone) continue
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
      onJoined: (p) => {
        if (p.zone !== this.zone) return
        this.upsertRemote(p)
        this.refreshPunchTargets()
      },
      onLeft: (id) => {
        this.remotes.get(id)?.destroy()
        this.remotes.delete(id)
        this.refreshPunchTargets()
      },
      onMoved: (m) => {
        if (m.zone !== this.zone) {
          this.remotes.get(m.id)?.destroy()
          this.remotes.delete(m.id)
          this.refreshPunchTargets()
          return
        }
        this.applyRemoteMove(m)
      },
      onZone: (p) => {
        if (p.zone !== this.zone) {
          this.remotes.get(p.id)?.destroy()
          this.remotes.delete(p.id)
          this.refreshPunchTargets()
          return
        }
        this.upsertRemote(p)
        this.refreshPunchTargets()
      },
      onChat: (id, name, text) => {
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
      onHit: (targetId, dirX, dirY, force) => {
        if (targetId === this.mp?.id) {
          this.player.applyKnockback(dirX, dirY, force)
          this.lastNetSent = 0
          this.lastNetAnim = ''
      this.lastNetSmoking = false
          return
        }
        this.remotes.get(targetId)?.applyKnockback(dirX, dirY, force)
      },
      onKtvSync: (startedAt, serverNow) => {
        if (this.location.id !== 'ktv-corner') return
        this.applyKtvSync(startedAt, serverNow)
      },
      onKtvStop: () => {
        if (this.location.id !== 'ktv-corner') return
        this.stopKtvPlayback()
      },
      onPlayerBed: (id, bed) => {
        if (bed) this.remoteBeds.set(id, bed)
        else this.remoteBeds.delete(id)
      },
      onNpcSay: (zone, bed, line) => {
        if (zone !== this.zone) return
        const text = MASSAGE_LINES[line]
        if (text) this.bedTherapists.get(bed)?.npc.say(text)
      },
    })

    // Exact interior spawn (WorldScene sent a temporary door pos)
    this.mp.sendZone(this.zone, this.player.sprite.x, this.player.sprite.y)
    this.mp.requestSync()
    this.lastNetX = this.player.sprite.x
    this.lastNetY = this.player.sprite.y
    this.registry.set('sendChat', (text: string) => this.mp?.sendChat(text))

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearRemotes()
    })
  }

  private teardownInteriorMultiplayer() {
    if (this.mp) {
      this.mp.sendZone(OVERWORLD_ZONE, this.returnX, this.returnY)
    }
    this.clearRemotes()
    this.localName?.destroy()
    this.localBubble?.destroy()
  }

  private clearRemotes() {
    for (const r of this.remotes.values()) r.destroy()
    this.remotes.clear()
    this.remoteBeds.clear()
  }

  private upsertRemote(p: PlayerPublic) {
    if (p.zone !== this.zone) return
    if (p.bed) this.remoteBeds.set(p.id, p.bed)
    else this.remoteBeds.delete(p.id)
    const existing = this.remotes.get(p.id)
    if (existing) {
      existing.applyFull(p)
      return
    }
    this.remotes.set(p.id, new RemotePlayer(this, p))
  }

  private applyRemoteMove(m: PlayerMove) {
    if (m.zone !== this.zone) return
    const remote = this.remotes.get(m.id)
    if (remote) remote.applyMove(m)
  }

  private refreshPunchTargets() {
    const mp = this.mp
    this.player.setTargets([
      ...this.npcs,
      ...[...this.remotes.values()].map((remote) => ({
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
    ])
  }

  private publishOnline(players: PlayerPublic[], selfId: string) {
    const list = players.map((p) => ({
      id: p.id,
      name: p.name,
      self: p.id === selfId,
    }))
    window.dispatchEvent(new CustomEvent('sm-players', { detail: list }))
  }

  private updateLocalHud() {
    if (!this.localName) return
    const x = this.player.sprite.x
    const y = this.player.sprite.y
    this.localName.setPosition(Math.round(x), Math.round(y - 36))
    snapBubble(this.localBubble, x, y - 54)
    if (this.localBubble.visible && performance.now() > this.localBubbleUntil) {
      this.localBubble.setVisible(false)
    }
  }

  private syncInteriorMultiplayer(time: number) {
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
}
