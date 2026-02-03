import { AUTO } from 'phaser'

// Grid dimensions
export interface GridConfig {
  cols: number
  rows: number
  tileSize: number
}

export const DEFAULT_GRID: GridConfig = {
  cols: 9,
  rows: 20,
  tileSize: 44,
}

// Trading scene dimensions (fixed for consistent gameplay)
export const TRADING_DIMENSIONS = {
  width: 600,
  height: 800,
} as const

// Mobile-aware scale helpers
export function getMobileScaleMultiplier(): number {
  if (typeof window === 'undefined') return 1
  const width = window.innerWidth
  // Scale down more aggressively for screens smaller than 600px
  // Minimum 0.5 scale (50% size) for very small screens
  return Math.max(0.5, Math.min(1, width / 600))
}

export function getCoinConfigScale(): number {
  return getMobileScaleMultiplier()
}

// Visual theme colors (consolidated magic numbers)
export const COLORS = {
  background: 0x0a0a0f, // Match MatchmakingScreen dark theme
  gridLine: 0x4a4a6a,
  hoverFill: 0x4a4a6a,
  selectedFill: 0xff00ff,
  playerFill: 0x00ff00,
} as const

// Rendering constants
export const RENDER = {
  gridLineWidth: 2,
  hoverAlpha: 0.2,
  selectedAlpha: 0.3,
  playerScale: 0.6,
  playerPulseScale: 1.2,
  playerPulseDuration: 100,
  moveDuration: 500,
  bounceScale: 0.7,
  bounceDuration: 80,
} as const

// Common physics config (zero gravity for top-down games)
const PHYSICS_CONFIG = {
  default: 'arcade',
  arcade: { gravity: { x: 0, y: 0 }, fps: 45 },
} as const

// Input config moved to factory function (evaluated when DOM exists)

interface PhaserConfigOptions {
  scene: Phaser.Types.Scenes.SceneType
  width: number
  height: number
  fitToScreen?: boolean
}

export function createPhaserConfig(options: PhaserConfigOptions): Phaser.Types.Core.GameConfig {
  const { scene, width, height, fitToScreen = false } = options

  // Create input config fresh each time (DOM element exists now)
  // Moving from module-level to factory fixes null target issue
  const inputConfig = {
    mouse: { target: document.getElementById('phaser-game') },
    touch: { target: document.getElementById('phaser-game') },
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    parent: 'phaser-game',
    width,
    height,
    backgroundColor: COLORS.background,
    fps: {
      target: 60, // Increase from 45 to 60 for smoother gameplay
      forceSetTimeOut: false,
    },
    physics: PHYSICS_CONFIG,
    input: inputConfig, // Add input config
    scene: [scene],
  }

  if (fitToScreen) {
    config.scale = {
      mode: Phaser.Scale.RESIZE,
    }
  }

  return config
}

// Convenience factory for GridScene
export function createGridPhaserConfig(
  scene: Phaser.Types.Scenes.SceneType,
  grid: GridConfig = DEFAULT_GRID
): Phaser.Types.Core.GameConfig {
  return createPhaserConfig({
    scene,
    width: grid.cols * grid.tileSize,
    height: grid.rows * grid.tileSize,
  })
}

// Convenience factory for TradingScene
export function createTradingPhaserConfig(
  scene: Phaser.Types.Scenes.SceneType
): Phaser.Types.Core.GameConfig {
  return createPhaserConfig({
    scene,
    width: TRADING_DIMENSIONS.width,
    height: TRADING_DIMENSIONS.height,
    fitToScreen: true,
  })
}
