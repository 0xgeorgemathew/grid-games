import { Geom } from 'phaser'
import { Token } from '../objects/Token'

export class SpatialGrid {
  private spatialGrid = new Map<string, Set<string>>()
  private readonly CELL_SIZE = 60

  /**
   * Get the grid cell key for a given position
   */
  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.CELL_SIZE)
    const cellY = Math.floor(y / this.CELL_SIZE)
    return `${cellX},${cellY}`
  }

  /**
   * Add a coin to the spatial grid
   */
  addCoinToGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    if (!this.spatialGrid.has(key)) {
      this.spatialGrid.set(key, new Set())
    }
    this.spatialGrid.get(key)!.add(coinId)
  }

  /**
   * Remove a coin from the spatial grid
   */
  removeCoinFromGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    const cell = this.spatialGrid.get(key)
    if (cell) {
      cell.delete(coinId)
      if (cell.size === 0) {
        this.spatialGrid.delete(key)
      }
    }
  }

  /**
   * Get all coins near a line segment (for collision detection)
   */
  getCoinsNearLine(p1: Geom.Point, p2: Geom.Point): Set<string> {
    const nearbyCoins = new Set<string>()

    // Get all cells the line passes through
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) / this.CELL_SIZE + 1

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = p1.x + dx * t
      const y = p1.y + dy * t
      const key = this.getCellKey(x, y)

      // Check current cell and adjacent cells (3x3 grid)
      const [cx, cy] = key.split(',').map(Number)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const neighborKey = `${cx + ox},${cy + oy}`
          const cell = this.spatialGrid.get(neighborKey)
          if (cell) {
            cell.forEach((coinId) => nearbyCoins.add(coinId))
          }
        }
      }
    }

    return nearbyCoins
  }

  /**
   * Rebuild the spatial grid from a token pool
   */
  rebuildFromTokenPool(tokenPool: Phaser.GameObjects.Group): void {
    this.spatialGrid.clear()

    tokenPool.getChildren().forEach((token) => {
      const tokenObj = token as Token
      if (!tokenObj.active) return
      const coinId = tokenObj.getData('id')
      this.addCoinToGrid(coinId, tokenObj.x, tokenObj.y)
    })
  }

  /**
   * Clear the spatial grid
   */
  clear(): void {
    this.spatialGrid.clear()
  }
}
