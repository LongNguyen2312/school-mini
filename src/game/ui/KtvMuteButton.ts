import Phaser from 'phaser'
import { pinToScreen } from './pinToScreen'

const BTN = 44
const MARGIN = 16

const active = new Set<KtvMuteButton>()

/**
 * Top-right mute toggle for KTV BGM — screen-pinned, HUD-safe hit test.
 */
export class KtvMuteButton {
  private readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private readonly bg: Phaser.GameObjects.Graphics
  private readonly icon: Phaser.GameObjects.Graphics
  private muted = false
  private readonly onChange: (muted: boolean) => void
  private screenX = 0
  private screenY = MARGIN
  private hover = false

  constructor(scene: Phaser.Scene, onChange: (muted: boolean) => void) {
    this.scene = scene
    this.onChange = onChange

    this.bg = scene.add.graphics()
    this.icon = scene.add.graphics()
    this.redraw()

    this.root = scene.add.container(0, 0, [this.bg, this.icon])
    this.root.setDepth(200)
    this.root.setSize(BTN, BTN)

    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointermove', this.onPointerMove)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)

    active.add(this)
    this.layout()
  }

  get isMuted() {
    return this.muted
  }

  static blocksPointer(pointer: Phaser.Input.Pointer) {
    for (const btn of active) {
      if (btn.containsScreen(pointer.x, pointer.y)) return true
    }
    return false
  }

  layout() {
    this.screenX = this.scene.scale.width - MARGIN - BTN
    this.screenY = MARGIN
    pinToScreen(this.scene, this.root, this.screenX, this.screenY)
  }

  destroy() {
    this.onShutdown()
    this.root.destroy(true)
  }

  private containsScreen(x: number, y: number) {
    return (
      x >= this.screenX &&
      x < this.screenX + BTN &&
      y >= this.screenY &&
      y < this.screenY + BTN
    )
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (!pointer.leftButtonDown()) return
    if (!this.containsScreen(pointer.x, pointer.y)) return
    this.muted = !this.muted
    this.redraw()
    this.onChange(this.muted)
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    const over = this.containsScreen(pointer.x, pointer.y)
    if (over !== this.hover) {
      this.hover = over
      this.redraw()
    }
    if (over) this.scene.input.setDefaultCursor('pointer')
  }

  private redraw() {
    this.bg.clear()
    const fill = this.muted ? 0x3a2428 : 0x12161c
    this.bg.fillStyle(fill, this.hover ? 0.98 : 0.92)
    this.bg.fillRoundedRect(0, 0, BTN, BTN, 10)
    this.bg.lineStyle(2, this.muted ? 0xff8899 : 0xffffff, this.hover ? 0.55 : 0.35)
    this.bg.strokeRoundedRect(0, 0, BTN, BTN, 10)

    this.icon.clear()
    const cx = BTN / 2
    const cy = BTN / 2
    const color = this.muted ? 0xffb0bc : 0xf2f5f8

    // Speaker body
    this.icon.fillStyle(color, 1)
    this.icon.fillTriangle(cx - 8, cy - 5, cx - 8, cy + 5, cx - 2, cy + 5)
    this.icon.fillTriangle(cx - 8, cy - 5, cx - 2, cy - 5, cx - 2, cy + 5)
    this.icon.fillRect(cx - 2, cy - 7, 4, 14)

    if (this.muted) {
      this.icon.lineStyle(2.5, color, 1)
      this.icon.lineBetween(cx + 4, cy - 8, cx + 12, cy + 8)
      this.icon.lineBetween(cx + 12, cy - 8, cx + 4, cy + 8)
    } else {
      this.icon.lineStyle(2, color, 0.95)
      this.icon.beginPath()
      this.icon.arc(cx + 1, cy, 6, -0.7, 0.7, false)
      this.icon.strokePath()
      this.icon.beginPath()
      this.icon.arc(cx + 1, cy, 10, -0.7, 0.7, false)
      this.icon.strokePath()
    }
  }

  private onShutdown = () => {
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    active.delete(this)
  }
}
