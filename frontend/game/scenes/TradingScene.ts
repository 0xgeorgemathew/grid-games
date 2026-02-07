import { Scene, GameObjects, Geom, Physics } from 'phaser'
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store'
import type { CoinType } from '../types/trading'
import { Token } from '../objects/Token'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'

// Import extracted systems
import { ParticleSystem } from '../systems/ParticleSystem'
import { CoinRenderer, COIN_CONFIG } from '../systems/CoinRenderer'
import { SpatialGrid } from '../systems/SpatialGrid'
import { VisualEffects } from '../systems/VisualEffects'
import { BladeRenderer } from '../systems/BladeRenderer'
import { AudioManager } from '../systems/AudioManager'

// =============================================================================
// Visual Configuration
// =============================================================================

const GRID_CONFIG = {
  color: 0x00f3ff,
  bgColor: 0x0a0a0a,
  size: 51,
} as const

// Re-export COIN_CONFIG for external use
export { COIN_CONFIG }

export class TradingScene extends Scene {
  // Game objects
  private tokenPool!: GameObjects.Group

  // Grid
  private gridGraphics!: GameObjects.Graphics
  private backgroundImage!: GameObjects.Image

  // Collision detection
  private collisionLine = new Geom.Line(0, 0, 0, 0)
  private collisionCircle = new Geom.Circle(0, 0, 0)

  // Extracted systems
  private particles!: ParticleSystem
  private coinRenderer!: CoinRenderer
  private spatialGrid!: SpatialGrid
  private visualEffects!: VisualEffects
  private bladeRenderer!: BladeRenderer
  private audio!: AudioManager

  // State
  private isShutdown = false
  private isMobile = false
  private eventEmitter: Phaser.Events.EventEmitter
  private userLeverage: string = '2x' // User's leverage for whale texture

  // Window visibility handlers for cleanup
  private visibilityChangeHandler?: () => void
  private windowBlurHandler?: () => void

  constructor() {
    super({ key: 'TradingScene' })
    this.eventEmitter = new Phaser.Events.EventEmitter()
  }

  preload(): void {
    // Preload audio assets
    this.audio = new AudioManager(this)
    this.audio.preload()
  }

  create(): void {
    this.isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height)

    // Get user's leverage from store for whale texture generation
    const store = useTradingStore.getState()
    this.userLeverage = store.userLeverage || '2x'

    // Initialize systems
    this.particles = new ParticleSystem(this)
    this.coinRenderer = new CoinRenderer(this)
    this.spatialGrid = new SpatialGrid()
    this.visualEffects = new VisualEffects(this, this.isMobile)
    this.bladeRenderer = new BladeRenderer(this, this.isMobile)
    this.audio.create()

    // Create vignette background texture once
    this.createVignetteBackground()

    // Create background image with vignette texture
    this.backgroundImage = this.add.image(0, 0, 'vignette-bg')
    this.backgroundImage.setOrigin(0, 0)
    this.backgroundImage.setDepth(-2)

    this.gridGraphics = this.add.graphics()
    this.gridGraphics.setDepth(-1)

    // Enable PostFX and add bloom for the electric neon effect
    // Bloom color naturally matches the cyan grid lines (0x00f3ff)
    this.gridGraphics.setPostPipeline('BloomPostFX')
    const bloomPipeline = this.gridGraphics.getPostPipeline('BloomPostFX') as any
    if (bloomPipeline) {
      // API varies by Phaser version - try both method and property
      if (typeof bloomPipeline.setBlurStrength === 'function') {
        bloomPipeline.setBlurStrength(1.2)
      } else if ('strength' in bloomPipeline) {
        bloomPipeline.strength = 1.2
      } else if ('blurStrength' in bloomPipeline) {
        bloomPipeline.blurStrength = 1.2
      }

      if (typeof bloomPipeline.setBlurQuality === 'function') {
        bloomPipeline.setBlurQuality(2)
      } else if ('blurQuality' in bloomPipeline) {
        bloomPipeline.blurQuality = 2
      }
    }

    // Generate textures with user's leverage for whale coin
    this.coinRenderer.generateCachedTextures(this.userLeverage)

    // Token pool (use regular group since Token manages its own physics in spawn())
    this.tokenPool = this.add.group({
      classType: Token,
      runChildUpdate: true,
      maxSize: 50,
      active: true,
      createCallback: (token) => {
        const t = token as Token
        t.setVisible(false)
        t.setActive(false)
      },
    })

    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this))
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this))
    this.eventEmitter.on('whale_2x_activated', this.handleWhale2XActivated.bind(this))
    this.eventEmitter.on('sound_muted', (muted: boolean) => {
      this.audio.setMuted(muted)
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.bladeRenderer.updateBladePath(pointer.x, pointer.y)
      // Play swipe sound only on fast, deliberate swipes (not normal mouse movement)
      const velocity = this.bladeRenderer.getBladeVelocity()
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
      if (speed > 25) {
        this.audio.playSwipe()
      }
    })

    this.input.on('pointerup', () => this.bladeRenderer.clearBladePath())
    this.input.on('pointerout', () => this.bladeRenderer.clearBladePath())

    // Handle window visibility changes to clear blade when tab loses focus
    // This prevents "ghost blade" artifacts when clicking outside the game window
    this.visibilityChangeHandler = () => {
      if (document.hidden) {
        this.bladeRenderer.clearBladePath()
      }
    }
    this.windowBlurHandler = () => {
      this.bladeRenderer.clearBladePath()
    }

    // Use document visibility API for tab switching (Alt+Tab, Cmd+Tab)
    document.addEventListener('visibilitychange', this.visibilityChangeHandler)
    // Also handle window blur for clicking outside the browser
    window.addEventListener('blur', this.windowBlurHandler)
    ;(window as { phaserEvents?: PhaserEventBridge }).phaserEvents = this
      .eventEmitter as PhaserEventBridge
    ;(window as { setSceneReady?: (ready: boolean) => void }).setSceneReady = (ready: boolean) => {
      useTradingStore.getState().isSceneReady = ready
    }
    ;(window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady?.(true)

    const updateDimensions = () => {
      if (!this.isCameraAvailable()) return
      ;(window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions = {
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      }
    }

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      if (!this.isCameraAvailable()) return

      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height)
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height)
      this.createVignetteBackground()
      this.drawGridBackground()
      updateDimensions()
    })

    updateDimensions()
    setTimeout(updateDimensions, 100)
    setTimeout(updateDimensions, 300)
    setTimeout(updateDimensions, 500)
  }

  update(): void {
    if (this.isShutdown) return

    const delta = 1000 / 60

    this.updateGrid()
    this.updateCoinPhysics()
    this.particles.update(delta)
    this.bladeRenderer.draw()
    this.checkCollisions()
    this.visualEffects.update()
  }

  private drawGridBackground(): void {
    // Update background image size to match viewport
    this.backgroundImage.setDisplaySize(this.cameras.main.width, this.cameras.main.height)
  }

  private updateGrid(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const time = this.time.now / 1000
    const cellSize = GRID_CONFIG.size

    // Digital breathing: modulate bloom intensity via alpha
    const pulseIntensity = 0.4 + Math.sin(time * 2) * 0.15

    // Clear grid graphics (background is separate image)
    this.gridGraphics.clear()

    const numVerticalLines = Math.ceil(width / cellSize)
    const numHorizontalLines = Math.ceil(height / cellSize) + 1 // +1 for seamless scrolling

    // =========================================================================
    // GRID SCROLL ANIMATION (moves top to bottom, infinite loop)
    // =========================================================================
    const scrollSpeed = 30 // pixels per second (slow, smooth scroll)
    const gridOffset = (time * scrollSpeed) % cellSize // loops every cell height

    this.gridGraphics.setBlendMode(Phaser.BlendModes.ADD)
    this.gridGraphics.lineStyle(2, GRID_CONFIG.color, pulseIntensity)

    // Draw vertical lines (constant position, don't scroll)
    for (let i = 0; i <= numVerticalLines; i++) {
      const x = i * cellSize
      this.gridGraphics.lineBetween(x, 0, x, height)
    }

    // Draw horizontal lines with vertical scroll offset
    for (let j = -1; j <= numHorizontalLines; j++) {
      const y = j * cellSize + gridOffset
      if (y >= -cellSize && y <= height + cellSize) {
        this.gridGraphics.lineBetween(0, y, width, y)
      }
    }

    // =========================================================================
    // DIGITAL VERTICES with scroll animation
    // =========================================================================
    const vertexSize = 4
    for (let i = 0; i <= numVerticalLines; i++) {
      for (let j = -1; j <= numHorizontalLines; j++) {
        const x = i * cellSize
        const y = j * cellSize + gridOffset

        // Only draw if visible
        if (y >= -vertexSize && y <= height + vertexSize) {
          // Outer cyan glow square
          this.gridGraphics.fillStyle(GRID_CONFIG.color, pulseIntensity * 0.6)
          this.gridGraphics.fillRect(x - vertexSize / 2, y - vertexSize / 2, vertexSize, vertexSize)

          // Inner bright white core square
          this.gridGraphics.fillStyle(0xffffff, pulseIntensity)
          this.gridGraphics.fillRect(x - 1.5, y - 1.5, 3, 3)
        }
      }
    }

    // Modulate bloom intensity based on pulse for "humming" effect
    const bloomPipeline = this.gridGraphics.getPostPipeline('BloomPostFX') as any
    if (bloomPipeline) {
      const newStrength = 1 + Math.sin(time * 2) * 0.3
      if (typeof bloomPipeline.setBlurStrength === 'function') {
        bloomPipeline.setBlurStrength(newStrength)
      } else if ('strength' in bloomPipeline) {
        bloomPipeline.strength = newStrength
      } else if ('blurStrength' in bloomPipeline) {
        bloomPipeline.blurStrength = newStrength
      }
    }
  }

  private updateCoinPhysics(): void {
    if (!this.tokenPool) return

    const sceneHeight = this.cameras.main.height

    this.tokenPool.getChildren().forEach((token) => {
      const t = token as Token
      if (!t.active) return

      const coinId = t.getData('id')
      const gridX = (t.getData('gridX') as number) ?? t.x
      const gridY = (t.getData('gridY') as number) ?? t.y

      if (t.y > sceneHeight + 200) {
        this.spatialGrid.removeCoinFromGrid(coinId, gridX, gridY)
        t.setActive(false)
        t.setVisible(false)
        if (t.body) t.body.stop()
        return
      }

      if (Math.abs(t.x - gridX) > 1 || Math.abs(t.y - gridY) > 1) {
        this.spatialGrid.removeCoinFromGrid(coinId, gridX, gridY)
        this.spatialGrid.addCoinToGrid(coinId, t.x, t.y)
        t.setData('gridX', t.x)
        t.setData('gridY', t.y)
      }
    })
  }

  private removeCoin(coinId: string): void {
    // Find token in pool
    const token = this.tokenPool.getChildren().find((t) => {
      const tokenObj = t as Token
      return tokenObj.getData('id') === coinId && tokenObj.active
    }) as Token | undefined

    if (token) {
      // Get tracked grid position (not current position)
      const gridX = (token.getData('gridX') as number) ?? token.x
      const gridY = (token.getData('gridY') as number) ?? token.y

      // Remove from spatial grid using tracked position
      this.spatialGrid.removeCoinFromGrid(coinId, gridX, gridY)

      // Disable physics before returning to pool
      if (token.body) {
        this.physics.world.disableBody(token.body)
      }

      // Return to pool
      token.setActive(false)
      token.setVisible(false)
    }
  }

  shutdown(): void {
    this.isShutdown = true
    this.tweens.killAll()

    this.particles.destroy()
    this.gridGraphics?.destroy()
    this.backgroundImage?.destroy()
    this.visualEffects.setShutdown(true)
    this.visualEffects.destroy()
    this.bladeRenderer.destroy()
    this.audio.destroy()

    this.scale.off('resize')

    const setReady = (window as unknown as { setSceneReady?: (ready: boolean) => void })
      .setSceneReady
    setReady?.(false)
    delete (window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady
    delete (window as { phaserEvents?: PhaserEventBridge }).phaserEvents

    // Remove window event listeners to prevent memory leaks
    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler)
      this.visibilityChangeHandler = undefined
    }
    if (this.windowBlurHandler) {
      window.removeEventListener('blur', this.windowBlurHandler)
      this.windowBlurHandler = undefined
    }

    this.tokenPool.clear(true, true)
    this.eventEmitter.destroy()
    this.spatialGrid.clear()

    this.input.off('pointermove')
    this.input.off('pointerup')
    this.input.off('pointerout')
  }

  private checkCollisions(): void {
    // Get all collision segments (center + edges for recent blade positions)
    const segments = this.bladeRenderer.getCollisionSegments()
    if (segments.length === 0) return

    // Guard against shutdown - tokenPool may be destroyed
    if (!this.tokenPool) return

    // Track sliced coins this frame to prevent double-slicing
    const slicedThisFrame = new Set<string>()

    // Iterate pool and check all nearby coins against all segments
    for (const token of this.tokenPool.getChildren()) {
      const tokenObj = token as Token
      if (!tokenObj.active) continue

      const coinId = tokenObj.getData('id')
      if (slicedThisFrame.has(coinId)) continue

      const type = tokenObj.getData('type') as CoinType
      const config = COIN_CONFIG[type]

      // Hitbox: 85% of visual size, accounting for mobile scale (matching Token.spawn())
      const mobileScale = this.isMobile ? 1.3 : 1
      const hitboxRadius = config.radius * 0.85 * mobileScale * (config.hitboxMultiplier ?? 1.0)
      this.collisionCircle.setTo(tokenObj.x, tokenObj.y, hitboxRadius)

      // Check against all collision segments
      for (const seg of segments) {
        this.collisionLine.setTo(seg.x1, seg.y1, seg.x2, seg.y2)

        if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
          this.sliceCoin(coinId, tokenObj)
          slicedThisFrame.add(coinId)
          break // Move to next coin once sliced
        }
      }
    }
  }

  private isCameraAvailable(): boolean {
    return this.cameras?.main !== undefined
  }

  private createVignetteBackground(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    // Create canvas texture for vignette effect
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Create radial gradient: center (0x051014) → edges (0x000000)
    const centerX = width / 2
    const centerY = height / 2
    const maxRadius = Math.max(width, height) / 1.5
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius)

    // Dark charcoal/teal center to pure black edges
    gradient.addColorStop(0, '#051014')
    gradient.addColorStop(0.6, '#03080a')
    gradient.addColorStop(1, '#000000')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Add texture to cache
    const textureKey = 'vignette-bg'
    if (this.textures.exists(textureKey)) {
      this.textures.remove(textureKey)
    }
    this.textures.addCanvas(textureKey, canvas)

    // Update existing background image or create new one
    if (this.backgroundImage) {
      this.backgroundImage.setTexture(textureKey)
      this.backgroundImage.setDisplaySize(width, height)
    }
  }

  private handleCoinSpawn(data: {
    coinId: string
    coinType: CoinType
    x: number
    y: number
  }): void {
    if (this.isShutdown || !this.tokenPool) return

    const config = COIN_CONFIG[data.coinType]
    if (!config) return

    const token = this.tokenPool.get(data.x, data.y) as Token
    if (!token) return

    if (token.body && token.body.enable) {
      token.body.enable = true
    }

    // For whale coins, use leverage-specific texture key
    const textureKey =
      data.coinType === 'whale' ? `texture_whale_${this.userLeverage}` : `texture_${data.coinType}`

    token.spawn(data.x, data.y, data.coinType, data.coinId, config, this.isMobile, textureKey)

    token.setData('gridX', token.x)
    token.setData('gridY', token.y)

    this.spatialGrid.addCoinToGrid(data.coinId, token.x, token.y)
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }): void {
    // Guard against events firing after scene shutdown
    if (this.isShutdown || !this.add || !this.cameras) return

    this.visualEffects.showOpponentSlice(data.playerName, data.coinType)
  }

  private sliceCoin(coinId: string, coin: Token): void {
    const type = coin.getData('type') as CoinType
    const config = COIN_CONFIG[type]
    const store = useTradingStore.getState()

    // Play slice SFX (boom) when slicing a coin
    this.audio.playSlice()

    this.particles.emitSlice(coin.x, coin.y, config.color, 20)
    this.visualEffects.createDirectionalArrow(coin.x, coin.y, type)
    this.visualEffects.createSplitEffect(coin.x, coin.y, config.color, config.radius, type)

    if (type === 'gas') {
      store.sliceCoin(coinId, type, 0)
      this.removeCoin(coinId)
      return
    }

    const currentPrice = store.priceData?.price ?? DEFAULT_BTC_PRICE
    store.sliceCoin(coinId, type, currentPrice)

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015)
    }

    this.removeCoin(coinId)
  }

  private handleWhale2XActivated(data: {
    playerId: string
    playerName: string
    durationMs: number
    isLocalPlayer: boolean
  }): void {
    // Visual indicator is now in React HUD (GameHUD.tsx)
    // This scene only forwards the event via window.phaserEvents
    // No Phaser-side rendering needed
  }
}
