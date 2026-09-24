import Phaser from 'phaser'
import { crispText } from './crispText'
import { pinToScreen } from './pinToScreen'
import { isTouchDevice } from './TouchControls'

type HelpVariant = 'world' | 'interior'

const WORLD_ROWS: [string, string][] = [
  ['WASD', 'Di chuyển'],
  ['Shift', 'Chạy nhanh'],
  ['R-Click', 'Đi tới chỗ click'],
  ['L-Click', 'Đấm'],
  ['Map L-kéo', 'Xem map (thả về NV)'],
  ['Space', 'Nhảy'],
  ['Q', 'Nhảy múa'],
  ['C', 'Ngồi / đứng'],
  ['Z', 'Nằm / dậy'],
  ['R', 'Hút thuốc (bật/tắt)'],
  ['E', 'Tương tác'],
  ['Scroll', 'Zoom in / out'],
]

const INTERIOR_ROWS: [string, string][] = [
  ['WASD', 'Di chuyển'],
  ['Shift', 'Chạy nhanh'],
  ['R-Click', 'Đi tới chỗ click'],
  ['L-Click', 'Đấm'],
  ['Space', 'Nhảy'],
  ['Q', 'Nhảy múa'],
  ['C', 'Ngồi / đứng'],
  ['Z', 'Nằm / dậy'],
  ['R', 'Hút thuốc (bật/tắt)'],
  ['E', 'Ra ngoài'],
  ['M', 'Mở Google Maps'],
  ['Scroll', 'Zoom in / out'],
]

const PANEL_W = 228
const HEADER_H = 36
const PAD_X = 14
const ROW_H = 22
const KEY_W = 64
const FOOTER_H = 10
const SCREEN_X = 16
const SCREEN_Y = 16

const activePanels = new Set<ControlsHelp>()

/**
 * Expandable top-left controls panel — screen-pinned, ignores camera zoom.
 * Clicks use screen-space hit tests (container scale breaks Phaser input).
 */
export class ControlsHelp {
  private readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container

  private readonly bg: Phaser.GameObjects.Graphics
  private readonly titleText: Phaser.GameObjects.Text
  private readonly chevron: Phaser.GameObjects.Text
  private readonly hint: Phaser.GameObjects.Text
  private readonly body: Phaser.GameObjects.Container
  private readonly rows: Phaser.GameObjects.Container[]

  private expanded = false
  private animating = false

  constructor(scene: Phaser.Scene, variant: HelpVariant = 'world') {
    this.scene = scene
    const data = variant === 'world' ? WORLD_ROWS : INTERIOR_ROWS

    this.bg = scene.add.graphics()

    this.titleText = crispText(
      scene.add
        .text(PAD_X, HEADER_H / 2, 'Điều khiển', {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '14px',
          color: '#f2f5f8',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5),
    )

    this.chevron = crispText(
      scene.add
        .text(PANEL_W - PAD_X, HEADER_H / 2, '▸', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '13px',
          color: '#7ddea8',
        })
        .setOrigin(1, 0.5),
    )

    this.hint = crispText(
      scene.add
        .text(PAD_X + 92, HEADER_H / 2, 'bấm để mở', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '11px',
          color: '#8b95a3',
        })
        .setOrigin(0, 0.5),
    )

    this.rows = data.map(([key, label], i) => this.makeRow(key, label, i))
    this.body = scene.add.container(0, HEADER_H, this.rows)
    this.body.setAlpha(0)
    this.body.setVisible(false)

    this.root = scene.add.container(0, 0, [
      this.bg,
      this.titleText,
      this.chevron,
      this.hint,
      this.body,
    ])
    this.root.setDepth(200)
    this.root.setSize(PANEL_W, HEADER_H)

    this.drawPanel(HEADER_H)

    this.layout()
    // Keyboard shortcuts are meaningless on phones — on-screen buttons replace them.
    if (isTouchDevice()) {
      this.root.setVisible(false)
      return
    }

    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointermove', this.onPointerMove)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)

    activePanels.add(this)
  }

  /** True when the pointer is over any open controls panel (blocks world clicks). */
  static blocksPointer(pointer: Phaser.Input.Pointer) {
    for (const panel of activePanels) {
      if (panel.containsScreen(pointer.x, pointer.y)) return true
    }
    return false
  }

  /** Collapsed/expanded height for stacking other HUD below. */
  get panelHeight() {
    if (!this.expanded) return HEADER_H
    return HEADER_H + this.rows.length * ROW_H + FOOTER_H
  }

  layout() {
    pinToScreen(this.scene, this.root, SCREEN_X, SCREEN_Y)
  }

  private containsScreen(x: number, y: number) {
    return (
      x >= SCREEN_X &&
      x < SCREEN_X + PANEL_W &&
      y >= SCREEN_Y &&
      y < SCREEN_Y + this.panelHeight
    )
  }

  private containsHeader(x: number, y: number) {
    return (
      x >= SCREEN_X &&
      x < SCREEN_X + PANEL_W &&
      y >= SCREEN_Y &&
      y < SCREEN_Y + HEADER_H
    )
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.leftButtonDown()) return
    if (!this.containsHeader(pointer.x, pointer.y)) return
    this.toggle()
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (!this.expanded && this.containsHeader(pointer.x, pointer.y)) {
      this.hint.setColor('#b7c2cf')
      this.scene.input.setDefaultCursor('pointer')
    } else {
      this.hint.setColor('#8b95a3')
      if (!this.containsScreen(pointer.x, pointer.y)) {
        this.scene.input.setDefaultCursor('default')
      }
    }
  }

  private onShutdown = () => {
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    activePanels.delete(this)
  }

  private makeRow(key: string, label: string, index: number) {
    const y = index * ROW_H
    const chip = this.scene.add
      .rectangle(PAD_X, y + 3, KEY_W, 16, 0x24303c, 1)
      .setOrigin(0)
      .setStrokeStyle(1, 0x3d4f5f, 1)

    const keyText = crispText(
      this.scene.add
        .text(PAD_X + KEY_W / 2, y + 11, key, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '11px',
          color: '#98e6bc',
        })
        .setOrigin(0.5),
    )

    const labelText = crispText(
      this.scene.add
        .text(PAD_X + KEY_W + 10, y + 11, label, {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: '12px',
          color: '#d5dde6',
        })
        .setOrigin(0, 0.5),
    )

    return this.scene.add.container(0, 0, [chip, keyText, labelText])
  }

  private drawPanel(height: number) {
    const g = this.bg
    g.clear()
    g.fillStyle(0x000000, 0.22)
    g.fillRoundedRect(2, 3, PANEL_W, height, 10)
    g.fillStyle(0x161c24, 0.94)
    g.fillRoundedRect(0, 0, PANEL_W, height, 10)
    g.lineStyle(1, 0xffffff, 0.1)
    g.strokeRoundedRect(0, 0, PANEL_W, height, 10)
    g.fillStyle(0x4ade80, 0.95)
    g.fillRoundedRect(0, 0, 3, height, { tl: 10, bl: 10, tr: 0, br: 0 })
    if (height > HEADER_H + 4) {
      g.lineStyle(1, 0xffffff, 0.08)
      g.lineBetween(PAD_X - 2, HEADER_H - 1, PANEL_W - PAD_X + 2, HEADER_H - 1)
    }
  }

  private toggle() {
    if (this.animating) return
    this.expanded = !this.expanded
    this.animating = true

    const targetH = this.panelHeight
    const startH = this.expanded
      ? HEADER_H
      : HEADER_H + this.rows.length * ROW_H + FOOTER_H

    this.chevron.setText(this.expanded ? '▾' : '▸')
    this.chevron.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.hint.setVisible(!this.expanded)

    if (this.expanded) {
      this.body.setVisible(true)
      this.body.setAlpha(0)
      this.scene.tweens.add({
        targets: this.body,
        alpha: 1,
        duration: 180,
        ease: 'Sine.Out',
      })
    } else {
      this.scene.tweens.add({
        targets: this.body,
        alpha: 0,
        duration: 140,
        ease: 'Sine.In',
        onComplete: () => this.body.setVisible(false),
      })
    }

    const proxy = { h: startH }
    this.scene.tweens.add({
      targets: proxy,
      h: targetH,
      duration: 220,
      ease: 'Cubic.Out',
      onUpdate: () => this.drawPanel(proxy.h),
      onComplete: () => {
        this.drawPanel(targetH)
        this.animating = false
        this.scene.events.emit('controls-resized')
      },
    })
  }
}
