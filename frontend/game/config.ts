import { AUTO } from "phaser";

// Grid dimensions
export interface GridConfig {
  cols: number;
  rows: number;
  tileSize: number;
}

export const DEFAULT_GRID: GridConfig = {
  cols: 9,
  rows: 20,
  tileSize: 44,
};

// Visual theme colors (consolidated magic numbers)
export const COLORS = {
  background: "#1a1a2e",
  gridLine: 0x4a4a6a,
  hoverFill: 0x4a4a6a,
  selectedFill: 0xff00ff,
  playerFill: 0x00ff00,
} as const;

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
} as const;

export const createPhaserConfig = (
  scene: Phaser.Scene,
  grid?: GridConfig,
): Phaser.Types.Core.GameConfig => {
  const resolvedGrid = grid ?? DEFAULT_GRID;
  return {
    type: AUTO,
    parent: "phaser-game",
    width: resolvedGrid.cols * resolvedGrid.tileSize,
    height: resolvedGrid.rows * resolvedGrid.tileSize,
    backgroundColor: COLORS.background,
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
    scene: [scene],
  };
};
