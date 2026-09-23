import Phaser from 'phaser'

/** Device pixel ratio used for sharp HUD / world labels. */
export function textResolution() {
  return Math.min(4, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 1.5)))
}

/**
 * Crisp text — high resolution + linear filter so glyphs stay sharp
 * under zoom, HUD pin, and fractional camera scroll.
 */
export function crispText<T extends Phaser.GameObjects.Text>(text: T): T {
  text.setResolution(textResolution())
  text.setPadding(2, 2, 2, 2)
  text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
  // Snap display size so sub-pixel scaling doesn't blur glyphs
  text.setScale(1)
  return text
}

/** Call after setFontSize / setText that changes glyph atlas. */
export function refreshCrispText<T extends Phaser.GameObjects.Text>(text: T): T {
  text.setResolution(textResolution())
  text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
  return text
}
