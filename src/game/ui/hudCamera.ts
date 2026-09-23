import Phaser from 'phaser'

const HUD_CAM = 'hud'
const HUD_ROOTS = new WeakMap<Phaser.Scene, Set<Phaser.GameObjects.GameObject>>()

function hudRoots(scene: Phaser.Scene) {
  let set = HUD_ROOTS.get(scene)
  if (!set) {
    set = new Set()
    HUD_ROOTS.set(scene, set)
  }
  return set
}

/** Fixed screen-space camera for HUD (zoom/scroll-independent, no roundPixels jitter). */
export function getHudCamera(scene: Phaser.Scene) {
  let cam = scene.cameras.getCamera(HUD_CAM)
  if (!cam) {
    cam = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height, false, HUD_CAM)
    cam.setZoom(1)
    cam.setScroll(0, 0)
    cam.setRoundPixels(false)
    cam.transparent = true
    scene.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      cam?.setSize(gameSize.width, gameSize.height)
    })
  }
  return cam
}

/**
 * Call once late in scene.create() after world + HUD exist.
 * Main camera skips HUD; HUD camera skips the world (avoids double-draw + zoom jitter).
 */
export function installHudCamera(scene: Phaser.Scene) {
  const main = scene.cameras.main
  const hud = getHudCamera(scene)
  const roots = hudRoots(scene)

  const sync = (go: Phaser.GameObjects.GameObject) => {
    if (roots.has(go) || isUnderHudRoot(go, roots)) {
      main.ignore(go)
      return
    }
    hud.ignore(go)
  }

  for (const child of scene.children.list) sync(child)

  scene.events.on('addedtoscene', sync)
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off('addedtoscene', sync)
    HUD_ROOTS.delete(scene)
  })
}

/** Register a top-level HUD root so it only renders on the HUD camera. */
export function registerHud(scene: Phaser.Scene, root: Phaser.GameObjects.GameObject) {
  hudRoots(scene).add(root)
  getHudCamera(scene)
  scene.cameras.main.ignore(root)
}

function isUnderHudRoot(
  go: Phaser.GameObjects.GameObject,
  roots: Set<Phaser.GameObjects.GameObject>,
) {
  let parent = go.parentContainer as Phaser.GameObjects.Container | null
  while (parent) {
    if (roots.has(parent)) return true
    parent = parent.parentContainer
  }
  return false
}
