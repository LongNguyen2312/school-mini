import Phaser from 'phaser'
import { crispText, refreshCrispText, textResolution } from '../ui/crispText'

/** Bold, high-DPI speech bubble — snapped to avoid blur under camera zoom. */
export function makeChatBubble(scene: Phaser.Scene, x: number, y: number) {
  const text = crispText(
    scene.add
      .text(x, y, '', {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#0a0e0ccc',
        padding: { x: 10, y: 6 },
        wordWrap: { width: 200 },
        align: 'center',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(13)
      .setVisible(false),
  )
  text.setResolution(Math.max(3, textResolution()))
  text.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
  return text
}

export function showChatBubble(
  text: Phaser.GameObjects.Text,
  message: string,
  durationMs = 4200,
): number {
  text.setText(message).setVisible(true)
  text.setFontStyle('bold')
  text.setStroke('#000000', 5)
  text.setResolution(Math.max(3, textResolution()))
  text.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
  refreshCrispText(text)
  return performance.now() + durationMs
}

export function snapBubble(
  text: Phaser.GameObjects.Text,
  x: number,
  y: number,
) {
  text.setPosition(Math.round(x), Math.round(y))
}
