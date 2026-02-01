import { Scene, GameObjects, Geom, Physics } from 'phaser'
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store'
import type { CoinType } from '../types/trading'
import { Token } from '../objects/Token'

// Coin configuration for visual rendering (Bitcoin-style)
export const COIN_CONFIG = {
  call: {
    color: 0xf7931a, // Bitcoin orange
    symbol: '₿',
    arrow: '▲',
    radius: 20,
    innerColor: 0xffd700, // Gold inner
  },
  put: {
    color: 0xf7931a, // Bitcoin orange
    symbol: '₿',
    arrow: '▼',
    radius: 20,
    innerColor: 0xcd8500, // Darker gold inner for puts
  },
  gas: {
    color: 0xffff00, // Yellow
    symbol: '⚡',
    arrow: '',
    radius: 20,
    innerColor: 0xffaa00,
  },
  whale: {
    color: 0xffd700, // Gold
    symbol: '₿',
    arrow: '★',
    radius: 32,
    innerColor: 0xffa500, // Orange inner
  },
} as const

export class TradingScene extends Scene {
  // Active game objects
  private tokenPool!: Physics.Arcade.Group
  private opponentSlices: GameObjects.Text[] = []

  // Blade rendering
  private bladePath: Geom.Point[] = []
  private bladeGraphics!: GameObjects.Graphics

  // Grid background
  private gridGraphics!: GameObjects.Graphics

  // Reusable geometry for collision detection (prevents GC stutter)
  private collisionLine = new Geom.Line(0, 0, 0, 0)
  private collisionCircle = new Geom.Circle(0, 0, 0)

  // Spatial hash grid for O(1) collision detection
  private spatialGrid = new Map<string, Set<string>>()
  private readonly CELL_SIZE = 60 // Coin diameter ~56

  // Event bridge to React store
  private eventEmitter: Phaser.Events.EventEmitter

  // Mobile detection and scaling
  private isMobile: boolean = false
  private readonly mobileScale: number = 1.3 // 30% larger coins on mobile
  private readonly mobileTrailLength: number = 20
  private readonly desktopTrailLength: number = 10

  // Object pooling for split effects (prevents GC stutter)
  private splitEffectPool: { left: Phaser.GameObjects.Graphics; right: Phaser.GameObjects.Graphics; leftContainer: Phaser.GameObjects.Container; rightContainer: Phaser.GameObjects.Container }[] = []
  private readonly SPLIT_POOL_SIZE = 10

  // Change detection for blade path (prevents unnecessary updates)
  private lastBladePoint: Geom.Point | null = null

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
    this.bladeGraphics.setDepth(1000) // Ensure blade renders on top

    // Create grid graphics and draw background
    this.gridGraphics = this.add.graphics()
    this.gridGraphics.setDepth(-1) // Ensure grid renders behind everything
    this.drawGridBackground()

    // Generate cached textures for all coin types
    this.generateCachedTextures()

    // Setup token pool for object reuse
    this.tokenPool = this.physics.add.group({
      classType: Token,
      runChildUpdate: true,
      maxSize: 30,
      active: true,
      createCallback: (token) => {
        const tokenObj = token as Token
        tokenObj.setVisible(false)
        tokenObj.setActive(false)
      },
    })

    // CRITICAL: Register event listeners BEFORE exposing window.phaserEvents
    // This ensures no events are lost during initialization
    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this))
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this))

    // Track mouse movement for blade trail (with change detection)
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const currentPoint = new Geom.Point(pointer.x, pointer.y)
      // Only update if position actually changed (prevents unnecessary updates)
      if (!this.lastBladePoint || (this.lastBladePoint.x !== currentPoint.x || this.lastBladePoint.y !== currentPoint.y)) {
        this.bladePath.push(currentPoint)
        // Limit trail length for performance (longer on mobile for smoother visuals)
        const maxTrailLength = this.isMobile ? this.mobileTrailLength : this.desktopTrailLength
        if (this.bladePath.length > maxTrailLength) {
          this.bladePath.shift()
        }
        this.lastBladePoint = currentPoint
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

    // Handle resize events to update physics world bounds and redraw grid
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height)
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height)
      this.drawGridBackground()
    })
  }

  update(): void {
    this.updateCoinPhysics()
    this.drawBlade()
    // Spatial grid now updates incrementally in updateCoinPhysics()
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

    this.tokenPool.getChildren().forEach((token) => {
      const tokenObj = token as Token
      if (!tokenObj.active) return
      const coinId = tokenObj.getData('id')
      this.addCoinToGrid(coinId, tokenObj.x, tokenObj.y)
    })
  }

  private drawGridBackground(): void {
    const GRID_SIZE = 60
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    // Landing Page theme colors
    const GRID_COLOR = 0x00f3ff // Tron cyan (from globals.css --color-tron-cyan)
    const BACKGROUND_COLOR = 0x0a0a0f // Near-black

    // Fill background
    this.gridGraphics.fillStyle(BACKGROUND_COLOR, 1)
    this.gridGraphics.fillRect(0, 0, width, height)

    // Draw grid lines with better visibility
    this.gridGraphics.lineStyle(1, GRID_COLOR, 0.5) // Increased from 0.3 to 0.5

    // Vertical lines
    for (let x = 0; x <= width; x += GRID_SIZE) {
      this.gridGraphics.lineBetween(x, 0, x, height)
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += GRID_SIZE) {
      this.gridGraphics.lineBetween(0, y, width, y)
    }
  }

  private generateCachedTextures(): void {
    const textureKeys: Array<CoinType> = ['call', 'put', 'gas', 'whale']

    textureKeys.forEach(type => {
      const config = COIN_CONFIG[type]
      const diameter = config.radius * 2

      // Create a container to hold all elements
      const container = this.add.container(0, 0)

      // 1. Create graphics for coin body
      const graphics = this.add.graphics()

      // Draw coin body (radial gradient)
      const centerColor = config.color
      const edgeColor = Phaser.Display.Color.IntegerToColor(config.color).darken(40).color

      for (let r = config.radius; r >= 0; r -= 2) {
        const t = r / config.radius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(centerColor),
          Phaser.Display.Color.ValueToColor(edgeColor),
          config.radius,
          t
        )
        graphics.fillStyle(color.color, 1 - t * 0.3)
        graphics.fillCircle(0, 0, r)
      }

      // Draw metallic shine
      graphics.fillStyle(0xffffff, 0.15)
      graphics.fillCircle(
        -config.radius * 0.3,
        -config.radius * 0.3,
        config.radius * 0.4
      )

      // Draw inner circle
      const innerRadius = config.radius * 0.75
      const innerCenter = config.innerColor
      const innerEdge = Phaser.Display.Color.IntegerToColor(config.innerColor).darken(20).color

      for (let r = innerRadius; r >= 0; r -= 1.5) {
        const t = r / innerRadius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(innerCenter),
          Phaser.Display.Color.ValueToColor(innerEdge),
          innerRadius,
          t
        )
        graphics.fillStyle(color.color, 0.95)
        graphics.fillCircle(0, 0, r)
      }

      graphics.lineStyle(2, 0xffffff, 0.3)
      graphics.strokeCircle(0, 0, innerRadius)
      container.add(graphics)

      // 2. Draw symbol (₿ or ⚡)
      const symbol = this.add.text(0, 2, config.symbol, {
        fontSize: `${config.radius * 0.8}px`,
        color: '#000000',
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
      }).setOrigin(0.5)
      container.add(symbol)

      // 3. Draw arrow (if applicable)
      if (config.arrow) {
        const arrowY = config.arrow === '▲' ? -config.radius * 0.5 : config.radius * 0.5
        const arrowColor = config.arrow === '▲' ? '#00ff00' : '#ff0000'

        const arrow = this.add.text(0, arrowY, config.arrow, {
          fontSize: `${config.radius * 0.4}px`,
          color: arrowColor,
          fontStyle: 'bold',
        }).setOrigin(0.5)
        container.add(arrow)
      }

      // 4. Generate texture from container
      // Create a render texture to capture the container
      const renderTexture = this.make.renderTexture({ width: diameter, height: diameter }, false)
      renderTexture.draw(container, config.radius, config.radius)
      renderTexture.saveTexture(`texture_${type}`)
      renderTexture.destroy()

      // Cleanup
      container.destroy()
    })
  }

  private updateCoinPhysics(): void {
    const sceneHeight = this.cameras.main.height

    // Iterate active tokens in pool
    this.tokenPool.getChildren().forEach((token) => {
      const tokenObj = token as Token
      if (!tokenObj.active) return

      // Store old position for spatial grid update
      const oldX = tokenObj.getData('oldX') as number ?? tokenObj.x
      const oldY = tokenObj.getData('oldY') as number ?? tokenObj.y
      const coinId = tokenObj.getData('id')

      // Remove coins that fall below screen
      if (tokenObj.y > sceneHeight + 50) {
        this.removeCoinFromGrid(coinId, tokenObj.x, tokenObj.y)

        // Return to pool
        tokenObj.setActive(false)
        tokenObj.setVisible(false)
        if (tokenObj.body) {
          tokenObj.body.stop()
        }
        return
      }

      // Update spatial grid if token moved (incremental update)
      if (Math.abs(tokenObj.x - oldX) > 1 || Math.abs(tokenObj.y - oldY) > 1) {
        this.removeCoinFromGrid(coinId, oldX, oldY)
        this.addCoinToGrid(coinId, tokenObj.x, tokenObj.y)
        tokenObj.setData('oldX', tokenObj.x)
        tokenObj.setData('oldY', tokenObj.y)
      }
    })
  }

  private removeCoin(coinId: string): void {
    // Find token in pool
    const token = this.tokenPool.getChildren().find(
      (t) => {
        const tokenObj = t as Token
        return tokenObj.getData('id') === coinId && tokenObj.active
      }
    ) as Token | undefined

    if (token) {
      // Remove from spatial grid
      this.removeCoinFromGrid(coinId, token.x, token.y)

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
    // Signal scene not ready before destroying event emitter
    const setReady = (window as unknown as { setSceneReady?: (ready: boolean) => void })
      .setSceneReady
    setReady?.(false)
    delete (window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady
    delete (window as { phaserEvents?: PhaserEventBridge }).phaserEvents

    // Clear token pool
    this.tokenPool.clear(true, true)

    this.eventEmitter.destroy()
    this.spatialGrid.clear()
    this.opponentSlices.forEach((t) => t.destroy())

    // Remove input event listeners to prevent memory leaks
    this.input.off('pointermove')

    // Clean up split effect pool
    this.splitEffectPool.forEach((effect) => {
      effect.left.destroy()
      effect.right.destroy()
      effect.leftContainer.destroy()
      effect.rightContainer.destroy()
    })
    this.splitEffectPool.length = 0
  }

  private drawBlade(): void {
    this.bladeGraphics.clear()
    if (this.bladePath.length < 2) return

    const lineWidth = this.isMobile ? 7 : 5
    const trailColor = 0x00d9ff

    // Draw trail with alpha gradient (fade from tail to head)
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]

      // Alpha increases from tail (0) to head (1)
      const alpha = i / this.bladePath.length

      this.bladeGraphics.lineStyle(lineWidth, trailColor, alpha)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    // Add glow to head segment
    if (this.bladePath.length >= 2) {
      const lastIdx = this.bladePath.length - 1
      const p1 = this.bladePath[lastIdx - 1]
      const p2 = this.bladePath[lastIdx]

      this.bladeGraphics.lineStyle(lineWidth + 4, trailColor, 0.3)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    this.bladeGraphics.setDepth(1000)
  }

  private checkCollisions(): void {
    if (this.bladePath.length < 2) return

    const p1 = this.bladePath[this.bladePath.length - 2]
    const p2 = this.bladePath[this.bladePath.length - 1]

    // Reuse line instance (update coordinates instead of creating new)
    this.collisionLine.setTo(p1.x, p1.y, p2.x, p2.y)

    // Get nearby coins from spatial grid
    const nearbyCoinIds = this.getCoinsNearLine(p1, p2)

    // Iterate pool and check nearby coins
    for (const token of this.tokenPool.getChildren()) {
      const tokenObj = token as Token
      if (!tokenObj.active) continue

      const coinId = tokenObj.getData('id')
      if (!nearbyCoinIds.has(coinId)) continue

      const type = tokenObj.getData('type') as CoinType
      const config = COIN_CONFIG[type]

      this.collisionCircle.setTo(tokenObj.x, tokenObj.y, config.radius)

      if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
        this.sliceCoin(coinId, tokenObj)
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
    const config = COIN_CONFIG[data.coinType]
    if (!config) return

    // Get token from pool (creates new if needed)
    const token = this.tokenPool.get(data.x, data.y) as Token
    if (!token) return

    // Initialize token state
    token.spawn(data.x, data.y, data.coinType, data.coinId, config, this.isMobile)

    // Add to spatial grid (for collision detection)
    this.addCoinToGrid(data.coinId, token.x, token.y)
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

  private sliceCoin(coinId: string, coin: Token): void {
    const type = coin.getData('type') as CoinType
    const config = COIN_CONFIG[type]
    const store = useTradingStore.getState()

    // Create split effect (2 half-coins flying apart)
    this.createSplitEffect(coin.x, coin.y, config.color, config.radius)

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

  private getSplitEffectFromPool(): { left: Phaser.GameObjects.Graphics; right: Phaser.GameObjects.Graphics; leftContainer: Phaser.GameObjects.Container; rightContainer: Phaser.GameObjects.Container } | null {
    const effect = this.splitEffectPool.pop()
    if (effect) {
      effect.left.setVisible(true)
      effect.right.setVisible(true)
      effect.leftContainer.setVisible(true)
      effect.rightContainer.setVisible(true)
    }
    return effect || null
  }

  private returnSplitEffectToPool(effect: { left: Phaser.GameObjects.Graphics; right: Phaser.GameObjects.Graphics; leftContainer: Phaser.GameObjects.Container; rightContainer: Phaser.GameObjects.Container }): void {
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

  private createSplitEffect(x: number, y: number, color: number, radius: number): void {
    const pooled = this.getSplitEffectFromPool()

    const leftHalf = pooled?.left || this.add.graphics()
    const rightHalf = pooled?.right || this.add.graphics()
    const leftContainer = pooled?.leftContainer || this.add.container(x, y)
    const rightContainer = pooled?.rightContainer || this.add.container(x, y)

    if (!pooled) {
      // Only create graphics if not from pool
      leftHalf.fillStyle(color, 1)
      leftHalf.beginPath()
      leftHalf.arc(0, 0, radius, Math.PI, Math.PI * 2) // Left semicircle (180° → 360°)
      leftHalf.fillPath()
      leftContainer.add(leftHalf)

      rightHalf.fillStyle(color, 1)
      rightHalf.beginPath()
      rightHalf.arc(0, 0, radius, 0, Math.PI) // Right semicircle (0° → 180°)
      rightHalf.fillPath()
      rightContainer.add(rightHalf)
    }

    // Update positions
    leftContainer.setPosition(x, y)
    rightContainer.setPosition(x, y)
    leftContainer.setAlpha(1)
    rightContainer.setAlpha(1)
    leftContainer.setRotation(0)
    rightContainer.setRotation(0)

    // Animate halves flying apart
    this.tweens.add({
      targets: leftContainer,
      x: x - 40,
      y: y + 20,
      rotation: -1,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        if (pooled) {
          this.returnSplitEffectToPool(pooled)
        } else {
          leftContainer.destroy()
        }
      },
    })

    this.tweens.add({
      targets: rightContainer,
      x: x + 40,
      y: y - 20,
      rotation: 1,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        if (pooled) {
          // Already returned to pool in left tween
        } else {
          rightContainer.destroy()
        }
      },
    })
  }
}
