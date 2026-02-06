import { Scene } from 'phaser'
import type { CoinType } from '../types/trading'

// Coin configuration for visual rendering (Classic Casino Token theme)
// Colors: Muted, metallic tones with thick dark edges for milled rim effect
// Hitbox multipliers adjust slice difficulty: larger = easier, smaller = harder
export const COIN_CONFIG = {
  call: {
    color: 0x4a7c59, // Muted Forest Green
    edgeColor: 0x2d4a35, // Dark Green (milled edge)
    radius: 12,
    hitboxMultiplier: 1.4, // 40% larger hitbox - easier to slice
  },
  put: {
    color: 0x8b3a3a, // Muted Burgundy
    edgeColor: 0x4a1f1f, // Dark Burgundy (milled edge)
    radius: 12,
    hitboxMultiplier: 1.4, // 40% larger hitbox - easier to slice
  },
  gas: {
    color: 0xc9a227, // Antique Gold
    edgeColor: 0x8b6914, // Bronze (milled edge)
    radius: 12,
    innerColor: 0xff8c00, // Orange inner (keep gradient for gas)
    hitboxMultiplier: 2.0, // 2x hitbox - much easier to slice (encourage quick reaction)
  },
  whale: {
    color: 0x6b4c8a, // Royal Purple
    edgeColor: 0x3d2a4f, // Dark Purple (milled edge)
    radius: 15, // Slightly larger than regular
    hitboxMultiplier: 0.7, // 30% smaller hitbox - harder to slice (reward precision)
  },
} as const

export class CoinRenderer {
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * Helper function to adjust color brightness
   * Used for creating metallic gradient effects on casino tokens
   */
  private adjustBrightness(hexColor: number, factor: number): number {
    const color = Phaser.Display.Color.ValueToColor(hexColor)
    color.red = Math.floor(Math.min(255, color.red * factor))
    color.green = Math.floor(Math.min(255, color.green * factor))
    color.blue = Math.floor(Math.min(255, color.blue * factor))
    return Phaser.Display.Color.GetColor(color.red, color.green, color.blue)
  }

  /**
   * Draw skull symbol for penalty coins
   * Cranium (circle) + jaw (rounded rect) + eye sockets + nose
   */
  private drawSkull(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    color: number
  ): void {
    // Cranium (circle)
    graphics.fillStyle(color, 1)
    graphics.fillCircle(x, y - size * 0.1, size * 0.35)

    // Jaw (rounded rect)
    graphics.fillRoundedRect(x - size * 0.25, y + size * 0.15, size * 0.5, size * 0.25, size * 0.1)

    // Eye sockets (black)
    graphics.fillStyle(0x000000, 1)
    graphics.fillCircle(x - size * 0.12, y - size * 0.15, size * 0.1)
    graphics.fillCircle(x + size * 0.12, y - size * 0.15, size * 0.1)

    // Nose triangle
    graphics.fillTriangle(
      x,
      y - size * 0.05,
      x - size * 0.08,
      y + size * 0.05,
      x + size * 0.08,
      y + size * 0.05
    )
  }

  /**
   * Generate whale texture with dynamic multiplier display
   * @param leverage - Leverage multiplier string (e.g., '2x', '5x', '10x', '20x')
   */
  private generateWhaleTexture(leverage: string): void {
    const config = COIN_CONFIG.whale

    // Quadruple the texture size for smooth gradients
    const scale = 4
    const diameter = (config.radius * 2 + 4) * scale

    // Create a container to hold all elements
    const container = this.scene.add.container(0, 0)

    // Create graphics for coin body
    const graphics = this.scene.add.graphics()
    const scaledRadius = config.radius * scale

    // =========================================================================
    // CLASSIC CASINO TOKEN LAYERED STRUCTURE (from bottom to top)
    // =========================================================================

    // 1. OUTER RIM / MILLED EDGE (thick dark border)
    graphics.fillStyle(config.edgeColor, 1)
    graphics.fillCircle(0, 0, scaledRadius)

    // 2. MAIN BODY with radial gradient (metallic 3D effect)
    for (let r = scaledRadius * 0.95; r >= scaledRadius * 0.2; r -= 0.5) {
      const t = r / scaledRadius
      const brightness = 1 - t * 0.4
      const shadeColor = this.adjustBrightness(config.color, brightness)
      graphics.fillStyle(shadeColor, 1)
      graphics.fillCircle(0, 0, r)
    }

    // 3. INNER RING (bright border at ~70% radius)
    const innerRingRadius = scaledRadius * 0.7
    graphics.lineStyle(2 * scale, 0xffffff, 0.6)
    graphics.strokeCircle(0, 0, innerRingRadius)

    // 4. RIDGE DETAILS (decorative tick marks around inner ring)
    graphics.lineStyle(1 * scale, config.edgeColor, 0.4)
    const numRidges = 24
    for (let i = 0; i < numRidges; i++) {
      const angle = (i / numRidges) * Math.PI * 2
      const innerR = innerRingRadius - 3 * scale
      const outerR = innerRingRadius + 3 * scale
      graphics.beginPath()
      graphics.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR)
      graphics.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
      graphics.strokePath()
    }

    // 5. CENTER AREA (slightly raised platform)
    const centerShade = this.adjustBrightness(config.color, 1.1)
    graphics.fillStyle(centerShade, 1)
    graphics.fillCircle(0, 0, scaledRadius * 0.65)

    container.add(graphics)

    // =========================================================================
    // WHALE: Draw red/gold split on purple body
    // =========================================================================
    graphics.fillStyle(0x8b3a3a, 0.9) // Burgundy
    graphics.fillCircle(0, 0, scaledRadius * 0.6)

    // Gold half (right side) - overlay
    graphics.fillStyle(0xc9a227, 0.9) // Antique Gold
    graphics.fillCircle(scaledRadius * 0.3, 0, scaledRadius * 0.55)

    // =========================================================================
    // DYNAMIC LEVERAGE TEXT
    // =========================================================================
    const symbol = leverage.toUpperCase()
    const symbolScale = config.radius * 0.7 * scale

    // Shadow first (offset and blurred)
    const shadowText = this.scene.add
      .text(2 * scale, 2 * scale, symbol, {
        fontSize: `${symbolScale}px`,
        fontStyle: 'bold',
        fontFamily: 'Arial',
        color: '#000000',
      })
      .setOrigin(0.5)

    // Main text on top (white with black outline)
    const mainText = this.scene.add
      .text(0, 0, symbol, {
        fontSize: `${symbolScale}px`,
        fontStyle: 'bold',
        fontFamily: 'Arial',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2 * scale,
      })
      .setOrigin(0.5)

    container.add(shadowText)
    container.add(mainText)

    // =========================================================================
    // GENERATE TEXTURE FROM CONTAINER
    // =========================================================================
    const renderTexture = this.scene.make.renderTexture(
      { width: diameter, height: diameter },
      false
    )
    renderTexture.draw(container, diameter / 2, diameter / 2)

    // Use leverage-specific texture key
    const textureKey = `texture_whale_${leverage.toLowerCase()}`
    renderTexture.saveTexture(textureKey)

    // Set linear filtering for smooth scaling on high-DPI displays
    this.scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.LINEAR)

    renderTexture.destroy()
    container.destroy()
  }

  /**
   * Generate all cached coin textures
   * @param userLeverage - User's leverage for whale texture (e.g., '2x', '5x', '10x', '20x')
   */
  generateCachedTextures(userLeverage: string = '2x'): void {
    const textureKeys: Array<CoinType> = ['call', 'put', 'gas'] // Exclude whale (handled separately)

    textureKeys.forEach((type) => {
      const config = COIN_CONFIG[type]

      // Quadruple the texture size for smooth gradients
      const scale = 4
      const diameter = (config.radius * 2 + 4) * scale

      // Create a container to hold all elements
      const container = this.scene.add.container(0, 0)

      // Create graphics for coin body
      const graphics = this.scene.add.graphics()
      const scaledRadius = config.radius * scale

      // =========================================================================
      // CLASSIC CASINO TOKEN LAYERED STRUCTURE (from bottom to top)
      // =========================================================================

      // 1. OUTER RIM / MILLED EDGE (thick dark border)
      graphics.fillStyle(config.edgeColor, 1)
      graphics.fillCircle(0, 0, scaledRadius)

      // 2. MAIN BODY with radial gradient (metallic 3D effect)
      for (let r = scaledRadius * 0.95; r >= scaledRadius * 0.2; r -= 0.5) {
        const t = r / scaledRadius
        const brightness = 1 - t * 0.4
        const shadeColor = this.adjustBrightness(config.color, brightness)
        graphics.fillStyle(shadeColor, 1)
        graphics.fillCircle(0, 0, r)
      }

      // 3. INNER RING (bright border at ~70% radius)
      const innerRingRadius = scaledRadius * 0.7
      graphics.lineStyle(2 * scale, 0xffffff, 0.6)
      graphics.strokeCircle(0, 0, innerRingRadius)

      // 4. RIDGE DETAILS (decorative tick marks around inner ring)
      graphics.lineStyle(1 * scale, config.edgeColor, 0.4)
      const numRidges = 24
      for (let i = 0; i < numRidges; i++) {
        const angle = (i / numRidges) * Math.PI * 2
        const innerR = innerRingRadius - 3 * scale
        const outerR = innerRingRadius + 3 * scale
        graphics.beginPath()
        graphics.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR)
        graphics.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
        graphics.strokePath()
      }

      // 5. CENTER AREA (slightly raised platform)
      const centerShade = this.adjustBrightness(config.color, 1.1)
      graphics.fillStyle(centerShade, 1)
      graphics.fillCircle(0, 0, scaledRadius * 0.65)

      container.add(graphics)

      // =========================================================================
      // SYMBOL RENDERING (with raised appearance - drop shadow)
      // =========================================================================

      let symbol: string
      let symbolScale: number

      if (type === 'gas') {
        // Gas: skull symbol drawn with graphics
        const skullGraphics = this.scene.add.graphics()
        this.drawSkull(skullGraphics, 0, 0, config.radius * scale, 0xffffff)
        container.add(skullGraphics)
        symbol = ''
        symbolScale = 0
      } else {
        // Call/Put: BTC ₿ symbol
        symbol = '₿'
        symbolScale = config.radius * 0.8 * scale
      }

      // Add text symbol with drop shadow for raised appearance
      if (symbol) {
        const shadowText = this.scene.add
          .text(2 * scale, 2 * scale, symbol, {
            fontSize: `${symbolScale}px`,
            fontStyle: 'bold',
            fontFamily: 'Arial',
            color: '#000000',
          })
          .setOrigin(0.5)

        const mainText = this.scene.add
          .text(0, 0, symbol, {
            fontSize: `${symbolScale}px`,
            fontStyle: 'bold',
            fontFamily: 'Arial',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2 * scale,
          })
          .setOrigin(0.5)

        container.add(shadowText)
        container.add(mainText)
      }

      // =========================================================================
      // GENERATE TEXTURE FROM CONTAINER
      // =========================================================================
      const renderTexture = this.scene.make.renderTexture(
        { width: diameter, height: diameter },
        false
      )
      renderTexture.draw(container, diameter / 2, diameter / 2)
      renderTexture.saveTexture(`texture_${type}`)

      this.scene.textures.get(`texture_${type}`).setFilter(Phaser.Textures.FilterMode.LINEAR)

      renderTexture.destroy()
      container.destroy()
    })

    // Generate whale texture with user's leverage
    this.generateWhaleTexture(userLeverage)
  }
}
