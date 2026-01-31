import { Scene, GameObjects, Geom } from 'phaser'
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store'
import type { CoinType } from '../types/trading'

// Coin configuration for visual rendering (Bitcoin-style)
const COIN_CONFIG = {
  call: {
    color: 0xf7931a, // Bitcoin orange
    symbol: '₿',
    arrow: '▲',
    radius: 28,
    innerColor: 0xffd700, // Gold inner
  },
  put: {
    color: 0xf7931a, // Bitcoin orange
    symbol: '₿',
    arrow: '▼',
    radius: 28,
    innerColor: 0xcd8500, // Darker gold inner for puts
  },
  gas: {
    color: 0xffff00, // Yellow
    symbol: '⚡',
    arrow: '',
    radius: 28,
    innerColor: 0xffaa00,
  },
  whale: {
    color: 0xffd700, // Gold
    symbol: '₿',
    arrow: '★',
    radius: 45,
    innerColor: 0xffa500, // Orange inner
  },
} as const

export class TradingScene extends Scene {
  // Active game objects
  private coins: Map<string, Phaser.GameObjects.Container> = new Map()
  private opponentSlices: GameObjects.Text[] = []

  // Blade rendering
  private bladePath: Geom.Point[] = []
  private bladeGraphics!: GameObjects.Graphics

  // Reusable geometry for collision detection (prevents GC stutter)
  private collisionLine = new Geom.Line(0, 0, 0, 0)
  private collisionCircle = new Geom.Circle(0, 0, 0)

  // Spatial hash grid for O(1) collision detection
  private spatialGrid = new Map<string, Set<string>>()
  private readonly CELL_SIZE = 60 // Coin diameter ~56

  // Object pooling for particles (prevents GC stutter) - stores heterogeneous Phaser objects
  private particlePool: any[] = []
  private readonly PARTICLE_POOL_SIZE = 100

  // Event bridge to React store
  private eventEmitter: Phaser.Events.EventEmitter

  // Mobile detection and scaling
  private isMobile: boolean = false
  private readonly mobileScale: number = 1.3 // 30% larger coins on mobile
  private readonly mobileTrailLength: number = 20
  private readonly desktopTrailLength: number = 10

  constructor() {
    super({ key: 'TradingScene' })
    this.eventEmitter = new Phaser.Events.EventEmitter()
  }

  create(): void {
    // Detect mobile device
    this.isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS

    // Set physics world bounds
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height)

    // Create blade graphics (reused each frame)
    this.bladeGraphics = this.add.graphics()

    // Pre-allocate particle pool for explosions
    for (let i = 0; i < this.PARTICLE_POOL_SIZE; i++) {
      const particle = this.add.circle(0, 0, 4, 0xffffff)
      particle.setVisible(false)
      particle.setActive(false)
      this.particlePool.push(particle)
    }

    // Track mouse movement for blade trail
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.bladePath.push(new Geom.Point(pointer.x, pointer.y))
      // Limit trail length for performance (longer on mobile for smoother visuals)
      const maxTrailLength = this.isMobile ? this.mobileTrailLength : this.desktopTrailLength
      if (this.bladePath.length > maxTrailLength) {
        this.bladePath.shift()
      }
    })

    // Expose event emitter to window for React bridge
    // Phaser.Events.EventEmitter implements our PhaserEventBridge interface
    ;(window as { phaserEvents?: PhaserEventBridge }).phaserEvents = this
      .eventEmitter as PhaserEventBridge

    // Signal that scene is ready to receive events
    ;(window as { setSceneReady?: (ready: boolean) => void }).setSceneReady = (ready: boolean) => {
      const store = useTradingStore.getState()
      store.isSceneReady = ready
    }
    ;(window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady?.(true)
    console.log('[TradingScene] Scene ready, events can now be received')

    // Handle resize events to update physics world bounds
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height)
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height)
    })

    // Listen for store events
    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this))
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this))
  }

  update(): void {
    this.updateCoinPhysics()
    this.drawBlade()
    this.rebuildSpatialGrid() // Rebuild grid before collision checks
    this.checkCollisions()
    this.updateOpponentSlices()
  }

  // Spatial hash helpers
  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.CELL_SIZE)
    const cellY = Math.floor(y / this.CELL_SIZE)
    return `${cellX},${cellY}`
  }

  private addCoinToGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    if (!this.spatialGrid.has(key)) {
      this.spatialGrid.set(key, new Set())
    }
    this.spatialGrid.get(key)!.add(coinId)
  }

  private removeCoinFromGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    const cell = this.spatialGrid.get(key)
    if (cell) {
      cell.delete(coinId)
      if (cell.size === 0) {
        this.spatialGrid.delete(key)
      }
    }
  }

  private getCoinsNearLine(p1: Geom.Point, p2: Geom.Point): Set<string> {
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

  // Rebuild spatial grid (called once per frame before collision checks)
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear()
    this.coins.forEach((coin, coinId) => {
      this.addCoinToGrid(coinId, coin.x, coin.y)
    })
  }

  private updateCoinPhysics(): void {
    const height = this.cameras.main.height
    const coinsToRemove: string[] = []

    this.coins.forEach((coin) => {
      // Apply rotation (not handled by physics)
      coin.rotation += coin.getData('rotationSpeed') || 0

      // Remove coins that fall below screen
      if (coin.y > height + 50) {
        coinsToRemove.push(coin.getData('id')!)
      }
    })

    coinsToRemove.forEach((id) => this.removeCoin(id))
  }

  private removeCoin(coinId: string): void {
    const coin = this.coins.get(coinId)
    if (coin) {
      // Remove from spatial grid
      this.removeCoinFromGrid(coinId, coin.x, coin.y)

      // Disable physics body before destroying to prevent memory leaks
      const body = coin.body as Phaser.Physics.Arcade.Body | undefined
      if (body) {
        this.physics.world.disableBody(body)
      }
      coin.destroy()
      this.coins.delete(coinId)
    }
  }

  shutdown(): void {
    // Signal scene not ready before destroying event emitter
    const setReady = (window as unknown as { setSceneReady?: (ready: boolean) => void })
      .setSceneReady
    setReady?.(false)
    delete (window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady
    delete (window as { phaserEvents?: PhaserEventBridge }).phaserEvents

    this.eventEmitter.destroy()
    this.coins.clear()
    this.spatialGrid.clear()
    this.opponentSlices.forEach((t) => t.destroy())
    this.particlePool.forEach((p) => p.destroy())
    this.particlePool.length = 0
  }

  private drawBlade(): void {
    this.bladeGraphics.clear()
    if (this.bladePath.length < 2) return

    // Draw outer glow in a single pass
    this.bladeGraphics.lineStyle(8, 0x00ffff, 0.3)
    this.bladeGraphics.beginPath()
    this.bladePath.forEach((p, i) => {
      if (i === 0) this.bladeGraphics.moveTo(p.x, p.y)
      else this.bladeGraphics.lineTo(p.x, p.y)
    })
    this.bladeGraphics.strokePath()

    // Draw inner core with gradient fade (keeping fade effect)
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]
      const alpha = i / this.bladePath.length

      this.bladeGraphics.lineStyle(4, 0x00ffff, alpha)
      this.bladeGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y)
    }
  }

  private checkCollisions(): void {
    if (this.bladePath.length < 2) return

    const p1 = this.bladePath[this.bladePath.length - 2]
    const p2 = this.bladePath[this.bladePath.length - 1]

    // Reuse line instance (update coordinates instead of creating new)
    this.collisionLine.setTo(p1.x, p1.y, p2.x, p2.y)

    // Use spatial grid to get only nearby coins
    const nearbyCoinIds = this.getCoinsNearLine(p1, p2)

    for (const coinId of nearbyCoinIds) {
      const coin = this.coins.get(coinId)
      if (!coin) continue

      const type = coin.getData('type') as CoinType
      const config = COIN_CONFIG[type]

      // Reuse circle instance (update coordinates instead of creating new)
      this.collisionCircle.setTo(coin.x, coin.y, config.radius)

      if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
        this.sliceCoin(coinId, coin)
        break // One slice per frame
      }
    }
  }

  private updateOpponentSlices(): void {
    for (let i = this.opponentSlices.length - 1; i >= 0; i--) {
      const text = this.opponentSlices[i]
      text.y -= 1
      text.alpha -= 0.02
      if (text.alpha <= 0) {
        text.destroy()
        this.opponentSlices.splice(i, 1)
      }
    }
  }

  private handleCoinSpawn(data: {
    coinId: string
    coinType: CoinType
    x: number
    y: number
  }): void {
    // Guard against events firing after scene shutdown
    if (!this.add || !this.physics) return

    const config = COIN_CONFIG[data.coinType]
    if (!config) {
      return
    }

    const coin = this.add.container(data.x, data.y)

    coin.setData('id', data.coinId)
    coin.setData('type', data.coinType)
    coin.setData('rotationSpeed', (Math.random() - 0.5) * 0.05)

    // Apply mobile scale for larger touch targets
    const scale = this.isMobile ? this.mobileScale : 1
    const coinParts = [
      this.createCoinBody(config, scale),
      this.createCoinInner(config, scale),
      this.createCoinSymbol(config, scale),
    ]

    // Add direction arrow for call/put/whale coins
    const arrow = this.createCoinArrow(config, scale)
    if (arrow) coinParts.push(arrow)

    coin.add(coinParts)

    this.physics.add.existing(coin)

    const physicsBody = coin.body as Phaser.Physics.Arcade.Body
    physicsBody.setVelocity((Math.random() - 0.5) * 2, Math.random() * 3 + 2)
    physicsBody.setGravity(0, data.coinType === 'whale' ? 0.1 : 0.15)

    this.coins.set(data.coinId, coin)

    // Add to spatial grid
    this.addCoinToGrid(data.coinId, data.x, data.y)
  }

  private createCoinBody(
    config: (typeof COIN_CONFIG)[keyof typeof COIN_CONFIG],
    scale: number = 1
  ) {
    const body = this.add.circle(0, 0, config.radius * scale, config.color)
    body.setStrokeStyle(3, 0xffffff)
    return body
  }

  private createCoinInner(
    config: (typeof COIN_CONFIG)[keyof typeof COIN_CONFIG],
    scale: number = 1
  ) {
    const inner = this.add.circle(0, 0, config.radius * 0.75 * scale, config.innerColor)
    inner.setStrokeStyle(2, 0xffffff)
    inner.setAlpha(0.9)
    return inner
  }

  private createCoinSymbol(
    config: (typeof COIN_CONFIG)[keyof typeof COIN_CONFIG],
    scale: number = 1
  ) {
    // Main Bitcoin symbol
    const symbol = this.add
      .text(0, 2, config.symbol, {
        fontSize: `${config.radius * 0.8 * scale}px`,
        color: '#000000',
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
      })
      .setOrigin(0.5)

    return symbol
  }

  private createCoinArrow(
    config: (typeof COIN_CONFIG)[keyof typeof COIN_CONFIG],
    scale: number = 1
  ) {
    if (!config.arrow) return null

    // Direction indicator above/below the coin
    const arrowY = config.arrow === '▲' ? -config.radius * 0.5 : config.radius * 0.5
    const arrowColor = config.arrow === '▲' ? '#00ff00' : '#ff0000'

    const arrow = this.add
      .text(0, arrowY, config.arrow, {
        fontSize: `${config.radius * 0.4 * scale}px`,
        color: arrowColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    return arrow
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }): void {
    // Guard against events firing after scene shutdown
    if (!this.add || !this.cameras) return

    const config = COIN_CONFIG[data.coinType]

    // Use percentage-based margins for mobile compatibility
    const margin = Math.min(100, this.cameras.main.width * 0.15)

    const text = this.add
      .text(
        Phaser.Math.Between(margin, this.cameras.main.width - margin),
        Phaser.Math.Between(margin, this.cameras.main.height - margin),
        `${data.playerName}: ${data.coinType}!`,
        {
          fontSize: this.isMobile ? '28px' : '20px',
          fontStyle: 'bold',
          color: `#${config.color.toString(16).padStart(6, '0')}`,
          stroke: '#000000',
          strokeThickness: 4,
        }
      )
      .setOrigin(0.5)

    this.opponentSlices.push(text)
    this.cameras.main.flash(100, 255, 255, 255, false)
  }

  private sliceCoin(coinId: string, coin: Phaser.GameObjects.Container): void {
    const type = coin.getData('type') as CoinType
    const config = COIN_CONFIG[type]
    const store = useTradingStore.getState()

    this.createExplosion(coin.x, coin.y, config.color)

    if (type === 'gas') {
      // Gas coins damage the slicer immediately
      this.cameras.main.flash(200, 255, 255, 0, false)
      store.sliceCoin(coinId, type, 0)
      this.removeCoin(coinId)
      return
    }

    // Use price from store (with fallback for development/testing)
    const currentPrice = store.priceData?.price ?? 3400
    store.sliceCoin(coinId, type, currentPrice)

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015)
      this.cameras.main.flash(100, 255, 215, 0, false)
    }

    this.removeCoin(coinId)
  }

  private createExplosion(x: number, y: number, color: number): void {
    const PARTICLE_COUNT = 12
    const DURATION = 300
    const availableParticles: any[] = []

    // Find available particles from pool
    for (const particle of this.particlePool) {
      if (!particle.visible) {
        availableParticles.push(particle)
        if (availableParticles.length >= PARTICLE_COUNT) break
      }
    }

    // If not enough particles available, skip this explosion
    if (availableParticles.length < PARTICLE_COUNT) return

    // Activate and position particles
    availableParticles.forEach((particle, i) => {
      particle.setPosition(x, y)
      particle.setVisible(true)
      particle.setActive(true)
      particle.setFillStyle(color)
      particle.setAlpha(1)
      particle.setScale(1)

      const angle = ((Math.PI * 2) / PARTICLE_COUNT) * i
      const distance = 40 + Math.random() * 20

      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: DURATION,
        ease: 'Power2',
        onComplete: () => {
          particle.setVisible(false)
          particle.setActive(false)
          particle.setPosition(0, 0) // Reset position
        },
      })
    })
  }
}
