import { Scene, GameObjects, Physics, Tweens } from 'phaser'
import type { CoinType } from '../types/trading'

export interface CoinConfig {
  color: number
  symbol: string
  arrow: string
  radius: number
  innerColor: number
  rotationSpeed?: number // Radians per second
  jitterAmount?: number // For gas coins
  hasTrail?: boolean // For whale coins
}

export class Token extends GameObjects.Container {
  public body: Physics.Arcade.Body | null = null
  private image: GameObjects.Image
  private config: CoinConfig
  private glowRing?: GameObjects.Graphics
  private spawnScaleTween?: Tweens.Tween
  private spawnRotationTween?: Tweens.Tween
  private yoyoScaleTween?: Tweens.Tween // Track nested tween for cleanup

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
    this.setDepth(10) // Render above grid (depth -1) and below blade (depth 1000)
    this.image.setDepth(10) // Ensure image inherits depth

    // Update texture with validation
    const textureKey = `texture_${type}`
    if (!this.scene.textures.exists(textureKey)) {
      console.error(`Missing texture: ${textureKey}, falling back to texture_call`)
      this.image.setTexture('texture_call')
    } else {
      this.image.setTexture(textureKey)
    }

    // Apply mobile scale (1.3x larger on mobile for better visibility)
    const scale = isMobile ? 1.3 : 1

    // Store metadata
    this.setData('id', id)
    this.setData('type', type)

    // Determine rotation behavior based on coin type
    let rotationSpeed = 0.5 // Default clockwise for CALL
    let jitterAmount = 0
    let hasTrail = false

    switch (type) {
      case 'call':
        rotationSpeed = 0.5 // Clockwise
        break
      case 'put':
        rotationSpeed = -0.5 // Counter-clockwise
        break
      case 'gas':
        rotationSpeed = 0
        jitterAmount = 2 // Jittery rotation
        break
      case 'whale':
        rotationSpeed = 1.2 // Double speed
        hasTrail = true
        break
    }

    this.setData('rotationSpeed', rotationSpeed)
    this.setData('jitterAmount', jitterAmount)
    this.setData('hasTrail', hasTrail)
    this.setData('spawnTime', this.scene.time.now)
    this.setData('baseScale', scale)

    // Store initial position for incremental spatial grid updates
    this.setData('oldX', x)
    this.setData('oldY', y)

    // Ensure physics body is enabled
    if (!this.body) {
      this.scene.physics.add.existing(this)
      // Verify body was actually created (physics.add.existing can fail)
      if (!this.body) {
        throw new Error('Failed to create physics body for Token')
      }
    }

    // Reset physics state (clear accumulated forces)
    this.body.reset(x, y)
    this.body.setAcceleration(0, 0)
    this.body.setVelocity(0, 0)

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

    // Start at minimum visible scale (prevents stuck-at-0)
    this.setScale(scale * 0.1)

    // Play spawn animation (elastic scale-in + rotation burst)
    this.playSpawnAnimation(scale, type)

    // Set initial angular velocity
    this.body.setAngularVelocity(rotationSpeed * 60) // Convert rad/s to deg/s for Phaser
  }

  private playSpawnAnimation(targetScale: number, type: CoinType): void {
    // Kill any existing spawn tweens
    if (this.spawnScaleTween) {
      this.spawnScaleTween.destroy()
    }
    if (this.spawnRotationTween) {
      this.spawnRotationTween.destroy()
    }
    if (this.yoyoScaleTween) {
      this.yoyoScaleTween.destroy()
    }

    // Elastic scale-in (0 → 1.2 → 1.0)
    this.spawnScaleTween = this.scene.tweens.add({
      targets: this,
      scale: targetScale * 1.2,
      duration: 150,
      ease: 'Back.easeOut',
      yoyo: true,
      onYoyo: () => {
        // After reaching 1.2x, tween back to 1.0x
        // Track nested tween for cleanup
        this.yoyoScaleTween = this.scene.tweens.add({
          targets: this,
          scale: targetScale,
          duration: 100,
          ease: 'Power2',
          onComplete: () => {
            // Fallback: ensure scale reaches target
            if (this.scale !== targetScale) {
              this.setScale(targetScale)
            }
          },
        })
      },
    })

    // Initial rotation burst (±90 degrees)
    const rotationBurst = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2)
    this.spawnRotationTween = this.scene.tweens.add({
      targets: this,
      angle: rotationBurst * (180 / Math.PI), // Convert to degrees
      duration: 200,
      ease: 'Power2.easeOut',
    })
  }

  /**
   * Handle slice event - play death animation then return to pool.
   */
  onSlice(): void {
    // Kill all tweens to prevent memory leaks
    if (this.spawnScaleTween) {
      this.spawnScaleTween.destroy()
      this.spawnScaleTween = undefined
    }
    if (this.spawnRotationTween) {
      this.spawnRotationTween.destroy()
      this.spawnRotationTween = undefined
    }
    if (this.yoyoScaleTween) {
      this.yoyoScaleTween.destroy()
      this.yoyoScaleTween = undefined
    }

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
   * Cleanup when token is destroyed (scene shutdown).
   * Ensures all tweens are properly destroyed.
   */
  destroy(): void {
    // Destroy all tweens to prevent memory leaks
    if (this.spawnScaleTween) {
      this.spawnScaleTween.destroy()
      this.spawnScaleTween = undefined
    }
    if (this.spawnRotationTween) {
      this.spawnRotationTween.destroy()
      this.spawnRotationTween = undefined
    }
    if (this.yoyoScaleTween) {
      this.yoyoScaleTween.destroy()
      this.yoyoScaleTween = undefined
    }

    // Destroy graphics objects
    if (this.glowRing) {
      this.glowRing.destroy()
      this.glowRing = undefined
    }

    // Clear image reference (will be destroyed by Container's destroy)
    this.image = null as any

    super.destroy()
  }

  /**
   * Update rotation (not handled by physics).
   */
  preUpdate(time: number, delta: number): void {
    const type = this.getData('type') as CoinType
    const jitterAmount = this.getData('jitterAmount') as number

    // Apply jitter for gas coins
    if (type === 'gas' && jitterAmount > 0) {
      const jitter = Phaser.Math.FloatBetween(-jitterAmount, jitterAmount)
      this.rotation += jitter * (delta / 1000)
    }
  }
}
