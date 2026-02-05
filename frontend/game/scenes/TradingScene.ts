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

// =============================================================================
// Visual Configuration
// =============================================================================

const GRID_CONFIG = {
  color: 0x00f3ff,
  bgColor: 0x0a0a0a,
  size: 60,
} as const

// Re-export COIN_CONFIG for external use
export { COIN_CONFIG }

export class TradingScene extends Scene {
  // Game objects
  private tokenPool!: GameObjects.Group

  // Grid
  private gridGraphics!: GameObjects.Graphics

  // Collision detection
  private collisionLine = new Geom.Line(0, 0, 0, 0)
  private collisionCircle = new Geom.Circle(0, 0, 0)

  // Extracted systems
  private particles!: ParticleSystem
  private coinRenderer!: CoinRenderer
  private spatialGrid!: SpatialGrid
  private visualEffects!: VisualEffects
  private bladeRenderer!: BladeRenderer

  // State
  private isShutdown = false
  private isMobile = false
  private eventEmitter: Phaser.Events.EventEmitter

  constructor() {
    super({ key: 'TradingScene' })
    this.eventEmitter = new Phaser.Events.EventEmitter()
  }

  create(): void {
    this.isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height)

    // Initialize systems
    this.particles = new ParticleSystem(this)
    this.coinRenderer = new CoinRenderer(this)
    this.spatialGrid = new SpatialGrid()
    this.visualEffects = new VisualEffects(this, this.isMobile)
    this.bladeRenderer = new BladeRenderer(this, this.isMobile)

    this.gridGraphics = this.add.graphics()
    this.gridGraphics.setDepth(-1)
    this.drawGridBackground()

    this.coinRenderer.generateCachedTextures()

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

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.bladeRenderer.updateBladePath(pointer.x, pointer.y)
    })

    this.input.on('pointerup', () => this.bladeRenderer.clearBladePath())
    this.input.on('pointerout', () => this.bladeRenderer.clearBladePath())
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
    this.bladeRenderer.draw((x, y) => this.particles.emitTrail(x, y, 2))
    this.checkCollisions()
    this.visualEffects.update()
  }

  private drawGridBackground(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    this.gridGraphics.fillStyle(GRID_CONFIG.bgColor, 1)
    this.gridGraphics.fillRect(0, 0, width, height)
  }

  private updateGrid(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const time = this.time.now / 1000
    const pulseIntensity = 0.15 + Math.sin(time * 2) * 0.05

    this.gridGraphics.clear()
    this.gridGraphics.setBlendMode(Phaser.BlendModes.NORMAL)
    this.gridGraphics.fillStyle(GRID_CONFIG.bgColor, 1)
    this.gridGraphics.fillRect(0, 0, width, height)

    this.gridGraphics.setBlendMode(Phaser.BlendModes.ADD)

    const numVerticalLines = Math.ceil(width / GRID_CONFIG.size)
    const numHorizontalLines = Math.ceil(height / GRID_CONFIG.size)

    // Vertical lines
    for (let i = 0; i <= numVerticalLines; i++) {
      const x = i * GRID_CONFIG.size
      this.gridGraphics.lineStyle(6, GRID_CONFIG.color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(x, 0, x, height)
      this.gridGraphics.lineStyle(3, GRID_CONFIG.color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(x, 0, x, height)
      this.gridGraphics.lineStyle(1, GRID_CONFIG.color, pulseIntensity)
      this.gridGraphics.lineBetween(x, 0, x, height)
    }

    // Horizontal lines
    for (let j = 0; j <= numHorizontalLines; j++) {
      const y = j * GRID_CONFIG.size
      this.gridGraphics.lineStyle(6, GRID_CONFIG.color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(0, y, width, y)
      this.gridGraphics.lineStyle(3, GRID_CONFIG.color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(0, y, width, y)
      this.gridGraphics.lineStyle(1, GRID_CONFIG.color, pulseIntensity)
      this.gridGraphics.lineBetween(0, y, width, y)
    }

    // Intersections
    for (let i = 0; i <= numVerticalLines; i++) {
      for (let j = 0; j <= numHorizontalLines; j++) {
        const x = i * GRID_CONFIG.size
        const y = j * GRID_CONFIG.size

        this.gridGraphics.fillStyle(GRID_CONFIG.color, pulseIntensity * 1.25)
        this.gridGraphics.fillCircle(x, y, 6)

        this.gridGraphics.fillStyle(0xffffff, pulseIntensity * 2.5)
        this.gridGraphics.fillCircle(x, y, 2.5)
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
    this.visualEffects.setShutdown(true)
    this.visualEffects.destroy()
    this.bladeRenderer.destroy()

    this.scale.off('resize')

    const setReady = (window as unknown as { setSceneReady?: (ready: boolean) => void })
      .setSceneReady
    setReady?.(false)
    delete (window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady
    delete (window as { phaserEvents?: PhaserEventBridge }).phaserEvents

    this.tokenPool.clear(true, true)
    this.eventEmitter.destroy()
    this.spatialGrid.clear()

    this.input.off('pointermove')
    this.input.off('pointerup')
    this.input.off('pointerout')
  }

  private checkCollisions(): void {
    // Check collisions whenever blade has points (no gesture state check)
    const bladePath = this.bladeRenderer.getBladePath()
    if (bladePath.length < 2) return

    // Guard against shutdown - tokenPool may be destroyed
    if (!this.tokenPool) return

    const p1 = bladePath[bladePath.length - 2]
    const p2 = bladePath[bladePath.length - 1]

    // Reuse line instance (update coordinates instead of creating new)
    this.collisionLine.setTo(p1.x, p1.y, p2.x, p2.y)

    // Get nearby coins from spatial grid
    const nearbyCoinIds = this.spatialGrid.getCoinsNearLine(p1, p2)

    // Track sliced coins this frame to prevent double-slicing
    const slicedThisFrame = new Set<string>()

    // Iterate pool and check nearby coins
    for (const token of this.tokenPool.getChildren()) {
      const tokenObj = token as Token
      if (!tokenObj.active) continue

      const coinId = tokenObj.getData('id')
      if (!nearbyCoinIds.has(coinId) || slicedThisFrame.has(coinId)) continue

      const type = tokenObj.getData('type') as CoinType
      const config = COIN_CONFIG[type]

      // Hitbox: 85% of visual size, accounting for mobile scale (matching Token.spawn())
      const mobileScale = this.isMobile ? 1.3 : 1
      const hitboxRadius = config.radius * 0.85 * mobileScale * (config.hitboxMultiplier ?? 1.0)
      this.collisionCircle.setTo(tokenObj.x, tokenObj.y, hitboxRadius)

      if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
        this.sliceCoin(coinId, tokenObj)
        slicedThisFrame.add(coinId)
        // NOTE: No break here - allows multi-coin combos in single fast swipe
      }
    }
  }

  private isCameraAvailable(): boolean {
    return this.cameras?.main !== undefined
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

    token.spawn(data.x, data.y, data.coinType, data.coinId, config, this.isMobile)

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
