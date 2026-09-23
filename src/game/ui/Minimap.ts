import Phaser from 'phaser'
import { MINIMAP_MARGIN, MINIMAP_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../config'
import { computeRoadLayout, type PlacedLocation } from '../data/geo'
import { crispText } from './crispText'
import { pinToScreen } from './pinToScreen'

/** Same colors as WorldScene. */
const PLAZA = 0xd4c4a8
const TREE = 0x3d7a45
const TREE_LIGHT = 0x4a9054

const SHORT_LABEL: Record<string, string> = {
  'home-tan-binh': '66B',
  'nhau-tc': 'Nhậu',
  'che-cau-nguyet': 'Chè',
  'ga-nguyen-con': 'Gà',
  'bun-chi-rau': 'Bún',
  'mat-xa-nguoi-mu': 'MX',
  'ktv-corner': 'KTV',
}

type NavigateFn = (worldX: number, worldY: number) => void
type FollowTargetFn = () => Phaser.GameObjects.GameObject

const activeMinimaps = new Set<Minimap>()

/**
 * Bottom-right mini-map: grass/path + hub colors matching the overworld.
 * Left-drag = peek camera (character stays). Right-click = walk there.
 */
export class Minimap {
  private readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private readonly playerDot: Phaser.GameObjects.Arc
  private readonly viewRect: Phaser.GameObjects.Rectangle
  private readonly size: number
  private readonly pad = 6
  private readonly onNavigate: NavigateFn
  private readonly getFollowTarget: FollowTargetFn
  private screenX = 0
  private screenY = 0
  private peeking = false

  constructor(
    scene: Phaser.Scene,
    hubs: PlacedLocation[],
    onNavigate: NavigateFn,
    getFollowTarget: FollowTargetFn,
  ) {
    this.scene = scene
    this.size = MINIMAP_SIZE
    this.onNavigate = onNavigate
    this.getFollowTarget = getFollowTarget

    const p = this.pad
    const inner = this.inner()
    const scaleX = inner / WORLD_WIDTH
    const scaleY = inner / WORLD_HEIGHT

    const content: Phaser.GameObjects.GameObject[] = []

    const grass = scene.add
      .tileSprite(p, p, inner, inner, 'grass')
      .setOrigin(0)
      .setTileScale(scaleX * 4, scaleY * 4)
    content.push(grass)

    // Roads from 66B to each shop (axis-aligned L paths)
    const pathKey = scene.textures.exists('path-seam') ? 'path-seam' : 'path'
    if (hubs.length > 0) {
      const layout = computeRoadLayout(hubs)
      const { ROAD, segs, junctions } = layout
      for (const s of segs) {
        content.push(...this.makeRoadSprites(s.x1, s.y1, s.x2, s.y2, scaleX, scaleY, pathKey, ROAD))
      }
      for (const j of junctions) {
        content.push(...this.makeJunction(j.x, j.y, scaleX, scaleY, pathKey, ROAD))
      }
    }

    const overlay = scene.add.graphics()
    for (const hub of hubs) this.paintHub(overlay, hub)
    content.push(overlay)

    for (const hub of hubs) content.push(this.makeLabel(hub))

    this.viewRect = scene.add
      .rectangle(0, 0, 20, 14, 0xffffff, 0)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xffffff, 0.9)
    content.push(this.viewRect)

    this.playerDot = scene.add.circle(0, 0, 3.5, 0x4ade80).setStrokeStyle(1.5, 0xffffff, 1)
    content.push(this.playerDot)

    const mapLayer = scene.add.container(0, 0, content)

    // Phaser 4 WebGL: GeometryMask / setMask is unsupported (Canvas only).
    // Frame already clips the map visually — skip mask to avoid blank render.

    const frame = scene.add
      .rectangle(0, 0, this.size, this.size, 0x1c2418, 1)
      .setOrigin(0)
      .setStrokeStyle(2, 0xffffff, 0.65)

    const titleBg = scene.add.rectangle(p + 2, p + 2, 34, 13, 0x0f160e, 0.5).setOrigin(0)
    const title = crispText(
      scene.add
        .text(p + 6, p + 4, 'MAP', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '9px',
          color: '#f0f7ea',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0),
    )

    this.root = scene.add.container(0, 0, [frame, mapLayer, titleBg, title])
    this.root.setDepth(200)

    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointermove', this.onPointerMove)
    scene.input.on('pointerup', this.onPointerUp)
    scene.input.on('pointerupoutside', this.onPointerUp)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)
    activeMinimaps.add(this)

    this.layout()
    scene.scale.on('resize', () => this.layout())
  }

  static blocksPointer(pointer: Phaser.Input.Pointer) {
    for (const map of activeMinimaps) {
      if (map.isPeeking || map.containsScreen(pointer.x, pointer.y)) return true
    }
    return false
  }

  get isPeeking() {
    return this.peeking
  }

  update(playerX: number, playerY: number) {
    const { mx, my } = this.worldToMini(playerX, playerY)
    this.playerDot.setPosition(mx, my)

    const cam = this.scene.cameras.main
    const view = cam.worldView
    const { mx: vx, my: vy } = this.worldToMini(view.centerX, view.centerY)
    const halfW = (view.width / WORLD_WIDTH) * this.inner() * 0.5
    const halfH = (view.height / WORLD_HEIGHT) * this.inner() * 0.5
    this.viewRect.setPosition(vx, vy)
    this.viewRect.setSize(Math.max(10, halfW * 2), Math.max(8, halfH * 2))
    this.viewRect.setStrokeStyle(1, this.peeking ? 0xffe066 : 0xffffff, this.peeking ? 1 : 0.9)
  }

  relayout() {
    this.layout()
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!this.containsScreen(pointer.x, pointer.y)) return

    if (pointer.rightButtonDown()) {
      const world = this.screenToWorld(pointer.x, pointer.y)
      if (!world) return
      this.onNavigate(world.x, world.y)
      return
    }

    if (!pointer.leftButtonDown()) return
    const world = this.screenToWorldClamped(pointer.x, pointer.y)
    this.beginPeek(world.x, world.y)
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (this.peeking && pointer.leftButtonDown()) {
      const world = this.screenToWorldClamped(pointer.x, pointer.y)
      this.scene.cameras.main.centerOn(world.x, world.y)
      this.scene.input.setDefaultCursor('grabbing')
      return
    }
    if (this.containsScreen(pointer.x, pointer.y)) {
      this.scene.input.setDefaultCursor('pointer')
    }
  }

  private onPointerUp = (_pointer: Phaser.Input.Pointer) => {
    if (!this.peeking) return
    this.endPeek()
  }

  private beginPeek(worldX: number, worldY: number) {
    this.peeking = true
    const cam = this.scene.cameras.main
    cam.stopFollow()
    cam.centerOn(worldX, worldY)
    this.scene.input.setDefaultCursor('grabbing')
  }

  private endPeek() {
    this.peeking = false
    const target = this.getFollowTarget()
    this.scene.cameras.main.startFollow(target, false, 1, 1)
    this.scene.input.setDefaultCursor('default')
  }

  private onShutdown = () => {
    if (this.peeking) this.endPeek()
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    this.scene.input.off('pointerup', this.onPointerUp)
    this.scene.input.off('pointerupoutside', this.onPointerUp)
    activeMinimaps.delete(this)
  }

  private containsScreen(x: number, y: number) {
    return (
      x >= this.screenX &&
      x < this.screenX + this.size &&
      y >= this.screenY &&
      y < this.screenY + this.size
    )
  }

  private screenToWorld(screenX: number, screenY: number) {
    const lx = screenX - this.screenX
    const ly = screenY - this.screenY
    const p = this.pad
    const inner = this.inner()
    if (lx < p || ly < p || lx >= p + inner || ly >= p + inner) return null

    return {
      x: ((lx - p) / inner) * WORLD_WIDTH,
      y: ((ly - p) / inner) * WORLD_HEIGHT,
    }
  }

  /** Peek drag — clamp to map so dragging past the edge still pans. */
  private screenToWorldClamped(screenX: number, screenY: number) {
    const lx = screenX - this.screenX
    const ly = screenY - this.screenY
    const p = this.pad
    const inner = this.inner()
    const cx = Phaser.Math.Clamp(lx, p, p + inner)
    const cy = Phaser.Math.Clamp(ly, p, p + inner)
    return {
      x: ((cx - p) / inner) * WORLD_WIDTH,
      y: ((cy - p) / inner) * WORLD_HEIGHT,
    }
  }
  /** Axis-aligned only — seamless texture, segments overlap by full road width. */
  private makeRoadSprites(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    scaleX: number,
    scaleY: number,
    pathKey = 'path-seam',
    road = 56,
  ) {
    const mid = this.worldToMini((x1 + x2) / 2, (y1 + y2) / 2)
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const horizontal = dx >= dy
    const worldW = horizontal ? dx + road : road
    const worldH = horizontal ? road : dy + road
    const sprite = this.scene.add.tileSprite(0, 0, worldW, worldH, pathKey)
    sprite.setPosition(mid.mx, mid.my)
    sprite.setDisplaySize(this.s(worldW), this.sy(worldH))
    sprite.setTileScale(scaleX, scaleY)
    sprite.setAlpha(0.95)
    return [sprite]
  }

  private makeJunction(
    x: number,
    y: number,
    scaleX: number,
    scaleY: number,
    pathKey = 'path-seam',
    road = 56,
  ) {
    const mid = this.worldToMini(x, y)
    const sprite = this.scene.add.tileSprite(0, 0, road, road, pathKey)
    sprite.setPosition(mid.mx, mid.my)
    sprite.setDisplaySize(this.s(road), this.sy(road))
    sprite.setTileScale(scaleX, scaleY)
    sprite.setAlpha(0.95)
    return [sprite]
  }

  private paintHub(g: Phaser.GameObjects.Graphics, hub: PlacedLocation) {
    const { x, y, kind } = hub
    const ground = this.worldToMini(x - 210, y - 150)
    const gw = this.s(420)
    const gh = this.sy(340)

    g.fillStyle(hub.groundColor, 0.5)
    g.fillRect(ground.mx, ground.my, gw, gh)
    g.lineStyle(1, 0x2a3a2a, 0.6)
    g.strokeRect(ground.mx, ground.my, gw, gh)

    const plaza = this.worldToMini(x, y + 70)
    g.fillStyle(PLAZA, 0.95)
    g.fillEllipse(plaza.mx, plaza.my, Math.max(4, this.s(200)), Math.max(3, this.sy(70)))

    if (kind === 'restaurant') {
      const bw = this.s(200)
      const bh = this.sy(110)
      const b = this.worldToMini(x - 100, y - 20 - 55)
      g.fillStyle(hub.color, 1)
      g.fillRect(b.mx, b.my, bw, bh)
      const roof = Phaser.Display.Color.IntegerToColor(hub.color).darken(45).color
      g.fillStyle(roof, 1)
      g.fillRect(b.mx - 2, b.my - 4, bw + 4, Math.max(3, bh * 0.22))
      g.fillStyle(0x2a2018, 1)
      g.fillRect(b.mx + 4, b.my + bh * 0.4, bw - 8, bh * 0.45)
    } else if (kind === 'ktv') {
      const bw = this.s(210)
      const bh = this.sy(130)
      const b = this.worldToMini(x - 105, y - 16 - 65)
      g.fillStyle(0x1a1224, 1)
      g.fillRect(b.mx, b.my, bw, bh)
      g.fillStyle(0xff44cc, 0.85)
      g.fillRect(b.mx + 4, b.my + 2, bw - 8, Math.max(2, bh * 0.18))
      g.fillStyle(0x4a1868, 1)
      g.fillRect(b.mx + 6, b.my + bh * 0.45, bw - 12, bh * 0.4)
    } else {
      const bw = this.s(kind === 'hometown' ? 210 : 190)
      const bh = this.sy(kind === 'hometown' ? 150 : 130)
      const halfW = kind === 'hometown' ? 105 : 95
      const halfH = kind === 'hometown' ? 75 : 65
      const b = this.worldToMini(x - halfW, y - 10 - halfH)
      g.fillStyle(hub.color, 1)
      g.fillRect(b.mx, b.my, bw, bh)
      const roof = Phaser.Display.Color.IntegerToColor(hub.color).darken(40).color
      g.fillStyle(roof, 1)
      // Simple peaked roof as triangle on minimap
      const top = this.worldToMini(x, y - 10 - halfH - 40)
      g.fillTriangle(b.mx - 2, b.my, b.mx + bw + 2, b.my, top.mx, top.my)
      g.fillStyle(0x3a2a1a, 1)
      const door = this.worldToMini(x - 12, y - 10 + halfH - 28)
      g.fillRect(door.mx, door.my, this.s(24), this.sy(28))
    }

    this.paintDecor(g, hub)
  }

  private paintDecor(g: Phaser.GameObjects.Graphics, hub: PlacedLocation) {
    const { x, y, kind } = hub

    if (kind === 'home') {
      this.paintTree(g, x - 150, y - 5)
    } else if (kind === 'hometown') {
      this.paintTree(g, x - 170, y - 20)
      this.paintTree(g, x + 175, y + 30)
      const field = this.worldToMini(x + 140, y)
      g.fillStyle(0x8fbc5a, 1)
      g.fillRect(field.mx, field.my, this.s(120), this.sy(80))
    } else if (kind === 'ktv') {
      this.paintTree(g, x + 180, y + 20)
    } else if (hub.id !== 'mat-xa-nguoi-mu') {
      this.paintTree(g, x - 165, y - 10)
    }
  }

  private paintTree(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    const c = this.worldToMini(x, y)
    const r = Math.max(2, this.s(22))
    g.fillStyle(TREE, 1)
    g.fillCircle(c.mx, c.my - r * 0.3, r)
    g.fillStyle(TREE_LIGHT, 0.85)
    g.fillCircle(c.mx - r * 0.3, c.my, r * 0.55)
  }

  private makeLabel(hub: PlacedLocation) {
    const text = SHORT_LABEL[hub.id] ?? hub.shortName.slice(0, 4)
    const halfH =
      hub.kind === 'restaurant' ? 55 : hub.kind === 'ktv' ? 65 : hub.kind === 'hometown' ? 75 : 65
    const buildingTop = this.worldToMini(hub.x, hub.y - 10 - halfH - 30)

    const label = crispText(
      this.scene.add
        .text(0, 0, text, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '9px',
          color: '#ffffff',
          stroke: '#1a1a2e',
          strokeThickness: 3,
          align: 'center',
        })
        .setOrigin(0.5, 1),
    )

    const margin = this.pad + 12
    const mx = Phaser.Math.Clamp(buildingTop.mx, margin, this.size - margin)
    const my = Phaser.Math.Clamp(buildingTop.my - 2, this.pad + 18, this.size - this.pad - 4)
    label.setPosition(mx, my)
    return label
  }

  private inner() {
    return this.size - this.pad * 2
  }

  private s(worldUnits: number) {
    return (worldUnits / WORLD_WIDTH) * this.inner()
  }

  private sy(worldUnits: number) {
    return (worldUnits / WORLD_HEIGHT) * this.inner()
  }

  private worldToMini(x: number, y: number) {
    const inner = this.inner()
    return {
      mx: this.pad + (x / WORLD_WIDTH) * inner,
      my: this.pad + (y / WORLD_HEIGHT) * inner,
    }
  }

  private layout() {
    this.screenX = this.scene.scale.width - this.size - MINIMAP_MARGIN
    this.screenY = this.scene.scale.height - this.size - MINIMAP_MARGIN
    pinToScreen(this.scene, this.root, this.screenX, this.screenY)
  }
}
