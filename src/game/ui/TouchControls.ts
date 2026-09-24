import Phaser from 'phaser'
import { crispText } from './crispText'
import { pinToScreen } from './pinToScreen'

export type TouchAction = 'interact' | 'punch' | 'jump' | 'sit' | 'dance' | 'smoke'

/** Scene event emitted when an on-screen action button is tapped. */
export const TOUCH_ACTION_EVENT = 'touch-action'

const STICK_R = 58
const KNOB_R = 26
const MARGIN = 26
const BIG_R = 36
const SMALL_R = 25

type Button = {
  action: TouchAction
  label: string
  r: number
  /** Offset from the E button center. */
  dx: number
  dy: number
  gfx: Phaser.GameObjects.Graphics
  x: number
  y: number
}

const byScene = new Map<Phaser.Scene, TouchControls>()

export function isTouchDevice() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 900)
  )
}

function polar(r: number, deg: number) {
  const a = Phaser.Math.DegToRad(deg)
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r }
}

/**
 * Mobile controls: virtual joystick (bottom-left) + action buttons (bottom-right).
 * Movement is read by Player via `TouchControls.vector(scene)`.
 */
export class TouchControls {
  private readonly scene: Phaser.Scene
  readonly root: Phaser.GameObjects.Container
  private readonly base: Phaser.GameObjects.Graphics
  private readonly knob: Phaser.GameObjects.Graphics
  private readonly buttons: Button[] = []
  private stickX = 0
  private stickY = 0
  private stickPointer: number | null = null
  private vx = 0
  private vy = 0

  constructor(scene: Phaser.Scene) {
    this.scene = scene

    this.base = scene.add.graphics()
    this.base.fillStyle(0x000000, 0.28)
    this.base.fillCircle(0, 0, STICK_R)
    this.base.lineStyle(2, 0xffffff, 0.45)
    this.base.strokeCircle(0, 0, STICK_R)

    this.knob = scene.add.graphics()
    this.knob.fillStyle(0xffffff, 0.55)
    this.knob.fillCircle(0, 0, KNOB_R)
    this.knob.lineStyle(2, 0xffffff, 0.8)
    this.knob.strokeCircle(0, 0, KNOB_R)

    const children: Phaser.GameObjects.GameObject[] = [this.base, this.knob]

    const defs: { action: TouchAction; label: string; r: number; dx: number; dy: number }[] = [
      { action: 'interact', label: 'E', r: BIG_R, dx: 0, dy: 0 },
      { action: 'punch', label: 'Đấm', r: SMALL_R, ...polar(88, 180) },
      { action: 'jump', label: 'Nhảy', r: SMALL_R, ...polar(88, 225) },
      { action: 'sit', label: 'Ngồi', r: SMALL_R, ...polar(88, 270) },
      { action: 'dance', label: 'Múa', r: SMALL_R, ...polar(152, 200) },
      { action: 'smoke', label: 'Hút', r: SMALL_R, ...polar(152, 250) },
    ]
    for (const d of defs) {
      const gfx = scene.add.graphics()
      const big = d.action === 'interact'
      gfx.fillStyle(big ? 0xff4fd8 : 0x12161c, big ? 0.8 : 0.6)
      gfx.fillCircle(0, 0, d.r)
      gfx.lineStyle(2, 0xffffff, 0.6)
      gfx.strokeCircle(0, 0, d.r)
      const text = crispText(
        scene.add
          .text(0, 0, d.label, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: big ? '22px' : '12px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5),
      )
      const btn: Button = { ...d, gfx, x: 0, y: 0 }
      this.buttons.push(btn)
      children.push(gfx, text)
      gfx.setData('label', text)
    }

    this.root = scene.add.container(0, 0, children)
    this.root.setDepth(220)

    scene.input.on('pointerdown', this.onPointerDown)
    scene.input.on('pointermove', this.onPointerMove)
    scene.input.on('pointerup', this.onPointerUp)
    scene.input.on('pointerupoutside', this.onPointerUp)
    scene.events.on(Phaser.Scenes.Events.SLEEP, this.releaseStick)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown)
    byScene.set(scene, this)

    this.layout()
  }

  /** Joystick direction, magnitude 0..1 (zero when idle or no controls). */
  static vector(scene: Phaser.Scene) {
    const c = byScene.get(scene)
    return c ? { x: c.vx, y: c.vy } : { x: 0, y: 0 }
  }

  static blocksPointer(pointer: Phaser.Input.Pointer) {
    for (const c of byScene.values()) {
      if (c.stickPointer === pointer.id || c.hitTest(pointer.x, pointer.y)) return true
    }
    return false
  }

  layout() {
    const w = this.scene.scale.width
    const h = this.scene.scale.height
    pinToScreen(this.scene, this.root, 0, 0)

    this.stickX = MARGIN + STICK_R
    this.stickY = h - MARGIN - STICK_R
    this.base.setPosition(this.stickX, this.stickY)
    this.knob.setPosition(this.stickX, this.stickY)

    const ax = w - MARGIN - BIG_R
    const ay = h - MARGIN - BIG_R
    for (const b of this.buttons) {
      b.x = ax + b.dx
      b.y = ay + b.dy
      b.gfx.setPosition(b.x, b.y)
      ;(b.gfx.getData('label') as Phaser.GameObjects.Text).setPosition(b.x, b.y)
    }
  }

  private hitStick(x: number, y: number) {
    return Math.hypot(x - this.stickX, y - this.stickY) <= STICK_R * 1.5
  }

  private hitButton(x: number, y: number) {
    return this.buttons.find((b) => Math.hypot(x - b.x, y - b.y) <= b.r + 6)
  }

  private hitTest(x: number, y: number) {
    return this.hitStick(x, y) || !!this.hitButton(x, y)
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (this.stickPointer == null && this.hitStick(pointer.x, pointer.y)) {
      this.stickPointer = pointer.id
      this.updateStick(pointer)
      return
    }
    const btn = this.hitButton(pointer.x, pointer.y)
    if (!btn) return
    btn.gfx.setScale(0.9)
    this.scene.time.delayedCall(110, () => btn.gfx.setScale(1))
    this.scene.events.emit(TOUCH_ACTION_EVENT, btn.action)
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === this.stickPointer) this.updateStick(pointer)
  }

  private onPointerUp = (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === this.stickPointer) this.releaseStick()
  }

  private releaseStick = () => {
    this.stickPointer = null
    this.vx = 0
    this.vy = 0
    this.knob.setPosition(this.stickX, this.stickY)
  }

  private updateStick(pointer: Phaser.Input.Pointer) {
    let dx = pointer.x - this.stickX
    let dy = pointer.y - this.stickY
    const dist = Math.hypot(dx, dy)
    if (dist > STICK_R) {
      dx = (dx / dist) * STICK_R
      dy = (dy / dist) * STICK_R
    }
    this.knob.setPosition(this.stickX + dx, this.stickY + dy)
    const mag = Math.min(1, dist / STICK_R)
    if (mag < 0.18) {
      this.vx = 0
      this.vy = 0
      return
    }
    this.vx = dx / STICK_R
    this.vy = dy / STICK_R
  }

  private onShutdown = () => {
    this.scene.events.off(Phaser.Scenes.Events.SLEEP, this.releaseStick)
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    this.scene.input.off('pointerup', this.onPointerUp)
    this.scene.input.off('pointerupoutside', this.onPointerUp)
    byScene.delete(this.scene)
  }
}
