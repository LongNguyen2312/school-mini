import Phaser from 'phaser'
import type { Hittable } from '../combat/types'
import { PLAYER_FRAMES, PLAYER_SHEET } from '../data/playerAnims'
import { animKeyFor, ensurePlayerLook } from '../appearance'
import { crispText } from '../ui/crispText'
import { makeChatBubble, showChatBubble, snapBubble } from '../ui/chatBubble'
import type { Facing, PlayerMove, PlayerPublic } from '../../multiplayer/types'

type Snap = {
  t: number
  x: number
  y: number
  vx: number
  vy: number
  facing: Facing
  anim: string
}

/** Render ~2–3 ticks behind so we always lerp between two snaps. */
const INTERP_DELAY_MS = 80
const MAX_EXTRAP_MS = 100
const MAX_BUF = 16

/**
 * Other players — buffered snapshot interpolation + hittable for local punches.
 */
export class RemotePlayer implements Hittable {
  readonly id: string
  name: string
  readonly sprite: Phaser.GameObjects.Sprite
  private readonly label: Phaser.GameObjects.Text
  private readonly bubble: Phaser.GameObjects.Text
  private readonly shadow: Phaser.GameObjects.Ellipse
  private sheetKey = PLAYER_SHEET.key as string
  private facing: Facing = 'down'
  private bubbleUntil = 0
  private currentAnim = ''
  private displayX = 0
  private displayY = 0
  private buf: Snap[] = []
  private ignoreNetUntil = 0
  private knockVx = 0
  private knockVy = 0
  private cigGfx: Phaser.GameObjects.Graphics | null = null
  private smoking = false
  private smokeStartedAt = 0

  constructor(scene: Phaser.Scene, data: PlayerPublic) {
    this.id = data.id
    this.name = data.name
    const scale = PLAYER_SHEET.scale
    this.sheetKey = ensurePlayerLook(scene, data.bald, data.shirtColor)
    this.displayX = data.x
    this.displayY = data.y

    this.shadow = scene.add
      .ellipse(data.x, data.y + 28 * scale, 20 * scale, 8 * scale, 0x000000, 0.3)
      .setDepth(9)

    this.sprite = scene.add
      .sprite(data.x, data.y, this.sheetKey, PLAYER_FRAMES.idleDown[0])
      .setDepth(10)
      .setScale(scale)

    this.label = crispText(
      scene.add
        .text(data.x, data.y - 36, data.name, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(12),
    )

    this.bubble = makeChatBubble(scene, data.x, data.y - 52)

    this.applyFull(data, true)
  }

  get x() {
    return this.displayX
  }

  get y() {
    return this.displayY
  }

  applyLook(bald: boolean, shirtColor: number) {
    const key = ensurePlayerLook(this.sprite.scene, bald, shirtColor)
    if (key === this.sheetKey) return
    this.sheetKey = key
    this.sprite.setTexture(key, this.sprite.frame.name)
    this.currentAnim = ''
  }

  applyFull(data: PlayerPublic, instant = false) {
    if (data.name && data.name !== this.name) {
      this.name = data.name
      this.label.setText(data.name)
    }
    this.applyLook(data.bald, data.shirtColor)
    this.setSmoking(Boolean(data.smoking))
    this.pushSnap(
      {
        id: data.id,
        zone: data.zone,
        x: data.x,
        y: data.y,
        facing: data.facing,
        anim: data.anim,
        vx: 0,
        vy: 0,
        smoking: Boolean(data.smoking),
      },
      instant,
    )
  }

  applyMove(move: PlayerMove) {
    this.setSmoking(Boolean(move.smoking))
    this.pushSnap(move, false)
  }

  private setSmoking(on: boolean) {
    if (on === this.smoking) return
    this.smoking = on
    if (on) {
      this.smokeStartedAt = this.sprite.scene.time.now
      this.drawCigarette()
    } else {
      this.hideCigarette()
    }
  }

  private pushSnap(move: PlayerMove, instant: boolean) {
    const now = performance.now()
    if (now < this.ignoreNetUntil) {
      const toNet = Math.hypot(move.x - this.displayX, move.y - this.displayY)
      if (toNet < 28) {
        this.ignoreNetUntil = 0
        this.buf = [
          {
            t: now,
            x: move.x,
            y: move.y,
            vx: 0,
            vy: 0,
            facing: move.facing,
            anim: move.anim,
          },
        ]
        this.displayX = move.x
        this.displayY = move.y
      }
      this.facing = move.facing
      this.playAnim(move.anim)
      return
    }

    this.facing = move.facing
    const snap: Snap = {
      t: now,
      x: move.x,
      y: move.y,
      vx: move.vx || 0,
      vy: move.vy || 0,
      facing: move.facing,
      anim: move.anim,
    }

    if (instant || this.buf.length === 0) {
      this.buf = [snap]
      this.displayX = move.x
      this.displayY = move.y
      this.sprite.setPosition(move.x, move.y)
    } else {
      // Monotonic time; drop duplicate/out-of-order
      const last = this.buf[this.buf.length - 1]
      if (snap.t <= last.t) snap.t = last.t + 1
      this.buf.push(snap)
      if (this.buf.length > MAX_BUF) this.buf.splice(0, this.buf.length - MAX_BUF)
    }
    this.playAnim(move.anim)
  }

  applyKnockback(dirX: number, dirY: number, force: number) {
    const len = Math.hypot(dirX, dirY) || 1
    this.knockVx = (dirX / len) * force * 0.02
    this.knockVy = (dirY / len) * force * 0.02
    this.ignoreNetUntil = performance.now() + 550
    this.buf.length = 0
    this.playAnim('hit')
  }

  showChat(text: string, durationMs = 4200) {
    this.bubbleUntil = showChatBubble(this.bubble, text, durationMs)
  }

  update(delta: number) {
    const dt = Math.min(delta, 50)
    if (Math.abs(this.knockVx) > 0.05 || Math.abs(this.knockVy) > 0.05) {
      this.displayX += this.knockVx * (dt / 16)
      this.displayY += this.knockVy * (dt / 16)
      const damp = Math.exp(-0.012 * dt)
      this.knockVx *= damp
      this.knockVy *= damp
    } else {
      this.sampleAt(performance.now() - INTERP_DELAY_MS)
    }

    this.sprite.setPosition(this.displayX, this.displayY)
    this.label.setPosition(this.displayX | 0, (this.displayY - 36) | 0)
    snapBubble(this.bubble, this.displayX, this.displayY - 54)
    this.shadow.setPosition(this.displayX, this.displayY + 28 * PLAYER_SHEET.scale)
    if (this.smoking) this.drawCigarette()

    if (this.bubble.visible && performance.now() > this.bubbleUntil) {
      this.bubble.setVisible(false)
    }
  }

  /** Interpolate (or briefly extrapolate) at a past render time. */
  private sampleAt(renderAt: number) {
    const buf = this.buf
    if (buf.length === 0) return

    if (buf.length === 1 || renderAt <= buf[0].t) {
      this.displayX = buf[0].x
      this.displayY = buf[0].y
      return
    }

    const last = buf[buf.length - 1]
    if (renderAt >= last.t) {
      const age = Math.min(MAX_EXTRAP_MS, renderAt - last.t) / 1000
      this.displayX = last.x + last.vx * age
      this.displayY = last.y + last.vy * age
      return
    }

    // Find segment [i, i+1] containing renderAt
    let i = 0
    for (let k = 0; k < buf.length - 1; k++) {
      if (buf[k].t <= renderAt && renderAt <= buf[k + 1].t) {
        i = k
        break
      }
      if (buf[k].t < renderAt) i = k
    }
    const a = buf[i]
    const b = buf[i + 1]
    const span = b.t - a.t || 1
    const u = (renderAt - a.t) / span
    this.displayX = a.x + (b.x - a.x) * u
    this.displayY = a.y + (b.y - a.y) * u
  }

  private playAnim(anim: string) {
    const suffix = anim.startsWith('player-') ? anim.slice(7) : anim

    // Legacy: older clients sent anim === 'smoke'
    if (suffix === 'smoke') {
      this.setSmoking(true)
      const idleKey = animKeyFor(this.sheetKey, `idle-${this.facing}`)
      if (this.currentAnim !== idleKey || !this.sprite.anims.isPlaying) {
        this.currentAnim = idleKey
        if (this.sprite.scene.anims.exists(idleKey)) {
          this.sprite.anims.play(idleKey, true)
        }
      }
      return
    }

    const key = animKeyFor(this.sheetKey, suffix)
    const looping = /^(idle|walk|run|dance)-/.test(suffix)
    if (key === this.currentAnim && this.sprite.anims.isPlaying && looping) return
    if (key === this.currentAnim && this.sprite.anims.isPlaying && !looping) return
    this.currentAnim = key
    if (this.sprite.scene.anims.exists(key)) {
      this.sprite.anims.play(key, looping)
      return
    }
    const frames =
      this.facing === 'up'
        ? PLAYER_FRAMES.idleUp
        : this.facing === 'left'
          ? PLAYER_FRAMES.idleLeft
          : this.facing === 'right'
            ? PLAYER_FRAMES.idleRight
            : PLAYER_FRAMES.idleDown
    this.sprite.setFrame(frames[0])
  }

  private mouthAnchor(): {
    fx: number
    fy: number
    dir: 1 | -1
    slope: number
    visible: boolean
  } {
    switch (this.facing) {
      case 'down':
        return { fx: 31, fy: 33, dir: 1, slope: 0.45, visible: true }
      case 'right':
        return { fx: 37, fy: 32.5, dir: 1, slope: 0, visible: true }
      case 'left':
        return { fx: 26, fy: 32.5, dir: -1, slope: 0, visible: true }
      case 'up':
        return { fx: 32, fy: 30, dir: 1, slope: 0, visible: false }
    }
  }

  private drawCigarette() {
    if (!this.cigGfx) {
      this.cigGfx = this.sprite.scene.add.graphics().setDepth(12)
    }
    const g = this.cigGfx
    const anchor = this.mouthAnchor()
    g.setVisible(anchor.visible)
    g.clear()
    if (!anchor.visible) return

    const s = PLAYER_SHEET.scale
    const px = s * 1.55
    const ax = this.displayX + (anchor.fx - 32) * s
    const ay = this.displayY + (anchor.fy - 32) * s
    g.setPosition(0, 0)

    const d = anchor.dir
    const slope = anchor.slope
    const body = [0xc8aa78, 0xebdcb9, 0xebdcb9, 0xebdcb9, 0xe6d2aa, 0xdc411c]
    for (let i = 0; i < body.length; i++) {
      g.fillStyle(body[i], 1)
      g.fillRect(ax + i * d * px, ay + i * slope * px, px, px * 1.15)
    }
    const tipX = ax + 6 * d * px
    const tipY = ay + 6 * slope * px
    g.fillStyle(0xff9c32, 1)
    g.fillRect(tipX, tipY - 0.35 * px, px, px)

    const t = (this.sprite.scene.time.now - this.smokeStartedAt) / 180
    for (let p = 0; p < 3; p++) {
      const phase = (t + p * 2) % 10
      const sx = tipX + (p % 2) * px * 0.35 * d - (phase / 5) * px * 0.25
      const sy = tipY - 1.5 * px - phase * px * 0.5
      const rad = (1.1 + phase / 5) * px * 0.5
      g.fillStyle(0xc8c8c8, Math.max(0.25, 0.85 - phase * 0.07))
      g.fillCircle(sx, sy, rad)
    }
  }

  private hideCigarette() {
    this.cigGfx?.clear()
    this.cigGfx?.setVisible(false)
  }

  destroy() {
    this.cigGfx?.destroy()
    this.cigGfx = null
    this.sprite.destroy()
    this.label.destroy()
    this.bubble.destroy()
    this.shadow.destroy()
  }
}
