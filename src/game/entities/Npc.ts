import Phaser from 'phaser'
import type { Hittable } from '../combat/types'
import { PLAYER_SHEET } from '../data/playerAnims'
import { crispText } from '../ui/crispText'
import { makeChatBubble, showChatBubble, snapBubble } from '../ui/chatBubble'

export type NpcRole = 'owner' | 'waiter' | 'dancer' | 'therapist' | 'dj' | 'bartender'

/** Map logical roles onto texture packs. */
function textureRole(role: NpcRole): 'owner' | 'waiter' | 'bikini' {
  if (role === 'owner') return 'owner'
  if (role === 'dancer' || role === 'therapist') return 'bikini'
  // dj / bartender / waiter
  return 'waiter'
}

const IDLE_KEY: Record<'m' | 'f', Record<'owner' | 'waiter' | 'bikini', string>> = {
  m: { owner: 'npc-owner', waiter: 'npc-waiter', bikini: 'npc-bikini' },
  f: { owner: 'npc-owner-f', waiter: 'npc-waiter-f', bikini: 'npc-bikini' },
}

const WALK_KEY: Record<'m' | 'f', Record<'owner' | 'waiter' | 'bikini', string>> = {
  m: { owner: 'npc-owner-walk', waiter: 'npc-waiter-walk', bikini: 'npc-bikini-walk' },
  f: { owner: 'npc-owner-f-walk', waiter: 'npc-waiter-f-walk', bikini: 'npc-bikini-walk' },
}

/**
 * Staff / dancer / therapist NPC.
 */
export class Npc implements Hittable {
  readonly sprite: Phaser.Physics.Arcade.Sprite
  private readonly label: Phaser.GameObjects.Text
  private readonly scene: Phaser.Scene
  private readonly role: NpcRole
  private readonly gender: 'm' | 'f'
  private readonly homeX: number
  private readonly homeY: number
  private stunUntil = 0
  private target: { x: number; y: number } | null = null
  private onArrive: (() => void) | null = null
  private readonly walkAnimKey: string
  private dancing = false
  private danceTweens: Phaser.Tweens.Tween[] = []
  private massaging = false
  private massageTweens: Phaser.Tweens.Tween[] = []
  private massageHands: Phaser.GameObjects.Ellipse[] = []
  private bubble: Phaser.GameObjects.Text | null = null
  private bubbleUntil = 0

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    labelText: string,
    role: NpcRole,
    female = false,
    tint?: number,
  ) {
    this.scene = scene
    this.role = role
    this.gender = female ? 'f' : 'm'
    this.homeX = x
    this.homeY = y

    const pack = textureRole(role)
    const idleKey = IDLE_KEY[this.gender][pack]
    const walkKey = WALK_KEY[this.gender][pack]
    this.walkAnimKey = `${walkKey}-anim`

    if (scene.textures.exists(walkKey)) {
      if (!scene.anims.exists(this.walkAnimKey)) {
        try {
          const tex = scene.textures.get(walkKey)
          const end = Math.min(5, Math.max(0, tex.frameTotal - 1))
          scene.anims.create({
            key: this.walkAnimKey,
            frames: scene.anims.generateFrameNumbers(walkKey, { start: 0, end }),
            frameRate: 10,
            repeat: -1,
          })
        } catch {
          // Missing/corrupt walk sheet — dancers still bob via tweens
        }
      }
    }

    const scale = PLAYER_SHEET.scale
    this.sprite = scene.physics.add.sprite(x, y, idleKey, 0)
    this.sprite.setDepth(9)
    this.sprite.setScale(scale)
    if (tint != null) this.sprite.setTint(tint)
    this.sprite.setCollideWorldBounds(true)
    this.sprite.body!.setSize(14, 8)
    this.sprite.body!.setOffset(25, 52)
    ;(this.sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false)
    this.sprite.setDrag(0, 0)
    this.sprite.setMaxVelocity(220, 220)

    this.label = crispText(
      scene.add
        .text(x, y + 36, labelText, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(11),
    )

    if (role === 'dancer' || role === 'dj') this.startDance()
  }

  get x() {
    return this.sprite.x
  }

  get y() {
    return this.sprite.y
  }

  startDance() {
    if (this.dancing) return
    this.dancing = true
    this.target = null
    this.sprite.setVelocity(0, 0)
    this.playWalkAnim()

    const bob = this.scene.tweens.add({
      targets: this.sprite,
      y: this.homeY - 8,
      duration: 220 + Math.random() * 80,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    const sway = this.scene.tweens.add({
      targets: this.sprite,
      x: this.homeX + 10,
      duration: 360 + Math.random() * 120,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.danceTweens.push(bob, sway)
  }

  get isMassaging() {
    return this.massaging
  }

  /** Short speech bubble above the head. */
  say(text: string, durationMs = 3800) {
    if (!this.bubble) {
      this.bubble = makeChatBubble(this.scene, this.sprite.x, this.sprite.y - 40)
    }
    this.bubbleUntil = showChatBubble(this.bubble, text, durationMs)
    snapBubble(this.bubble, this.sprite.x, this.sprite.y - 40)
  }

  /** Lean over the bed and knead the customer's back at (tx, ty). */
  startMassage(tx: number, ty: number) {
    if (this.massaging) return
    this.stopDance()
    this.massaging = true
    this.target = null
    this.onArrive = null
    this.sprite.setVelocity(0, 0)
    this.stopWalkAnim()
    this.sprite.setPosition(this.homeX, this.homeY)

    const leanX = this.homeX + Math.sign(tx - this.homeX) * 10
    const lean = this.scene.tweens.add({
      targets: this.sprite,
      x: leanX,
      duration: 260,
      ease: 'Sine.easeOut',
    })
    const press = this.scene.tweens.add({
      targets: this.sprite,
      y: this.homeY + 3,
      scaleY: this.sprite.scaleY * 0.95,
      duration: 190,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
    this.massageTweens.push(lean, press)

    for (let i = 0; i < 2; i++) {
      const hand = this.scene.add
        .ellipse(tx + (i === 0 ? -7 : 7), ty - 6, 9, 7, 0xf1c9a5)
        .setStrokeStyle(1, 0x8a5a3a)
        .setDepth(12)
      this.massageHands.push(hand)
      const knead = this.scene.tweens.add({
        targets: hand,
        y: ty,
        scaleX: 1.2,
        scaleY: 0.8,
        duration: 190,
        yoyo: true,
        repeat: -1,
        delay: i * 190,
        ease: 'Quad.easeIn',
      })
      this.massageTweens.push(knead)
    }
  }

  stopMassage() {
    if (!this.massaging) return
    this.massaging = false
    for (const t of this.massageTweens) t.stop()
    this.massageTweens = []
    for (const h of this.massageHands) h.destroy()
    this.massageHands = []
    this.sprite.setScale(PLAYER_SHEET.scale)
    this.sprite.setPosition(this.homeX, this.homeY)
  }

  goTo(x: number, y: number, onArrive?: () => void) {
    this.stopMassage()
    this.stopDance()
    this.target = { x, y }
    this.onArrive = onArrive ?? null
  }

  goHome(onArrive?: () => void) {
    this.goTo(this.homeX, this.homeY, onArrive)
  }

  applyKnockback(dirX: number, dirY: number, force: number) {
    this.target = null
    this.onArrive = null
    this.stopMassage()
    this.stopDance()
    this.stopWalkAnim()
    const len = Math.hypot(dirX, dirY) || 1
    this.sprite.setVelocity((dirX / len) * force, (dirY / len) * force)
    this.stunUntil = this.scene.time.now + 350
    this.sprite.setTint(0xffffff)
    this.scene.time.delayedCall(80, () => this.sprite.clearTint())
  }

  update() {
    this.label.setPosition(this.sprite.x, this.sprite.y + 36)
    if (this.bubble?.visible) {
      snapBubble(this.bubble, this.sprite.x, this.sprite.y - 40)
      if (performance.now() > this.bubbleUntil) this.bubble.setVisible(false)
    }

    if (this.dancing) {
      this.playWalkAnim()
      return
    }

    if (this.massaging) return

    if (this.scene.time.now < this.stunUntil) return

    if (!this.target) {
      this.sprite.setVelocity(0, 0)
      this.stopWalkAnim()
      return
    }

    const dx = this.target.x - this.sprite.x
    const dy = this.target.y - this.sprite.y
    const dist = Math.hypot(dx, dy)
    if (dist < 10) {
      this.sprite.setVelocity(0, 0)
      this.sprite.setPosition(this.target.x, this.target.y)
      this.target = null
      this.stopWalkAnim()
      const cb = this.onArrive
      this.onArrive = null
      cb?.()
      return
    }

    const speed = 160
    this.sprite.setVelocity((dx / dist) * speed, (dy / dist) * speed)
    this.playWalkAnim()
  }

  private stopDance() {
    if (!this.dancing) return
    this.dancing = false
    for (const t of this.danceTweens) t.stop()
    this.danceTweens = []
    this.sprite.setPosition(this.homeX, this.homeY)
  }

  private playWalkAnim() {
    const walkKey = WALK_KEY[this.gender][textureRole(this.role)]
    if (!this.scene.textures.exists(walkKey)) return
    if (this.sprite.texture.key !== walkKey) {
      this.sprite.setTexture(walkKey)
    }
    if (this.scene.anims.exists(this.walkAnimKey)) {
      this.sprite.anims.play(this.walkAnimKey, true)
    }
  }

  private stopWalkAnim() {
    this.sprite.anims.stop()
    const idleKey = IDLE_KEY[this.gender][textureRole(this.role)]
    if (this.sprite.texture.key !== idleKey) {
      this.sprite.setTexture(idleKey, 0)
    } else {
      this.sprite.setFrame(0)
    }
  }

  destroy() {
    this.stopMassage()
    this.stopDance()
    this.bubble?.destroy()
    this.bubble = null
    this.label.destroy()
    this.sprite.destroy()
  }
}
