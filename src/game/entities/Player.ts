import Phaser from 'phaser'
import {
  ATTACK_COOLDOWN_MS,
  HIT_CONE_DOT,
  JUMP_APEX,
  JUMP_FORCE,
  JUMP_GRAVITY,
  PLAYER_RUN_SPEED,
  PLAYER_SPEED,
  PUNCH_FORCE,
  PUNCH_HIT_MS,
  PUNCH_RANGE,
  PUNCH_RECOVER_MS,
} from '../config'
import { animKeyFor, ensurePlayerLook } from '../appearance'
import { facingVector, type Direction, type Hittable } from '../combat/types'
import { PLAYER_FRAMES, PLAYER_SHEET } from '../data/playerAnims'
import { ControlsHelp } from '../ui/ControlsHelp'
import { Minimap } from '../ui/Minimap'

export class Player implements Hittable {
  readonly sprite: Phaser.Physics.Arcade.Sprite
  private readonly scene: Phaser.Scene
  private sheetKey: string = PLAYER_SHEET.key
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }
  private shiftKey!: Phaser.Input.Keyboard.Key
  private facing: Direction = 'down'
  private sitting = false
  private lying = false
  private jumping = false
  private attacking = false
  private punchSeq = 0
  private punchBuffered = false
  private smoking = false
  private smokeStartedAt = 0
  private cigGfx: Phaser.GameObjects.Graphics | null = null
  private stunned = false
  private hop = 0
  private hopVelocity = 0
  private gx: number
  private gy: number
  private attackReadyAt = 0
  private targets: Hittable[] = []
  private readonly shadow: Phaser.GameObjects.Ellipse
  /** Right-click / hold move destination in world space. */
  private moveTarget: { x: number; y: number } | null = null
  private clickMarker: Phaser.GameObjects.Container | null = null
  /** Scene can intercept C (e.g. sit on a nearby chair). Return true if handled. */
  sitInterceptor: (() => boolean) | null = null
  /** Ask WorldScene to flush net state immediately (punch/jump/hit). */
  actionFlush: (() => void) | null = null
  private knockVx = 0
  private knockVy = 0
  private knockUntil = 0
  private netMoving = false

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene
    this.gx = x
    this.gy = y

    const scale = PLAYER_SHEET.scale
    this.shadow = scene.add
      .ellipse(x, y + 28 * scale, 20 * scale, 8 * scale, 0x000000, 0.35)
      .setDepth(9)

    this.sprite = scene.physics.add.sprite(x, y, PLAYER_SHEET.key, PLAYER_FRAMES.idleDown[0])
    this.sprite.setCollideWorldBounds(true)
    this.sprite.setDepth(10)
    this.sprite.setDrag(0, 0)
    this.sprite.setScale(scale)

    this.sprite.body!.setSize(14, 8)
    this.sprite.body!.setOffset(25, 52)
    ;(this.sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false)

    Player.createAnimations(scene)

    const keyboard = scene.input.keyboard!
    keyboard.addCapture(['C', 'SPACE', 'W', 'A', 'S', 'D', 'Z', 'R', 'SHIFT'])

    this.cursors = keyboard.createCursorKeys()
    this.wasd = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Player['wasd']
    this.shiftKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)

    keyboard.on('keydown-C', this.onSitKey, this)
    keyboard.on('keydown-SPACE', this.onJumpKey, this)
    keyboard.on('keydown-Z', this.onLieKey, this)
    keyboard.on('keydown-R', this.onSmokeKey, this)

    this.playIdle()
    this.bindCombatInput()

    scene.events.on('postupdate', this.afterPhysics, this)
    scene.events.once('shutdown', this.cleanup, this)
    scene.events.once('destroy', this.cleanup, this)
  }

  private cleanup = () => {
    const keyboard = this.scene.input.keyboard
    keyboard?.off('keydown-C', this.onSitKey, this)
    keyboard?.off('keydown-SPACE', this.onJumpKey, this)
    keyboard?.off('keydown-Z', this.onLieKey, this)
    keyboard?.off('keydown-R', this.onSmokeKey, this)
    this.scene.events.off('postupdate', this.afterPhysics, this)
    this.scene.input.off('pointerdown', this.onPointerDown)
    this.scene.input.off('pointermove', this.onPointerMove)
    this.shadow.destroy()
    this.cigGfx?.destroy()
    this.cigGfx = null
    this.clearClickMarker()
  }

  private isSceneLive() {
    return this.scene.sys.isActive() && this.scene.sys.isVisible()
  }

  private onSitKey = (event?: KeyboardEvent) => {
    if (!this.isSceneLive() || event?.repeat) return
    if (this.sitInterceptor?.()) return
    this.toggleSit()
  }

  private onJumpKey = (event?: KeyboardEvent) => {
    if (!this.isSceneLive()) return
    event?.preventDefault()
    if (event?.repeat) return
    this.jump()
  }

  private onLieKey = (event?: KeyboardEvent) => {
    if (!this.isSceneLive() || event?.repeat) return
    this.toggleLie()
  }

  private onSmokeKey = (event?: KeyboardEvent) => {
    if (!this.isSceneLive() || event?.repeat) return
    this.smoke()
  }

  static createAnimations(scene: Phaser.Scene) {
    const keys = [
      'player-idle-up',
      'player-idle-down',
      'player-idle-left',
      'player-idle-right',
      'player-walk-up',
      'player-walk-down',
      'player-walk-left',
      'player-walk-right',
      'player-run-up',
      'player-run-down',
      'player-run-left',
      'player-run-right',
      'player-sit-up',
      'player-sit-down',
      'player-sit-left',
      'player-sit-right',
      'player-punch-up',
      'player-punch-down',
      'player-punch-left',
      'player-punch-right',
      'player-jump-up',
      'player-jump-down',
      'player-jump-left',
      'player-jump-right',
      'player-lie',
      'player-smoke',
      'player-hit',
    ]
    for (const key of keys) {
      if (scene.anims.exists(key)) scene.anims.remove(key)
    }

    const mk = (
      key: string,
      frames: readonly number[],
      frameRate: number,
      repeat: number,
    ) => {
      if (!frames.length) return
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(PLAYER_SHEET.key, {
          frames: [...frames],
        }),
        frameRate,
        repeat,
      })
    }

    mk('player-idle-right', PLAYER_FRAMES.idleRight, 5, -1)
    mk('player-idle-left', PLAYER_FRAMES.idleLeft, 5, -1)
    mk('player-idle-up', PLAYER_FRAMES.idleUp, 5, -1)
    mk('player-idle-down', PLAYER_FRAMES.idleDown, 5, -1)

    mk('player-walk-up', PLAYER_FRAMES.walkUp, 10, -1)
    mk('player-walk-down', PLAYER_FRAMES.walkDown, 10, -1)
    mk('player-walk-left', PLAYER_FRAMES.walkLeft, 10, -1)
    mk('player-walk-right', PLAYER_FRAMES.walkRight, 10, -1)

    mk('player-run-up', PLAYER_FRAMES.runUp, 14, -1)
    mk('player-run-down', PLAYER_FRAMES.runDown, 14, -1)
    mk('player-run-right', PLAYER_FRAMES.runRight, 14, -1)
    mk('player-run-left', PLAYER_FRAMES.runLeft, 14, -1)

    mk('player-sit-up', PLAYER_FRAMES.sitUp, 8, 0)
    mk('player-sit-down', PLAYER_FRAMES.sitDown, 8, 0)
    mk('player-sit-left', PLAYER_FRAMES.sitLeft, 8, 0)
    mk('player-sit-right', PLAYER_FRAMES.sitRight, 8, 0)

    mk('player-punch-up', PLAYER_FRAMES.punchUp, 22, 0)
    mk('player-punch-down', PLAYER_FRAMES.punchDown, 22, 0)
    mk('player-punch-left', PLAYER_FRAMES.punchLeft, 22, 0)
    mk('player-punch-right', PLAYER_FRAMES.punchRight, 22, 0)

    mk('player-jump-up', PLAYER_FRAMES.jumpUp, 12, 0)
    mk('player-jump-down', PLAYER_FRAMES.jumpDown, 12, 0)
    mk('player-jump-left', PLAYER_FRAMES.jumpLeft, 12, 0)
    mk('player-jump-right', PLAYER_FRAMES.jumpRight, 12, 0)

    mk('player-lie', PLAYER_FRAMES.lie, 10, 0)
    mk('player-smoke', PLAYER_FRAMES.smoke, 5, 0)
    mk('player-hit', PLAYER_FRAMES.hit, 10, 0)
  }

  get x() {
    return this.sprite.x
  }

  get y() {
    return this.sprite.y
  }

  setTargets(targets: Hittable[]) {
    this.targets = targets
  }

  get isSitting() {
    return this.sitting
  }

  get isLying() {
    return this.lying
  }

  get isBusy() {
    return this.sitting || this.lying || this.attacking || this.smoking || this.stunned
  }

  getFacing(): Direction {
    return this.facing
  }

  /** Network anim id, e.g. idle-down / walk-left */
  getNetAnim(): string {
    if (this.lying) return 'lie'
    if (this.sitting) return `sit-${this.facing}`
    if (this.jumping) return `jump-${this.facing}`
    if (this.attacking) return `punch-${this.facing}`
    if (this.smoking) return 'smoke'
    if (this.stunned || this.scene.time.now < this.knockUntil) return 'hit'
    // Do NOT use body.velocity — syncBodyToGround zeroes it every frame
    if (this.netMoving || this.isMovePressed() || this.moveTarget) {
      const running = this.shiftKey?.isDown
      return `${running ? 'run' : 'walk'}-${this.facing}`
    }
    return `idle-${this.facing}`
  }

  private flushAction() {
    this.actionFlush?.()
  }

  applyAppearance(bald: boolean, shirtColor: number) {
    const key = ensurePlayerLook(this.scene, bald, shirtColor)
    this.sheetKey = key
    this.sprite.anims.stop()
    this.sprite.clearTint()
    this.sprite.setTexture(key, PLAYER_FRAMES.idleDown[0])
    const idle = animKeyFor(key, `idle-${this.facing}`)
    if (this.scene.anims.exists(idle)) {
      this.sprite.anims.play(idle, true)
    } else {
      this.playIdle()
    }
  }

  applyKnockback(dirX: number, dirY: number, force: number) {
    const len = Math.hypot(dirX, dirY) || 1
    // World units / second (same space as walk); gx/gy is the real position
    this.knockVx = (dirX / len) * force * 1.35
    this.knockVy = (dirY / len) * force * 1.35
    this.knockUntil = this.scene.time.now + 320
    this.clearClickMove()
    this.takeHit()
    this.flushAction()
  }

  private anim(suffix: string) {
    return animKeyFor(this.sheetKey, suffix)
  }

  private dirKey(prefix: string) {
    // prefix like 'player-idle' → suffix 'idle-down'
    const base = prefix.replace(/^player-/, '')
    return this.anim(`${base}-${this.facing}`)
  }

  private jumpFrames(): readonly number[] {
    switch (this.facing) {
      case 'up':
        return PLAYER_FRAMES.jumpUp
      case 'down':
        return PLAYER_FRAMES.jumpDown
      case 'left':
        return PLAYER_FRAMES.jumpLeft
      default:
        return PLAYER_FRAMES.jumpRight
    }
  }

  private sitFrames(): readonly number[] {
    switch (this.facing) {
      case 'up':
        return PLAYER_FRAMES.sitUp
      case 'down':
        return PLAYER_FRAMES.sitDown
      case 'left':
        return PLAYER_FRAMES.sitLeft
      default:
        return PLAYER_FRAMES.sitRight
    }
  }

  sitAt(x: number, y: number, facing: Direction = 'down') {
    if (this.jumping || this.attacking || this.stunned) return
    this.stopSmoke()
    this.lying = false
    this.sitting = true
    this.jumping = false
    this.hop = 0
    this.hopVelocity = 0
    this.facing = facing
    this.gx = x
    this.gy = y
    this.sprite.setVelocity(0, 0)
    this.sprite.setFlipX(false)
    this.sprite.setScale(PLAYER_SHEET.scale)
    this.sprite.anims.play(this.dirKey('player-sit'), true)
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!this.sitting) return
      this.sprite.anims.stop()
      const frames = this.sitFrames()
      this.sprite.setFrame(frames[frames.length - 1])
    })
    this.syncBodyToGround()
    this.flushAction()
  }

  standUp() {
    if (this.sitting) {
      this.sitting = false
      this.sprite.setAngle(0)
      this.playIdle()
      this.flushAction()
      return
    }
    if (this.lying) {
      this.lying = false
      this.sprite.setAngle(0)
      this.playIdle()
      this.flushAction()
    }
  }

  toggleSit() {
    if (this.jumping || this.attacking || this.stunned) return
    this.stopSmoke()
    if (this.lying) {
      this.lying = false
      this.sprite.setAngle(0)
    }
    if (this.sitting) this.standUp()
    else this.sitAt(this.gx, this.gy, this.facing)
  }

  /** Lie down at a world point (e.g. massage bed). */
  lieAt(x: number, y: number) {
    if (this.jumping || this.attacking || this.stunned) return
    this.stopSmoke()
    this.sitting = false
    this.lying = true
    this.jumping = false
    this.hop = 0
    this.hopVelocity = 0
    this.gx = x
    this.gy = y
    this.sprite.setVelocity(0, 0)
    this.sprite.setFlipX(false)
    this.sprite.setAngle(0)
    this.sprite.setScale(PLAYER_SHEET.scale)
    this.sprite.anims.play(this.anim('lie'), true)
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (!this.lying) return
      this.sprite.anims.stop()
      this.sprite.setFrame(PLAYER_FRAMES.lie[PLAYER_FRAMES.lie.length - 1])
    })
    this.syncBodyToGround()
    this.flushAction()
  }

  toggleLie() {
    if (this.jumping || this.attacking || this.stunned) return
    this.stopSmoke()
    if (this.sitting) this.sitting = false
    if (this.lying) {
      this.lying = false
      this.sprite.setAngle(0)
      this.playIdle()
      return
    }
    this.lieAt(this.gx, this.gy)
  }

  smoke() {
    if (this.isBusy || this.jumping || this.isMovePressed()) return
    this.smoking = true
    this.smokeStartedAt = this.scene.time.now
    this.playIdle()
    this.ensureCigGfx()
    this.drawCigarette()
    this.flushAction()

    this.scene.time.delayedCall(2200, () => {
      if (!this.smoking) return
      this.stopSmoke()
      if (!this.sitting && !this.lying) this.playIdle()
    })
  }

  /** Mouth anchor in frame pixels (origin = frame center 32,32), cig grows along `dir`. */
  private mouthAnchor(): {
    fx: number
    fy: number
    dir: 1 | -1
    /** Per-segment drop for diagonal (front-facing cig tips toward camera). */
    slope: number
    visible: boolean
  } {
    switch (this.facing) {
      case 'down':
        // lips; tip angles forward/down
        return { fx: 31, fy: 33, dir: 1, slope: 0.45, visible: true }
      case 'right':
        return { fx: 37, fy: 32.5, dir: 1, slope: 0, visible: true }
      case 'left':
        return { fx: 26, fy: 32.5, dir: -1, slope: 0, visible: true }
      case 'up':
        return { fx: 32, fy: 30, dir: 1, slope: 0, visible: false }
    }
  }

  private ensureCigGfx() {
    if (this.cigGfx) return
    this.cigGfx = this.scene.add.graphics().setDepth(12)
  }

  private hideCigarette() {
    this.cigGfx?.clear()
    this.cigGfx?.setVisible(false)
  }

  /** Cancel smoke immediately (any other action). */
  private stopSmoke() {
    if (!this.smoking) return
    this.smoking = false
    this.hideCigarette()
    this.flushAction()
  }

  private drawCigarette() {
    const g = this.cigGfx
    if (!g) return
    const anchor = this.mouthAnchor()
    g.setVisible(anchor.visible)
    g.clear()
    if (!anchor.visible) return

    const s = PLAYER_SHEET.scale
    const px = s * 1.55
    const ax = this.sprite.x + (anchor.fx - 32) * s
    const ay = this.sprite.y + (anchor.fy - 32) * s
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

    const t = (this.scene.time.now - this.smokeStartedAt) / 180
    for (let p = 0; p < 3; p++) {
      const phase = (t + p * 2) % 10
      const sx = tipX + (p % 2) * px * 0.35 * d - (phase / 5) * px * 0.25
      const sy = tipY - 1.5 * px - phase * px * 0.5
      const rad = (1.1 + phase / 5) * px * 0.5
      g.fillStyle(0xc8c8c8, Math.max(0.25, 0.85 - phase * 0.07))
      g.fillCircle(sx, sy, rad)
    }
  }

  takeHit() {
    if (this.stunned) return
    this.sitting = false
    this.lying = false
    this.stopSmoke()
    this.attacking = false
    this.punchBuffered = false
    this.punchSeq++
    this.stunned = true
    this.sprite.setVelocity(0, 0)
    this.sprite.setFlipX(false)
    this.sprite.anims.play(this.anim('hit'), true)
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.stunned = false
      this.playIdle()
    })
    this.scene.time.delayedCall(450, () => {
      if (this.stunned) {
        this.stunned = false
        this.playIdle()
      }
    })
  }

  jump() {
    if (this.sitting || this.lying || this.jumping || this.attacking || this.stunned) return
    this.stopSmoke()
    this.clearClickMove()
    this.jumping = true
    this.hop = 0
    this.hopVelocity = -JUMP_FORCE
    this.sprite.setFlipX(false)
    this.sprite.anims.stop()
    this.sprite.setFrame(this.jumpFrames()[0])
    this.flushAction()
  }

  update(_time: number, delta: number) {
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
      this.sprite.setVelocity(0, 0)
      this.syncBodyToGround()
      return
    }

    const dt = Math.min(delta / 1000, 0.05)

    if (this.scene.time.now < this.knockUntil) {
      this.gx += this.knockVx * dt
      this.gy += this.knockVy * dt
      const bounds = this.scene.physics.world.bounds
      this.gx = Phaser.Math.Clamp(this.gx, bounds.x + 14, bounds.right - 14)
      this.gy = Phaser.Math.Clamp(this.gy, bounds.y + 14, bounds.bottom - 14)
      // Exponential decay (~independent of framerate)
      const damp = Math.exp(-10 * dt)
      this.knockVx *= damp
      this.knockVy *= damp
      this.syncBodyToGround()
      return
    }

    if (this.stunned) {
      this.sprite.setVelocity(0, 0)
      this.syncBodyToGround()
      return
    }

    if (this.smoking) {
      if (this.isMovePressed()) {
        this.stopSmoke()
      } else {
        this.sprite.setVelocity(0, 0)
        this.syncBodyToGround()
        this.drawCigarette()
        return
      }
    }

    if (this.sitting) {
      if (this.isMovePressed()) this.standUp()
      else {
        this.sprite.setVelocity(0, 0)
        this.syncBodyToGround()
        return
      }
    }

    if (this.lying) {
      if (this.isMovePressed()) {
        this.lying = false
      } else {
        this.sprite.setVelocity(0, 0)
        this.syncBodyToGround()
        return
      }
    }

    const ox = this.gx
    const oy = this.gy
    this.moveOnGround(dt)
    this.updateHop(dt)
    this.syncBodyToGround()
    this.netMoving =
      Math.hypot(this.gx - ox, this.gy - oy) > 0.05 ||
      this.isMovePressed() ||
      !!this.moveTarget ||
      this.jumping

    if (this.punchBuffered && this.scene.time.now >= this.attackReadyAt) {
      this.punchBuffered = false
      this.punch()
    }
  }

  private afterPhysics = () => {
    if (!this.sprite.active) return

    this.sprite.setPosition(this.gx, this.gy + this.hop)
    const scale = PLAYER_SHEET.scale
    this.shadow.setPosition(this.gx, this.gy + 28 * scale)

    if (this.jumping) {
      const height = Math.min(-this.hop / JUMP_APEX, 1)
      this.shadow.setScale(1 - height * 0.45, 1 - height * 0.45)
      this.shadow.setAlpha(0.35 - height * 0.2)
    } else if (this.sitting || this.lying) {
      this.shadow.setScale(1.25, 1)
      this.shadow.setAlpha(0.4)
    } else {
      this.shadow.setScale(1)
      this.shadow.setAlpha(0.35)
    }
  }

  private syncBodyToGround() {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body
    body.x = this.gx - body.halfWidth
    body.y = this.gy - body.halfHeight
    body.velocity.set(0, 0)
    body.stop()
  }

  private bindCombatInput() {
    this.scene.input.on('pointerdown', this.onPointerDown)
    this.scene.input.on('pointermove', this.onPointerMove)
    this.scene.input.mouse?.disableContextMenu()
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (ControlsHelp.blocksPointer(pointer) || Minimap.blocksPointer(pointer)) return
    if (pointer.leftButtonDown()) this.punch()
    if (pointer.rightButtonDown()) this.setClickMoveFromPointer(pointer, true)
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (ControlsHelp.blocksPointer(pointer) || Minimap.blocksPointer(pointer)) return
    if (pointer.rightButtonDown()) this.setClickMoveFromPointer(pointer, false)
  }

  /** Walk to a world-space point (right-click move / minimap click). */
  moveToWorld(x: number, y: number, showMarker = true) {
    if (this.jumping || this.stunned) return
    this.stopSmoke()
    if (this.sitting) this.standUp()
    if (this.lying) this.lying = false

    const bounds = this.scene.physics.world.bounds
    const tx = Phaser.Math.Clamp(x, bounds.x + 14, bounds.right - 14)
    const ty = Phaser.Math.Clamp(y, bounds.y + 20, bounds.bottom - 20)
    this.moveTarget = { x: tx, y: ty }
    if (showMarker) this.spawnClickMarker(tx, ty)
    else this.moveClickMarker(tx, ty)
  }

  private setClickMoveFromPointer(pointer: Phaser.Input.Pointer, showMarker: boolean) {
    if (this.jumping || this.attacking || this.stunned) return
    const world = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
    this.moveToWorld(world.x, world.y, showMarker)
  }

  private clearClickMove() {
    this.moveTarget = null
  }

  private clearClickMarker() {
    this.clickMarker?.destroy(true)
    this.clickMarker = null
  }

  private spawnClickMarker(x: number, y: number) {
    this.clearClickMarker()
    const ring = this.scene.add
      .ellipse(0, 0, 22, 12, 0xffffff, 0)
      .setStrokeStyle(2, 0x4ade80, 0.95)
    const core = this.scene.add.ellipse(0, 0, 8, 4, 0x4ade80, 0.55)
    this.clickMarker = this.scene.add.container(x, y, [ring, core]).setDepth(8)

    this.scene.tweens.add({
      targets: ring,
      scaleX: 2.2,
      scaleY: 2.2,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.Out',
    })
    this.scene.tweens.add({
      targets: core,
      scaleX: 0.4,
      scaleY: 0.4,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.Out',
      onComplete: () => this.clearClickMarker(),
    })
  }

  private moveClickMarker(x: number, y: number) {
    if (this.clickMarker?.active) this.clickMarker.setPosition(x, y)
  }

  private punch() {
    if (this.sitting || this.lying || this.jumping || this.stunned) return

    if (this.scene.time.now < this.attackReadyAt) {
      this.punchBuffered = true
      return
    }

    this.stopSmoke()
    this.punchBuffered = false
    this.attackReadyAt = this.scene.time.now + ATTACK_COOLDOWN_MS
    this.attacking = true
    const seq = ++this.punchSeq

    const dir = facingVector(this.facing)
    const animKey = this.dirKey('player-punch')

    this.sprite.setFlipX(false)
    this.sprite.setScale(PLAYER_SHEET.scale)
    this.sprite.anims.play(animKey, false)
    this.flushAction()

    this.scene.time.delayedCall(PUNCH_HIT_MS, () => {
      if (seq !== this.punchSeq) return
      for (const target of this.targets) {
        const dx = target.x - this.gx
        const dy = target.y - this.gy
        const dist = Math.hypot(dx, dy)
        if (dist > PUNCH_RANGE || dist < 1) continue

        const nx = dx / dist
        const ny = dy / dist
        if (nx * dir.x + ny * dir.y < HIT_CONE_DOT) continue

        target.applyKnockback(dir.x * 0.85 + nx * 0.15, dir.y * 0.85 + ny * 0.15, PUNCH_FORCE)
      }
    })

    const endPunch = () => {
      if (seq !== this.punchSeq) return
      this.attacking = false
      if (this.punchBuffered && this.scene.time.now >= this.attackReadyAt) {
        this.punchBuffered = false
        this.punch()
        return
      }
      if (!this.isMovePressed() && !this.moveTarget) this.playIdle()
    }

    this.sprite.once(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      (anim: Phaser.Animations.Animation) => {
        if (anim.key === animKey) endPunch()
      },
    )

    this.scene.time.delayedCall(PUNCH_RECOVER_MS, endPunch)
  }

  private moveOnGround(dt: number) {
    let vx = 0
    let vy = 0

    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1

    const keyboardMove = vx !== 0 || vy !== 0
    if (keyboardMove) this.clearClickMove()

    if (!keyboardMove && this.moveTarget) {
      const dx = this.moveTarget.x - this.gx
      const dy = this.moveTarget.y - this.gy
      const dist = Math.hypot(dx, dy)
      if (dist < 6) {
        this.gx = this.moveTarget.x
        this.gy = this.moveTarget.y
        this.clearClickMove()
      } else {
        vx = dx / dist
        vy = dy / dist
      }
    }

    if (vx !== 0 && vy !== 0 && keyboardMove) {
      const inv = 1 / Math.SQRT2
      vx *= inv
      vy *= inv
    }

    const running = this.shiftKey.isDown
    const speed = running ? PLAYER_RUN_SPEED : PLAYER_SPEED

    this.gx += vx * speed * dt
    this.gy += vy * speed * dt

    const bounds = this.scene.physics.world.bounds
    this.gx = Phaser.Math.Clamp(this.gx, bounds.x + 14, bounds.right - 14)
    this.gy = Phaser.Math.Clamp(this.gy, bounds.y + 20, bounds.bottom - 20)

    const moving = vx !== 0 || vy !== 0
    if (moving) {
      if (Math.abs(vx) >= Math.abs(vy) && vx !== 0) {
        this.facing = vx < 0 ? 'left' : 'right'
      } else if (vy !== 0) {
        this.facing = vy < 0 ? 'up' : 'down'
      }

      if (!this.jumping && !this.attacking) {
        if (running) this.playRun()
        else this.playWalk()
      }
    } else if (!this.jumping && !this.attacking) {
      this.playIdle()
    }
  }

  private updateHop(dt: number) {
    if (!this.jumping) {
      this.hop = 0
      return
    }

    this.hopVelocity += JUMP_GRAVITY * dt
    this.hop += this.hopVelocity * dt

    const frames = this.jumpFrames()
    const n = frames.length
    let idx: number
    if (this.hopVelocity < 0) {
      const rise = Phaser.Math.Clamp(-this.hop / JUMP_APEX, 0, 1)
      if (rise < 0.2) idx = 0
      else if (rise < 0.55) idx = Math.min(1, n - 1)
      else idx = Math.min(2, n - 1)
    } else {
      const fall = Phaser.Math.Clamp(1 + this.hop / JUMP_APEX, 0, 1)
      if (fall < 0.45) idx = Math.min(3, n - 1)
      else idx = Math.min(4, n - 1)
    }
    this.sprite.anims.stop()
    this.sprite.setFrame(frames[idx])

    if (this.hop >= 0) {
      this.hop = 0
      this.hopVelocity = 0
      this.jumping = false
      this.playIdle()
    }
  }

  private playIdle() {
    const key = this.dirKey('player-idle')
    if (this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) {
      return
    }
    this.sprite.setFlipX(false)
    this.sprite.setAngle(0)
    this.sprite.setScale(PLAYER_SHEET.scale)
    this.sprite.anims.play(key, true)
  }

  private playWalk() {
    this.sprite.setFlipX(false)
    this.sprite.setScale(PLAYER_SHEET.scale)
    const key = this.dirKey('player-walk')
    if (this.sprite.anims.currentAnim?.key !== key) {
      this.sprite.anims.play(key, true)
    }
  }

  private playRun() {
    this.sprite.setFlipX(false)
    this.sprite.setScale(PLAYER_SHEET.scale)
    const key = this.dirKey('player-run')
    if (this.sprite.anims.currentAnim?.key !== key) {
      this.sprite.anims.play(key, true)
    }
  }

  private isMovePressed() {
    return (
      this.cursors.left.isDown ||
      this.cursors.right.isDown ||
      this.cursors.up.isDown ||
      this.cursors.down.isDown ||
      this.wasd.left.isDown ||
      this.wasd.right.isDown ||
      this.wasd.up.isDown ||
      this.wasd.down.isDown
    )
  }
}
