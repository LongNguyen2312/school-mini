import Phaser from 'phaser'
import { CAMERA_ZOOM_DEFAULT, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from './config'

/**
 * Smooth wheel zoom centered on the followed subject (player).
 * Does not re-anchor to the cursor — avoids fighting startFollow and jumping.
 */
export function bindCameraZoom(scene: Phaser.Scene) {
  const cam = scene.cameras.main
  cam.setZoom(CAMERA_ZOOM_DEFAULT)
  cam.setRoundPixels(false)

  let targetZoom = CAMERA_ZOOM_DEFAULT

  scene.input.on(
    'wheel',
    (
      _pointer: Phaser.Input.Pointer,
      _over: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ) => {
      if (Math.abs(deltaY) < 0.01) return
      const factor = Math.exp(-deltaY * 0.0016)
      targetZoom = Phaser.Math.Clamp(targetZoom * factor, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX)
    },
  )

  scene.events.on('update', () => {
    const cur = cam.zoom
    const diff = targetZoom - cur
    if (Math.abs(diff) < 0.0004) {
      if (cur !== targetZoom) cam.setZoom(targetZoom)
      return
    }
    cam.setZoom(cur + diff * 0.28)
  })
}
