import { Scene, GameObjects, Geom, Physics } from 'phaser'
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store'
import type { CoinType } from '../types/trading'
import { Token } from '../objects/Token'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'

// Trail particle interface
interface TrailParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

// Slice particle interface
interface SliceParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: number
}

// Coin configuration for visual rendering (NEON ARCADE TERMINAL theme)
export const COIN_CONFIG = {
  call: {
    color: 0x39ff14, // Electric Lime (bullish)
    symbol: '₿',
    arrow: '▲',
    radius: 28,
    innerColor: 0x2ecc00, // Darker lime inner
  },
  put: {
    color: 0xff1744, // Neon Red (bearish)
    symbol: '₿',
    arrow: '▼',
    radius: 28,
    innerColor: 0xcc0033, // Darker red inner
  },
  gas: {
    color: 0xffd700, // Hazard gold
    symbol: '⚡',
    arrow: '',
    radius: 28,
    innerColor: 0xff8c00, // Orange inner
  },
  whale: {
    color: 0xff00ff, // Legendary Magenta
    symbol: '★',
    arrow: '',
    radius: 40,
    innerColor: 0xcc00cc, // Deep magenta inner
  },
} as const

export class TradingScene extends Scene {
  // Active game objects
  private tokenPool!: Physics.Arcade.Group
  private opponentSlices: GameObjects.Text[] = []

  // Blade rendering
  private bladePath: Geom.Point[] = []
  private bladeGraphics!: GameObjects.Graphics
  private lastBladePosition: Geom.Point = new Geom.Point(0, 0)
  private bladeVelocity: { x: number; y: number } = { x: 0, y: 0 }

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
  private splitEffectPool: {
    left: Phaser.GameObjects.Graphics
    right: Phaser.GameObjects.Graphics
    leftContainer: Phaser.GameObjects.Container
    rightContainer: Phaser.GameObjects.Container
  }[] = []
  private readonly SPLIT_POOL_SIZE = 10

  // Trail particle system
  private particles: TrailParticle[] = []
  private readonly MAX_PARTICLES = 50
  private particleGraphics!: GameObjects.Graphics

  // Slice particle burst pool
  private sliceParticles: SliceParticle[] = []
  private readonly MAX_SLICE_PARTICLES = 200 // Increased to prevent hitting limit
  private sliceParticleGraphics!: GameObjects.Graphics

  // Electrical arc tracking for cleanup (prevents memory leaks)
  private electricalArcs: GameObjects.Graphics[] = []

  // Change detection for blade path (prevents unnecessary updates)
  private lastBladePoint: Geom.Point | null = null

  // Shutdown flag to prevent events after destruction
  private isShutdown: boolean = false

  // Reusable blade point to prevent GC
  private reusableBladePoint = new Geom.Point(0, 0)

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

    // Create particle graphics
    this.particleGraphics = this.add.graphics()
    this.particleGraphics.setDepth(999) // Just below blade

    this.sliceParticleGraphics = this.add.graphics()
    this.sliceParticleGraphics.setDepth(1001) // On top of blade

    // Create grid graphics and draw background
    this.gridGraphics = this.add.graphics()
    this.gridGraphics.setDepth(-1) // Front grid layer
    this.drawGridBackground()

    // Generate cached textures for all coin types
    this.generateCachedTextures()

    // Setup token pool for object reuse
    this.tokenPool = this.physics.add.group({
      classType: Token,
      runChildUpdate: true,
      maxSize: 150, // Covers ~200 coins in 3-min game with safety margin
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

    // Track mouse movement for blade trail (always track, no velocity gating)
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Reuse point object to prevent GC
      this.reusableBladePoint.x = pointer.x
      this.reusableBladePoint.y = pointer.y

      // ALWAYS track blade position (removed velocity gating)
      // Only update if position actually changed (prevents unnecessary updates)
      if (
        !this.lastBladePoint ||
        this.lastBladePoint.x !== this.reusableBladePoint.x ||
        this.lastBladePoint.y !== this.reusableBladePoint.y
      ) {
        // Create new point for the path (we need separate objects for the path)
        const pathPoint = new Geom.Point(this.reusableBladePoint.x, this.reusableBladePoint.y)
        this.bladePath.push(pathPoint)
        // Limit trail length for performance (longer on mobile for smoother visuals)
        const maxTrailLength = this.isMobile ? this.mobileTrailLength : this.desktopTrailLength
        if (this.bladePath.length > maxTrailLength) {
          this.bladePath.shift() // Let GC handle destroyed point
        }
        this.lastBladePoint = pathPoint
      }
    })

    // Clear blade trail when user stops interacting (mouse up / touch end)
    // This fixes the "ghost blade" issue where lingering points continue colliding
    this.input.on('pointerup', () => {
      this.bladePath = []
      this.lastBladePoint = null
    })

    // Also clear when pointer leaves the canvas (e.g., mouse dragged outside)
    this.input.on('pointerout', () => {
      this.bladePath = []
      this.lastBladePoint = null
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

    // CRITICAL FIX: Use fixed game height (800) for consistent spawning across devices
    // On iOS, cameras.main.height returns window.innerHeight (932px with address bar)
    // which breaks bottom-toss detection. Server expects fixed height.
    const GAME_HEIGHT = 800 // Fixed game height for consistent physics
    const updateDimensions = () => {
      const dims = {
        width: this.cameras.main.width,
        height: GAME_HEIGHT, // ALWAYS use 800, not camera height
      }
      ;(window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions = dims

      // Debug logging - track when dimensions are set
      console.log(
        '[TradingScene] sceneDimensions updated:',
        dims,
        '| camera.main.height:',
        this.cameras.main.height,
        '| window.innerHeight:',
        window.innerHeight,
        '| gameSize:',
        this.scale.gameSize
      )
    }

    // Handle resize events to update physics world bounds and redraw grid
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height)
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height)
      this.drawGridBackground()

      // CRITICAL FIX: Always use camera dimensions, not gameSize
      // gameSize may differ from camera.height in Scale.RESIZE mode
      updateDimensions()
    })

    // Emit initial dimensions immediately
    updateDimensions()

    // ALSO update after delays to catch any missed resize events
    // This ensures dimensions are correct even if resize fires late (especially on iOS with dynamic address bar)
    setTimeout(updateDimensions, 100)
    setTimeout(updateDimensions, 300)
    setTimeout(updateDimensions, 500)
  }

  update(): void {
    // Guard against shutdown - prevent updates after scene destruction
    if (this.isShutdown) return

    this.updateGrid()
    this.updateCoinPhysics()
    this.updateTrailParticles()
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
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    // NEON ARCADE TERMINAL theme colors
    const GRID_COLOR = 0x00f3ff // Tron cyan
    const BACKGROUND_COLOR = 0x0a0a0a // Deep black void

    // Fill background with void color
    this.gridGraphics.fillStyle(BACKGROUND_COLOR, 1)
    this.gridGraphics.fillRect(0, 0, width, height)
  }

  private updateGrid(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const GRID_SIZE = 60
    const GRID_COLOR = 0x00f3ff // Tron cyan

    // Clear previous frame
    this.gridGraphics.clear()

    // Fill background with void color
    this.gridGraphics.setBlendMode(Phaser.BlendModes.NORMAL)
    this.gridGraphics.fillStyle(0x0a0a0a, 1)
    this.gridGraphics.fillRect(0, 0, width, height)

    // Calculate ambient pulse (slow oscillation, ~3 second cycle)
    const time = this.time.now / 1000 // Convert to seconds
    const pulseIntensity = 0.15 + Math.sin(time * 2) * 0.05 // Range: 0.10 to 0.20

    // Switch to additive blend for neon glow
    this.gridGraphics.setBlendMode(Phaser.BlendModes.ADD)

    // Draw grid lines with layered glow
    this.drawGridLines(width, height, GRID_SIZE, GRID_COLOR, pulseIntensity)

    // Draw intersection dots (energized junctions)
    this.drawIntersections(width, height, GRID_SIZE, GRID_COLOR, pulseIntensity)
  }

  private drawGridLines(
    width: number,
    height: number,
    gridSize: number,
    color: number,
    pulseIntensity: number
  ): void {
    const numVerticalLines = Math.ceil(width / gridSize)
    const numHorizontalLines = Math.ceil(height / gridSize)

    // Vertical lines (data columns)
    for (let i = 0; i <= numVerticalLines; i++) {
      const x = i * gridSize

      // Layer 1: Bloom (widest, most diffuse) - 6px width, 15% of pulse
      this.gridGraphics.lineStyle(6, color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(x, 0, x, height)

      // Layer 2: Glow (medium diffusion) - 3px width, 40% of pulse
      this.gridGraphics.lineStyle(3, color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(x, 0, x, height)

      // Layer 3: Base (crisp core) - 1px width, full pulse
      this.gridGraphics.lineStyle(1, color, pulseIntensity)
      this.gridGraphics.lineBetween(x, 0, x, height)
    }

    // Horizontal lines (grounded feel)
    for (let j = 0; j <= numHorizontalLines; j++) {
      const y = j * gridSize

      // Same three-layer approach
      this.gridGraphics.lineStyle(6, color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(0, y, width, y)

      this.gridGraphics.lineStyle(3, color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(0, y, width, y)

      this.gridGraphics.lineStyle(1, color, pulseIntensity)
      this.gridGraphics.lineBetween(0, y, width, y)
    }
  }

  private drawIntersections(
    width: number,
    height: number,
    gridSize: number,
    color: number,
    pulseIntensity: number
  ): void {
    const numVerticalLines = Math.ceil(width / gridSize)
    const numHorizontalLines = Math.ceil(height / gridSize)

    // Draw glowing dot at each grid intersection
    for (let i = 0; i <= numVerticalLines; i++) {
      for (let j = 0; j <= numHorizontalLines; j++) {
        const x = i * gridSize
        const y = j * gridSize

        // Outer glow layer (diffuse cyan)
        this.gridGraphics.fillStyle(color, pulseIntensity * 1.25)
        this.gridGraphics.fillCircle(x, y, 6)

        // Inner core layer (bright white center)
        this.gridGraphics.fillStyle(0xffffff, pulseIntensity * 2.5)
        this.gridGraphics.fillCircle(x, y, 2.5)
      }
    }
  }

  private generateCachedTextures(): void {
    const textureKeys: Array<CoinType> = ['call', 'put', 'gas', 'whale']

    textureKeys.forEach((type) => {
      const config = COIN_CONFIG[type]
      const diameter = config.radius * 2 + 8 // Extra padding for glow

      // Create a container to hold all elements
      const container = this.add.container(0, 0)

      // 1. Create graphics for coin body
      const graphics = this.add.graphics()

      // Draw outer bloom glow (larger, softer glow)
      const glowColor = Phaser.Display.Color.IntegerToColor(config.color)
      for (let r = config.radius + 4; r >= config.radius; r--) {
        const alpha = ((config.radius + 4 - r) / 4) * 0.3
        graphics.fillStyle(config.color, alpha)
        graphics.fillCircle(0, 0, r)
      }

      // Draw coin body (radial gradient)
      const centerColor = config.color
      const edgeColor = Phaser.Display.Color.IntegerToColor(config.color).darken(30).color

      for (let r = config.radius; r >= 0; r -= 2) {
        const t = r / config.radius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(centerColor),
          Phaser.Display.Color.ValueToColor(edgeColor),
          config.radius,
          t
        )
        graphics.fillStyle(color.color, 1 - t * 0.2)
        graphics.fillCircle(0, 0, r)
      }

      // Draw metallic shine (top-left highlight)
      graphics.fillStyle(0xffffff, 0.25)
      graphics.fillCircle(-config.radius * 0.3, -config.radius * 0.3, config.radius * 0.4)

      // Draw inner ring (concentric at 60% radius, white stroke)
      const innerRingRadius = config.radius * 0.6
      graphics.lineStyle(2, 0xffffff, 0.5)
      graphics.strokeCircle(0, 0, innerRingRadius)

      // Draw inner circle with gradient
      const innerRadius = config.radius * 0.75
      const innerCenter = config.innerColor
      const innerEdge = Phaser.Display.Color.IntegerToColor(config.innerColor).darken(15).color

      for (let r = innerRadius; r >= 0; r -= 1.5) {
        const t = r / innerRadius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(innerCenter),
          Phaser.Display.Color.ValueToColor(innerEdge),
          innerRadius,
          t
        )
        graphics.fillStyle(color.color, 0.98)
        graphics.fillCircle(0, 0, r)
      }

      container.add(graphics)

      // 2. Draw symbol (₿, ⚡, or ★) - white with glow for contrast
      const symbol = this.add
        .text(0, 2, config.symbol, {
          fontSize: `${config.radius * 1.0}px`,
          color: '#FFFFFF',
          fontStyle: 'bold',
          fontFamily: 'Arial, sans-serif',
          shadow: {
            offsetX: 0,
            offsetY: 0,
            blur: 10,
            color: '#FFFFFF',
            stroke: false,
            fill: true,
          },
        })
        .setOrigin(0.5)
      container.add(symbol)

      // 3. Draw arrow (if applicable)
      if (config.arrow) {
        const arrowY = config.arrow === '▲' ? -config.radius * 0.5 : config.radius * 0.5
        const arrowColor = config.arrow === '▲' ? '#39ff14' : '#ff1744'

        const arrow = this.add
          .text(0, arrowY, config.arrow, {
            fontSize: `${config.radius * 0.5}px`,
            color: arrowColor,
            fontStyle: 'bold',
            shadow: {
              offsetX: 0,
              offsetY: 0,
              blur: 6,
              color: arrowColor,
              stroke: false,
              fill: true,
            },
          })
          .setOrigin(0.5)
        container.add(arrow)
      }

      // 4. Generate texture from container
      // Create a render texture to capture the container
      const renderTexture = this.make.renderTexture({ width: diameter, height: diameter }, false)
      renderTexture.draw(container, diameter / 2, diameter / 2)
      renderTexture.saveTexture(`texture_${type}`)
      renderTexture.destroy()

      // Cleanup
      container.destroy()
    })
  }

  private updateCoinPhysics(): void {
    const sceneHeight = this.cameras.main.height

    // Guard against shutdown - tokenPool may be destroyed
    if (!this.tokenPool) return

    // Iterate active tokens in pool
    this.tokenPool.getChildren().forEach((token) => {
      const tokenObj = token as Token
      if (!tokenObj.active) return

      // Get tracked grid position (not current position)
      const gridX = (tokenObj.getData('gridX') as number) ?? tokenObj.x
      const gridY = (tokenObj.getData('gridY') as number) ?? tokenObj.y
      const coinId = tokenObj.getData('id')

      // Remove coins that fall below screen
      if (tokenObj.y > sceneHeight + 50) {
        // Remove from tracked grid position (not current position)
        this.removeCoinFromGrid(coinId, gridX, gridY)

        // Return to pool
        tokenObj.setActive(false)
        tokenObj.setVisible(false)
        if (tokenObj.body) {
          tokenObj.body.stop()
        }
        return
      }

      // Update spatial grid if token moved (incremental update)
      if (Math.abs(tokenObj.x - gridX) > 1 || Math.abs(tokenObj.y - gridY) > 1) {
        this.removeCoinFromGrid(coinId, gridX, gridY)
        this.addCoinToGrid(coinId, tokenObj.x, tokenObj.y)
        tokenObj.setData('gridX', tokenObj.x)
        tokenObj.setData('gridY', tokenObj.y)
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
      this.removeCoinFromGrid(coinId, gridX, gridY)

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
    // Set shutdown flag FIRST to prevent any further event processing
    this.isShutdown = true

    // Kill ALL active tweens BEFORE cleanup
    this.tweens.killAll()

    // CRITICAL: Destroy all graphics objects to prevent GPU memory leaks
    this.bladeGraphics?.destroy()
    this.particleGraphics?.destroy()
    this.sliceParticleGraphics?.destroy()
    this.gridGraphics?.destroy()

    // Clear references
    this.bladeGraphics = null as any
    this.particleGraphics = null as any
    this.sliceParticleGraphics = null as any
    this.gridGraphics = null as any

    // Clean up all active electrical arcs
    this.electricalArcs.forEach((arc) => arc.destroy())
    this.electricalArcs.length = 0

    // Remove resize event listener to prevent post-shutdown callbacks
    this.scale.off('resize')

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

    // Clean up opponent slices
    this.opponentSlices.forEach((t) => t.destroy())
    this.opponentSlices.length = 0

    // Remove input event listeners to prevent memory leaks
    this.input.off('pointermove')
    this.input.off('pointerup')
    this.input.off('pointerout')

    // Clean up blade path (create new array, let old one be GC'd)
    this.bladePath = []
    this.lastBladePoint = null

    // Clean up split effect pool
    this.splitEffectPool.forEach((effect) => {
      effect.left.destroy()
      effect.right.destroy()
      effect.leftContainer.destroy()
      effect.rightContainer.destroy()
    })
    this.splitEffectPool.length = 0

    // Clear particle arrays properly (use length=0 instead of reassignment)
    this.particles.length = 0
    this.sliceParticles.length = 0
  }

  private drawBlade(): void {
    this.bladeGraphics.clear()
    if (this.bladePath.length < 2) return

    const trailColor = 0x00f3ff // TRON CYAN
    const isMobile = this.isMobile
    const coreWidth = isMobile ? 4 : 3
    const glowWidth = isMobile ? 20 : 15
    const midWidth = isMobile ? 10 : 8

    // Calculate velocity for motion blur
    const head = this.bladePath[this.bladePath.length - 1]
    const prev = this.bladePath[this.bladePath.length - 2]
    const dx = head.x - prev.x
    const dy = head.y - prev.y
    const velocity = Math.sqrt(dx * dx + dy * dy) * 60 // pixels per second (assuming 60fps)

    // Update velocity tracking
    this.bladeVelocity.x = dx
    this.bladeVelocity.y = dy
    this.lastBladePosition.x = head.x
    this.lastBladePosition.y = head.y

    const isHighVelocity = velocity > 500
    const motionBlurMultiplier = isHighVelocity ? 1.2 : 1.0

    // Emit trail particles at blade head
    this.emitTrailParticles(head.x, head.y, 2)

    // Set additive blend mode for luminous effect
    this.bladeGraphics.setBlendMode(Phaser.BlendModes.ADD)

    // Draw glow layer (outer diffuse glow) - Layer 1
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]

      // Exponential fade for smoother appearance
      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * 0.3 // Quadratic curve, max 0.3 alpha

      this.bladeGraphics.lineStyle(glowWidth * motionBlurMultiplier, trailColor, alpha)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    // Draw mid layer - Layer 2
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]

      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * 0.6

      this.bladeGraphics.lineStyle(midWidth * motionBlurMultiplier, trailColor, alpha)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    // Draw core layer (bright center) - Layer 3
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]

      // Sharper fade for core
      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * t // Cubic curve for tighter bright core

      this.bladeGraphics.lineStyle(coreWidth, 0xffffff, alpha * 0.9)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    this.bladeGraphics.setDepth(1000)

    // Also update slice particles
    this.updateSliceParticles()
  }

  private emitTrailParticles(x: number, y: number, count: number = 2): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.MAX_PARTICLES) break

      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const speed = Phaser.Math.FloatBetween(50, 100)

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 300, // 300ms lifespan
        maxLife: 300,
      })
    }
  }

  private updateTrailParticles(): void {
    const delta = 1000 / 60 // Assume 60fps

    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.x += p.vx * (delta / 1000)
      p.y += p.vy * (delta / 1000)
      p.life -= delta

      if (p.life <= 0) {
        this.particles.splice(i, 1)
      }
    }

    // Draw particles
    this.particleGraphics.clear()
    this.particleGraphics.setBlendMode(Phaser.BlendModes.ADD)

    for (const p of this.particles) {
      const alpha = (p.life / p.maxLife) * 0.5
      const size = (p.life / p.maxLife) * 6

      // Core
      this.particleGraphics.fillStyle(0xffffff, alpha)
      this.particleGraphics.fillCircle(p.x, p.y, size * 0.5)

      // Glow
      this.particleGraphics.fillStyle(0x00f3ff, alpha * 0.6)
      this.particleGraphics.fillCircle(p.x, p.y, size)
    }
  }

  private emitSliceParticles(x: number, y: number, color: number, count: number = 20): void {
    for (let i = 0; i < count; i++) {
      if (this.sliceParticles.length >= this.MAX_SLICE_PARTICLES) break

      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const speed = Phaser.Math.FloatBetween(100, 300)

      this.sliceParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 50, // Slight upward bias
        life: 500, // 500ms lifespan
        maxLife: 500,
        color,
      })
    }
  }

  private updateSliceParticles(): void {
    const delta = 1000 / 60 // Assume 60fps
    const gravity = 500 // Gravity for slice particles

    // Update existing particles
    for (let i = this.sliceParticles.length - 1; i >= 0; i--) {
      const p = this.sliceParticles[i]
      p.vy += gravity * (delta / 1000)
      p.x += p.vx * (delta / 1000)
      p.y += p.vy * (delta / 1000)
      p.life -= delta

      if (p.life <= 0) {
        this.sliceParticles.splice(i, 1)
      }
    }

    // Draw particles
    this.sliceParticleGraphics.clear()
    this.sliceParticleGraphics.setBlendMode(Phaser.BlendModes.ADD)

    for (const p of this.sliceParticles) {
      const alpha = (p.life / p.maxLife) * 0.8
      const size = (p.life / p.maxLife) * 8

      // Glow
      this.sliceParticleGraphics.fillStyle(p.color, alpha * 0.5)
      this.sliceParticleGraphics.fillCircle(p.x, p.y, size)

      // Core
      this.sliceParticleGraphics.fillStyle(0xffffff, alpha)
      this.sliceParticleGraphics.fillCircle(p.x, p.y, size * 0.4)
    }
  }

  private checkCollisions(): void {
    // Check collisions whenever blade has points (no gesture state check)
    if (this.bladePath.length < 2) return

    // Guard against shutdown - tokenPool may be destroyed
    if (!this.tokenPool) return

    const p1 = this.bladePath[this.bladePath.length - 2]
    const p2 = this.bladePath[this.bladePath.length - 1]

    // Reuse line instance (update coordinates instead of creating new)
    this.collisionLine.setTo(p1.x, p1.y, p2.x, p2.y)

    // Get nearby coins from spatial grid
    const nearbyCoinIds = this.getCoinsNearLine(p1, p2)

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

      this.collisionCircle.setTo(tokenObj.x, tokenObj.y, config.radius)

      if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
        this.sliceCoin(coinId, tokenObj)
        slicedThisFrame.add(coinId)
        // NOTE: No break here - allows multi-coin combos in single fast swipe
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
    if (this.isShutdown || !this.tokenPool) return

    // Debug logging - track coin spawn from server
    console.log(
      `[CoinSpawn] Server sent coin at (${data.x.toFixed(0)}, ${data.y.toFixed(0)}) | ` +
        `cameraHeight: ${this.cameras.main.height} | ` +
        `coinType: ${data.coinType}`
    )

    const config = COIN_CONFIG[data.coinType]
    if (!config) return

    // Get token from pool (creates new if needed)
    const token = this.tokenPool.get(data.x, data.y) as Token
    if (!token) return

    // Re-enable physics body (it was disabled when returned to pool)
    if (token.body && token.body.enable) {
      token.body.enable = true
    }

    // Initialize token state (Fruit Ninja-style bottom toss)
    // Server sends y > sceneHeight to trigger upward arc trajectory
    token.spawn(data.x, data.y, data.coinType, data.coinId, config, this.isMobile)

    // Track the actual position in the grid (after spawn, in case spawn() modified it)
    token.setData('gridX', token.x)
    token.setData('gridY', token.y)

    // Add to spatial grid using the tracked position
    this.addCoinToGrid(data.coinId, token.x, token.y)
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }): void {
    // Guard against events firing after scene shutdown
    if (this.isShutdown || !this.add || !this.cameras) return

    const config = COIN_CONFIG[data.coinType]

    // Use percentage-based margins for mobile compatibility
    const margin = Math.min(100, this.cameras.main.width * 0.15)

    // Convert color number to hex string
    const colorHex = '#' + config.color.toString(16).padStart(6, '0')

    const text = this.add
      .text(
        Phaser.Math.Between(margin, this.cameras.main.width - margin),
        Phaser.Math.Between(margin, this.cameras.main.height - margin),
        `${data.playerName}: ${data.coinType.toUpperCase()}!`,
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
    this.cameras.main.flash(100, 255, 255, 255, false)
  }

  private sliceCoin(coinId: string, coin: Token): void {
    const type = coin.getData('type') as CoinType
    const config = COIN_CONFIG[type]
    const store = useTradingStore.getState()

    // Emit slice particle burst
    this.emitSliceParticles(coin.x, coin.y, config.color, 20)

    // Create split effect (2 half-coins flying apart)
    this.createSplitEffect(coin.x, coin.y, config.color, config.radius, type)

    if (type === 'gas') {
      // Gas coins damage the slicer immediately
      // Stronger flash for gas (already handled in createSplitEffect via electrical arc)
      store.sliceCoin(coinId, type, 0)
      this.removeCoin(coinId)
      return
    }

    // Use price from store (with fallback for development/testing)
    const currentPrice = store.priceData?.price ?? DEFAULT_BTC_PRICE
    store.sliceCoin(coinId, type, currentPrice)

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015)
      // Flash already handled in createSplitEffect
    }

    this.removeCoin(coinId)
  }

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

  private createSplitEffect(
    x: number,
    y: number,
    color: number,
    radius: number,
    coinType?: CoinType
  ): void {
    const pooled = this.getSplitEffectFromPool()

    const leftHalf = pooled?.left || this.add.graphics()
    const rightHalf = pooled?.right || this.add.graphics()
    const leftContainer = pooled?.leftContainer || this.add.container(x, y)
    const rightContainer = pooled?.rightContainer || this.add.container(x, y)

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

    this.tweens.add({
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

    this.tweens.add({
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

    // Stronger bloom flash for all coins
    this.cameras.main.flash(100, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, false)
  }

  private createElectricalArc(x: number, y: number, color: number): void {
    // Create electrical arc effect using jagged lines
    const arcGraphics = this.add.graphics()
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
    this.tweens.add({
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
}
