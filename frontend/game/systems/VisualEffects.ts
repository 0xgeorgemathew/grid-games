import { Scene, GameObjects } from 'phaser'
import type { CoinType } from '../types/trading'
import { COIN_CONFIG } from './CoinRenderer'

export class VisualEffects {
  private scene: Scene
  private isMobile: boolean
  private isShutdown = false

  // Visual effect arrays
  private opponentSlices: GameObjects.Text[] = []
  private damageIndicators: GameObjects.Text[] = []
  private sliceArrows: GameObjects.Text[] = []
  private electricalArcs: GameObjects.Graphics[] = []

  // Split effect pool
  private splitEffectPool: {
    left: GameObjects.Graphics
    right: GameObjects.Graphics
    leftContainer: GameObjects.Container
    rightContainer: GameObjects.Container
  }[] = []
  private readonly SPLIT_POOL_SIZE = 10

  constructor(scene: Scene, isMobile: boolean) {
    this.scene = scene
    this.isMobile = isMobile
  }

  /**
   * Update text objects (damage indicators, slice arrows, opponent slices)
   */
  updateTextObjects(arr: GameObjects.Text[], vy: number, alphaDelta: number): void {
    for (let i = arr.length - 1; i >= 0; i--) {
      const text = arr[i]
      text.y += vy
      text.alpha += alphaDelta
      if (text.alpha <= 0) {
        text.destroy()
        arr.splice(i, 1)
      }
    }
  }

  /**
   * Update all visual effects (called from scene update)
   */
  update(): void {
    this.updateTextObjects(this.opponentSlices, -1, -0.02)
    this.updateTextObjects(this.damageIndicators, -1.5, -0.02)
    this.updateTextObjects(this.sliceArrows, 0, 0)
  }

  /**
   * Show opponent slice notification
   */
  showOpponentSlice(playerName: string, coinType: CoinType): void {
    if (this.isShutdown || !this.scene.add || !this.scene.cameras) return

    const config = COIN_CONFIG[coinType]

    // Use percentage-based margins for mobile compatibility
    const margin = Math.min(100, this.scene.cameras.main.width * 0.15)

    // Convert color number to hex string
    const colorHex = '#' + config.color.toString(16).padStart(6, '0')

    const text = this.scene.add
      .text(
        Phaser.Math.Between(margin, this.scene.cameras.main.width - margin),
        Phaser.Math.Between(margin, this.scene.cameras.main.height - margin),
        `${playerName}: ${coinType.toUpperCase()}!`,
        {
          fontSize: this.isMobile ? '28px' : '20px',
          fontStyle: 'bold',
          fontFamily: 'Arial, sans-serif',
          color: colorHex,
          stroke: '#000000',
          strokeThickness: 4,
          shadow: {
            offsetX: 0,
            offsetY: 0,
            blur: 8,
            color: colorHex,
            stroke: false,
            fill: true,
          },
        }
      )
      .setOrigin(0.5)

    this.opponentSlices.push(text)
    this.scene.cameras.main.flash(100, 255, 255, 255, false)
  }

  /**
   * Show damage indicator (floating text)
   */
  showDamageIndicator(x: number, y: number, amount: number, isGain: boolean): void {
    if (this.isShutdown || !this.scene.add || !this.scene.cameras) return

    const color = isGain ? 0x4ade80 : 0xf87171 // green-400 or red-400
    const colorHex = '#' + color.toString(16).padStart(6, '0')
    const sign = amount > 0 ? '+' : ''

    const text = this.scene.add
      .text(x, y, `${sign}$${amount}`, {
        fontSize: this.isMobile ? '24px' : '18px',
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
        color: colorHex,
        stroke: '#000000',
        strokeThickness: 3,
        shadow: {
          offsetX: 0,
          offsetY: 0,
          blur: 6,
          color: colorHex,
          stroke: false,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setDepth(1003) // Above electrical arcs (1002)

    this.damageIndicators.push(text)
  }

  /**
   * Create directional arrow text for coin slices
   */
  createDirectionalArrow(x: number, y: number, coinType: CoinType): void {
    if (this.isShutdown || !this.scene.add || !this.scene.cameras) return

    const config = COIN_CONFIG[coinType]
    let text: string
    let color: number = config.color // Widened type with 'let'
    let fontSize = this.isMobile ? '34px' : '28px' // Larger for prominence

    // Determine text based on coin type
    if (coinType === 'call') {
      text = 'LONG - BTC'
    } else if (coinType === 'put') {
      text = 'Short BTC'
    } else if (coinType === 'gas') {
      text = 'PENALTY'
      color = 0xffd700 // Gold
      fontSize = this.isMobile ? '38px' : '32px'
    } else if (coinType === 'whale') {
      text = '2X'
      color = 0x39ff14 // Electric Lime (green)
      fontSize = this.isMobile ? '56px' : '48px'
    } else {
      // Fallback (shouldn't happen)
      text = '?'
      fontSize = this.isMobile ? '56px' : '44px'
    }

    const colorHex = '#' + color.toString(16).padStart(6, '0')

    // Offset text upward to avoid overlap with explosion shards
    const verticalOffset = coinType === 'whale' ? 60 : 45

    const textObj = this.scene.add
      .text(x, y - verticalOffset, text, {
        fontSize,
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
        color: colorHex,
        stroke: '#000000',
        strokeThickness: 8,
        shadow: {
          offsetX: 0,
          offsetY: 0,
          blur: 20,
          color: colorHex,
          stroke: false,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setDepth(1004)

    this.sliceArrows.push(textObj)

    // Slow fade - 3500ms for easy readability
    this.scene.tweens.add({
      targets: textObj,
      y: y - verticalOffset - 100,
      alpha: 0,
      duration: 3500,
      ease: 'Power1',
      onComplete: () => {
        if (!this.isShutdown) {
          textObj.destroy()
          const idx = this.sliceArrows.indexOf(textObj)
          if (idx >= 0) this.sliceArrows.splice(idx, 1)
        }
      },
    })
  }

  /**
   * Create electrical arc effect
   */
  private createElectricalArc(x: number, y: number, color: number): void {
    // Create electrical arc effect using jagged lines
    const arcGraphics = this.scene.add.graphics()
    this.electricalArcs.push(arcGraphics) // Track for cleanup

    arcGraphics.setDepth(1002)
    arcGraphics.lineStyle(2, 0xffffff, 0.8)
    arcGraphics.setBlendMode(Phaser.BlendModes.ADD)

    const numArcs = Phaser.Math.Between(3, 5)
    const arcLength = 50

    for (let i = 0; i < numArcs; i++) {
      const angle = (Math.PI * 2 * i) / numArcs
      let currentX = x
      let currentY = y

      arcGraphics.beginPath()
      arcGraphics.moveTo(currentX, currentY)

      // Create jagged path
      const segments = Phaser.Math.Between(3, 6)
      for (let j = 0; j < segments; j++) {
        const segmentLength = arcLength / segments
        const jitter = Phaser.Math.FloatBetween(-0.3, 0.3) // Random angle jitter
        const newAngle = angle + jitter
        currentX += Math.cos(newAngle) * segmentLength
        currentY += Math.sin(newAngle) * segmentLength
        arcGraphics.lineTo(currentX, currentY)
      }

      arcGraphics.strokePath()
    }

    // Fade out and destroy
    this.scene.tweens.add({
      targets: arcGraphics,
      alpha: 0,
      duration: 200,
      ease: 'Power2',
      onComplete: () => {
        // Double-check guard: scene may have shut down during tween
        if (this.isShutdown) return

        arcGraphics.destroy()
        // Remove from tracking array
        const idx = this.electricalArcs.indexOf(arcGraphics)
        if (idx >= 0) this.electricalArcs.splice(idx, 1)
      },
    })
  }

  /**
   * Get a split effect from the pool or create new
   */
  private getSplitEffectFromPool(): {
    left: Phaser.GameObjects.Graphics
    right: Phaser.GameObjects.Graphics
    leftContainer: Phaser.GameObjects.Container
    rightContainer: Phaser.GameObjects.Container
  } | null {
    const effect = this.splitEffectPool.pop()
    if (effect) {
      effect.left.setVisible(true)
      effect.right.setVisible(true)
      effect.leftContainer.setVisible(true)
      effect.rightContainer.setVisible(true)
    }
    return effect || null
  }

  /**
   * Return a split effect to the pool
   */
  private returnSplitEffectToPool(effect: {
    left: Phaser.GameObjects.Graphics
    right: Phaser.GameObjects.Graphics
    leftContainer: Phaser.GameObjects.Container
    rightContainer: Phaser.GameObjects.Container
  }): void {
    effect.left.setVisible(false)
    effect.right.setVisible(false)
    effect.leftContainer.setVisible(false)
    effect.rightContainer.setVisible(false)
    // Limit pool size to prevent memory bloat
    if (this.splitEffectPool.length < this.SPLIT_POOL_SIZE) {
      this.splitEffectPool.push(effect)
    } else {
      // Pool full, destroy the objects
      effect.left.destroy()
      effect.right.destroy()
      effect.leftContainer.destroy()
      effect.rightContainer.destroy()
    }
  }

  /**
   * Create split effect for sliced coins
   */
  createSplitEffect(
    x: number,
    y: number,
    color: number,
    radius: number,
    coinType?: CoinType
  ): void {
    const pooled = this.getSplitEffectFromPool()

    const leftHalf = pooled?.left || this.scene.add.graphics()
    const rightHalf = pooled?.right || this.scene.add.graphics()
    const leftContainer = pooled?.leftContainer || this.scene.add.container(x, y)
    const rightContainer = pooled?.rightContainer || this.scene.add.container(x, y)

    if (!pooled) {
      // Only create graphics if not from pool
      // Draw left semicircle with enhanced glow
      leftHalf.fillStyle(color, 1)
      leftHalf.beginPath()
      leftHalf.arc(0, 0, radius, Math.PI, Math.PI * 2)
      leftHalf.fillPath()

      // Add glow effect
      leftHalf.lineStyle(3, color, 0.5)
      leftHalf.beginPath()
      leftHalf.arc(0, 0, radius + 2, Math.PI, Math.PI * 2)
      leftHalf.strokePath()

      leftContainer.add(leftHalf)

      // Draw right semicircle with enhanced glow
      rightHalf.fillStyle(color, 1)
      rightHalf.beginPath()
      rightHalf.arc(0, 0, radius, 0, Math.PI)
      rightHalf.fillPath()

      // Add glow effect
      rightHalf.lineStyle(3, color, 0.5)
      rightHalf.beginPath()
      rightHalf.arc(0, 0, radius + 2, 0, Math.PI)
      rightHalf.strokePath()

      rightContainer.add(rightHalf)
    }

    // Update positions
    leftContainer.setPosition(x, y)
    rightContainer.setPosition(x, y)
    leftContainer.setAlpha(1)
    rightContainer.setAlpha(1)
    leftContainer.setRotation(0)
    rightContainer.setRotation(0)

    // Track completion separately
    let leftComplete = false
    let rightComplete = false

    const handleComplete = () => {
      // Guard against shutdown - pool may be destroyed
      if (this.isShutdown) {
        // Clean up non-pooled effects to prevent leaks
        if (!pooled) {
          leftContainer?.destroy()
          rightContainer?.destroy()
        }
        return
      }

      if (pooled) {
        // Only return when BOTH complete
        if (leftComplete && rightComplete) {
          this.returnSplitEffectToPool(pooled)
        }
      } else {
        // Non-pooled: each cleans up its own container
        leftContainer?.destroy()
        rightContainer?.destroy()
      }
    }

    // Animate halves flying apart with more dramatic movement
    const flyDistance = coinType === 'whale' ? 60 : 40
    const rotationAmount = coinType === 'whale' ? 1.5 : 1

    this.scene.tweens.add({
      targets: leftContainer,
      x: x - flyDistance,
      y: y + flyDistance * 0.5,
      rotation: -rotationAmount,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        leftComplete = true
        handleComplete()
      },
    })

    this.scene.tweens.add({
      targets: rightContainer,
      x: x + flyDistance,
      y: y - flyDistance * 0.5,
      rotation: rotationAmount,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        rightComplete = true
        handleComplete()
      },
    })

    // Add electrical arc effect for GAS coins
    if (coinType === 'gas') {
      this.createElectricalArc(x, y, color)
    }

    // Tron-style impact flash: brief white burst followed by colored flash
    // The white flash simulates the high-intensity "shatter" moment
    this.scene.cameras.main.flash(50, 255, 255, 255, false) // Quick white burst

    // Followed by a subtle colored flash
    this.scene.time.delayedCall(50, () => {
      if (!this.isShutdown) {
        this.scene.cameras.main.flash(
          80,
          (color >> 16) & 0xff,
          (color >> 8) & 0xff,
          color & 0xff,
          false
        )
      }
    })
  }

  /**
   * Mark as shutdown to prevent new effects
   */
  setShutdown(value: boolean): void {
    this.isShutdown = value
  }

  /**
   * Destroy all visual effects
   */
  destroy(): void {
    this.isShutdown = true

    this.electricalArcs.forEach((arc) => arc.destroy())
    this.electricalArcs.length = 0

    this.opponentSlices.forEach((t) => t.destroy())
    this.opponentSlices.length = 0

    this.damageIndicators.forEach((t) => t.destroy())
    this.damageIndicators.length = 0

    this.sliceArrows.forEach((t) => t.destroy())
    this.sliceArrows.length = 0

    this.splitEffectPool.forEach((e) => {
      e.left.destroy()
      e.right.destroy()
      e.leftContainer.destroy()
      e.rightContainer.destroy()
    })
    this.splitEffectPool.length = 0
  }
}
