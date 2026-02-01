import { Scene, GameObjects, Physics } from 'phaser'
import type { CoinType } from '../types/trading'

export interface CoinConfig {
  color: number
  symbol: string
  arrow: string
  radius: number
  innerColor: number
}

export class Token extends GameObjects.Container {
  public body: Physics.Arcade.Body | null = null
  private image: GameObjects.Image
  private config: CoinConfig

  constructor(scene: Scene) {
    super(scene, 0, 0)

    // Create image (texture set in spawn())
    this.image = scene.add.image(0, 0, 'texture_call')
    this.add(this.image)

    // Default config (will be overridden in spawn())
    this.config = {
      color: 0xf7931a,
      symbol: '₿',
      arrow: '▲',
      radius: 28,
      innerColor: 0xffd700,
    }
  }

  /**
   * Initialize token with type and position.
   * Called by object pool when spawning.
   */
  spawn(
    x: number,
    y: number,
    type: CoinType,
    id: string,
    config: CoinConfig,
    isMobile: boolean
  ): void {
    this.config = config

    // Reset container state
    this.setVisible(true)
    this.setActive(true)
    this.setRotation(0)

    // Update texture
    this.image.setTexture(`texture_${type}`)

    // Apply mobile scale
    const scale = isMobile ? 1.3 : 1
    this.setScale(scale)

    // Store metadata
    this.setData('id', id)
    this.setData('type', type)
    this.setData('rotationSpeed', (Math.random() - 0.5) * 0.05)

    // Store initial position for incremental spatial grid updates
    this.setData('oldX', x)
    this.setData('oldY', y)

    // Ensure physics body is enabled
    if (!this.body) {
      this.scene.physics.add.existing(this)
      this.body = this.body as Physics.Arcade.Body
    }

    // Reset physics state (clear accumulated forces)
    this.body.reset(x, y) // Cleaner than setPosition for physics bodies
    this.body.setAcceleration(0, 0) // Clear any accumulated forces
    this.body.setVelocity(0, 0) // Clear velocity before setting new values

    // Configure physics (Fruit Ninja style - Floaty Heavy feel)
    this.body.setVelocity(
      0, // X: No horizontal drift
      Phaser.Math.Between(100, 200) // Y: Downwards 100-200
    )
    this.body.setGravity(0, 150) // Low gravity (Floaty feel)
    this.body.setBounce(0) // No bounce
    this.body.setCollideWorldBounds(false) // Fall through edges

    // Hitbox: 85% of visual size (forgiving slicing)
    const hitboxRadius = config.radius * 0.85 * scale
    this.body.setCircle(hitboxRadius)

    // Angular velocity for slow rotation effect
    this.body.setAngularVelocity(Phaser.Math.Between(-50, 50))
  }

  /**
   * Handle slice event - play death animation then return to pool.
   */
  onSlice(): void {
    // Return to pool (deactivate)
    this.setActive(false)
    this.setVisible(false)

    // Reset physics
    if (this.body) {
      this.body.stop()
      this.body.setVelocity(0, 0)
      this.body.setAngularVelocity(0)
    }
  }

  /**
   * Update rotation (not handled by physics).
   */
  preUpdate(time: number, delta: number): void {
    // Rotation handled by angular velocity
  }
}
