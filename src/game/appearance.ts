import Phaser from 'phaser'
import { PLAYER_FRAMES, PLAYER_BALD_SHEET, PLAYER_SHEET } from './data/playerAnims'

/** Default sleeveless cream reads as “white” in lobby. */
export const DEFAULT_SHIRT = 0xffffff

export function baseSheetKey(bald: boolean): string {
  return bald ? PLAYER_BALD_SHEET.key : PLAYER_SHEET.key
}

export function lookTextureKey(bald: boolean, shirt: number): string {
  if ((shirt >>> 0) === DEFAULT_SHIRT) {
    return baseSheetKey(bald)
  }
  return `plook6_${bald ? 1 : 0}_${(shirt >>> 0).toString(16)}`
}

/** Cream sleeveless top — not skin. */
function isShirtPixel(r: number, g: number, b: number, a: number, fy: number): boolean {
  if (a < 180) return false
  if (fy < 28 || fy > 46) return false
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const lum = (r + g + b) / 3
  if (lum < 155) return false
  if (r - b > 55) return false
  if (mx - mn > 55) return false
  return true
}

function paintColor(target: number, shade: number): number {
  const tr = (target >> 16) & 0xff
  const tg = (target >> 8) & 0xff
  const tb = target & 0xff
  const k = Phaser.Math.Clamp(shade, 0.55, 1.15)
  return (
    (Math.min(255, Math.round(tr * k)) << 16) |
    (Math.min(255, Math.round(tg * k)) << 8) |
    Math.min(255, Math.round(tb * k))
  )
}

function sourceImage(
  scene: Phaser.Scene,
  sheetKey: string,
): HTMLImageElement | HTMLCanvasElement | null {
  if (!scene.textures.exists(sheetKey)) return null
  const src = scene.textures.get(sheetKey).getSourceImage() as
    | HTMLImageElement
    | HTMLCanvasElement
    | Phaser.GameObjects.RenderTexture
  if (!src || !('width' in src) || !src.width) return null
  return src as HTMLImageElement | HTMLCanvasElement
}

function addSheetFrames(texture: Phaser.Textures.Texture, w: number, h: number) {
  const fw = PLAYER_SHEET.frameWidth
  const fh = PLAYER_SHEET.frameHeight
  const cols = Math.floor(w / fw)
  const rows = Math.floor(h / fh)
  let index = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      texture.add(index, 0, col * fw, row * fh, fw, fh)
      index++
    }
  }
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Shirt tint only — bald/haired comes from the precomposed base sheet. */
function bakeShirtTint(scene: Phaser.Scene, key: string, bald: boolean, shirt: number) {
  const baseKey = baseSheetKey(bald)
  const src = sourceImage(scene, baseKey)
  if (!src) {
    console.warn('[look] base sheet not ready', baseKey)
    return
  }
  const w = src.width
  const h = src.height

  if (scene.textures.exists(key)) {
    scene.textures.remove(key)
  }

  const canvasTex = scene.textures.createCanvas(key, w, h)
  if (!canvasTex) {
    console.warn('[look] createCanvas failed', key)
    return
  }

  const ctx = canvasTex.getContext()
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const fh = PLAYER_SHEET.frameHeight

  for (let i = 0; i < d.length; i += 4) {
    const pix = i / 4
    const y = Math.floor(pix / w)
    const fy = y % fh
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const a = d[i + 3]
    if (!isShirtPixel(r, g, b, a, fy)) continue
    const lum = (r + g + b) / 3
    const c = paintColor(shirt, Phaser.Math.Clamp(lum / 210, 0.7, 1.12))
    d[i] = (c >> 16) & 0xff
    d[i + 1] = (c >> 8) & 0xff
    d[i + 2] = c & 0xff
  }

  ctx.putImageData(img, 0, 0)
  canvasTex.refresh()
  addSheetFrames(canvasTex, w, h)
}

function ensureLookAnims(scene: Phaser.Scene, sheetKey: string) {
  if (sheetKey === PLAYER_SHEET.key) return
  const mk = (suffix: string, frames: readonly number[], rate: number, repeat: number) => {
    const key = `${sheetKey}-${suffix}`
    if (scene.anims.exists(key)) return
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(sheetKey, { frames: [...frames] }),
      frameRate: rate,
      repeat,
    })
  }

  mk('idle-up', PLAYER_FRAMES.idleUp, 5, -1)
  mk('idle-down', PLAYER_FRAMES.idleDown, 5, -1)
  mk('idle-left', PLAYER_FRAMES.idleLeft, 5, -1)
  mk('idle-right', PLAYER_FRAMES.idleRight, 5, -1)
  mk('walk-up', PLAYER_FRAMES.walkUp, 10, -1)
  mk('walk-down', PLAYER_FRAMES.walkDown, 10, -1)
  mk('walk-left', PLAYER_FRAMES.walkLeft, 10, -1)
  mk('walk-right', PLAYER_FRAMES.walkRight, 10, -1)
  mk('run-up', PLAYER_FRAMES.runUp, 14, -1)
  mk('run-down', PLAYER_FRAMES.runDown, 14, -1)
  mk('run-left', PLAYER_FRAMES.runLeft, 14, -1)
  mk('run-right', PLAYER_FRAMES.runRight, 14, -1)
  mk('sit-up', PLAYER_FRAMES.sitUp, 8, 0)
  mk('sit-down', PLAYER_FRAMES.sitDown, 8, 0)
  mk('sit-left', PLAYER_FRAMES.sitLeft, 8, 0)
  mk('sit-right', PLAYER_FRAMES.sitRight, 8, 0)
  mk('punch-up', PLAYER_FRAMES.punchUp, 22, 0)
  mk('punch-down', PLAYER_FRAMES.punchDown, 22, 0)
  mk('punch-left', PLAYER_FRAMES.punchLeft, 22, 0)
  mk('punch-right', PLAYER_FRAMES.punchRight, 22, 0)
  mk('jump-up', PLAYER_FRAMES.jumpUp, 12, 0)
  mk('jump-down', PLAYER_FRAMES.jumpDown, 12, 0)
  mk('jump-left', PLAYER_FRAMES.jumpLeft, 12, 0)
  mk('jump-right', PLAYER_FRAMES.jumpRight, 12, 0)
  mk('lie', PLAYER_FRAMES.lie, 10, 0)
  mk('smoke', PLAYER_FRAMES.smoke, 5, 0)
  mk('hit', PLAYER_FRAMES.hit, 10, 0)
}

/** Resolve look sheet: precomposed bald/haired + optional shirt tint. */
export function ensurePlayerLook(
  scene: Phaser.Scene,
  bald: boolean,
  shirtColor: number,
): string {
  const key = lookTextureKey(bald, shirtColor)
  if (key !== PLAYER_SHEET.key && key !== PLAYER_BALD_SHEET.key && !scene.textures.exists(key)) {
    bakeShirtTint(scene, key, bald, shirtColor >>> 0)
  }
  if (!scene.textures.exists(key)) {
    return baseSheetKey(bald)
  }
  ensureLookAnims(scene, key)
  return key
}

export function animKeyFor(sheetKey: string, suffix: string): string {
  if (sheetKey === PLAYER_SHEET.key) return `player-${suffix}`
  return `${sheetKey}-${suffix}`
}
