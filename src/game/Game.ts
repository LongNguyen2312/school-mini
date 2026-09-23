import Phaser from 'phaser'
import type { PlayerProfile } from '../multiplayer/types'
import { InteriorScene } from './scenes/InteriorScene'
import { WorldScene } from './scenes/WorldScene'

export function createGame(parent: HTMLElement, profile?: PlayerProfile): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1a1a2e',
    callbacks: {
      preBoot: (g) => {
        if (profile) g.registry.set('profile', profile)
      },
    },
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
    scene: [WorldScene, InteriorScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    fps: {
      target: 60,
      smoothStep: true,
    },
    render: {
      // Nearest sampling via texture filters; roundPixels off so zoom stays smooth
      antialias: false,
      roundPixels: false,
      powerPreference: 'high-performance',
      batchSize: 4096,
    },
    input: {
      activePointers: 3,
    },
  })
  if (profile) game.registry.set('profile', profile)
  return game
}
