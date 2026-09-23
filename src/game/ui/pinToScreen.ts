import Phaser from 'phaser'

type ScreenPinned = Phaser.GameObjects.Components.Transform &
  Phaser.GameObjects.Components.ScrollFactor &
  Phaser.GameObjects.Components.Visible

/**
 * Pin a HUD object to fixed screen coordinates on the HUD camera (zoom 1).
 * Call on create / resize / content size change — not every frame.
 */
export function pinToScreen(
  _scene: Phaser.Scene,
  obj: ScreenPinned,
  screenX: number,
  screenY: number,
) {
  obj.setScrollFactor(0)
  obj.setScale(1)
  obj.setPosition(Math.round(screenX), Math.round(screenY))
}
